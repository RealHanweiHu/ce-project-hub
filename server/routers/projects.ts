import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getProjectsByUser,
  getProjectsByMember,
  getProjectById,
  createProjectWithSeed,
  updateProject,
  deleteProject,
  getPortfolio,
  createActivityLog,
  getMeetingParticipants,
  ensureProjectMember,
  assignTasksByRole,
  updateProjectMeetingConfig,
  updateProjectDingtalkEvent,
  setUserDingtalkId,
  applyProjectSchedule,
} from "../db";
import { TRPCError } from "@trpc/server";
import { ROLE_PERMISSIONS } from "./members";
import { syncProjectMeeting } from "../_core/meetingSync";
import { resolveDingtalkUserId } from "../_core/dingtalk";
import { upsertWeeklyMeeting } from "../_core/dingtalkCalendar";
import { notifyUsersViaDingtalk, resolveCorpIdsForUsers } from "../_core/dingtalkMessage";
import { createGroupChat, sendToGroupChat } from "../_core/dingtalkGroup";
import { getProjectMembers } from "../db";
import { getPhasesForCategory } from "../../shared/sop-templates";
import { PROJECT_MEMBER_ROLES } from "../../drizzle/schema";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";
import { isISODate } from "../../shared/scheduling";

const DEFAULT_MEETING = { enabled: true, weekday: 3, time: "15:00", durationMin: 60, title: "项目周会" };
const isoDateInput = z.string().refine(isISODate, "日期必须是有效的 YYYY-MM-DD");

/** 按角色分配未分配任务 + (可选)逐人发钉钉通知。assignByRole / kickoff 共用。 */
async function assignAndNotify(
  project: { id: string; name: string; category: string; dingtalkChatId?: string | null },
  actorId: number,
  notify: boolean
): Promise<{ assigned: number; recipients: number; notified: number }> {
  const assignments = await assignTasksByRole(project.id, actorId);
  const nameMap = new Map<string, string>();
  for (const phase of getPhasesForCategory(project.category)) {
    for (const t of phase.tasks) nameMap.set(t.id, t.name);
  }
  const byUser = new Map<number, Array<{ taskId: string; dueDate: string | null }>>();
  for (const a of assignments) {
    const arr = byUser.get(a.userId) ?? [];
    arr.push({ taskId: a.taskId, dueDate: a.dueDate });
    byUser.set(a.userId, arr);
  }
  let notified = 0;
  if (notify) {
    for (const [userId, items] of Array.from(byUser.entries())) {
      const lines = items
        .map((i: { taskId: string; dueDate: string | null }) => `- ${nameMap.get(i.taskId) ?? i.taskId}${i.dueDate ? `（截止 ${i.dueDate}）` : ""}`)
        .join("\n");
      const md = `### 项目「${project.name}」任务分配\n你被指派以下 ${items.length} 项任务：\n${lines}`;
      try { await notifyUsersViaDingtalk([userId], "项目任务分配", md); notified += 1; }
      catch (e) { console.warn("[assign] dingtalk notify failed (non-fatal):", e); }
    }
    // 同步发一份汇总到项目群(若已建群)
    if (project.dingtalkChatId && assignments.length > 0) {
      const summary = `### 项目「${project.name}」任务已分配\n共 ${assignments.length} 项任务分给 ${byUser.size} 位负责人,详情见各自钉钉工作通知。`;
      try { await sendToGroupChat(project.dingtalkChatId, "任务分配", summary); } catch { /* 非阻断 */ }
    }
  }
  return { assigned: assignments.length, recipients: byUser.size, notified };
}

const riskEnum = z.enum(["low", "medium", "high"]).default("low");

const projectInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectNumber: z.string().default(""),
  category: z.string().default("npd"),
  /** PM user id (FK to users.id) */
  pmUserId: z.number().int().nullable().optional(),
  /** 关联产品(产品库 id);NPD 新产品可暂空 */
  productId: z.string().nullable().optional(),
  risk: riskEnum,
  currentPhase: z.string().default("concept"),
  progress: z.number().default(0),
  startDate: isoDateInput.nullable().optional(),
  targetDate: isoDateInput.nullable().optional(),
  /** 立项基础信息 */
  description: z.string().nullable().optional(),
  customer: z.string().nullable().optional(),
  background: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  /** 自定义字段值 fieldKey -> value */
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const projectsRouter = router({
  /** 跨项目组合看板：用户可见项目 + 健康度聚合 */
  portfolio: protectedProcedure.query(async ({ ctx }) => {
    const { getPortfolio } = await import("../db");
    return getPortfolio(ctx.user.id);
  }),

  /** 里程碑日历：时间窗内的阶段截止/Gate/目标日事件 */
  calendar: protectedProcedure
    .input(z.object({ fromDate: z.string(), toDate: z.string() }))
    .query(async ({ ctx, input }) => {
      const { getCalendar } = await import("../db");
      return getCalendar(ctx.user.id, input.fromDate, input.toDate);
    }),

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
    const portfolio = await getPortfolio(ctx.user.id);
    const autoRiskByProject = new Map(portfolio.map((p) => [p.id, p.risk]));
    return all.map((row) => ({ ...row, risk: autoRiskByProject.get(row.id) ?? "low" }));
  }),

  /** Get a single project by id (owner or member with canView) */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await getProjectById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.id, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
      const portfolio = await getPortfolio(ctx.user.id);
      const health = portfolio.find((item) => item.id === input.id);
      return health ? { ...row, risk: health.risk } : row;
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
        productId: input.productId ?? null,
        description: input.description ?? null,
        customer: input.customer ?? null,
        background: input.background ?? null,
        value: input.value ?? null,
        risk: "low",
        currentPhase: input.currentPhase,
        progress: input.progress,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        createdBy: ctx.user.id,
        archived: false,
      }, input.category, ctx.user.id);
      // 选了 PM 且不是创建者本人 → 自动加入项目成员并赋 pm 角色（否则 PM 看不到项目）
      if (input.pmUserId && input.pmUserId !== ctx.user.id) {
        try { await ensureProjectMember(input.id, input.pmUserId, "pm", ctx.user.id); }
        catch (e) { console.warn("[member] add pm on create failed (non-fatal):", e); }
      }
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
        const members = await getMeetingParticipants(input.id, project?.pmUserId ?? null);
        await syncProjectMeeting({
          project: project as never,
          config: DEFAULT_MEETING,
          members,
          todayISO: new Date().toISOString().slice(0, 10),
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
        productId: input.productId ?? null,
        description: input.description ?? null,
        customer: input.customer ?? null,
        background: input.background ?? null,
        value: input.value ?? null,
        currentPhase: input.currentPhase,
        progress: input.progress,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        ...(input.customFields !== undefined ? { customFields: input.customFields } : {}),
      });
      // PM 变更 → 确保新 PM 是成员(否则换了 PM 后对方看不到项目)
      if (input.pmUserId && input.pmUserId !== existing.pmUserId && input.pmUserId !== existing.createdBy) {
        try { await ensureProjectMember(input.id, input.pmUserId, "pm", ctx.user.id); }
        catch (e) { console.warn("[member] add pm on update failed (non-fatal):", e); }
      }
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
   * 按角色把未分配任务自动指派给对应成员,并给每位负责人发钉钉通知(含任务+截止日)。
   * 立项后由创建者/PM 在指定好各角色成员后触发。需 canEditProjectInfo。
   */
  assignByRole: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Owner/管理层/PM 可分配负责人" });
      }

      const r = await assignAndNotify(project, ctx.user.id, true);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "project.assign_by_role",
        entityType: "project",
        entityId: input.projectId,
        meta: { assigned: r.assigned, recipients: r.recipients },
      });
      return { success: true, ...r };
    }),

  /**
   * 立项向导:一步完成「设置开始日(生成排期) + 各角色配人 + 按角色分配任务 + 钉钉通知」。
   * 需 canEditProjectInfo。
   */
  kickoff: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      startDate: isoDateInput.nullable().optional(),
      staffing: z.array(z.object({
        role: z.enum(PROJECT_MEMBER_ROLES),
        userId: z.number().int(),
      })).default([]),
      notify: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Owner/管理层/PM 可执行立项向导" });
      }

      // 1) 开始日 → 生成整套排期(非阻断)
      if (input.startDate && input.startDate !== project.startDate) {
        try {
          await updateProject(input.projectId, { startDate: input.startDate });
          await applyProjectSchedule(input.projectId);
        } catch (e) { console.warn("[kickoff] schedule failed (non-fatal):", e); }
      }

      // 2) 各角色配人(去重;跳过创建者本人,避免覆盖 owner)
      let staffed = 0;
      const seen = new Set<string>();
      for (const s of input.staffing) {
        const key = `${s.role}:${s.userId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (s.userId === project.createdBy) continue;
        try { if (await ensureProjectMember(input.projectId, s.userId, s.role, ctx.user.id)) staffed += 1; }
        catch (e) { console.warn("[kickoff] staffing failed (non-fatal):", e); }
      }

      // 3) 按角色分配任务 + 通知
      const r = await assignAndNotify(
        { id: project.id, name: project.name, category: project.category, dingtalkChatId: project.dingtalkChatId },
        ctx.user.id,
        input.notify,
      );
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "project.kickoff",
        entityType: "project",
        entityId: input.projectId,
        meta: { staffed, assigned: r.assigned, recipients: r.recipients, startDate: input.startDate ?? null },
      });
      return { success: true, staffed, ...r };
    }),

  /**
   * 为项目创建/绑定钉钉对接群:群主取 PM(无则创建者),成员取项目成员。
   * 成功后回填 dingtalkChatId,后续项目提醒发到此群。需 canEditProjectInfo + 已建群权限。
   */
  createDingtalkGroup: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Owner/管理层/PM 可创建项目群" });
      }
      if (project.dingtalkChatId) {
        return { success: true, chatId: project.dingtalkChatId, already: true };
      }

      const ownerUserId = project.pmUserId ?? project.createdBy;
      const [ownerCorp] = await resolveCorpIdsForUsers([ownerUserId]);
      if (!ownerCorp) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "群主(PM/创建者)需先在「成员/系统管理」里配置手机号" });
      }
      const members = await getProjectMembers(input.projectId);
      const memberCorps = await resolveCorpIdsForUsers(
        members.map((m) => m.userId).filter((id) => id !== ownerUserId)
      );

      const res = await createGroupChat(`【${project.name}】项目群`, ownerCorp, memberCorps);
      if (!res.ok) throw new TRPCError({ code: "BAD_REQUEST", message: res.error });

      await updateProject(input.projectId, { dingtalkChatId: res.chatId });
      await sendToGroupChat(
        res.chatId,
        "项目群已创建",
        `### 【${project.name}】项目对接群\n本群用于该项目对接,逾期/Gate/任务/周会等提醒会自动发到这里。`
      );
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "project.create_group",
        entityType: "project",
        entityId: input.projectId,
        meta: { chatId: res.chatId, members: memberCorps.length + 1 },
      });
      return { success: true, chatId: res.chatId, already: false };
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
