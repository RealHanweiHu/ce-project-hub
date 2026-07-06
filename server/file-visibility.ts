import type { ProjectFileVisibility, ProjectMemberRole } from "../drizzle/schema";
import { PROJECT_FILE_VISIBILITIES } from "../drizzle/schema";
import { ROLE_PERMISSIONS } from "./routers/members";

const visibilitySet = new Set<string>(PROJECT_FILE_VISIBILITIES);

export function normalizeProjectFileVisibility(value: unknown): ProjectFileVisibility {
  return typeof value === "string" && visibilitySet.has(value)
    ? value as ProjectFileVisibility
    : "internal";
}

export function canRoleViewInternalWorkspace(role: ProjectMemberRole): boolean {
  return ROLE_PERMISSIONS[role]?.canViewInternalWorkspace ?? false;
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
  role: ProjectMemberRole,
  visibility: string | null | undefined,
): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  const normalized = normalizeProjectFileVisibility(visibility);
  if (normalized === "public") return permissions.canView;
  if (normalized === "customer") return permissions.canViewCustomerFiles;
  if (normalized === "supplier") return permissions.canViewSupplierFiles;
  return permissions.canViewInternalFiles;
}
