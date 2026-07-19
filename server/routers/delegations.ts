import { and, eq, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PROJECT_MEMBER_ROLES, projectRoleDelegations } from "../../drizzle/schema";
import { isShanghaiDateInInclusiveRange } from "../../shared/project-roles";
import { todayShanghai } from "../../shared/shanghai-date";
import { isSystemAdminRole } from "../../shared/system-roles";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createActivityLog,
  createProjectRoleDelegation,
  getDb,
  getProjectById,
  listProjectRoleDelegations,
  revokeProjectRoleDelegation,
} from "../db";
import { getEffectiveProjectRoles, getUnionPermissions } from "../project-access";
import { notifyPersonal } from "../notification-gateway";
import { buildProjectActionPath } from "../../shared/action-links";

async function assertCanManage(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  const roles = await getEffectiveProjectRoles(project, userId);
  if (!getUnionPermissions(roles).canManageMembers) {
    throw new TRPCError({ code: "FORBIDDEN", message: "没有代理人管理权限" });
  }
  return project;
}

export const delegationsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertCanManage(input.projectId, ctx.user.id);
      return listProjectRoleDelegations(input.projectId);
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      role: z.enum(PROJECT_MEMBER_ROLES).refine((role) => role !== "owner", "不能代理创建者身份"),
      fromUserId: z.number().int().positive().nullable().optional(),
      toUserId: z.number().int().positive(),
      startDate: z.string(),
      endDate: z.string(),
      reason: z.string().trim().min(2).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await assertCanManage(input.projectId, ctx.user.id);
      if (!isShanghaiDateInInclusiveRange(input.startDate, input.startDate, input.endDate)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "代理日期范围无效" });
      }
      if (input.endDate < todayShanghai()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "代理结束日期不能早于今天" });
      }
      // 管理层身份进入四眼升级链：manager 代理只能由管理层/系统管理员建立，
      // 防止 canManageMembers 级角色（PM）经代理表自授管理层权限。
      if (input.role === "manager" && !isSystemAdminRole(ctx.user.role)) {
        const actorRoles = await getEffectiveProjectRoles(project, ctx.user.id);
        if (!actorRoles.has("manager") && !actorRoles.has("owner")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层或系统管理员可以建立管理层代理" });
        }
      }
      const targetRoles = await getEffectiveProjectRoles(project, input.toUserId);
      if (targetRoles.size === 0 || !getUnionPermissions(targetRoles).canViewInternalWorkspace) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "代理人必须是可访问项目内部工作区的成员" });
      }
      if (input.fromUserId === input.toUserId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能把岗位代理给本人" });
      }
      if (input.fromUserId != null) {
        const fromRoles = await getEffectiveProjectRoles(project, input.fromUserId);
        if (!fromRoles.has(input.role)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "被代理人当前不持有该岗位" });
        }
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [overlap] = await db.select({ id: projectRoleDelegations.id })
        .from(projectRoleDelegations)
        .where(and(
          eq(projectRoleDelegations.projectId, input.projectId),
          eq(projectRoleDelegations.role, input.role),
          eq(projectRoleDelegations.toUserId, input.toUserId),
          eq(projectRoleDelegations.active, true),
          lte(projectRoleDelegations.startDate, input.endDate),
          gte(projectRoleDelegations.endDate, input.startDate),
        )).limit(1);
      if (overlap) throw new TRPCError({ code: "CONFLICT", message: "该代理人在此日期范围已有同岗位代理" });

      const row = await createProjectRoleDelegation({
        ...input,
        fromUserId: input.fromUserId ?? null,
        createdBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId, userId: ctx.user.id, action: "role_delegation.create",
        entityType: "role_delegation", entityId: String(row.id),
        meta: { role: row.role, fromUserId: row.fromUserId, toUserId: row.toUserId, startDate: row.startDate, endDate: row.endDate },
      });
      await notifyPersonal({
        eventKey: "exception_escalation",
        projectId: input.projectId,
        userIds: [row.toUserId, ...(row.fromUserId ? [row.fromUserId] : [])],
        title: "项目岗位代理已建立",
        body: `${row.role} 岗位由用户 ${row.toUserId} 代理，生效期 ${row.startDate} 至 ${row.endDate}。`,
        entityType: "role_delegation",
        entityId: String(row.id),
        actionPath: buildProjectActionPath({ projectId: input.projectId, tab: "overview" }),
        bestEffortDingtalk: true,
      });
      return row;
    }),

  revoke: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManage(input.projectId, ctx.user.id);
      const row = await revokeProjectRoleDelegation(input.projectId, input.id, ctx.user.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "代理记录不存在或已撤销" });
      await createActivityLog({
        projectId: input.projectId, userId: ctx.user.id, action: "role_delegation.revoke",
        entityType: "role_delegation", entityId: String(row.id), meta: { role: row.role, toUserId: row.toUserId },
      });
      await notifyPersonal({
        eventKey: "exception_escalation",
        projectId: input.projectId,
        userIds: [row.toUserId, ...(row.fromUserId ? [row.fromUserId] : [])],
        title: "项目岗位代理已撤销",
        body: `${row.role} 岗位代理已撤销。`,
        entityType: "role_delegation",
        entityId: String(row.id),
        actionPath: buildProjectActionPath({ projectId: input.projectId, tab: "overview" }),
        bestEffortDingtalk: true,
      });
      return { success: true };
    }),
});
