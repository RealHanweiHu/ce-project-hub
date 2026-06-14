import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getProjectsByUser,
  getProjectsByMember,
  getProjectById,
  createProjectWithSeed,
  updateProject,
  deleteProject,
  createActivityLog,
  getProjectMembers,
  updateProjectMeetingConfig,
  updateProjectDingtalkEvent,
  setUserDingtalkId,
  applyProjectSchedule,
} from "../db";
import { TRPCError } from "@trpc/server";
import { ROLE_PERMISSIONS } from "./members";
import { getProjectMember } from "../db";
import { syncProjectMeeting } from "../_core/meetingSync";
import { resolveDingtalkUserId } from "../_core/dingtalk";
import { upsertWeeklyMeeting } from "../_core/dingtalkCalendar";

const DEFAULT_MEETING = { enabled: true, weekday: 3, time: "15:00", durationMin: 60, title: "项目周会" };

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
  /** 自定义字段值 fieldKey -> value */
  customFields: z.record(z.string(), z.unknown()).optional(),
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
      await createProjectWithSeed({
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
      }, input.category, ctx.user.id);
      // 有开始日 → 按 IPD 依赖图自动生成整套任务起止日（非阻断）
      if (input.startDate) {
        try { await applyProjectSchedule(input.id); }
        catch (e) { console.warn("[schedule] generate failed (non-fatal):", e); }
      }
      await createActivityLog({
        projectId: input.id,
        userId: ctx.user.id,
        action: "project.create",
        entityType: "project",
        entityId: input.id,
        meta: {
          name: input.name,
          category: input.category,
          projectNumber: input.projectNumber,
        },
      });
      // 默认周会配置 + 尝试建钉钉日程（降级安全，绝不阻断建项目）
      try {
        await updateProjectMeetingConfig(input.id, DEFAULT_MEETING);
        const project = await getProjectById(input.id);
        const members = await getProjectMembers(input.id);
        await syncProjectMeeting({
          project: project as never,
          config: DEFAULT_MEETING,
          members: members as never,
          deps: {
            resolveUserId: (u) => resolveDingtalkUserId(u, setUserDingtalkId),
            upsert: upsertWeeklyMeeting,
            saveEventId: updateProjectDingtalkEvent,
            // 建项目阶段静默降级（不推群），避免成员手机号还没配时每建一个项目就刷群；
            // PM 之后在周会编辑器显式保存时才会走群推降级。
            groupPush: async () => {},
          },
        });
      } catch (e) {
        console.warn("[meeting] create sync failed (non-fatal):", e);
      }
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
        ...(input.customFields !== undefined ? { customFields: input.customFields } : {}),
      });
      await createActivityLog({
        projectId: input.id,
        userId: ctx.user.id,
        action: "project.update",
        entityType: "project",
        entityId: input.id,
        meta: {
          name: input.name,
          projectNumber: input.projectNumber,
          category: input.category,
          currentPhase: input.currentPhase,
        },
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
      await createActivityLog({
        projectId: input.id,
        userId: ctx.user.id,
        action: "project.delete",
        entityType: "project",
        entityId: input.id,
        meta: { name: existing.name },
      });
      return { success: true, projectName: existing.name };
    }),
});
