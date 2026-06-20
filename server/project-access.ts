import { TRPCError } from "@trpc/server";
import { getProjectById, getProjectMember, getUserById } from "./db";
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
  pm: 2,
  manager: 3,
  owner: 4,
};

export type ProjectPermission = {
  [K in keyof RolePermissions]: RolePermissions[K] extends boolean ? K : never
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

export async function getEffectiveProjectRole(
  project: ProjectRow,
  userId: number,
): Promise<ProjectMemberRole | null> {
  const member = await getProjectMember(project.id, userId);
  let role: ProjectMemberRole | null = member?.role ?? null;
  if (project.pmUserId === userId) role = pickHigherProjectRole(role, "pm");
  if (project.createdBy === userId) role = pickHigherProjectRole(role, "owner");
  // System admins can view/manage any project even without explicit membership,
  // so portfolio drill-in works for managers (mirrors assertProjectAccess admin bypass).
  if (!role) {
    const u = await getUserById(userId);
    if (u?.role === "admin") role = "manager";
  }
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

  if (actor.role === "admin") {
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
