export const SYSTEM_ROLES = ["owner", "admin", "member", "external", "viewer"] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];
export type LegacySystemRole = "user";
export type AnySystemRole = SystemRole | LegacySystemRole | string | null | undefined;

export const SYSTEM_ROLE_LABELS: Record<SystemRole, string> = {
  owner: "拥有者",
  admin: "管理员",
  member: "成员",
  external: "外部协作",
  viewer: "只读观察者",
};

export function normalizeSystemRole(role: AnySystemRole): SystemRole {
  if (role === "owner" || role === "admin" || role === "member" || role === "external" || role === "viewer") {
    return role;
  }
  if (role === "user") return "member";
  return "member";
}

export function isSystemOwnerRole(role: AnySystemRole): boolean {
  return normalizeSystemRole(role) === "owner";
}

export function isSystemAdminRole(role: AnySystemRole): boolean {
  const normalized = normalizeSystemRole(role);
  return normalized === "owner" || normalized === "admin";
}

export function isSystemExternalRole(role: AnySystemRole): boolean {
  return normalizeSystemRole(role) === "external";
}

export function systemRoleCanCreateProject(user: { role?: AnySystemRole; canCreateProject?: boolean | null } | null | undefined): boolean {
  return !!user && (isSystemAdminRole(user.role) || user.canCreateProject === true);
}
