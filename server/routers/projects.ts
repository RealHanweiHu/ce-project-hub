import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getProjectsByUser,
  getProjectsByMember,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  seedProjectPhasesAndTasks,
} from "../db";
import { TRPCError } from "@trpc/server";
import { ROLE_PERMISSIONS } from "./members";
import { getProjectMember } from "../db";

/** Resolve effective role for a user in a project */
async function getEffectiveRole(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (project.createdBy === userId) return "owner" as const;
  const member = await getProjectMember(projectId, userId);
  return member?.role ?? null;
}

const riskEnum = z.enum(["low", "medium", "high"]).default("low");

const projectInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectNumber: z.string().default(""),
  category: z.string().default("npd"),
  /** PM user id (FK to users.id) */
  pmUserId: z.number().int().nullable().optional(),
  risk: riskEnum,
  currentPhase: z.string().default("concept"),
  progress: z.number().default(0),
  startDate: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
});

export const projectsRouter = router({
  /** List all projects for the current user (owned + member) */
  list: protectedProcedure.query(async ({ ctx }) => {
    const [owned, memberOf] = await Promise.all([
      getProjectsByUser(ctx.user.id),
      getProjectsByMember(ctx.user.id),
    ]);
    const seen = new Set<string>();
    const all = [...owned, ...memberOf].filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    return all;
  }),

  /** Get a single project by id (owner or member with canView) */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await getProjectById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.id, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
      return row;
    }),

  /** Create a new project (requires canCreateProject or admin role) */
  create: protectedProcedure
    .input(projectInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if user has permission to create projects
      const canCreate = ctx.user.role === 'admin' || ctx.user.canCreateProject;
      if (!canCreate) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '您没有创建项目的权限。请联系管理员授权。',
        });
      }
      await createProject({
        id: input.id,
        name: input.name,
        projectNumber: input.projectNumber,
        category: input.category,
        pmUserId: input.pmUserId ?? null,
        risk: input.risk,
        currentPhase: input.currentPhase,
        progress: input.progress,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        createdBy: ctx.user.id,
        archived: false,
      });
      // Seed project_phases and project_tasks from SOP template
      await seedProjectPhasesAndTasks(input.id, input.category, ctx.user.id);
      return { success: true };
    }),

  /** Update an existing project metadata (requires canEditProjectInfo) */
  update: protectedProcedure
    .input(projectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await getProjectById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.id, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) throw new TRPCError({ code: "FORBIDDEN" });

      await updateProject(input.id, {
        name: input.name,
        projectNumber: input.projectNumber,
        category: input.category,
        pmUserId: input.pmUserId ?? null,
        risk: input.risk,
        currentPhase: input.currentPhase,
        progress: input.progress,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
      });
      return { success: true };
    }),

  /**
   * Delete (soft-archive) a project.
   * Allowed for: project owner, project manager role with canDeleteProject,
   * or system admin (ctx.user.role === 'admin').
   * Returns the project name so the frontend can show a confirmation message.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getProjectById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      // System admins can delete any project regardless of membership
      const isSystemAdmin = ctx.user.role === 'admin';
      if (!isSystemAdmin) {
        const role = await getEffectiveRole(input.id, ctx.user.id);
        if (!role || !ROLE_PERMISSIONS[role].canDeleteProject) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "只有项目创建者、管理员或系统管理员可以删除项目",
          });
        }
      }
      await deleteProject(input.id);
      return { success: true, projectName: existing.name };
    }),
});
