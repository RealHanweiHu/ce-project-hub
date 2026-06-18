/**
 * files router
 *
 * File upload uses a dedicated Express route (POST /api/files/upload) rather than
 * tRPC because tRPC does not natively support multipart/form-data.
 * The tRPC procedures here handle listing and deleting file metadata.
 *
 * Upload flow:
 *   1. Client POSTs multipart/form-data to /api/files/upload
 *   2. multer buffers the file in memory (16 MB limit)
 *   3. Server calls storagePut → S3
 *   4. Server writes metadata row to project_files (with phaseId + taskId)
 *   5. Server returns { id, name, storageUrl, size, mimeType, taskId }
 *
 * Delete flow:
 *   1. Client calls trpc.files.delete mutation
 *   2. Server fetches storageKey from DB, deletes DB row
 *   3. Server attempts to invalidate S3 object (best-effort, non-fatal)
 *   4. Server writes activity log entry
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createProjectFile,
  getProjectFiles,
  getProjectFileById,
  deleteProjectFile,
  createActivityLog,
} from "../db";
import { TRPCError } from "@trpc/server";
import { ROLE_PERMISSIONS } from "./members";
import { storagePut, storageDelete } from "../storage";
import multer from "multer";
import type { Express, Request, Response } from "express";
import { createContext } from "../_core/context";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";

// ── Permission helper ─────────────────────────────────────────────────────────

function canMutateFile(role: keyof typeof ROLE_PERMISSIONS, taskScoped: boolean) {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.canEditProjectInfo || (taskScoped && permissions.canEditTasks);
}

// ── S3 invalidation (best-effort) ────────────────────────────────────────────

/**
 * Attempt to delete an S3 object by key.
 * Non-fatal: logs a warning on failure rather than throwing.
 */
async function tryInvalidateS3Object(storageKey: string): Promise<void> {
  try {
    await storageDelete(storageKey);
  } catch (err) {
    console.warn("[FileDelete] S3 invalidation failed (non-fatal):", err);
  }
}

// ── tRPC procedures ───────────────────────────────────────────────────────────

export const filesRouter = router({
  /**
   * List files for a project.
   * Optional filters: phaseId, taskId.
   * Returns files ordered by upload time (oldest first).
   */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        phaseId: z.string().optional(),
        taskId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getProjectFiles(input.projectId, input.phaseId, input.taskId);
    }),

  /**
   * Delete a file record.
   * - Removes the DB row
   * - Attempts to invalidate the S3 object (best-effort)
   * - Writes an activity log entry
   */
  delete: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        projectId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      const file = await getProjectFileById(input.id);
      if (!file || file.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      }
      if (!role || !canMutateFile(role, !!file.taskId)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const deleted = await deleteProjectFile(input.id);
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      }

      // Best-effort S3 invalidation (non-blocking)
      void tryInvalidateS3Object(deleted.storageKey);

      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "file.delete",
        entityType: "file",
        entityId: String(input.id),
        meta: { storageKey: deleted.storageKey },
      });

      return { success: true };
    }),
});

// ── Express upload route ──────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024; // 16 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

/**
 * Register the multipart upload endpoint on the Express app.
 * Call this from server/_core/index.ts after auth routes.
 *
 * POST /api/files/upload
 * Form fields:
 *   file      (required) - the file to upload
 *   projectId (required) - target project id
 *   phaseId   (optional) - associate with a specific phase
 *   taskId    (optional) - associate with a specific task within the phase
 */
export function registerFileUploadRoute(app: Express) {
  app.post(
    "/api/files/upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        // Resolve user from session cookie (reuse tRPC context factory)
        const ctx = await createContext(
          { req, res } as import("@trpc/server/adapters/express").CreateExpressContextOptions
        );
        if (!ctx.user) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        const { projectId, phaseId, taskId, deliverableName } = req.body as {
          projectId?: string;
          phaseId?: string;
          taskId?: string;
          deliverableName?: string;
        };

        if (!projectId) {
          res.status(400).json({ error: "projectId is required" });
          return;
        }

        if (!req.file) {
          res.status(400).json({ error: "No file provided" });
          return;
        }

        // Permission check
        const role = await getEffectiveRole(projectId, ctx.user.id);
        if (!role || !canMutateFile(role, !!taskId)) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }

        const file = req.file;
        // multer decodes the multipart filename as latin1, but browsers send it
        // as UTF-8 \u2014 re-decode so non-ASCII names (e.g. Chinese) aren't mojibake.
        const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
        // \u5b58\u50a8 key \u53ea\u7528 ASCII\uff08\u907f\u514d S3/URL \u5bf9\u4e2d\u6587 key \u7684\u7f16\u7801\u95ee\u9898\uff09\uff1b\u5c55\u793a\u540d originalName \u4ecd\u5b58\u4e2d\u6587\u3002
        const dot = originalName.lastIndexOf(".");
        const ext = dot >= 0 ? originalName.slice(dot).replace(/[^a-zA-Z0-9.]/g, "") : "";
        const asciiBase = (dot >= 0 ? originalName.slice(0, dot) : originalName)
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "") || "file";
        const storageKey = `projects/${projectId}/files/${Date.now()}_${asciiBase}${ext}`;

        // Upload to S3 via storagePut
        const { key, url: storageUrl } = await storagePut(
          storageKey,
          file.buffer,
          file.mimetype
        );

        // Write metadata to DB (including optional taskId)
        const fileId = await createProjectFile({
          projectId,
          phaseId: phaseId || null,
          taskId: taskId || null,
          deliverableName: deliverableName || null,
          name: originalName,
          mimeType: file.mimetype,
          size: file.size,
          storageKey: key,
          storageUrl,
          uploadedBy: ctx.user.id,
        });

        // Activity log
        await createActivityLog({
          projectId,
          userId: ctx.user.id,
          action: "file.upload",
          entityType: "file",
          entityId: String(fileId),
          meta: {
            name: originalName,
            size: file.size,
            mimeType: file.mimetype,
            phaseId: phaseId || null,
            taskId: taskId || null,
          },
        });

        res.json({
          id: fileId,
          name: originalName,
          mimeType: file.mimetype,
          size: file.size,
          storageKey: key,
          storageUrl,
          taskId: taskId || null,
        });
      } catch (err: any) {
        console.error("[FileUpload] Error:", err);
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({
            error: `File too large (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)`,
          });
          return;
        }
        res.status(500).json({ error: err.message || "Upload failed" });
      }
    }
  );
}
