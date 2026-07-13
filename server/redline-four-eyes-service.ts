import { and, eq, ne } from "drizzle-orm";
import type { ProjectMemberRole } from "../drizzle/schema";
import {
  projectRoleFallbackReviewers,
  users,
} from "../drizzle/schema";
import { todayShanghai } from "../shared/shanghai-date";
import { isSystemExternalRole } from "../shared/system-roles";
import {
  getDb,
  getProjectById,
  getProjectMembers,
  listProjectRoleDelegations,
} from "./db";
import { normalizeExtraRoles } from "../shared/project-roles";

export type RedlineReviewerEscalation = {
  userId: number;
  actedAsRole: ProjectMemberRole;
  viaDelegationId: number | null;
  source: "management" | "delegation" | "fallback";
};

export async function findRedlineReviewerEscalation(input: {
  projectId: string;
  role: ProjectMemberRole;
  submitterUserId: number;
}): Promise<RedlineReviewerEscalation | null> {
  const [project, members] = await Promise.all([
    getProjectById(input.projectId),
    getProjectMembers(input.projectId),
  ]);
  if (!project) return null;
  // 升级人选必须确定性排序：提交时与评审时重算若返回不同人，会把已指派的
  // 复核人推入"角色不匹配"死胡同（评审入口按 escalation.userId === 当前人放行）。
  const management = [
    ...members.filter((member) =>
      member.userId !== input.submitterUserId &&
      [member.role, ...normalizeExtraRoles(member.role, member.extraRoles)]
        .some((role) => role === "manager" || role === "owner")
    ).map((member) => member.userId).sort((a, b) => a - b),
    ...(project.createdBy !== input.submitterUserId ? [project.createdBy] : []),
  ];
  if (management[0]) {
    return { userId: management[0], actedAsRole: input.role, viaDelegationId: null, source: "management" };
  }

  const today = todayShanghai();
  const delegations = (await listProjectRoleDelegations(input.projectId)).filter((item) =>
    item.active && item.role === input.role && item.toUserId !== input.submitterUserId &&
    item.startDate <= today && item.endDate >= today
  ).sort((a, b) => a.id - b.id);
  if (delegations[0]) {
    return {
      userId: delegations[0].toUserId,
      actedAsRole: input.role,
      viaDelegationId: delegations[0].id,
      source: "delegation",
    };
  }

  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({
    userId: projectRoleFallbackReviewers.userId,
    systemRole: users.role,
  }).from(projectRoleFallbackReviewers)
    .innerJoin(users, eq(projectRoleFallbackReviewers.userId, users.id))
    .where(and(
      eq(projectRoleFallbackReviewers.role, input.role),
      eq(projectRoleFallbackReviewers.active, true),
      ne(projectRoleFallbackReviewers.userId, input.submitterUserId),
    ))
    .orderBy(projectRoleFallbackReviewers.id);
  const fallback = rows.find((row) => !isSystemExternalRole(row.systemRole));
  return fallback
    ? { userId: fallback.userId, actedAsRole: input.role, viaDelegationId: null, source: "fallback" }
    : null;
}

export function noRedlineReviewerMessage(role: ProjectMemberRole): string {
  return `红线对象缺少独立复核人（${role}）：请由非提交人的管理层代签、设置生效代理人，或由管理员配置系统兜底审核人`;
}
