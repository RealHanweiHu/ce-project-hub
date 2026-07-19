import type { ProjectFileVisibility, ProjectMemberRole } from "../drizzle/schema";
import { PROJECT_FILE_VISIBILITIES } from "../drizzle/schema";
import { ROLE_PERMISSIONS } from "./routers/members";

const visibilitySet = new Set<string>(PROJECT_FILE_VISIBILITIES);

export function normalizeProjectFileVisibility(value: unknown): ProjectFileVisibility {
  return typeof value === "string" && visibilitySet.has(value)
    ? value as ProjectFileVisibility
    : "internal";
}

export function canRoleViewInternalWorkspace(
  roleOrRoles: ProjectMemberRole | Iterable<ProjectMemberRole>,
): boolean {
  const roles = typeof roleOrRoles === "string" ? [roleOrRoles] : Array.from(roleOrRoles);
  return roles.some((role) => ROLE_PERMISSIONS[role]?.canViewInternalWorkspace ?? false);
}

/**
 * 上传未显式指定 visibility 时的默认值：一律 internal，绝不静默对外。
 * sales 曾默认 "customer"——一次手滑内部文件就进客户视野；改为 internal 后
 * 会被可见性校验拒绝（sales 无 canViewInternalFiles），等价于强制显式选择。
 * 外部角色默认其唯一可用 audience，否则账号传什么都 403。
 */
export function resolveDefaultUploadVisibility(role: ProjectMemberRole): ProjectFileVisibility {
  if (role === "external_customer") return "customer";
  if (role === "supplier") return "supplier";
  return "internal";
}

export function canRoleViewFileVisibility(
  roleOrRoles: ProjectMemberRole | Iterable<ProjectMemberRole>,
  visibility: string | null | undefined,
): boolean {
  // 并集语义与 canRoleViewInternalWorkspace 一致：多岗成员任一角色可见即可见，
  // 否则 pm 主角色 + scm 兼任的人会因单角色索引丢失 supplier 文件可见性。
  const roles = typeof roleOrRoles === "string" ? [roleOrRoles] : Array.from(roleOrRoles);
  const normalized = normalizeProjectFileVisibility(visibility);
  return roles.some((role) => {
    const permissions = ROLE_PERMISSIONS[role];
    if (!permissions) return false;
    if (normalized === "public") return permissions.canView;
    if (normalized === "customer") return permissions.canViewCustomerFiles;
    if (normalized === "supplier") return permissions.canViewSupplierFiles;
    return permissions.canViewInternalFiles;
  });
}
