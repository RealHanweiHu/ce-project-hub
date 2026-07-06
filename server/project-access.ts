import { TRPCError } from "@trpc/server";
import { isSystemAdminRole, isSystemExternalRole } from "../shared/system-roles";
import { getProjectById, getProjectMember, getProjectRolesForUser, getUserById } from "./db";
import type { ProjectMemberRole, ProjectRow } from "../drizzle/schema";
import { ROLE_PERMISSIONS } from "./routers/members";

type RolePermissions = (typeof ROLE_PERMISSIONS)[ProjectMemberRole];

const PROJECT_ROLE_RANK: Record<ProjectMemberRole, number> = {
  viewer: 0,
  rd_hw: 1,
  rd_sw: 1,
  rd_mech: 1,
  qa: 1,
  scm: 1,
  pe: 1,
  mfg: 1,
  sales: 1,
  cert: 1,
  battery_safety: 1,
  external_customer: 0,
  supplier: 0,
  pm: 2,
  project_manager: 3,
  manager: 3,
  owner: 4,
};

export type ProjectPermission = {
  // -? + NonNullable：可选布尔权限位（如 canEditBomStructure?）也算合法权限名，
  // 且不把 undefined 混进键联合
  [K in keyof RolePermissions]-?: NonNullable<RolePermissions[K]> extends boolean ? K : never
}[keyof RolePermissions];

export type ProjectActor = {
  id: number;
  role: string;
};

export type ProjectAccess = {
  project: ProjectRow;
  role: ProjectMemberRole;
  permissions: RolePermissions;
  isAdmin: boolean;
};

/**
 * 拦截「纯外部账号」访问产品库级资源（冻结 BOM 结构、whereUsed、版本 diff）：
 * 所有项目角色均为 external_customer/supplier 的账号只该看到被授权的项目内
 * 客户/供应商资料，不该枚举任意 revision 的物料结构。零成员的内部员工与
 * 内外混合账号（任一项目有内部角色）不受影响，保持「产品库全员可读」语义。
 */
export async function assertNotExternalOnlyAccount(user: ProjectActor & { role: string }) {
  if (isSystemAdminRole(user.role)) return;
  if (isSystemExternalRole(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "外部协作账号不能访问产品库物料数据" });
  }
  const roles = await getProjectRolesForUser(user.id);
  if (roles.size === 0) return;
  const externalOnly = Array.from(roles.values())
    .every((role) => role === "external_customer" || role === "supplier");
  if (externalOnly) {
    throw new TRPCError({ code: "FORBIDDEN", message: "外部协作账号不能访问产品库物料数据" });
  }
}

export async function getEffectiveProjectRole(
  project: ProjectRow,
  userId: number,
): Promise<ProjectMemberRole | null> {
  const member = await getProjectMember(project.id, userId);
  let role: ProjectMemberRole | null = member?.role ?? null;
  if (project.pmUserId === userId) role = pickHigherProjectRole(role, "project_manager");
  if (project.createdBy === userId) role = pickHigherProjectRole(role, "owner");
  // System admins get at least manager on ANY project — even when explicitly added
  // as a low role (e.g. viewer). Using pickHigher (not "only when null") keeps admin
  // consistent across every resolver and mirrors assertProjectAccess's admin bypass;
  // otherwise an admin-as-viewer could create issues (assert-based routers) yet be
  // FORBIDDEN from completing tasks (getEffectiveRole-based routers).
  const u = await getUserById(userId);
  if (isSystemAdminRole(u?.role)) role = pickHigherProjectRole(role, "manager");
  return role;
}

export function pickHigherProjectRole(
  current: ProjectMemberRole | null,
  candidate: ProjectMemberRole | null,
): ProjectMemberRole | null {
  if (!current) return candidate;
  if (!candidate) return current;
  return PROJECT_ROLE_RANK[candidate] > PROJECT_ROLE_RANK[current] ? candidate : current;
}

export async function getEffectiveProjectRoleById(
  projectId: string,
  userId: number,
): Promise<ProjectMemberRole | null> {
  const project = await getProjectById(projectId);
  if (!project) return null;
  return getEffectiveProjectRole(project, userId);
}

export async function assertProjectAccess(
  projectId: string,
  actor: ProjectActor,
): Promise<ProjectAccess> {
  const project = await getProjectById(projectId);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  }

  if (isSystemAdminRole(actor.role)) {
    return {
      project,
      role: "owner",
      permissions: ROLE_PERMISSIONS.owner,
      isAdmin: true,
    };
  }

  const role = await getEffectiveProjectRole(project, actor.id);
  if (!role || !ROLE_PERMISSIONS[role].canView) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无访问权限" });
  }

  return {
    project,
    role,
    permissions: ROLE_PERMISSIONS[role],
    isAdmin: false,
  };
}

export async function assertProjectPermission(
  projectId: string,
  actor: ProjectActor,
  permission: ProjectPermission,
  message = "无操作权限",
): Promise<ProjectAccess> {
  const access = await assertProjectAccess(projectId, actor);
  if (!access.isAdmin && !access.permissions[permission]) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
  return access;
}

export async function assertProjectAnyPermission(
  projectId: string,
  actor: ProjectActor,
  permissions: ProjectPermission[],
  message = "无操作权限",
): Promise<ProjectAccess> {
  const access = await assertProjectAccess(projectId, actor);
  if (!access.isAdmin && !permissions.some((permission) => access.permissions[permission])) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
  return access;
}
