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
 *   4. Server writes metadata row to project_files
 *   5. Server returns { id, name, storageUrl, size, mimeType }
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createProjectFile,
  getProjectFiles,
  deleteProjectFile,
  getProjectById,
  getProjectMember,
  createActivityLog,
} from "../db";
import { TRPCError } from "@trpc/server";
import { ROLE_PERMISSIONS } from "./members";
import { storagePut } from "../storage";
import multer from "multer";
import type { Express, Request, Response, NextFunction } from "express";
import { createContext } from "../_core/context";

// ── Permission helper ─────────────────────────────────────────────────────────

async function getEffectiveRole(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project.createdBy === userId) return "owner" as const;
  const member = await getProjectMember(projectId, userId);
  return member?.role ?? null;
}

// ── tRPC procedures ───────────────────────────────────────────────────────────

export const filesRouter = router({
  /** List files for a project (optionally filtered by phase) */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        phaseId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getProjectFiles(input.projectId, input.phaseId);
    }),

  /** Delete a file record (and effectively removes access to the S3 object) */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int(), projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await deleteProjectFile(input.id);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "file.delete",
        entityType: "file",
        entityId: String(input.id),
        meta: {},
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

        const { projectId, phaseId } = req.body as {
          projectId?: string;
          phaseId?: string;
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
        if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }

        const file = req.file;
        const storageKey = `projects/${projectId}/files/${Date.now()}_${file.originalname}`;

        // Upload to S3 via storagePut
        const { key, url: storageUrl } = await storagePut(
          storageKey,
          file.buffer,
          file.mimetype
        );

        // Write metadata to DB
        const fileId = await createProjectFile({
          projectId,
          phaseId: phaseId || null,
          name: file.originalname,
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
          meta: { name: file.originalname, size: file.size, mimeType: file.mimetype },
        });

        res.json({
          id: fileId,
          name: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          storageKey: key,
          storageUrl,
        });
      } catch (err: any) {
        console.error("[FileUpload] Error:", err);
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: `File too large (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)` });
          return;
        }
        res.status(500).json({ error: err.message || "Upload failed" });
      }
    }
  );
}
