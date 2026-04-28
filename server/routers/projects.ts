import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getProjectsByUser,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
} from "../db";
import { TRPCError } from "@trpc/server";

// Full project data schema (flexible JSON)
const projectDataSchema = z.record(z.string(), z.unknown());

const projectInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectNumber: z.string().default(""),
  category: z.string().default("npd"),
  pm: z.string().default(""),
  risk: z.string().default("low"),
  currentPhase: z.string().default("concept"),
  progress: z.number().default(0),
  startDate: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  data: projectDataSchema,
});

export const projectsRouter = router({
  /** List all projects for the current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await getProjectsByUser(ctx.user.id);
    return rows.map((row) => ({
      ...row,
      data: row.data as Record<string, unknown>,
    }));
  }),

  /** Get a single project by id */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await getProjectById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.createdBy !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      return { ...row, data: row.data as Record<string, unknown> };
    }),

  /** Create a new project */
  create: protectedProcedure
    .input(projectInputSchema)
    .mutation(async ({ ctx, input }) => {
      await createProject({
        id: input.id,
        name: input.name,
        projectNumber: input.projectNumber,
        category: input.category,
        pm: input.pm,
        risk: input.risk,
        currentPhase: input.currentPhase,
        progress: input.progress,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        data: input.data,
        createdBy: ctx.user.id,
        archived: false,
      });
      return { success: true };
    }),

  /** Update an existing project (full replace of data) */
  update: protectedProcedure
    .input(projectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await getProjectById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.createdBy !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

      await updateProject(input.id, {
        name: input.name,
        projectNumber: input.projectNumber,
        category: input.category,
        pm: input.pm,
        risk: input.risk,
        currentPhase: input.currentPhase,
        progress: input.progress,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        data: input.data,
      });
      return { success: true };
    }),

  /** Delete (archive) a project */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getProjectById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.createdBy !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      await deleteProject(input.id);
      return { success: true };
    }),

  /** Bulk import projects (for migration from localStorage) */
  bulkImport: protectedProcedure
    .input(z.array(projectInputSchema))
    .mutation(async ({ ctx, input }) => {
      for (const p of input) {
        const existing = await getProjectById(p.id);
        if (existing) {
          // Update if owned by this user, skip otherwise
          if (existing.createdBy === ctx.user.id) {
            await updateProject(p.id, {
              name: p.name,
              projectNumber: p.projectNumber,
              category: p.category,
              pm: p.pm,
              risk: p.risk,
              currentPhase: p.currentPhase,
              progress: p.progress,
              startDate: p.startDate ?? null,
              targetDate: p.targetDate ?? null,
              data: p.data,
            });
          }
        } else {
          await createProject({
            id: p.id,
            name: p.name,
            projectNumber: p.projectNumber,
            category: p.category,
            pm: p.pm,
            risk: p.risk,
            currentPhase: p.currentPhase,
            progress: p.progress,
            startDate: p.startDate ?? null,
            targetDate: p.targetDate ?? null,
            data: p.data,
            createdBy: ctx.user.id,
            archived: false,
          });
        }
      }
      return { success: true, count: input.length };
    }),
});
