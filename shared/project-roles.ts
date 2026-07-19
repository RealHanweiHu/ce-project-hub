/** Canonical project-role values shared by schema, server authorization, and client UI. */
export const PROJECT_MEMBER_ROLES = [
  "owner",
  "manager",
  "project_manager",
  "pm",
  "rd_hw",
  "rd_sw",
  "rd_mech",
  "qa",
  "scm",
  "pe",
  "mfg",
  "sales",
  "cert",
  "battery_safety",
  "external_customer",
  "supplier",
  "viewer",
] as const;

export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

const PROJECT_MEMBER_ROLE_SET = new Set<string>(PROJECT_MEMBER_ROLES);

export function isProjectMemberRole(value: unknown): value is ProjectMemberRole {
  return typeof value === "string" && PROJECT_MEMBER_ROLE_SET.has(value);
}

/**
 * 治理身份不能经"兼任角色"路径自助获得：owner/manager 只能是主角色（由具备
 * 相应权限的人显式授予），否则 kickoff staffing / 成员编辑等 canEditProjectInfo
 * 级入口可以把管理层并进自己的权限并集（Gate 评审权、红线升级链管理层身份）。
 */
export const NON_DELEGABLE_EXTRA_ROLES: readonly ProjectMemberRole[] = ["owner", "manager"];

/**
 * Stored extra roles never repeat the primary role and cannot grant owner/manager.
 * Canonical ordering makes equality checks, audit logs, and dedupe deterministic.
 */
export function normalizeExtraRoles(
  primaryRole: ProjectMemberRole,
  raw: unknown,
): ProjectMemberRole[] {
  if (!Array.isArray(raw)) return [];
  const accepted = new Set(
    raw.filter((role): role is ProjectMemberRole =>
      isProjectMemberRole(role) && !NON_DELEGABLE_EXTRA_ROLES.includes(role) && role !== primaryRole
    ),
  );
  return PROJECT_MEMBER_ROLES.filter((role) => accepted.has(role));
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Delegation dates are already normalized to Asia/Shanghai YYYY-MM-DD values. */
export function isShanghaiDateInInclusiveRange(
  today: string,
  startDate: string,
  endDate: string,
): boolean {
  if (![today, startDate, endDate].every((value) => ISO_DATE_RE.test(value))) return false;
  if (startDate > endDate) return false;
  return today >= startDate && today <= endDate;
}
