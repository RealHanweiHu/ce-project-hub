/**
 * files router — PLM Document Governance
 *
 * Upgraded from simple upload/list/delete to full document lifecycle:
 * - Version management (upload new version → previous becomes non-latest)
 * - Approval workflow (draft → pending_review → approved/rejected → obsolete)
 * - File categorization (PRD, BOM, drawing, test_report, etc.)
 * - Phase deliverables (required documents per gate)
 * - Content hash for deduplication
 * - Audit trail with old/new values
 *
 * Upload still uses Express route (multipart/form-data).
 * All other operations use tRPC procedures.
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
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { createContext } from "../_core/context";
import { getDb } from "../db";
import { projectFiles, phaseDeliverables, FILE_CATEGORIES, FILE_APPROVAL_STATUSES } from "../../drizzle/schema";
import { eq, and, desc, isNull } from "drizzle-orm";

// ── Permission helper ─────────────────────────────────────────────────────────

async function getEffectiveRole(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project.createdBy === userId) return "owner" as const;
  const member = await getProjectMember(projectId, userId);
  return member?.role ?? null;
}

// ── S3 invalidation (best-effort) ────────────────────────────────────────────

async function tryInvalidateS3Object(storageKey: string): Promise<void> {
  try {
    const forgeBaseUrl = (process.env.BUILT_IN_FORGE_API_URL || "").replace(/\/+$/, "");
    const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
    if (!forgeBaseUrl || !forgeKey) return;
    const url = new URL("v1/storage/delete", forgeBaseUrl + "/");
    url.searchParams.set("path", storageKey);
    const resp = await fetch(url.toString(), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${forgeKey}` },
    });
    if (!resp.ok) {
      console.warn(`[FileDelete] S3 invalidation returned ${resp.status} for key: ${storageKey}`);
    }
  } catch (err) {
    console.warn("[FileDelete] S3 invalidation failed (non-fatal):", err);
  }
}

// ── Content hash helper ──────────────────────────────────────────────────────

function computeContentHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// ── tRPC procedures ───────────────────────────────────────────────────────────

export const filesRouter = router({
  /**
   * List files for a project with enhanced filtering.
   * Supports: phaseId, taskId, category, approvalStatus, latestOnly.
   */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        phaseId: z.string().optional(),
        taskId: z.string().optional(),
        category: z.enum(FILE_CATEGORIES).optional(),
        approvalStatus: z.enum(FILE_APPROVAL_STATUSES).optional(),
        latestOnly: z.boolean().optional().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Build conditions
      const conditions: any[] = [
        eq(projectFiles.projectId, input.projectId),
        isNull(projectFiles.deletedAt),
      ];
      if (input.phaseId) conditions.push(eq(projectFiles.phaseId, input.phaseId));
      if (input.taskId) conditions.push(eq(projectFiles.taskId, input.taskId));
      if (input.category) conditions.push(eq(projectFiles.category, input.category));
      if (input.approvalStatus) conditions.push(eq(projectFiles.approvalStatus, input.approvalStatus));
      if (input.latestOnly) conditions.push(eq(projectFiles.isLatest, true));

      const db = (await getDb())!;
      const files = await db
        .select()
        .from(projectFiles)
        .where(and(...conditions))
        .orderBy(desc(projectFiles.createdAt));

      return files;
    }),

  /**
   * Get version history for a specific file (all versions in the chain).
   */
  versionHistory: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        fileId: z.number().int(),
      })
    )
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Get the target file first
      const db2 = (await getDb())!;
      const [targetFile] = await db2
        .select()
        .from(projectFiles)
        .where(and(eq(projectFiles.id, input.fileId), eq(projectFiles.projectId, input.projectId)));

      if (!targetFile) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Find all files with the same name in the same project/phase (version chain)
      const conditions: any[] = [
        eq(projectFiles.projectId, input.projectId),
        eq(projectFiles.name, targetFile.name),
        isNull(projectFiles.deletedAt),
      ];
      if (targetFile.phaseId) conditions.push(eq(projectFiles.phaseId, targetFile.phaseId));

      const versions = await db2
        .select()
        .from(projectFiles)
        .where(and(...conditions))
        .orderBy(desc(projectFiles.createdAt));

      return versions;
    }),

  /**
   * Update file metadata (category, approval status).
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        projectId: z.string(),
        category: z.enum(FILE_CATEGORIES).optional(),
        approvalStatus: z.enum(FILE_APPROVAL_STATUSES).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = (await getDb())!;
      const [existing] = await db
        .select()
        .from(projectFiles)
        .where(and(eq(projectFiles.id, input.id), eq(projectFiles.projectId, input.projectId)));

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updates: Record<string, any> = {};
      const oldValues: Record<string, any> = {};
      const newValues: Record<string, any> = {};

      if (input.category && input.category !== existing.category) {
        updates.category = input.category;
        oldValues.category = existing.category;
        newValues.category = input.category;
      }
      if (input.approvalStatus && input.approvalStatus !== existing.approvalStatus) {
        updates.approvalStatus = input.approvalStatus;
        oldValues.approvalStatus = existing.approvalStatus;
        newValues.approvalStatus = input.approvalStatus;
        // Track approval
        if (input.approvalStatus === "approved") {
          updates.approvedBy = ctx.user.id;
          updates.approvedAt = new Date();
        }
      }

      if (Object.keys(updates).length > 0) {
        await db.update(projectFiles).set(updates).where(eq(projectFiles.id, input.id));

        // Determine action type for audit
        const action = input.approvalStatus === "approved" ? "file.approve" :
                       input.approvalStatus === "rejected" ? "file.reject" : "file.upload";

        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action,
          entityType: "file",
          entityId: String(input.id),
          meta: { name: existing.name },
          oldValues,
          newValues,
        });
      }

      return { success: true };
    }),

  /**
   * Soft-delete a file record.
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
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = (await getDb())!;
      const [existing] = await db
        .select()
        .from(projectFiles)
        .where(and(eq(projectFiles.id, input.id), eq(projectFiles.projectId, input.projectId)));

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      }

      // Soft delete
      await db.update(projectFiles).set({ deletedAt: new Date() }).where(eq(projectFiles.id, input.id));

      // Best-effort S3 invalidation (non-blocking)
      void tryInvalidateS3Object(existing.storageKey);

      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "file.delete",
        entityType: "file",
        entityId: String(input.id),
        meta: { storageKey: existing.storageKey, name: existing.name },
      });

      return { success: true };
    }),

  // ── Phase Deliverables ──────────────────────────────────────────────────────

  /**
   * List required deliverables for a phase.
   */
  listDeliverables: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        phaseId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = (await getDb())!;
      const deliverables = await db
        .select()
        .from(phaseDeliverables)
        .where(
          and(
            eq(phaseDeliverables.projectId, input.projectId),
            eq(phaseDeliverables.phaseId, input.phaseId)
          )
        );

      return deliverables;
    }),

  /**
   * Create a required deliverable for a phase.
   */
  createDeliverable: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        phaseId: z.string(),
        name: z.string().min(1),
        fileCategory: z.enum(FILE_CATEGORIES).optional().default("other"),
        isMandatory: z.boolean().optional().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = (await getDb())!;
      const [result] = await db.insert(phaseDeliverables).values({
        projectId: input.projectId,
        phaseId: input.phaseId,
        name: input.name,
        fileCategory: input.fileCategory,
        isMandatory: input.isMandatory,
      });

      return { id: result.insertId };
    }),

  /**
   * Link a file to a deliverable (mark as fulfilled).
   */
  linkDeliverable: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        deliverableId: z.number().int(),
        fileId: z.number().int(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = (await getDb())!;
      await db
        .update(phaseDeliverables)
        .set({ fileId: input.fileId, status: "uploaded" })
        .where(eq(phaseDeliverables.id, input.deliverableId));

      return { success: true };
    }),

  /**
   * Delete a deliverable requirement.
   */
  deleteDeliverable: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        deliverableId: z.number().int(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const db = (await getDb())!;
      await db.delete(phaseDeliverables).where(eq(phaseDeliverables.id, input.deliverableId));
      return { success: true };
    }),
});

