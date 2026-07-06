import { isSystemAdminRole } from "./system-roles";

export type RoleDashboardLens =
  | "exec"
  | "project_manager"
  | "product_manager"
  | "quality"
  | "npi"
  | "engineering"
  | "sales"
  | "external"
  | "generic";

export type RoleDashboardRole =
  | "owner"
  | "manager"
  | "project_manager"
  | "pm"
  | "rd_hw"
  | "rd_sw"
  | "rd_mech"
  | "qa"
  | "scm"
  | "pe"
  | "mfg"
  | "sales"
  | "cert"
  | "battery_safety"
  | "external_customer"
  | "supplier"
  | "viewer"
  | string;

export interface RoleProjectRef {
  projectId?: string;
  role: RoleDashboardRole | null | undefined;
  pmUserId?: number | null;
}

export interface RolePortfolioRef {
  myRole?: RoleDashboardRole | null;
  pmUserId?: number | null;
}

const EXEC_ROLES = new Set(["owner", "manager"]);
const PROJECT_MANAGER_ROLES = new Set(["project_manager"]);
const PRODUCT_MANAGER_ROLES = new Set(["pm"]);
const QUALITY_ROLES = new Set(["qa", "cert", "battery_safety"]);
const NPI_ROLES = new Set(["pe", "mfg"]);
const ENGINEERING_ROLES = new Set(["rd_hw", "rd_sw", "rd_mech"]);
const SALES_ROLES = new Set(["sales"]);
const EXTERNAL_ROLES = new Set(["external_customer", "supplier"]);

function hasRole(roles: RoleDashboardRole[], set: Set<string>): boolean {
  return roles.some((role) => set.has(role));
}

export function resolveRoleDashboardLens(input: {
  systemRole?: string | null;
  roles?: RoleProjectRef[];
  portfolio?: RolePortfolioRef[];
  userId?: number | null;
}): RoleDashboardLens | null {
  const roleValues = [
    ...(input.roles ?? []).map((role) => role.role).filter((role): role is RoleDashboardRole => !!role),
    ...(input.portfolio ?? []).map((row) => row.myRole).filter((role): role is RoleDashboardRole => !!role),
  ];
  const userId = input.userId ?? null;
  const isProjectManagerByField = userId != null && (input.portfolio ?? []).some((row) => row.pmUserId === userId);

  if (isSystemAdminRole(input.systemRole) || hasRole(roleValues, EXEC_ROLES)) return "exec";
  if (isProjectManagerByField || hasRole(roleValues, PROJECT_MANAGER_ROLES)) return "project_manager";
  if (hasRole(roleValues, PRODUCT_MANAGER_ROLES)) return "product_manager";
  if (hasRole(roleValues, QUALITY_ROLES)) return "quality";
  if (hasRole(roleValues, NPI_ROLES)) return "npi";
  if (hasRole(roleValues, ENGINEERING_ROLES)) return "engineering";
  if (hasRole(roleValues, SALES_ROLES)) return "sales";
  if (hasRole(roleValues, EXTERNAL_ROLES)) return "external";
  return roleValues.length > 0 ? "generic" : null;
}

export function roleDashboardTitle(lens: RoleDashboardLens): { title: string; desc: string } {
  switch (lens) {
    case "exec":
      return { title: "管理层总览", desc: "关注延期、成本、客户、风险、Gate 状态与重大继续决策。" };
    case "project_manager":
      return { title: "项目经理驾驶舱", desc: "推动阶段计划、角色协同、Gate 评审、项目健康和阻塞清除。" };
    case "product_manager":
      return { title: "产品经理工作台", desc: "关注产品定义、客户需求、规格冻结、目标成本和需求偏离。" };
    case "quality":
      return { title: "质量 / 测试工作台", desc: "跟踪 EVT/DVT/PVT 测试、报告审核、P0/P1 闭环和 QA Gate 阻断。" };
    case "npi":
      return { title: "PE / NPI 工作台", desc: "跟踪可制造性、SOP/夹具/制程/试产报告和 PVT/MP readiness。" };
    case "engineering":
      return { title: "工程研发工作台", desc: "聚焦设计任务、EVT/DVT 问题、文件交付和变更响应。" };
    case "sales":
      return { title: "销售 / 客户工作台", desc: "跟踪客户项目、样品交付风险、客户需求与客户可见材料。" };
    case "external":
      return { title: "外部协作工作台", desc: "只显示授权项目、客户/供应商可见材料与确认事项。" };
    default:
      return { title: "我的工作台", desc: "聚合指派给你的任务、审核、问题和项目提醒。" };
  }
}
