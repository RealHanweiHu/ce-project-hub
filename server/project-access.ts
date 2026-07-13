import { TRPCError } from "@trpc/server";
import { isSystemAdminRole, isSystemExternalRole } from "../shared/system-roles";
import { normalizeExtraRoles } from "../shared/project-roles";
import {
  getActiveProjectRoleDelegationsForUser,
  getProjectById,
  getProjectMember,
  getProjectRolesForUser,
  getUserById,
} from "./db";
import type { ProjectMemberRole, ProjectRow } from "../drizzle/schema";
import { ROLE_PERMISSIONS } from "./routers/members";
import { todayShanghai } from "../shared/shanghai-date";

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
  roles: Set<ProjectMemberRole>;
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
  const roles = await getEffectiveProjectRoles(project, userId);
  let role: ProjectMemberRole | null = null;
  for (const candidate of Array.from(roles)) role = pickHigherProjectRole(role, candidate);
  return role;
}

/**
 * A member keeps one primary role for display and may carry additional working
 * roles. Implicit owner/PM/admin roles join the same set; downstream permission
 * checks must use the union instead of guessing from the display role.
 */
export async function getEffectiveProjectRoles(
  project: ProjectRow,
  userId: number,
): Promise<Set<ProjectMemberRole>> {
  const member = await getProjectMember(project.id, userId);
  const roles = new Set<ProjectMemberRole>();
  if (member) {
    roles.add(member.role);
    for (const role of normalizeExtraRoles(member.role, member.extraRoles)) roles.add(role);
  }
  if (project.pmUserId === userId) roles.add("project_manager");
  if (project.createdBy === userId) roles.add("owner");
  const delegations = await getActiveProjectRoleDelegationsForUser(project.id, userId, todayShanghai());
  for (const delegation of delegations) roles.add(delegation.role);
  // System admins get at least manager on ANY project — even when explicitly added
  // as a low role (e.g. viewer). Using pickHigher (not "only when null") keeps admin
  // consistent across every resolver and mirrors assertProjectAccess's admin bypass;
  // otherwise an admin-as-viewer could create issues (assert-based routers) yet be
  // FORBIDDEN from completing tasks (getEffectiveRole-based routers).
  const u = await getUserById(userId);
  if (isSystemAdminRole(u?.role)) roles.add("manager");
  return roles;
}

/** OR every boolean permission bit while retaining the highest role's labels. */
export function getUnionPermissions(roles: Iterable<ProjectMemberRole>): RolePermissions {
  const roleList = Array.from(new Set(roles));
  let displayRole: ProjectMemberRole | null = null;
  for (const role of roleList) displayRole = pickHigherProjectRole(displayRole, role);
  const union = { ...ROLE_PERMISSIONS[displayRole ?? "viewer"] } as RolePermissions;
  const mutable = union as unknown as Record<string, unknown>;
  for (const role of roleList) {
    for (const [key, value] of Object.entries(ROLE_PERMISSIONS[role])) {
      if (typeof value === "boolean") mutable[key] = Boolean(mutable[key]) || value;
    }
  }
  return union;
}

export async function resolveProjectActedAsRole(input: {
  project: ProjectRow;
  userId: number;
  requestedRole?: ProjectMemberRole | null;
  eligible: (role: ProjectMemberRole) => boolean;
}): Promise<{ role: ProjectMemberRole; viaDelegationId: number | null; candidates: ProjectMemberRole[] }> {
  const effectiveRoles = await getEffectiveProjectRoles(input.project, input.userId);
  const candidates = Array.from(effectiveRoles).filter(input.eligible);
  if (candidates.length === 0) throw new Error("当前没有可用于本次签字的项目角色");
  if (!input.requestedRole && candidates.length > 1) {
    throw new Error(`请选择本次签字角色：${candidates.join("/")}`);
  }
  const role = input.requestedRole ?? candidates[0];
  if (!candidates.includes(role)) throw new Error("所选签字角色不属于当前有效角色");

  const member = await getProjectMember(input.project.id, input.userId);
  const directRoles = new Set<ProjectMemberRole>();
  if (member) {
    directRoles.add(member.role);
    normalizeExtraRoles(member.role, member.extraRoles).forEach((item) => directRoles.add(item));
  }
  if (input.project.pmUserId === input.userId) directRoles.add("project_manager");
  if (input.project.createdBy === input.userId) directRoles.add("owner");
  const user = await getUserById(input.userId);
  if (isSystemAdminRole(user?.role)) directRoles.add("manager");
  if (directRoles.has(role)) return { role, viaDelegationId: null, candidates };

  const delegations = await getActiveProjectRoleDelegationsForUser(
    input.project.id, input.userId, todayShanghai(),
  );
  return {
    role,
    viaDelegationId: delegations.find((item) => item.role === role)?.id ?? null,
    candidates,
  };
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

export async function getEffectiveProjectRolesById(
  projectId: string,
  userId: number,
): Promise<Set<ProjectMemberRole>> {
  const project = await getProjectById(projectId);
  if (!project) return new Set();
  return getEffectiveProjectRoles(project, userId);
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
      roles: new Set<ProjectMemberRole>(["owner"]),
      permissions: ROLE_PERMISSIONS.owner,
      isAdmin: true,
    };
  }

  const roles = await getEffectiveProjectRoles(project, actor.id);
  let role: ProjectMemberRole | null = null;
  for (const candidate of Array.from(roles)) role = pickHigherProjectRole(role, candidate);
  const permissions = getUnionPermissions(roles);
  if (!role || !permissions.canView) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无访问权限" });
  }

  return {
    project,
    role,
    roles,
    permissions,
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