// ── Express upload route (enhanced with versioning + category) ────────────────

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB (increased for engineering docs)

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

/**
 * Register the multipart upload endpoint on the Express app.
 *
 * POST /api/files/upload
 * Form fields:
 *   file             (required) - the file to upload
 *   projectId        (required) - target project id
 *   phaseId          (optional) - associate with a specific phase
 *   taskId           (optional) - associate with a specific task
 *   category         (optional) - file category (prd, bom, drawing, etc.)
 *   version          (optional) - version string (e.g. "1.0", "2.0")
 *   previousVersionId (optional) - ID of previous version file
 */
export function registerFileUploadRoute(app: Express) {
  app.post(
    "/api/files/upload",
    uploadMiddleware.single("file"),
    async (req: Request, res: Response) => {
      try {
        // Resolve user from session cookie
        const ctx = await createContext(
          { req, res } as import("@trpc/server/adapters/express").CreateExpressContextOptions
        );
        if (!ctx.user) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        const {
          projectId,
          phaseId,
          taskId,
          category,
          version,
          previousVersionId,
        } = req.body as {
          projectId?: string;
          phaseId?: string;
          taskId?: string;
          category?: string;
          version?: string;
          previousVersionId?: string;
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
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, "_");
        const storageKey = `projects/${projectId}/files/${Date.now()}_${safeName}`;

        // Compute content hash for deduplication
        const contentHash = computeContentHash(file.buffer);

        // Upload to S3
        const { key, url: storageUrl } = await storagePut(
          storageKey,
          file.buffer,
          file.mimetype
        );

        // If this is a new version, mark previous as non-latest
        const prevId = previousVersionId ? parseInt(previousVersionId, 10) : null;
        if (prevId) {
          const db = (await getDb())!;
          await db
            .update(projectFiles)
            .set({ isLatest: false })
            .where(eq(projectFiles.id, prevId));
        }

        // Determine version string
        const versionStr = version || "1.0";

        // Validate category
        const validCategory = FILE_CATEGORIES.includes(category as any) ? category : "other";

        // Write metadata to DB with PLM fields
        const fileId = await createProjectFile({
          projectId,
          phaseId: phaseId || null,
          taskId: taskId || null,
          name: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          storageKey: key,
          storageUrl,
          uploadedBy: ctx.user.id,
          version: versionStr,
          isLatest: true,
          previousVersionId: prevId,
          contentHash,
          category: validCategory as any,
          approvalStatus: "draft",
        });

        // Activity log
        const action = prevId ? "file.new_version" : "file.upload";
        await createActivityLog({
          projectId,
          userId: ctx.user.id,
          action,
          entityType: "file",
          entityId: String(fileId),
          meta: {
            name: file.originalname,
            size: file.size,
            mimeType: file.mimetype,
            version: versionStr,
            category: validCategory,
            previousVersionId: prevId,
            contentHash,
          },
        });

        res.json({
          id: fileId,
          name: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          storageKey: key,
          storageUrl,
          version: versionStr,
          category: validCategory,
          contentHash,
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
