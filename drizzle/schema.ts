import {
  integer,
  serial,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  jsonb,
  boolean,
  bigint,
  uniqueIndex,
  index,
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { VariantDelta } from "../shared/oem-variant";
import { SYSTEM_ROLES, type SystemRole } from "../shared/system-roles";
import type { GateSignoffRequirement, GateSignoffRoundStatus, GateSignoffSlot, GateSignoffStatus } from "../shared/gate-signoffs";
import type { ProjectChangeScopeDeclaration, ProjectSopRiskLevel, SopRiskAssessment } from "../shared/sop-risk";
import type { CertificateScopeType, CertificateStatus, CertificateType } from "../shared/certification";
import { PROJECT_MEMBER_ROLES, type ProjectMemberRole } from "../shared/project-roles";

export { PROJECT_MEMBER_ROLES } from "../shared/project-roles";
export type { ProjectMemberRole } from "../shared/project-roles";

export type ProductDefinitionCompetitor = {
  brand?: string;
  model?: string;
  price?: string;
  channel?: string;
  strengths?: string;
  weaknesses?: string;
  notes?: string;
};

export type ProductDefinitionSpec = {
  key: string;
  label: string;
  target: string;
  tolerance?: string;
  verification?: string;
  ownerRole?: string;
};

export type ProductDefinitionSku = {
  name: string;
  code?: string;
  targetMarket?: string;
  price?: string;
  differences?: string;
  customerName?: string;
};

export type ProductDefinitionSnapshotPayload = {
  title: string;
  opportunityName: string;
  opportunitySource: string;
  targetCustomers: string | null;
  targetMarkets: string[];
  applicationScenarios: string | null;
  competitors: ProductDefinitionCompetitor[];
  priceBand: string;
  positioning: string | null;
  sellingPoints: string[];
  differentiationStrategy: string | null;
  prdSummary: string | null;
  specs: ProductDefinitionSpec[];
  targetCost: string;
  targetPrice: string;
  targetGrossMargin: string;
  skuPlan: ProductDefinitionSku[];
};

export const PRODUCT_DEFINITION_CHANGE_AREAS = [
  "market",
  "customer",
  "scenario",
  "competitor",
  "positioning",
  "selling_point",
  "spec",
  "cost",
  "price",
  "margin",
  "sku",
  "certification",
  "packaging",
  "schedule",
  "other",
] as const;

export type ProductDefinitionChangeArea = (typeof PRODUCT_DEFINITION_CHANGE_AREAS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

export const USER_ROLES = SYSTEM_ROLES;
export type UserRole = SystemRole;
export const userRoleEnum = pgEnum("user_role", USER_ROLES);

/**
 * Core user table backing auth flow.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** User identifier - stores username for password auth (kept as openId for DB compatibility) */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  /** Username for login - same as openId for password-auth users */
  username: varchar("username", { length: 64 }).unique(),
  /** bcrypt hashed password. Null for legacy OAuth-only users. */
  passwordHash: varchar("passwordHash", { length: 256 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("member").notNull(),
  /**
   * Whether this user can create new projects.
   * Granted by admin. Typically given to PM, managers, and project leads.
   * Workspace owner/admin always have this permission regardless of this field.
   */
  canCreateProject: boolean("canCreateProject").notNull().default(false),
  /** 手机号（与钉钉一致）；自动映射钉钉 userId 的查询键 */
  mobile: varchar("mobile", { length: 32 }),
  /** 钉钉 unionId 缓存（日历 API 用） */
  dingtalkUserId: varchar("dingtalkUserId", { length: 64 }),
  /** 钉钉通讯录 userid 缓存（工作通知 API 用） */
  dingtalkCorpUserId: varchar("dingtalkCorpUserId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Projects (metadata only — no more data JSON blob)
// ─────────────────────────────────────────────────────────────────────────────

export const projectRiskEnum = pgEnum("project_risk", ["low", "medium", "high"]);

/** 项目生命周期：active 进行中 / paused 暂停（可恢复，退出自动化扫描）/ terminated 终止（终局，连带归档） */
export const PROJECT_LIFECYCLES = ["active", "paused", "terminated"] as const;
export type ProjectLifecycle = (typeof PROJECT_LIFECYCLES)[number];
export const projectLifecycleEnum = pgEnum("project_lifecycle", PROJECT_LIFECYCLES);

/**
 * Projects table - stores CE product development project metadata.
 * All phase/task/issue/gate/changelog data live in separate tables.
 */
/** 项目类型：必须与 shared/sop-templates.ts 的 ProjectCategory / CATEGORY_MAP 保持一致 */
export const PROJECT_CATEGORIES = ["npd", "eco", "derivative", "idr", "jdm", "obt"] as const;
export const projectCategoryEnum = pgEnum("project_category", PROJECT_CATEGORIES);

export const projects = pgTable("projects", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  projectNumber: varchar("projectNumber", { length: 64 }).notNull().default(""),
  /** Product category: maps to SOP template */
  category: projectCategoryEnum("category").notNull().default("npd"),
  /** 建项时冻结；历史项目继续按原版本展示和执行。 */
  sopTemplateVersion: varchar("sopTemplateVersion", { length: 32 }).notNull().default("2026-07-v2"),
  /**
   * Project manager user id (FK to users.id).
   * Use JOIN to get display name; no pmName string field.
   */
  pmUserId: integer("pmUserId"),
  /** Product owner who approves product definition and design-scope changes. */
  productOwnerUserId: integer("productOwnerUserId"),
  /** 项目描述 / 背景 / 客户 / 价值（立项基础信息） */
  description: text("description"),
  customer: varchar("customer", { length: 256 }),
  background: text("background"),
  value: text("value"),
  risk: projectRiskEnum("risk").notNull().default("low"),
  /** PM/Owner/管理层手动覆盖健康度；为空则使用自动健康度 */
  riskOverrideRisk: projectRiskEnum("riskOverrideRisk"),
  /** 手动覆盖健康度原因，覆盖时必填 */
  riskOverrideReason: text("riskOverrideReason"),
  riskOverrideUpdatedAt: timestamp("riskOverrideUpdatedAt"),
  riskOverrideUpdatedBy: integer("riskOverrideUpdatedBy"),
  currentPhase: varchar("currentPhase", { length: 32 }).notNull().default("concept"),
  progress: integer("progress").notNull().default(0),
  startDate: varchar("startDate", { length: 32 }),
  targetDate: varchar("targetDate", { length: 32 }),
  createdBy: integer("createdBy").notNull(),
  archived: boolean("archived").notNull().default(false),
  /** 生命周期：终止为终局（连带 archived）；暂停可恢复且退出自动化扫描 */
  lifecycle: projectLifecycleEnum("lifecycle").notNull().default("active"),
  lifecycleReason: text("lifecycleReason"),
  lifecycleChangedAt: timestamp("lifecycleChangedAt"),
  lifecycleChangedBy: integer("lifecycleChangedBy"),
  /** Reserved for future organization/workspace support */
  orgId: integer("orgId"),
  /** 项目完成后交付到产品库的独立产品；项目执行期间可以为空。 */
  productId: varchar("productId", { length: 32 }),
  /** NPD 创建时锁定的产品定义快照，用于项目交接与后续追溯 */
  productDefinitionSnapshotId: integer("productDefinitionSnapshotId"),
  /** 历史兼容：旧项目曾记录派生起点 Revision；新项目不再依赖。 */
  baseRevisionId: integer("baseRevisionId"),
  /** 历史兼容：旧发布曾回填产出 Revision；新发布直接生成产品。 */
  resultRevisionId: integer("resultRevisionId"),
  /** SOP 风险分级；high 会自动恢复安全/认证验证项并升级 Gate 会签。 */
  safetyRiskLevel: varchar("safetyRiskLevel", { length: 16 }).$type<ProjectSopRiskLevel>().notNull().default("standard"),
  regulatoryRiskLevel: varchar("regulatoryRiskLevel", { length: 16 }).$type<ProjectSopRiskLevel>().notNull().default("standard"),
  /** JDM/OBT 入口冻结：客户输入、料号、商务边界和签核责任人。 */
  customerInputVersion: varchar("customerInputVersion", { length: 128 }),
  customerPartNumber: varchar("customerPartNumber", { length: 128 }),
  commercialBoundary: text("commercialBoundary"),
  customerSignoffOwnerUserId: integer("customerSignoffOwnerUserId"),
  inputBaselineFrozenAt: timestamp("inputBaselineFrozenAt"),
  inputBaselineFrozenBy: integer("inputBaselineFrozenBy"),
  /** 自定义字段值：fieldKey -> value（定义见 custom_field_defs） */
  customFields: jsonb("customFields").$type<Record<string, unknown>>().notNull().default({}),
  /** 每项目周会配置：{ enabled, weekday(0-6), time:"HH:MM", durationMin, title } */
  meetingConfig: jsonb("meetingConfig").$type<{ enabled: boolean; weekday: number; time: string; durationMin: number; title: string } | null>(),
  /** 已建钉钉日程 id（用于改/删） */
  dingtalkEventId: varchar("dingtalkEventId", { length: 128 }),
  /** 项目周会钉钉同步状态：not_synced/pending/synced/group_fallback/failed/canceled */
  dingtalkMeetingSyncStatus: varchar("dingtalkMeetingSyncStatus", { length: 24 }).notNull().default("not_synced"),
  /** 最近一次项目周会钉钉同步错误 */
  dingtalkMeetingLastError: text("dingtalkMeetingLastError"),
  /** 最近一次项目周会成功同步/取消时间 */
  dingtalkMeetingLastSyncedAt: timestamp("dingtalkMeetingLastSyncedAt"),
  /** 项目专属钉钉群会话 id（建群后回填，项目提醒发到此群） */
  dingtalkChatId: varchar("dingtalkChatId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/** Versioned, structured-only declaration consumed by the SOP risk engine. */
export const projectChangeScopeDeclarations = pgTable(
  "project_change_scope_declarations",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    declaration: jsonb("declaration").$type<ProjectChangeScopeDeclaration>().notNull(),
    assessment: jsonb("assessment").$type<SopRiskAssessment>().notNull(),
    ruleVersion: varchar("ruleVersion", { length: 64 }).notNull(),
    declaredBy: integer("declaredBy").notNull(),
    engineeringConfirmedBy: integer("engineeringConfirmedBy"),
    engineeringConfirmedAt: timestamp("engineeringConfirmedAt"),
    qaOrCertConfirmedBy: integer("qaOrCertConfirmedBy"),
    qaOrCertConfirmedAt: timestamp("qaOrCertConfirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    uniqProjectVersion: uniqueIndex("uniq_change_scope_project_version").on(table.projectId, table.version),
    idxProject: index("idx_change_scope_project").on(table.projectId, table.version),
  }),
);

export type ProjectChangeScopeDeclarationRow = typeof projectChangeScopeDeclarations.$inferSelect;
export type InsertProjectChangeScopeDeclaration = typeof projectChangeScopeDeclarations.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Project Member Roles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Project member roles in CE product development context.
 *
 * Permission levels (high → low):
 *   owner      - 项目创建者，全部权限，不可被移除
 *   manager    - 管理层/决策层，可通过 Gate 评审，可管理成员
 *   project_manager - 项目经理/PMO，可维护计划、成员、任务和项目执行信息
 *   pm         - 产品经理，可维护产品需求、范围和产品定义输入
 *   rd_hw      - 硬件研发，可编辑任务和问题
 *   rd_sw      - 软件研发，可编辑任务和问题
 *   rd_mech    - 结构/ID 研发，可编辑任务和问题
 *   qa         - 测试/品质，可编辑问题清单（Issue List）
 *   scm        - 供应链/采购，可编辑变更记录中的成本相关字段
 *   viewer     - 只读，仅查看，不可修改任何内容
 */
export const projectMemberRoleEnum = pgEnum("project_member_role", PROJECT_MEMBER_ROLES);

/**
 * project_members table - maps users to projects with a specific role.
 * The project creator is automatically added as 'owner'.
 * UNIQUE(projectId, userId) prevents duplicate membership.
 */
export const projectMembers = pgTable(
  "project_members",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: integer("userId").notNull(),
    /** Role determines what the member can do in this project */
    role: projectMemberRoleEnum("role").notNull().default("viewer"),
    /** Additional hats; normalized to exclude owner, duplicates, and the primary role. */
    extraRoles: jsonb("extraRoles").$type<ProjectMemberRole[]>().notNull().default([]),
    /** Display name for this member's job title (e.g. "硬件工程师", "测试主管") */
    jobTitle: varchar("jobTitle", { length: 64 }),
    invitedBy: integer("invitedBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    /** Prevent the same user from being added to a project twice */
    uniqProjectUser: uniqueIndex("uniq_project_member").on(table.projectId, table.userId),
    /** Speed up queries filtering by project */
    idxProject: index("idx_project_members_project").on(table.projectId),
  })
);

export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = typeof projectMembers.$inferInsert;

/** Date-bounded delegation of one project role to another natural person. */
export const projectRoleDelegations = pgTable(
  "project_role_delegations",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: projectMemberRoleEnum("role").notNull(),
    fromUserId: integer("fromUserId"),
    toUserId: integer("toUserId").notNull(),
    startDate: date("startDate", { mode: "string" }).notNull(),
    endDate: date("endDate", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: integer("createdBy").notNull(),
    revokedBy: integer("revokedBy"),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectRoleDates: index("idx_project_role_delegations_project_role_dates").on(
      table.projectId,
      table.role,
      table.startDate,
      table.endDate,
    ),
    idxDelegateActive: index("idx_project_role_delegations_delegate_active").on(
      table.toUserId,
      table.active,
    ),
  }),
);

export type ProjectRoleDelegation = typeof projectRoleDelegations.$inferSelect;
export type InsertProjectRoleDelegation = typeof projectRoleDelegations.$inferInsert;

/** System-level last resort reviewers, maintained by admins per professional role. */
export const projectRoleFallbackReviewers = pgTable(
  "project_role_fallback_reviewers",
  {
    id: serial("id").primaryKey(),
    role: projectMemberRoleEnum("role").notNull(),
    userId: integer("userId").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqRoleUser: uniqueIndex("uniq_project_role_fallback_reviewer").on(table.role, table.userId),
    idxRoleActive: index("idx_project_role_fallback_reviewers_role_active").on(table.role, table.active),
  }),
);

export type ProjectRoleFallbackReviewer = typeof projectRoleFallbackReviewers.$inferSelect;
export type InsertProjectRoleFallbackReviewer = typeof projectRoleFallbackReviewers.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Project Phases (per-project phase state & dates)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * project_phases table - stores per-project phase metadata.
 * One row per (project, phase) pair.
 */
export const projectPhases = pgTable(
  "project_phases",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Phase id matching SOP template (e.g. 'concept', 'planning', 'design') */
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    /** Custom start date override (YYYY-MM-DD) */
    startDate: varchar("startDate", { length: 32 }),
    /** Custom end date override (YYYY-MM-DD) */
    endDate: varchar("endDate", { length: 32 }),
    /** Phase-level notes */
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    /** Each project can only have one row per phase */
    uniqProjectPhase: uniqueIndex("uniq_project_phase").on(table.projectId, table.phaseId),
  })
);

export type ProjectPhase = typeof projectPhases.$inferSelect;
export type InsertProjectPhase = typeof projectPhases.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Project Calendar Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manager/PM-created one-off project schedules. Milestone events are derived
 * from phases/gates; this table stores explicit meeting or coordination events.
 */
export const projectCalendarEvents = pgTable(
  "project_calendar_events",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description"),
    eventDate: date("eventDate", { mode: "string" }).notNull(),
    startTime: varchar("startTime", { length: 5 }).notNull(),
    durationMin: integer("durationMin").notNull().default(60),
    organizerUserId: integer("organizerUserId").notNull(),
    dingtalkEventId: varchar("dingtalkEventId", { length: 128 }),
    dingtalkSyncStatus: varchar("dingtalkSyncStatus", { length: 24 }).notNull().default("not_synced"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectDate: index("idx_project_calendar_events_project_date").on(table.projectId, table.eventDate),
    idxDate: index("idx_project_calendar_events_date").on(table.eventDate),
  })
);

export type ProjectCalendarEvent = typeof projectCalendarEvents.$inferSelect;
export type InsertProjectCalendarEvent = typeof projectCalendarEvents.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Exceptions（全局工作日历例外：法定假 / 调休上班）
// ─────────────────────────────────────────────────────────────────────────────
export const calendarExceptions = pgTable("calendar_exceptions", {
  date: date("date", { mode: "string" }).primaryKey(),
  type: varchar("type", { length: 16 }).notNull(),
  name: varchar("name", { length: 128 }).notNull().default(""),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CalendarExceptionRow = typeof calendarExceptions.$inferSelect;
export type InsertCalendarException = typeof calendarExceptions.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Process tailoring and deliverable overrides
// ─────────────────────────────────────────────────────────────────────────────

export const TAILORING_REASONS = [
  "customer_id",
  "customer_structure",
  "reuse_mature",
  "other",
] as const;
export type TailoringReason = (typeof TAILORING_REASONS)[number];
export const tailoringReasonEnum = pgEnum("tailoring_reason", TAILORING_REASONS);

export const TAILORING_STATUSES = ["pending", "approved", "rejected", "revoked"] as const;
export type TailoringStatus = (typeof TAILORING_STATUSES)[number];
export const tailoringStatusEnum = pgEnum("tailoring_status", TAILORING_STATUSES);

export type TailoringTarget =
  | { scope: "phase"; phaseId: string }
  | { scope: "task"; phaseId: string; taskId: string };

export const projectTailoring = pgTable(
  "project_tailoring",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    reasonType: tailoringReasonEnum("reasonType").notNull(),
    reasonNote: text("reasonNote").notNull().default(""),
    targets: jsonb("targets").$type<TailoringTarget[]>().notNull().default([]),
    status: tailoringStatusEnum("status").notNull().default("pending"),
    proposedBy: integer("proposedBy").notNull(),
    proposedAt: timestamp("proposedAt").defaultNow().notNull(),
    reviewedBy: integer("reviewedBy"),
    reviewedAt: timestamp("reviewedAt"),
    reviewNote: text("reviewNote"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProject: index("idx_project_tailoring_project").on(table.projectId),
    idxProjectStatus: index("idx_project_tailoring_project_status").on(table.projectId, table.status),
  })
);

export type ProjectTailoring = typeof projectTailoring.$inferSelect;
export type InsertProjectTailoring = typeof projectTailoring.$inferInsert;

export const DELIVERABLE_OVERRIDE_ACTIONS = ["add", "remove"] as const;
export type DeliverableOverrideAction = (typeof DELIVERABLE_OVERRIDE_ACTIONS)[number];
export const deliverableOverrideActionEnum = pgEnum(
  "deliverable_override_action",
  DELIVERABLE_OVERRIDE_ACTIONS
);

export const projectDeliverableOverrides = pgTable(
  "project_deliverable_overrides",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    nodePhaseId: varchar("nodePhaseId", { length: 32 }).notNull(),
    deliverableName: varchar("deliverableName", { length: 256 }).notNull(),
    action: deliverableOverrideActionEnum("action").notNull(),
    /** 豁免/裁剪理由：手动排除或存量 grandfather 时记录一次性说明，留审计痕迹 */
    reason: text("reason"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqProjectNodeDeliverable: uniqueIndex("uniq_project_deliverable_override").on(
      table.projectId,
      table.nodePhaseId,
      table.deliverableName
    ),
    idxProject: index("idx_project_deliverable_overrides_project").on(table.projectId),
  })
);

export type ProjectDeliverableOverride = typeof projectDeliverableOverrides.$inferSelect;
export type InsertProjectDeliverableOverride = typeof projectDeliverableOverrides.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Deliverable Reviews
// ─────────────────────────────────────────────────────────────────────────────

export const deliverableReviewStatusEnum = pgEnum("deliverable_review_status", ["pending", "approved", "rejected"]);

export const projectDeliverableReviews = pgTable(
  "project_deliverable_reviews",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    deliverableName: varchar("deliverableName", { length: 256 }).notNull(),
    status: deliverableReviewStatusEnum("status").notNull().default("pending"),
    reviewerUserId: integer("reviewerUserId").notNull(),
    submittedBy: integer("submittedBy").notNull(),
    submittedAt: timestamp("submittedAt").defaultNow().notNull(),
    reviewedBy: integer("reviewedBy"),
    reviewedAt: timestamp("reviewedAt"),
    reviewNote: text("reviewNote"),
    /** Role hat used for the final review decision. */
    actedAsRole: projectMemberRoleEnum("actedAsRole"),
    /** Active delegation that granted actedAsRole, when applicable. */
    viaDelegationId: integer("viaDelegationId")
      .references(() => projectRoleDelegations.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniq: uniqueIndex("uniq_deliverable_review").on(table.projectId, table.phaseId, table.deliverableName),
    idxReviewer: index("idx_deliverable_review_reviewer").on(table.reviewerUserId, table.status),
  })
);
export type ProjectDeliverableReview = typeof projectDeliverableReviews.$inferSelect;
export type InsertProjectDeliverableReview = typeof projectDeliverableReviews.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Tasks (per-project, per-phase task completion state)
// ─────────────────────────────────────────────────────────────────────────────

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "skipped", "pending_approval"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
/** 逐任务审批闸门的审批态（默认 none = 不需审批/未提交） */
export const TASK_APPROVAL_STATUSES = ["none", "pending", "approved", "rejected"] as const;
export type TaskApprovalStatus = (typeof TASK_APPROVAL_STATUSES)[number];

export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const taskPriorityEnum = pgEnum("task_priority", TASK_PRIORITIES);
export const taskApprovalStatusEnum = pgEnum("task_approval_status", TASK_APPROVAL_STATUSES);

/**
 * project_tasks table - tracks completion state and details for each SOP task.
 * One row per (project, phase, task) triple.
 */
export const projectTasks = pgTable(
  "project_tasks",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    /** Task id matching SOP template (e.g. 'c1', 'p3', 'd5') */
    taskId: varchar("taskId", { length: 32 }).notNull(),
    /** Whether the task is checked/completed */
    completed: boolean("completed").notNull().default(false),
    /** Task-level instructions / notes */
    instructions: text("instructions"),
    /** 轻证据一句话结论：随完成动作提交；取消完成时清空 */
    completionNote: text("completion_note"),
    /** 交付物完成状态：交付物名称 → 是否完成。模板见 shared/task-deliverables.ts */
    deliverables: jsonb("deliverables").$type<Record<string, boolean>>().default({}),
    /**
     * Roles that can see this task.
     * JSON array of ProjectMemberRole strings.
     * Empty array = visible to all members.
     */
    visibleRoles: jsonb("visibleRoles").$type<string[]>().default([]),
    /** Assigned user (FK → users.id) */
    assigneeUserId: integer("assigneeUserId"),
    /** Original unstaffed role while PM/owner temporarily carries this task. */
    staffingGapRole: projectMemberRoleEnum("staffingGapRole"),
    /** Due date for this task (DATE column, YYYY-MM-DD string at runtime) */
    dueDate: date("dueDate", { mode: "string" }),
    /** 自动排期生成的任务开始日（YYYY-MM-DD） */
    startDate: date("startDate", { mode: "string" }),
    /** 人工点击「开始」的实际时刻；不得与计划排期 startDate 混用 */
    actualStartedAt: timestamp("actualStartedAt"),
    /** Task workflow status */
    status: taskStatusEnum("status").notNull().default("todo"),
    /** Timestamp when workflow status last changed */
    statusChangedAt: timestamp("statusChangedAt").defaultNow().notNull(),
    /** Task priority */
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    /** Timestamp when task was marked done */
    completedAt: timestamp("completedAt"),
    /** Stable natural-person submitter for four-eyes checks; unlike updatedBy it is not overwritten by later edits. */
    completedBy: integer("completedBy"),
    updatedBy: integer("updatedBy"),
    /** 逐任务审批闸门：是否需要审批人通过才计入完成（默认 false → 零回归） */
    requiresApproval: boolean("requiresApproval").notNull().default(false),
    /** 指定审批人（FK → users.id） */
    approverUserId: integer("approverUserId"),
    /** 审批态：none/pending/approved/rejected */
    approvalStatus: taskApprovalStatusEnum("approvalStatus").notNull().default("none"),
    /** 审批意见（驳回/通过备注） */
    approvalNote: text("approvalNote"),
    /** 提交审批的人 + 时间 */
    approvalRequestedBy: integer("approvalRequestedBy"),
    approvalRequestedAt: timestamp("approvalRequestedAt"),
    /** 裁决人 + 时间 */
    approvalDecidedBy: integer("approvalDecidedBy"),
    approvalDecidedAt: timestamp("approvalDecidedAt"),
    /** Role hat used by the approval decision. */
    approvalActedAsRole: projectMemberRoleEnum("approvalActedAsRole"),
    approvalViaDelegationId: integer("approvalViaDelegationId")
      .references(() => projectRoleDelegations.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    /** Each project/phase can only have one row per task template id */
    uniqProjectPhaseTask: uniqueIndex("uniq_project_phase_task").on(
      table.projectId,
      table.phaseId,
      table.taskId
    ),
  })
);

export type ProjectTask = typeof projectTasks.$inferSelect;
export type InsertProjectTask = typeof projectTasks.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Issues
// ─────────────────────────────────────────────────────────────────────────────

export const ISSUE_SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export const ISSUE_STATUSES = ["open", "in_progress", "resolved", "closed", "wont_fix"] as const;
export const ISSUE_CATEGORIES = [
  "hardware", "software", "mechanical", "thermal",
  "reliability", "safety", "performance", "other",
] as const;

export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const issueSeverityEnum = pgEnum("issue_severity", ISSUE_SEVERITIES);
export const issueStatusEnum = pgEnum("issue_status", ISSUE_STATUSES);
export const issueCategoryEnum = pgEnum("issue_category", ISSUE_CATEGORIES);

/**
 * project_issues table - issue tracking per project/phase.
 */
export const projectIssues = pgTable(
  "project_issues",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    severity: issueSeverityEnum("severity").notNull().default("P2"),
    status: issueStatusEnum("status").notNull().default("open"),
    category: issueCategoryEnum("category").notNull().default("other"),
    /** Responsible person (display name) */
    owner: varchar("owner", { length: 256 }),
    reporter: varchar("reporter", { length: 256 }),
    foundDate: varchar("foundDate", { length: 32 }),
    targetDate: varchar("targetDate", { length: 32 }),
    closedDate: varchar("closedDate", { length: 32 }),
    rootCause: text("rootCause"),
    solution: text("solution"),
    relatedTaskId: varchar("relatedTaskId", { length: 32 }),
    /** User id of the creator (for permission checks) */
    creatorId: integer("creatorId"),
    /** QA/test verifier who confirmed the issue is truly closed */
    verifiedBy: integer("verifiedBy"),
    verifiedAt: timestamp("verifiedAt"),
    /** 溯源：问题挂在产品上（永久），projectId 为来源项目（可空，量产后客诉无项目） */
    productId: varchar("productId", { length: 32 }),
    /** 受控转轨时复制开放问题，并保留来源问题引用。 */
    sourceIssueId: integer("sourceIssueId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    /** Speed up issue list queries filtered by project/phase/status/severity */
    idxProjectPhaseStatusSeverity: index("idx_issues_project_phase_status_severity").on(
      table.projectId,
      table.phaseId,
      table.status,
      table.severity
    ),
  })
);

export type ProjectIssue = typeof projectIssues.$inferSelect;
export type InsertProjectIssue = typeof projectIssues.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Risk Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export const RISK_ITEM_SEVERITIES = ["low", "medium", "high"] as const;
export const RISK_ITEM_STATUSES = ["open", "mitigating", "watching", "closed"] as const;

export type RiskItemSeverity = (typeof RISK_ITEM_SEVERITIES)[number];
export type RiskItemStatus = (typeof RISK_ITEM_STATUSES)[number];

export const riskItemSeverityEnum = pgEnum("risk_item_severity", RISK_ITEM_SEVERITIES);
export const riskItemStatusEnum = pgEnum("risk_item_status", RISK_ITEM_STATUSES);

/**
 * project_risks table - lifecycle tracking for project-level risks.
 * The legacy projects.risk field remains as metadata; portfolio health uses
 * active risk items as the auditable source of risk signals.
 */
export const projectRisks = pgTable(
  "project_risks",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    severity: riskItemSeverityEnum("severity").notNull().default("medium"),
    status: riskItemStatusEnum("status").notNull().default("open"),
    /** Responsible person (display name) */
    owner: varchar("owner", { length: 256 }),
    mitigationPlan: text("mitigationPlan"),
    contingencyPlan: text("contingencyPlan"),
    targetDate: varchar("targetDate", { length: 32 }),
    closedAt: timestamp("closedAt"),
    creatorId: integer("creatorId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectStatusSeverity: index("idx_project_risks_project_status_severity").on(
      table.projectId,
      table.status,
      table.severity
    ),
    idxProjectTargetDate: index("idx_project_risks_project_target").on(table.projectId, table.targetDate),
  })
);

export type ProjectRisk = typeof projectRisks.$inferSelect;
export type InsertProjectRisk = typeof projectRisks.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Gate Blockers
// ─────────────────────────────────────────────────────────────────────────────

export const GATE_BLOCKER_TYPES = ["quality", "npi"] as const;
export const GATE_BLOCKER_STATUSES = ["open", "resolved"] as const;

export type GateBlockerType = (typeof GATE_BLOCKER_TYPES)[number];
export type GateBlockerStatus = (typeof GATE_BLOCKER_STATUSES)[number];

export const gateBlockerTypeEnum = pgEnum("gate_blocker_type", GATE_BLOCKER_TYPES);
export const gateBlockerStatusEnum = pgEnum("gate_blocker_status", GATE_BLOCKER_STATUSES);

export const projectGateBlockers = pgTable(
  "project_gate_blockers",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    blockerType: gateBlockerTypeEnum("blockerType").notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    status: gateBlockerStatusEnum("status").notNull().default("open"),
    createdBy: integer("createdBy").notNull(),
    resolvedBy: integer("resolvedBy"),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectPhaseStatus: index("idx_gate_blockers_project_phase_status").on(
      table.projectId,
      table.phaseId,
      table.status
    ),
  })
);

export type ProjectGateBlocker = typeof projectGateBlockers.$inferSelect;
export type InsertProjectGateBlocker = typeof projectGateBlockers.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Test Plans / Reports
// ─────────────────────────────────────────────────────────────────────────────

export const TEST_PLAN_STATUSES = ["draft", "active", "completed"] as const;
export const TEST_CASE_STATUSES = ["planned", "passed", "failed", "blocked", "waived"] as const;
export const TEST_REPORT_RESULTS = ["pass", "fail", "conditional"] as const;
export const TEST_REPORT_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export const NPI_READINESS_CATEGORIES = [
  "dfm",
  "process_flow",
  "sop_wi",
  "fixture",
  "test_program",
  "trial_run",
  "yield",
  "packaging",
  "other",
] as const;
export const NPI_READINESS_STATUSES = ["pending", "ready", "blocked", "waived"] as const;
export const SAMPLE_SIGNOFF_TYPES = [
  "evt_sample",
  "dvt_sample",
  "pvt_sample",
  "golden_sample",
  "first_article",
  "other",
] as const;
export const SAMPLE_SIGNOFF_AUDIENCES = ["customer", "supplier", "internal"] as const;
export const SAMPLE_SIGNOFF_STATUSES = ["pending", "approved", "rejected", "waived"] as const;

export type TestPlanStatus = (typeof TEST_PLAN_STATUSES)[number];
export type TestCaseStatus = (typeof TEST_CASE_STATUSES)[number];
export type TestReportResult = (typeof TEST_REPORT_RESULTS)[number];
export type TestReportReviewStatus = (typeof TEST_REPORT_REVIEW_STATUSES)[number];
export type NpiReadinessCategory = (typeof NPI_READINESS_CATEGORIES)[number];
export type NpiReadinessStatus = (typeof NPI_READINESS_STATUSES)[number];
export type SampleSignoffType = (typeof SAMPLE_SIGNOFF_TYPES)[number];
export type SampleSignoffAudience = (typeof SAMPLE_SIGNOFF_AUDIENCES)[number];
export type SampleSignoffStatus = (typeof SAMPLE_SIGNOFF_STATUSES)[number];

export const testPlanStatusEnum = pgEnum("test_plan_status", TEST_PLAN_STATUSES);
export const testCaseStatusEnum = pgEnum("test_case_status", TEST_CASE_STATUSES);
export const testReportResultEnum = pgEnum("test_report_result", TEST_REPORT_RESULTS);
export const testReportReviewStatusEnum = pgEnum("test_report_review_status", TEST_REPORT_REVIEW_STATUSES);
export const npiReadinessCategoryEnum = pgEnum("npi_readiness_category", NPI_READINESS_CATEGORIES);
export const npiReadinessStatusEnum = pgEnum("npi_readiness_status", NPI_READINESS_STATUSES);
export const sampleSignoffTypeEnum = pgEnum("sample_signoff_type", SAMPLE_SIGNOFF_TYPES);
export const sampleSignoffAudienceEnum = pgEnum("sample_signoff_audience", SAMPLE_SIGNOFF_AUDIENCES);
export const sampleSignoffStatusEnum = pgEnum("sample_signoff_status", SAMPLE_SIGNOFF_STATUSES);

/**
 * project_test_plans table - QA-owned validation plan per EVT/DVT/PVT phase.
 * It is separate from deliverable files so Gate readiness can reason about
 * whether the factory has an intentional validation scope, not just an upload.
 */
export const projectTestPlans = pgTable(
  "project_test_plans",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    scope: text("scope"),
    sampleSize: varchar("sampleSize", { length: 64 }),
    ownerUserId: integer("ownerUserId"),
    status: testPlanStatusEnum("status").notNull().default("active"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectPhaseStatus: index("idx_test_plans_project_phase_status").on(
      table.projectId,
      table.phaseId,
      table.status
    ),
  })
);

export type ProjectTestPlan = typeof projectTestPlans.$inferSelect;
export type InsertProjectTestPlan = typeof projectTestPlans.$inferInsert;

/**
 * project_test_cases table - executable validation item with sample/SN context.
 * Failed or blocked cases must be resolved through an Issue before Gate readiness clears.
 */
export const projectTestCases = pgTable(
  "project_test_cases",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    planId: integer("planId"),
    title: varchar("title", { length: 256 }).notNull(),
    category: varchar("category", { length: 64 }).notNull().default("functional"),
    acceptanceCriteria: text("acceptanceCriteria"),
    method: text("method"),
    sampleSerials: jsonb("sampleSerials").$type<string[]>(),
    severity: issueSeverityEnum("severity").notNull().default("P2"),
    status: testCaseStatusEnum("status").notNull().default("planned"),
    resultNotes: text("resultNotes"),
    evidenceFileId: integer("evidenceFileId"),
    relatedIssueId: integer("relatedIssueId"),
    ownerUserId: integer("ownerUserId"),
    createdBy: integer("createdBy").notNull(),
    updatedBy: integer("updatedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectPhaseStatus: index("idx_test_cases_project_phase_status").on(
      table.projectId,
      table.phaseId,
      table.status
    ),
    idxPlan: index("idx_test_cases_plan").on(table.planId),
    idxIssue: index("idx_test_cases_issue").on(table.relatedIssueId),
  })
);

export type ProjectTestCase = typeof projectTestCases.$inferSelect;
export type InsertProjectTestCase = typeof projectTestCases.$inferInsert;

/**
 * project_test_reports table - formal QA validation report and review outcome.
 * Gate readiness only accepts QA-reviewed pass/conditional reports for EVT/DVT/PVT.
 */
export const projectTestReports = pgTable(
  "project_test_reports",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    planId: integer("planId"),
    title: varchar("title", { length: 256 }).notNull(),
    reportNo: varchar("reportNo", { length: 64 }),
    result: testReportResultEnum("result").notNull().default("conditional"),
    reviewStatus: testReportReviewStatusEnum("reviewStatus").notNull().default("pending"),
    summary: text("summary"),
    fileId: integer("fileId"),
    submittedBy: integer("submittedBy").notNull(),
    reviewedBy: integer("reviewedBy"),
    reviewedAt: timestamp("reviewedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectPhaseReview: index("idx_test_reports_project_phase_review").on(
      table.projectId,
      table.phaseId,
      table.reviewStatus,
      table.result
    ),
    idxPlan: index("idx_test_reports_plan").on(table.planId),
  })
);

export type ProjectTestReport = typeof projectTestReports.$inferSelect;
export type InsertProjectTestReport = typeof projectTestReports.$inferInsert;

/**
 * project_npi_readiness_checks table - PE/MFG-owned manufacturability and MP readiness checks.
 * This is separate from deliverables because Gate readiness must know whether PVT/MP is truly ready,
 * not only whether a SOP or report file exists.
 */
export const projectNpiReadinessChecks = pgTable(
  "project_npi_readiness_checks",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    category: npiReadinessCategoryEnum("category").notNull().default("other"),
    status: npiReadinessStatusEnum("status").notNull().default("pending"),
    ownerUserId: integer("ownerUserId"),
    dueDate: date("dueDate", { mode: "string" }),
    evidenceFileId: integer("evidenceFileId"),
    relatedIssueId: integer("relatedIssueId"),
    notes: text("notes"),
    createdBy: integer("createdBy").notNull(),
    updatedBy: integer("updatedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectPhaseStatus: index("idx_npi_readiness_project_phase_status").on(
      table.projectId,
      table.phaseId,
      table.status
    ),
    idxIssue: index("idx_npi_readiness_issue").on(table.relatedIssueId),
    idxFile: index("idx_npi_readiness_file").on(table.evidenceFileId),
  })
);

export type ProjectNpiReadinessCheck = typeof projectNpiReadinessChecks.$inferSelect;
export type InsertProjectNpiReadinessCheck = typeof projectNpiReadinessChecks.$inferInsert;

/**
 * project_sample_signoffs table - controlled customer/supplier confirmation items.
 * External users only see rows for their audience and never see internal-only signoff items.
 */
export const projectSampleSignoffs = pgTable(
  "project_sample_signoffs",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    signoffType: sampleSignoffTypeEnum("signoffType").notNull().default("other"),
    audience: sampleSignoffAudienceEnum("audience").notNull().default("customer"),
    status: sampleSignoffStatusEnum("status").notNull().default("pending"),
    sampleSerials: jsonb("sampleSerials").$type<string[]>(),
    fileId: integer("fileId"),
    dueDate: date("dueDate", { mode: "string" }),
    requestedBy: integer("requestedBy").notNull(),
    respondedBy: integer("respondedBy"),
    respondedAt: timestamp("respondedAt"),
    notes: text("notes"),
    responseNote: text("responseNote"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectPhaseAudienceStatus: index("idx_sample_signoffs_project_phase_audience_status").on(
      table.projectId,
      table.phaseId,
      table.audience,
      table.status
    ),
    idxFile: index("idx_sample_signoffs_file").on(table.fileId),
  })
);

export type ProjectSampleSignoff = typeof projectSampleSignoffs.$inferSelect;
export type InsertProjectSampleSignoff = typeof projectSampleSignoffs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Requirements Pool
// ─────────────────────────────────────────────────────────────────────────────

export const REQUIREMENT_STATUSES = [
  "new",
  "triaged",
  "planned",
  "in_progress",
  "accepted",
  "deferred",
  "rejected",
] as const;
export const REQUIREMENT_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const REQUIREMENT_SOURCES = [
  "customer",
  "sales",
  "market",
  "internal",
  "regulatory",
  "manufacturing",
  "quality",
  "supplier",
  "other",
] as const;
export const REQUIREMENT_TYPES = [
  "functional",
  "performance",
  "compliance",
  "cost",
  "schedule",
  "quality",
  "manufacturing",
  "ux",
  "packaging",
  "other",
] as const;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];
export type RequirementSource = (typeof REQUIREMENT_SOURCES)[number];
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const requirementStatusEnum = pgEnum("requirement_status", REQUIREMENT_STATUSES);
export const requirementPriorityEnum = pgEnum("requirement_priority", REQUIREMENT_PRIORITIES);
export const requirementSourceEnum = pgEnum("requirement_source", REQUIREMENT_SOURCES);
export const requirementTypeEnum = pgEnum("requirement_type", REQUIREMENT_TYPES);

/**
 * project_requirements table - raw product/project requirements before they
 * become SOP tasks, issues, or formal change records.
 */
export const projectRequirements = pgTable(
  "project_requirements",
  {
    id: serial("id").primaryKey(),
    /** 来源项目;可空 —— 纯产品/全局 backlog 尚未归属任何项目 */
    projectId: varchar("projectId", { length: 32 }),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    source: requirementSourceEnum("source").notNull().default("internal"),
    sourceDetail: varchar("sourceDetail", { length: 256 }),
    type: requirementTypeEnum("type").notNull().default("functional"),
    priority: requirementPriorityEnum("priority").notNull().default("P2"),
    status: requirementStatusEnum("status").notNull().default("new"),
    owner: varchar("owner", { length: 256 }),
    targetPhaseId: varchar("targetPhaseId", { length: 32 }),
    linkedTaskId: varchar("linkedTaskId", { length: 32 }),
    /** 价值链路：需求对应的商业目标，如销量/收入/毛利/客户承诺 */
    businessGoal: text("businessGoal"),
    /** 价值链路：需求对应的项目目标，如本项目要解决的问题或交付范围 */
    projectGoal: text("projectGoal"),
    /** 价值链路：验收或成功指标，如可量化 KPI / 测试指标 / 放行标准 */
    successMetric: text("successMetric"),
    acceptanceCriteria: text("acceptanceCriteria"),
    decisionNote: text("decisionNote"),
    creatorId: integer("creatorId"),
    /** 溯源：需求挂在产品上（永久），projectId 为来源项目 */
    productId: varchar("productId", { length: 32 }),
    /** 采纳转化目标类型：task | issue | change（null 表示未转化） */
    convertedType: varchar("convertedType", { length: 16 }),
    /** 转化目标 id（任务模板 id / 问题 id / 变更 id） */
    convertedId: varchar("convertedId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectStatusPriority: index("idx_requirements_project_status_priority").on(
      table.projectId,
      table.status,
      table.priority
    ),
    idxProjectCreatedAt: index("idx_requirements_project_created").on(
      table.projectId,
      table.createdAt
    ),
  })
);

export type ProjectRequirement = typeof projectRequirements.$inferSelect;
export type InsertProjectRequirement = typeof projectRequirements.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Gate Reviews
// ─────────────────────────────────────────────────────────────────────────────

export const GATE_DECISIONS = ["approved", "conditional", "rejected"] as const;
export type GateDecision = (typeof GATE_DECISIONS)[number];

export const gateDecisionEnum = pgEnum("gate_decision", GATE_DECISIONS);

export type GateReviewTraceSnapshot = {
  capturedAt: string;
  projectId: string;
  phaseId: string;
  gateName: string;
  product: {
    id: string;
    productNumber: string;
    name: string;
    lifecycleState: string;
  } | null;
  baseRevision: {
    id: number;
    revisionLabel: string;
    status: string;
  } | null;
  resultRevision: {
    id: number;
    revisionLabel: string;
    status: string;
  } | null;
  workingBom: {
    lineCount: number;
    rows: Array<{
      partNumber: string;
      name: string;
      spec: string;
      quantity: number;
      refDesignator: string;
      componentProductId: string | null;
      componentRevisionId: number | null;
      sortOrder: number;
    }>;
  };
  customerVariants: Array<{
    id: number;
    variantCode: string;
    customerSku: string | null;
    customerId: string;
    customerName: string;
    baseRevision: string;
    status: string;
    customerBomRevision: string | null;
    customerApproved: boolean;
    goldenSampleRef: string | null;
  }>;
  testEvidence?: {
    planCount: number;
    reportCount: number;
    approvedReportCount: number;
    failedCaseCount: number;
    unresolvedFailedCaseCount: number;
    reports: Array<{
      id: number;
      title: string;
      reportNo: string | null;
      result: string;
      reviewStatus: string;
      fileId: number | null;
    }>;
    failedCases: Array<{
      id: number;
      title: string;
      status: string;
      severity: string;
      sampleSerials: string[];
      relatedIssueId: number | null;
    }>;
  };
  npiEvidence?: {
    checkCount: number;
    openCheckCount: number;
    checks: Array<{
      id: number;
      title: string;
      category: string;
      status: string;
      evidenceFileId: number | null;
      relatedIssueId: number | null;
    }>;
  };
  sampleSignoffs?: {
    signoffCount: number;
    openSignoffCount: number;
    signoffs: Array<{
      id: number;
      title: string;
      signoffType: string;
      audience: string;
      status: string;
      sampleSerials: string[];
      fileId: number | null;
      respondedAt: string | null;
    }>;
  };
};

/**
 * project_gate_reviews table - gate review records per project/phase.
 */
export const projectGateReviews = pgTable(
  "project_gate_reviews",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    phaseName: varchar("phaseName", { length: 256 }).notNull().default(""),
    gateName: varchar("gateName", { length: 256 }).notNull().default(""),
    reviewDate: varchar("reviewDate", { length: 32 }).notNull(),
    /** Comma-separated participant names */
    participants: text("participants"),
    decision: gateDecisionEnum("decision").notNull().default("conditional"),
    /** Conditions if conditional approval */
    conditions: text("conditions"),
    /** Structured follow-up owner/due date for a conditional decision. */
    conditionOwnerUserId: integer("conditionOwnerUserId"),
    conditionDueDate: date("conditionDueDate", { mode: "string" }),
    notes: text("notes"),
    /** Review round number (1 = first, 2 = re-review, etc.) */
    roundNumber: integer("roundNumber").notNull().default(1),
    /** Product/revision pointers captured when the Gate decision was made */
    productId: varchar("productId", { length: 32 }),
    baseRevisionId: integer("baseRevisionId"),
    resultRevisionId: integer("resultRevisionId"),
    /** Immutable Gate-time trace context: BOM structure and customer variants, without commercial fields */
    traceSnapshot: jsonb("traceSnapshot").$type<GateReviewTraceSnapshot | null>(),
    createdBy: integer("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    /** Speed up gate review list queries per project/phase */
    idxProjectPhase: index("idx_gate_reviews_project_phase").on(
      table.projectId,
      table.phaseId
    ),
    idxProduct: index("idx_gate_reviews_product").on(table.productId),
  })
);

export type ProjectGateReview = typeof projectGateReviews.$inferSelect;
export type InsertProjectGateReview = typeof projectGateReviews.$inferInsert;

/** Full requirement snapshot for one Gate round. */
export const projectGateSignoffRounds = pgTable(
  "project_gate_signoff_rounds",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    roundNumber: integer("roundNumber").notNull(),
    status: varchar("status", { length: 24 }).$type<GateSignoffRoundStatus>().notNull().default("open"),
    requirements: jsonb("requirements").$type<Record<GateSignoffSlot, GateSignoffRequirement>>().notNull(),
    riskSnapshot: jsonb("riskSnapshot").$type<{
      safetyRiskLevel: ProjectSopRiskLevel;
      regulatoryRiskLevel: ProjectSopRiskLevel;
      safetyReasons?: string[];
      regulatoryReasons?: string[];
    }>().notNull(),
    sopTemplateVersion: varchar("sopTemplateVersion", { length: 32 }).notNull(),
    openedBy: integer("openedBy"),
    openedAt: timestamp("openedAt").defaultNow().notNull(),
    supersededBy: integer("supersededBy"),
    supersededAt: timestamp("supersededAt"),
    supersedeReason: text("supersedeReason"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqProjectPhaseRound: uniqueIndex("uniq_gate_signoff_round").on(table.projectId, table.phaseId, table.roundNumber),
    idxOpenRound: index("idx_gate_signoff_round_open").on(table.projectId, table.phaseId, table.status),
  }),
);

export type ProjectGateSignoffRound = typeof projectGateSignoffRounds.$inferSelect;
export type InsertProjectGateSignoffRound = typeof projectGateSignoffRounds.$inferInsert;

/** Project-specific requirement promotions. Reductions are rejected in the router. */
export const projectGateSignoffAdditions = pgTable(
  "project_gate_signoff_additions",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    slot: varchar("slot", { length: 32 }).$type<GateSignoffSlot>().notNull(),
    requirement: varchar("requirement", { length: 24 }).$type<GateSignoffRequirement>().notNull(),
    reason: text("reason").notNull(),
    active: boolean("active").notNull().default(true),
    addedBy: integer("addedBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqProjectPhaseSlot: uniqueIndex("uniq_gate_signoff_addition_slot").on(table.projectId, table.phaseId, table.slot),
    idxProjectPhase: index("idx_gate_signoff_additions_project_phase").on(table.projectId, table.phaseId),
  }),
);

export type ProjectGateSignoffAddition = typeof projectGateSignoffAdditions.$inferSelect;
export type InsertProjectGateSignoffAddition = typeof projectGateSignoffAdditions.$inferInsert;

/**
 * Structured, per-round Gate signatures. The requirement is computed from the
 * round snapshot and copied onto each signature for auditability.
 */
export const projectGateSignoffs = pgTable(
  "project_gate_signoffs",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    roundNumber: integer("roundNumber").notNull().default(1),
    slot: varchar("slot", { length: 32 }).$type<GateSignoffSlot>().notNull(),
    requirement: varchar("requirement", { length: 24 }).$type<GateSignoffRequirement>().notNull(),
    status: varchar("status", { length: 24 }).$type<GateSignoffStatus>().notNull().default("pending"),
    signedBy: integer("signedBy"),
    signedAt: timestamp("signedAt"),
    viaDelegationId: integer("viaDelegationId")
      .references(() => projectRoleDelegations.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqProjectPhaseRoundSlot: uniqueIndex("uniq_gate_signoff_round_slot").on(
      table.projectId,
      table.phaseId,
      table.roundNumber,
      table.slot,
    ),
    idxProjectPhaseRound: index("idx_gate_signoffs_project_phase_round").on(
      table.projectId,
      table.phaseId,
      table.roundNumber,
    ),
  }),
);

export type ProjectGateSignoff = typeof projectGateSignoffs.$inferSelect;
export type InsertProjectGateSignoff = typeof projectGateSignoffs.$inferInsert;

/** Structured post-release evidence; two QA-confirmed periods covering 14 days are required to close. */
export const projectStabilityReports = pgTable(
  "project_stability_reports",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revisionId: integer("revisionId"),
    periodStart: date("periodStart", { mode: "string" }).notNull(),
    periodEnd: date("periodEnd", { mode: "string" }).notNull(),
    outputQuantity: integer("outputQuantity").notNull().default(0),
    targetOutputQuantity: integer("targetOutputQuantity").notNull().default(0),
    fpyBasisPoints: integer("fpyBasisPoints").notNull().default(0),
    targetFpyBasisPoints: integer("targetFpyBasisPoints").notNull().default(0),
    capacityAttainmentBasisPoints: integer("capacityAttainmentBasisPoints").notNull().default(0),
    qualityEvents: text("qualityEvents"),
    summary: text("summary"),
    createdBy: integer("createdBy").notNull(),
    qaConfirmedBy: integer("qaConfirmedBy"),
    qaConfirmedAt: timestamp("qaConfirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqProjectPeriod: uniqueIndex("uniq_stability_report_period").on(table.projectId, table.periodStart, table.periodEnd),
    idxProject: index("idx_stability_reports_project").on(table.projectId, table.periodEnd),
  }),
);

export type ProjectStabilityReport = typeof projectStabilityReports.$inferSelect;
export type InsertProjectStabilityReport = typeof projectStabilityReports.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Change Log / Decisions
// ─────────────────────────────────────────────────────────────────────────────

export const CHANGE_TYPES = [
  "decision",  // 老板拍板 / 关键决策
  "tradeoff",  // 方案取舍
  "eco",       // ECO — Engineering Change Order
  "ecn",       // ECN — Engineering Change Notice
  "spec",      // 规格变更
  "cost",      // 成本变更
  "schedule",  // 时间/进度变更
  "supplier",  // 供应商变更
  "other",     // 其他
] as const;
export const CHANGE_STATUSES = [
  "proposed",    // 提议中
  "approved",    // 已批准
  "rejected",    // 已拒绝
  "implemented", // 已实施
  "cancelled",   // 已取消
] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export const changeTypeEnum = pgEnum("change_type", CHANGE_TYPES);
export const changeStatusEnum = pgEnum("change_status", CHANGE_STATUSES);

/**
 * project_changelog table - change records and decisions per project.
 */
export const projectChangelog = pgTable(
  "project_changelog",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    /** Auto-generated number e.g. ECR-001, ECN-002 */
    number: varchar("number", { length: 64 }).notNull().default(""),
    type: changeTypeEnum("type").notNull().default("other"),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    reason: text("reason"),
    decisionMaker: varchar("decisionMaker", { length: 256 }),
    /** JSON array of phase ids affected */
    affectedPhases: jsonb("affectedPhases").$type<string[]>().default([]),
    status: changeStatusEnum("status").notNull().default("proposed"),
    costImpact: varchar("costImpact", { length: 128 }),
    scheduleImpact: varchar("scheduleImpact", { length: 128 }),
    notes: text("notes"),
    createdDate: varchar("createdDate", { length: 32 }),
    implementedDate: varchar("implementedDate", { length: 32 }),
    creatorId: integer("creatorId"),
    /** 溯源：变更挂在产品上（永久），projectId 为来源项目（可空） */
    productId: varchar("productId", { length: 32 }),
    /** 发布时盖章：本变更并入的产出版本(应用层关联，不加 DB FK；见 idxRevision) */
    revisionId: integer("revisionId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    /** Speed up changelog list queries filtered by project/type/status */
    idxProjectTypeStatus: index("idx_changelog_project_type_status").on(
      table.projectId,
      table.type,
      table.status
    ),
    /** 反查：某版本并入了哪些变更 */
    idxRevision: index("idx_changelog_revision").on(table.revisionId),
  })
);

export type ProjectChangeRecord = typeof projectChangelog.$inferSelect;
export type InsertProjectChangeRecord = typeof projectChangelog.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Project Files (object storage metadata)
// ─────────────────────────────────────────────────────────────────────────────

export const PROJECT_FILE_VISIBILITIES = ["internal", "customer", "supplier", "public"] as const;
export type ProjectFileVisibility = (typeof PROJECT_FILE_VISIBILITIES)[number];

/**
 * project_files table - metadata for files uploaded to object storage.
 * Actual file bytes live in S3-compatible storage; this table stores the reference.
 */
export const projectFiles = pgTable(
  "project_files",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    /** Optional: associate file with a specific phase */
    phaseId: varchar("phaseId", { length: 32 }),
    /** Optional: associate file with a specific task within the phase */
    taskId: varchar("taskId", { length: 32 }),
    /** Optional: associate file with a specific gate deliverable by name (2a). */
    deliverableName: varchar("deliverableName", { length: 256 }),
    /** 文件格式类别（可空）；取值见 shared/file-types.ts FILE_TYPES */
    fileType: varchar("fileType", { length: 64 }),
    /** 版本标签（可空，≤32），如 V1.0 / T1 / Rev.B */
    fileVersion: varchar("fileVersion", { length: 32 }),
    /** Visibility boundary for internal vs customer/supplier-facing files */
    visibility: varchar("visibility", { length: 32 }).notNull().default("internal"),
    /** Original file name as uploaded */
    name: varchar("name", { length: 256 }).notNull(),
    mimeType: varchar("mimeType", { length: 128 }).notNull().default("application/octet-stream"),
    /** File size in bytes */
    size: bigint("size", { mode: "number" }).notNull().default(0),
    /** S3 object key (relative path within the bucket) */
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    /** Served URL path (e.g. /storage/{key}) */
    storageUrl: varchar("storageUrl", { length: 512 }).notNull(),
    /** User id of the uploader */
    uploadedBy: integer("uploadedBy").notNull(),
    /** 受控转轨时复制元数据并指向原文件，底层对象不重复上传。 */
    sourceFileId: integer("sourceFileId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    /** Speed up queries filtering files by project */
    idxProject: index("idx_project_files_project").on(table.projectId),
    /** Speed up queries filtering files by project + phase */
    idxProjectPhase: index("idx_project_files_project_phase").on(table.projectId, table.phaseId),
  })
);

export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = typeof projectFiles.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Activity Logs
// ─────────────────────────────────────────────────────────────────────────────

export const ACTIVITY_ACTIONS = [
  // Project lifecycle
  "project.create",
  "project.update",
  "project.delete",
  "project.archive",
  // Phase
  "phase.advance",
  "phase.update_dates",
  // Tasks
  "task.complete",
  "task.uncomplete",
  "task.submit_approval",
  "task.approve",
  "task.reject",
  "task.update_instructions",
  "task.update_meta",
  "task.update_deliverable",
  "task.rescheduled",
  "task.update_visible_roles",
  // Issues
  "issue.create",
  "issue.update",
  "issue.close",
  "issue.delete",
  // Requirements
  "requirement.create",
  "requirement.update",
  "requirement.delete",
  // Gate reviews
  "gate.create",
  "gate.update",
  "gate.delete",
  "npi_readiness.create",
  "npi_readiness.update",
  "npi_readiness.issue_create",
  "sample_signoff.create",
  "sample_signoff.respond",
  "sample_signoff.update",
  // Deliverable reviews
  "deliverable_review.submit",
  "deliverable_review.approve",
  "deliverable_review.reject",
  "deliverable_review.reset",
  // Release / product lifecycle
  "mp.release",
  "product.definition_confirmed",
  // External approvals
  "approval.submit",
  "approval.approve",
  "approval.reject",
  "approval.terminate",
  "approval.business_blocked",
  // Meetings / calendar
  "meeting.update_config",
  "calendar.create_event",
  // BOM
  "bom.add",
  "bom.update",
  "bom.delete",
  // Changelog
  "change.create",
  "change.update",
  "change.delete",
  // Files
  "file.upload",
  "file.delete",
  // Members
  "member.invite",
  "member.update_role",
  "member.remove",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/**
 * activity_logs table - immutable audit trail for key project operations.
 * Written on every significant mutation; never updated or deleted.
 */
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: serial("id").primaryKey(),
    /** Project this activity belongs to */
    projectId: varchar("projectId", { length: 32 }).notNull(),
    /** User who performed the action */
    userId: integer("userId").notNull(),
    /** Action type (see ACTIVITY_ACTIONS) */
    action: varchar("action", { length: 64 }).notNull(),
    /** Entity type affected (e.g. 'issue', 'task', 'file') */
    entityType: varchar("entityType", { length: 32 }),
    /** Entity id affected (numeric or string id) */
    entityId: varchar("entityId", { length: 64 }),
    /** Additional context as JSON (e.g. { title, from, to }) */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    /** Speed up timeline queries per project */
    idxProject: index("idx_activity_logs_project").on(table.projectId),
    /** Speed up queries per user */
    idxUser: index("idx_activity_logs_user").on(table.userId),
    /** Speed up queries per project ordered by time */
    idxProjectTime: index("idx_activity_logs_project_time").on(
      table.projectId,
      table.createdAt
    ),
  })
);

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = typeof activityLogs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Organizations (reserved for future multi-tenant support)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * organizations table - reserved for future organization/workspace support.
 * Currently not used in application logic; projects have orgId=null.
 */
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  ownerId: integer("ownerId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// PLM Spine: Platforms / Products / Product Revisions
// ─────────────────────────────────────────────────────────────────────────────

/** 平台 = 一组可复用核心模块版本的捆绑；整机派生自平台 */
export const platforms = pgTable("platforms", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  category: varchar("category", { length: 64 }).notNull().default(""),
  description: text("description"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type Platform = typeof platforms.$inferSelect;
export type InsertPlatform = typeof platforms.$inferInsert;

/** 产品 = 长期主数据；type 区分整机/零部件 */
export const products = pgTable("products", {
  id: varchar("id", { length: 32 }).primaryKey(),
  productNumber: varchar("productNumber", { length: 64 }).notNull().default(""),
  name: varchar("name", { length: 256 }).notNull(),
  /** finished（整机）| component（零部件：机芯/电机/电池包） */
  type: varchar("type", { length: 16 }).notNull().default("finished"),
  /** 开放品类：风扇 / 充气泵 / … */
  category: varchar("category", { length: 64 }).notNull().default(""),
  /** 派生自哪个平台（可空） */
  platformId: varchar("platformId", { length: 32 }),
  /** 目标市场字符串数组 EU/US/JP… */
  targetMarkets: jsonb("targetMarkets").$type<string[]>().default([]),
  /** concept | development | mass_production | maintenance | eol */
  lifecycleState: varchar("lifecycleState", { length: 32 }).notNull().default("concept"),
  /** Product manager / product owner for PRD and product version decisions */
  productManagerUserId: integer("productManagerUserId"),
  /** Close 后承接量产维护、版本变更与 ECO 决策的责任人。 */
  maintenanceOwnerUserId: integer("maintenanceOwnerUserId"),
  /** 产品轴售后问题入口的默认责任人。 */
  afterSalesOwnerUserId: integer("afterSalesOwnerUserId"),
  /** 当前生产版本（FK product_revisions.id，可空） */
  currentRevisionId: integer("currentRevisionId"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type ProductRow = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

export const PRODUCT_DEFINITION_STATUSES = ["draft", "confirmed"] as const;
export type ProductDefinitionStatus = (typeof PRODUCT_DEFINITION_STATUSES)[number];
export const productDefinitionStatusEnum = pgEnum(
  "product_definition_status",
  PRODUCT_DEFINITION_STATUSES
);
export const productDefinitionChangeAreaEnum = pgEnum(
  "product_definition_change_area",
  PRODUCT_DEFINITION_CHANGE_AREAS
);

/** 产品定义基线：PM 在项目开发前冻结的市场机会、PRD、规格、商业目标和 SKU 口径。 */
export const productDefinitions = pgTable(
  "product_definitions",
  {
    id: serial("id").primaryKey(),
    productId: varchar("productId", { length: 32 }).notNull(),
    title: varchar("title", { length: 256 }).notNull().default(""),
    opportunityName: varchar("opportunityName", { length: 256 }).notNull().default(""),
    opportunitySource: varchar("opportunitySource", { length: 128 }).notNull().default(""),
    targetCustomers: text("targetCustomers"),
    targetMarkets: jsonb("targetMarkets").$type<string[]>().notNull().default([]),
    applicationScenarios: text("applicationScenarios"),
    competitors: jsonb("competitors").$type<ProductDefinitionCompetitor[]>().notNull().default([]),
    priceBand: varchar("priceBand", { length: 128 }).notNull().default(""),
    positioning: text("positioning"),
    sellingPoints: jsonb("sellingPoints").$type<string[]>().notNull().default([]),
    differentiationStrategy: text("differentiationStrategy"),
    prdSummary: text("prdSummary"),
    specs: jsonb("specs").$type<ProductDefinitionSpec[]>().notNull().default([]),
    targetCost: varchar("targetCost", { length: 64 }).notNull().default(""),
    targetPrice: varchar("targetPrice", { length: 64 }).notNull().default(""),
    targetGrossMargin: varchar("targetGrossMargin", { length: 64 }).notNull().default(""),
    skuPlan: jsonb("skuPlan").$type<ProductDefinitionSku[]>().notNull().default([]),
    status: productDefinitionStatusEnum("status").notNull().default("draft"),
    confirmedBy: integer("confirmedBy"),
    confirmedAt: timestamp("confirmedAt"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqProductDefinition: uniqueIndex("uniq_product_definition_product").on(table.productId),
    idxDefinitionStatus: index("idx_product_definition_status").on(table.status),
  })
);
export type ProductDefinition = typeof productDefinitions.$inferSelect;
export type InsertProductDefinition = typeof productDefinitions.$inferInsert;

/** 产品定义确认快照：每次 Gate 确认后生成不可变 PRD 版本，用于开发输入追溯。 */
export const productDefinitionSnapshots = pgTable(
  "product_definition_snapshots",
  {
    id: serial("id").primaryKey(),
    productId: varchar("productId", { length: 32 }).notNull(),
    definitionId: integer("definitionId").notNull(),
    versionNumber: integer("versionNumber").notNull(),
    title: varchar("title", { length: 256 }).notNull().default(""),
    snapshot: jsonb("snapshot").$type<ProductDefinitionSnapshotPayload>().notNull(),
    confirmedBy: integer("confirmedBy").notNull(),
    confirmedAt: timestamp("confirmedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    uniqProductDefinitionSnapshotVersion: uniqueIndex("uniq_product_definition_snapshot_version").on(
      table.productId,
      table.versionNumber
    ),
    idxProductDefinitionSnapshotProduct: index("idx_product_definition_snapshots_product").on(table.productId),
  })
);
export type ProductDefinitionSnapshot = typeof productDefinitionSnapshots.$inferSelect;
export type InsertProductDefinitionSnapshot = typeof productDefinitionSnapshots.$inferInsert;

/** 产品定义变更：记录开发中相对已确认产品定义的删减、优化、客户新增要求和偏离。 */
export const productDefinitionChanges = pgTable(
  "product_definition_changes",
  {
    id: serial("id").primaryKey(),
    productId: varchar("productId", { length: 32 }).notNull(),
    /** 来源项目：变更来自某个 NPD / ECO 项目时填写 */
    sourceProjectId: varchar("sourceProjectId", { length: 32 }),
    area: productDefinitionChangeAreaEnum("area").notNull().default("other"),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    reason: text("reason"),
    requestedByCustomer: varchar("requestedByCustomer", { length: 256 }),
    baselineValue: text("baselineValue"),
    requestedValue: text("requestedValue"),
    impactScope: jsonb("impactScope").$type<string[]>().notNull().default([]),
    costImpact: varchar("costImpact", { length: 128 }),
    priceImpact: varchar("priceImpact", { length: 128 }),
    scheduleImpact: varchar("scheduleImpact", { length: 128 }),
    status: changeStatusEnum("status").notNull().default("proposed"),
    decisionNotes: text("decisionNotes"),
    createdBy: integer("createdBy").notNull(),
    approvedBy: integer("approvedBy"),
    approvedAt: timestamp("approvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProductStatus: index("idx_product_definition_changes_product_status").on(
      table.productId,
      table.status
    ),
    idxSourceProject: index("idx_product_definition_changes_source_project").on(table.sourceProjectId),
  })
);
export type ProductDefinitionChange = typeof productDefinitionChanges.$inferSelect;
export type InsertProductDefinitionChange = typeof productDefinitionChanges.$inferInsert;

export const PRODUCT_REVISION_STATUSES = ["draft", "released", "superseded"] as const;
export const productRevisionStatusEnum = pgEnum("product_revision_status", PRODUCT_REVISION_STATUSES);

/** Product Revision = 包装、印刷、标签等轻微改版记录；不由项目发布生成。 */
export const productRevisions = pgTable(
  "product_revisions",
  {
    id: serial("id").primaryKey(),
    productId: varchar("productId", { length: 32 }).notNull(),
    /** Rev A / B / C */
    revisionLabel: varchar("revisionLabel", { length: 16 }).notNull(),
    /** 父版本（自引用，轻微改版链） */
    parentRevisionId: integer("parentRevisionId"),
    /** 历史兼容：旧 Revision 可能记录来源项目；新 Revision 来自产品库轻量变更。 */
    createdByProjectId: varchar("createdByProjectId", { length: 32 }),
    status: productRevisionStatusEnum("status").notNull().default("draft"),
    releasedAt: timestamp("releasedAt"),
    releasedBy: integer("releasedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    uniqProductRevision: uniqueIndex("uniq_product_revision").on(
      table.productId,
      table.revisionLabel
    ),
    idxProduct: index("idx_product_revisions_product").on(table.productId),
  })
);
export type ProductRevision = typeof productRevisions.$inferSelect;
export type InsertProductRevision = typeof productRevisions.$inferInsert;

/** 量产发布记录 = 项目完成后生成/交付独立产品的冻结快照。 */
export const mpReleases = pgTable("mp_releases", {
  id: serial("id").primaryKey(),
  productId: varchar("productId", { length: 32 }).notNull(),
  /** 历史发布可能关联 Revision；新发布不生成 Revision，因此为空。 */
  revisionId: integer("revisionId"),
  projectId: varchar("projectId", { length: 32 }).notNull(),
  /** 外部审批实例 id（如钉钉 MP Release 审批），用于追溯审批来源 */
  externalApprovalInstanceId: integer("externalApprovalInstanceId"),
  /** 冻结的 BOM 快照（第四刀填充） */
  snapshotBom: jsonb("snapshotBom").$type<unknown[]>().default([]),
  /** 冻结的受控文档快照（第四刀填充） */
  snapshotDocs: jsonb("snapshotDocs").$type<unknown[]>().default([]),
  /** 发布快照：本版本并入的变更说明(不可变)；条目形状见 shared RevisionChangeEntry */
  snapshotChangelog: jsonb("snapshotChangelog").$type<unknown[]>().default([]),
  /** 发布时未关闭问题清单 */
  openIssues: jsonb("openIssues").$type<unknown[]>().default([]),
  /** 关键规格 */
  specs: jsonb("specs").$type<Record<string, unknown>>().default({}),
  notes: text("notes"),
  /** 是否为 conditional 留痕强制发布 */
  overridden: boolean("overridden").notNull().default(false),
  /** 强制发布理由（override 时必填） */
  overrideReason: text("overrideReason"),
  /** 强制发布操作人（服务端登录态写入） */
  acceptedBy: integer("acceptedBy"),
  /** 强制发布时间（服务端时间戳写入） */
  acceptedAt: timestamp("acceptedAt"),
  /** 发布时 Gate 条件快照 */
  conditionsSnapshot: text("conditionsSnapshot"),
  /** 后续条件跟进负责人 userId（override 时必填） */
  followUpOwner: integer("followUpOwner"),
  /** 条件跟进截止日（override 时必填） */
  dueDate: varchar("dueDate", { length: 32 }),
  /** Unified controlled-condition row; legacy follow-up fields remain as the release-time snapshot. */
  followUpConditionId: integer("followUpConditionId"),
  releasedBy: integer("releasedBy").notNull(),
  releasedAt: timestamp("releasedAt").defaultNow().notNull(),
});
export type MpRelease = typeof mpReleases.$inferSelect;
export type InsertMpRelease = typeof mpReleases.$inferInsert;

/** Product/revision/project certificate ledger used by deterministic coverage checks. */
export const productCertificates = pgTable(
  "product_certificates",
  {
    id: serial("id").primaryKey(),
    productId: varchar("productId", { length: 32 })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    projectId: varchar("projectId", { length: 32 })
      .references(() => projects.id, { onDelete: "set null" }),
    revisionId: integer("revisionId"),
    type: varchar("type", { length: 48 }).$type<CertificateType>().notNull(),
    scopeType: varchar("scopeType", { length: 24 }).$type<CertificateScopeType>().notNull(),
    status: varchar("status", { length: 24 }).$type<CertificateStatus>().notNull().default("draft"),
    certificateNumber: varchar("certificateNumber", { length: 256 }),
    issuingBody: varchar("issuingBody", { length: 256 }),
    targetMarkets: jsonb("targetMarkets").$type<string[]>().notNull().default([]),
    validFrom: date("validFrom", { mode: "string" }),
    validUntil: date("validUntil", { mode: "string" }),
    evidenceFileId: integer("evidenceFileId"),
    evidenceReference: text("evidenceReference"),
    reuseApproved: boolean("reuseApproved").notNull().default(false),
    reuseBasis: text("reuseBasis"),
    /** 产品轴续期责任与状态；到期提醒不依赖项目仍处于活跃状态。 */
    renewalOwnerUserId: integer("renewalOwnerUserId"),
    renewalStatus: varchar("renewalStatus", { length: 24 }).notNull().default("not_started"),
    renewalNotes: text("renewalNotes"),
    replacementCertificateId: integer("replacementCertificateId"),
    reviewedBy: integer("reviewedBy"),
    reviewedAt: timestamp("reviewedAt"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProductStatus: index("idx_product_certificates_product_status").on(table.productId, table.status),
    idxProject: index("idx_product_certificates_project").on(table.projectId),
    uniqProductCertificateNumber: uniqueIndex("uniq_product_certificate_number").on(table.productId, table.type, table.certificateNumber),
  }),
);
export type ProductCertificate = typeof productCertificates.$inferSelect;
export type InsertProductCertificate = typeof productCertificates.$inferInsert;

export const PROJECT_CONDITION_SOURCE_TYPES = ["gate", "release", "waiver", "certificate", "other"] as const;
export type ProjectConditionSourceType = (typeof PROJECT_CONDITION_SOURCE_TYPES)[number];
export const PROJECT_CONDITION_STATUSES = ["open", "closed", "converted_to_eco"] as const;
export type ProjectConditionStatus = (typeof PROJECT_CONDITION_STATUSES)[number];

/** Controlled conditions/waivers. Extension changes the due date but remains open. */
export const projectConditions = pgTable(
  "project_conditions",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceType: varchar("sourceType", { length: 24 }).$type<ProjectConditionSourceType>().notNull(),
    sourceId: varchar("sourceId", { length: 64 }),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description").notNull(),
    ownerUserId: integer("ownerUserId").notNull(),
    dueDate: date("dueDate", { mode: "string" }).notNull(),
    status: varchar("status", { length: 24 }).$type<ProjectConditionStatus>().notNull().default("open"),
    linkedEcoProjectId: varchar("linkedEcoProjectId", { length: 32 }),
    resolutionNote: text("resolutionNote"),
    resolvedBy: integer("resolvedBy"),
    resolvedAt: timestamp("resolvedAt"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqSource: uniqueIndex("uniq_project_condition_source").on(table.sourceType, table.sourceId),
    idxProjectStatus: index("idx_project_conditions_project_status").on(table.projectId, table.status),
    idxOwnerStatus: index("idx_project_conditions_owner_status").on(table.ownerUserId, table.status),
  }),
);
export type ProjectCondition = typeof projectConditions.$inferSelect;
export type InsertProjectCondition = typeof projectConditions.$inferInsert;

export const PROJECT_TRANSITION_STATUSES = ["completed", "cancelled"] as const;
export type ProjectTransitionStatus = (typeof PROJECT_TRANSITION_STATUSES)[number];

/** 受控转轨采用关旧开新，不原地改写轨道或历史任务。 */
export const projectTransitions = pgTable(
  "project_transitions",
  {
    id: serial("id").primaryKey(),
    sourceProjectId: varchar("sourceProjectId", { length: 32 }).notNull(),
    targetProjectId: varchar("targetProjectId", { length: 32 }).notNull(),
    fromCategory: varchar("fromCategory", { length: 32 }).notNull(),
    toCategory: varchar("toCategory", { length: 32 }).notNull(),
    reason: text("reason").notNull(),
    migrationSummary: jsonb("migrationSummary").$type<{ issues: number; files: number; members: number }>()
      .notNull().default({ issues: 0, files: 0, members: 0 }),
    status: varchar("status", { length: 24 }).$type<ProjectTransitionStatus>().notNull().default("completed"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    uniqSource: uniqueIndex("uniq_project_transition_source").on(table.sourceProjectId),
    uniqTarget: uniqueIndex("uniq_project_transition_target").on(table.targetProjectId),
  }),
);
export type ProjectTransition = typeof projectTransitions.$inferSelect;
export type InsertProjectTransition = typeof projectTransitions.$inferInsert;

export const PROJECT_CLOSE_HANDOFF_STATUSES = ["draft", "pending_acceptance", "accepted"] as const;
export type ProjectCloseHandoffStatus = (typeof PROJECT_CLOSE_HANDOFF_STATUSES)[number];
export const PROJECT_CLOSE_HANDOFF_ITEM_KEYS = [
  "controlled_documents",
  "maintenance_scope",
  "after_sales_process",
  "eco_process",
] as const;
export type ProjectCloseHandoffItemKey = (typeof PROJECT_CLOSE_HANDOFF_ITEM_KEYS)[number];

/**
 * 项目关闭前的正式量产移交单。项目团队提交后必须由 maintenanceOwnerUserId
 * 本人接收；Close Gate 只认可 accepted 状态，不把“PM 自己勾完成”当成交接。
 */
export const projectCloseHandoffs = pgTable(
  "project_close_handoffs",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    productId: varchar("productId", { length: 32 })
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    revisionId: integer("revisionId"),
    status: varchar("status", { length: 24 }).$type<ProjectCloseHandoffStatus>().notNull().default("draft"),
    maintenanceOwnerUserId: integer("maintenanceOwnerUserId").notNull(),
    afterSalesOwnerUserId: integer("afterSalesOwnerUserId").notNull(),
    scopeSummary: text("scopeSummary").notNull(),
    submittedBy: integer("submittedBy"),
    submittedAt: timestamp("submittedAt"),
    acceptedBy: integer("acceptedBy"),
    acceptedAt: timestamp("acceptedAt"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqProject: uniqueIndex("uniq_project_close_handoff_project").on(table.projectId),
    idxProductStatus: index("idx_project_close_handoff_product_status").on(table.productId, table.status),
    idxMaintenanceOwner: index("idx_project_close_handoff_owner_status").on(table.maintenanceOwnerUserId, table.status),
  }),
);
export type ProjectCloseHandoff = typeof projectCloseHandoffs.$inferSelect;
export type InsertProjectCloseHandoff = typeof projectCloseHandoffs.$inferInsert;

/** 固定四项的结构化移交清单；完成项必须同时提供受控证据引用。 */
export const projectCloseHandoffItems = pgTable(
  "project_close_handoff_items",
  {
    id: serial("id").primaryKey(),
    handoffId: integer("handoffId")
      .notNull()
      .references(() => projectCloseHandoffs.id, { onDelete: "cascade" }),
    itemKey: varchar("itemKey", { length: 48 }).$type<ProjectCloseHandoffItemKey>().notNull(),
    completed: boolean("completed").notNull().default(false),
    evidenceReference: text("evidenceReference"),
    completedBy: integer("completedBy"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqHandoffItem: uniqueIndex("uniq_project_close_handoff_item").on(table.handoffId, table.itemKey),
  }),
);
export type ProjectCloseHandoffItem = typeof projectCloseHandoffItems.$inferSelect;
export type InsertProjectCloseHandoffItem = typeof projectCloseHandoffItems.$inferInsert;

export const PROJECT_TERMINATION_STATUSES = ["draft", "pending_approval", "approved", "rejected", "cancelled"] as const;
export type ProjectTerminationStatus = (typeof PROJECT_TERMINATION_STATUSES)[number];
export const PROJECT_TERMINATION_ITEM_KEYS = [
  "tooling_disposition",
  "material_disposition",
  "sample_disposition",
  "customer_commitments",
  "finance_contracts",
  "ip_documents",
  "knowledge_capture",
] as const;
export type ProjectTerminationItemKey = (typeof PROJECT_TERMINATION_ITEM_KEYS)[number];

/** 项目终止前的结构化评审；批准人与编制人必须分离。 */
export const projectTerminationReviews = pgTable(
  "project_termination_reviews",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull().references(() => projects.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).$type<ProjectTerminationStatus>().notNull().default("draft"),
    reason: text("reason").notNull(),
    sunkCostSummary: text("sunkCostSummary").notNull(),
    customerCommunication: text("customerCommunication").notNull(),
    ownerUserId: integer("ownerUserId").notNull(),
    approverUserId: integer("approverUserId").notNull(),
    createdBy: integer("createdBy").notNull(),
    submittedBy: integer("submittedBy"),
    submittedAt: timestamp("submittedAt"),
    approvedBy: integer("approvedBy"),
    approvedAt: timestamp("approvedAt"),
    rejectionReason: text("rejectionReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqProject: uniqueIndex("uniq_project_termination_review_project").on(table.projectId),
    idxApproverStatus: index("idx_project_termination_approver_status").on(table.approverUserId, table.status),
  }),
);
export type ProjectTerminationReview = typeof projectTerminationReviews.$inferSelect;
export type InsertProjectTerminationReview = typeof projectTerminationReviews.$inferInsert;

export const projectTerminationItems = pgTable(
  "project_termination_items",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("reviewId").notNull().references(() => projectTerminationReviews.id, { onDelete: "cascade" }),
    itemKey: varchar("itemKey", { length: 48 }).$type<ProjectTerminationItemKey>().notNull(),
    disposition: text("disposition").notNull(),
    completed: boolean("completed").notNull().default(false),
    evidenceReference: text("evidenceReference"),
    completedBy: integer("completedBy"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqReviewItem: uniqueIndex("uniq_project_termination_item").on(table.reviewId, table.itemKey),
  }),
);
export type ProjectTerminationItem = typeof projectTerminationItems.$inferSelect;
export type InsertProjectTerminationItem = typeof projectTerminationItems.$inferInsert;

export const PRODUCT_SERVICE_CASE_SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export type ProductServiceCaseSeverity = (typeof PRODUCT_SERVICE_CASE_SEVERITIES)[number];
export const PRODUCT_SERVICE_CASE_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type ProductServiceCaseStatus = (typeof PRODUCT_SERVICE_CASE_STATUSES)[number];

/** 产品轴的轻量售后入口；必要时可关联到由同一入口创建的 ECO 项目。 */
export const productServiceCases = pgTable(
  "product_service_cases",
  {
    id: serial("id").primaryKey(),
    caseNumber: varchar("caseNumber", { length: 64 }).notNull(),
    productId: varchar("productId", { length: 32 })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    revisionId: integer("revisionId"),
    sourceProjectId: varchar("sourceProjectId", { length: 32 })
      .references(() => projects.id, { onDelete: "set null" }),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description").notNull(),
    severity: varchar("severity", { length: 8 }).$type<ProductServiceCaseSeverity>().notNull().default("P2"),
    status: varchar("status", { length: 24 }).$type<ProductServiceCaseStatus>().notNull().default("open"),
    ownerUserId: integer("ownerUserId").notNull(),
    linkedEcoProjectId: varchar("linkedEcoProjectId", { length: 32 }),
    resolutionNote: text("resolutionNote"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqCaseNumber: uniqueIndex("uniq_product_service_case_number").on(table.caseNumber),
    idxProductStatus: index("idx_product_service_cases_product_status").on(table.productId, table.status),
    idxOwnerStatus: index("idx_product_service_cases_owner_status").on(table.ownerUserId, table.status),
  }),
);
export type ProductServiceCase = typeof productServiceCases.$inferSelect;
export type InsertProductServiceCase = typeof productServiceCases.$inferInsert;

export const PRODUCT_WAIVER_STATUSES = [
  "draft", "pending_approval", "approved", "rejected", "expired", "closed", "converted_to_eco", "cancelled",
] as const;
export type ProductWaiverStatus = (typeof PRODUCT_WAIVER_STATUSES)[number];
export const PRODUCT_WAIVER_SCOPE_TYPES = ["lot", "batch", "quantity", "timeboxed"] as const;
export type ProductWaiverScopeType = (typeof PRODUCT_WAIVER_SCOPE_TYPES)[number];

/** 量产让步/临时代料：产品轴记录，限定批次/数量/期限并要求独立批准。 */
export const productWaivers = pgTable(
  "product_waivers",
  {
    id: serial("id").primaryKey(),
    waiverNumber: varchar("waiverNumber", { length: 64 }).notNull(),
    productId: varchar("productId", { length: 32 }).notNull().references(() => products.id, { onDelete: "cascade" }),
    projectId: varchar("projectId", { length: 32 }).references(() => projects.id, { onDelete: "set null" }),
    revisionId: integer("revisionId"),
    title: varchar("title", { length: 256 }).notNull(),
    deviationDescription: text("deviationDescription").notNull(),
    impactAssessment: text("impactAssessment").notNull(),
    containmentPlan: text("containmentPlan").notNull(),
    scopeType: varchar("scopeType", { length: 24 }).$type<ProductWaiverScopeType>().notNull(),
    lotOrBatch: varchar("lotOrBatch", { length: 256 }),
    quantityLimit: integer("quantityLimit"),
    affectedPartNumbers: jsonb("affectedPartNumbers").$type<string[]>().notNull().default([]),
    effectiveFrom: date("effectiveFrom", { mode: "string" }).notNull(),
    expiresOn: date("expiresOn", { mode: "string" }).notNull(),
    riskLevel: varchar("riskLevel", { length: 16 }).notNull().default("medium"),
    status: varchar("status", { length: 24 }).$type<ProductWaiverStatus>().notNull().default("draft"),
    ownerUserId: integer("ownerUserId").notNull(),
    approverUserId: integer("approverUserId").notNull(),
    evidenceReference: text("evidenceReference"),
    linkedEcoProjectId: varchar("linkedEcoProjectId", { length: 32 }),
    resolutionNote: text("resolutionNote"),
    createdBy: integer("createdBy").notNull(),
    submittedBy: integer("submittedBy"),
    submittedAt: timestamp("submittedAt"),
    approvedBy: integer("approvedBy"),
    approvedAt: timestamp("approvedAt"),
    resolvedBy: integer("resolvedBy"),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqNumber: uniqueIndex("uniq_product_waiver_number").on(table.waiverNumber),
    idxProductStatusExpiry: index("idx_product_waiver_status_expiry").on(table.productId, table.status, table.expiresOn),
    idxApproverStatus: index("idx_product_waiver_approver_status").on(table.approverUserId, table.status),
  }),
);
export type ProductWaiver = typeof productWaivers.$inferSelect;
export type InsertProductWaiver = typeof productWaivers.$inferInsert;

/** 证书续期提醒去重；同一有效期的 90/30 天提醒各发送一次。 */
export const certificateRenewalAlerts = pgTable(
  "certificate_renewal_alerts",
  {
    id: serial("id").primaryKey(),
    certificateId: integer("certificateId").notNull().references(() => productCertificates.id, { onDelete: "cascade" }),
    validUntil: date("validUntil", { mode: "string" }).notNull(),
    leadDays: integer("leadDays").notNull(),
    recipientUserId: integer("recipientUserId").notNull(),
    sentAt: timestamp("sentAt").defaultNow().notNull(),
  },
  (table) => ({
    uniqReminder: uniqueIndex("uniq_certificate_renewal_alert").on(table.certificateId, table.validUntil, table.leadDays),
  }),
);
export type CertificateRenewalAlert = typeof certificateRenewalAlerts.$inferSelect;

export const PROJECT_EXPENSE_CATEGORIES = ["tooling", "certification", "nre", "prototype", "travel", "other"] as const;
export type ProjectExpenseCategory = (typeof PROJECT_EXPENSE_CATEGORIES)[number];
export const PROJECT_EXPENSE_STATUSES = ["planned", "committed", "paid", "cancelled"] as const;
export type ProjectExpenseStatus = (typeof PROJECT_EXPENSE_STATUSES)[number];

/** 项目性支出。金额以最小货币单位存储，跨币种永不直接汇总。 */
export const projectExpenses = pgTable(
  "project_expenses",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 24 }).$type<ProjectExpenseCategory>().notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    supplier: varchar("supplier", { length: 256 }),
    currency: varchar("currency", { length: 3 }).notNull().default("CNY"),
    budgetAmountMinor: integer("budgetAmountMinor").notNull().default(0),
    actualAmountMinor: integer("actualAmountMinor").notNull().default(0),
    status: varchar("status", { length: 24 }).$type<ProjectExpenseStatus>().notNull().default("planned"),
    ownerUserId: integer("ownerUserId").notNull(),
    occurredDate: date("occurredDate", { mode: "string" }),
    evidenceReference: text("evidenceReference"),
    notes: text("notes"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    idxProjectStatus: index("idx_project_expenses_project_status").on(table.projectId, table.status),
    idxOwnerStatus: index("idx_project_expenses_owner_status").on(table.ownerUserId, table.status),
  }),
);
export type ProjectExpense = typeof projectExpenses.$inferSelect;
export type InsertProjectExpense = typeof projectExpenses.$inferInsert;

export const PRODUCT_SOFTWARE_RELEASE_STATUSES = [
  "draft", "pending_validation", "validated", "staged", "released", "rolled_back", "cancelled",
] as const;
export type ProductSoftwareReleaseStatus = (typeof PRODUCT_SOFTWARE_RELEASE_STATUSES)[number];

/** 非安全相关的软件/固件轻量发版单；安全相关变更必须转入 ECO。 */
export const productSoftwareReleases = pgTable(
  "product_software_releases",
  {
    id: serial("id").primaryKey(),
    releaseNumber: varchar("releaseNumber", { length: 64 }).notNull(),
    productId: varchar("productId", { length: 32 })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** 软件有自己的版本号，不依赖包装/印刷类 Product Revision。 */
    baseRevisionId: integer("baseRevisionId"),
    version: varchar("version", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).$type<ProductSoftwareReleaseStatus>().notNull().default("draft"),
    scopeSummary: text("scopeSummary").notNull(),
    releaseNotes: text("releaseNotes").notNull(),
    compatibilityNotes: text("compatibilityNotes").notNull(),
    safetyRelated: boolean("safetyRelated").notNull().default(false),
    bomOrManufacturingImpact: boolean("bomOrManufacturingImpact").notNull().default(false),
    regressionEvidenceReference: text("regressionEvidenceReference").notNull(),
    rolloutPlan: text("rolloutPlan").notNull(),
    rollbackPlan: text("rollbackPlan").notNull(),
    rolloutPercent: integer("rolloutPercent").notNull().default(0),
    qaOwnerUserId: integer("qaOwnerUserId").notNull(),
    submittedBy: integer("submittedBy"),
    submittedAt: timestamp("submittedAt"),
    validatedBy: integer("validatedBy"),
    validatedAt: timestamp("validatedAt"),
    releasedBy: integer("releasedBy"),
    releasedAt: timestamp("releasedAt"),
    rolledBackBy: integer("rolledBackBy"),
    rolledBackAt: timestamp("rolledBackAt"),
    rollbackReason: text("rollbackReason"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqReleaseNumber: uniqueIndex("uniq_product_software_release_number").on(table.releaseNumber),
    uniqProductVersion: uniqueIndex("uniq_product_software_release_version").on(table.productId, table.version),
    idxProductStatus: index("idx_product_software_releases_product_status").on(table.productId, table.status),
    idxQaStatus: index("idx_product_software_releases_qa_status").on(table.qaOwnerUserId, table.status),
  }),
);
export type ProductSoftwareRelease = typeof productSoftwareReleases.$inferSelect;
export type InsertProductSoftwareRelease = typeof productSoftwareReleases.$inferInsert;

export const PRODUCT_EOL_PLAN_STATUSES = ["draft", "pending_approval", "approved", "completed", "cancelled"] as const;
export type ProductEolPlanStatus = (typeof PRODUCT_EOL_PLAN_STATUSES)[number];
export const PRODUCT_EOL_ITEM_KEYS = [
  "customer_notice",
  "last_time_buy",
  "inventory_disposition",
  "supplier_shutdown",
  "service_spares_commitment",
  "certificate_records",
  "replacement_strategy",
] as const;
export type ProductEolItemKey = (typeof PRODUCT_EOL_ITEM_KEYS)[number];

/** 产品停产方案。只有批准且清单完整后才能把产品生命周期置为 eol。 */
export const productEolPlans = pgTable(
  "product_eol_plans",
  {
    id: serial("id").primaryKey(),
    productId: varchar("productId", { length: 32 })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).$type<ProductEolPlanStatus>().notNull().default("draft"),
    reason: text("reason").notNull(),
    lastOrderDate: date("lastOrderDate", { mode: "string" }).notNull(),
    lastShipDate: date("lastShipDate", { mode: "string" }).notNull(),
    serviceEndDate: date("serviceEndDate", { mode: "string" }).notNull(),
    sparePartsYears: integer("sparePartsYears").notNull(),
    inventoryDisposition: text("inventoryDisposition").notNull(),
    customerCommunicationPlan: text("customerCommunicationPlan").notNull(),
    supplierExitPlan: text("supplierExitPlan").notNull(),
    replacementProductId: varchar("replacementProductId", { length: 32 }),
    ownerUserId: integer("ownerUserId").notNull(),
    approverUserId: integer("approverUserId").notNull(),
    submittedBy: integer("submittedBy"),
    submittedAt: timestamp("submittedAt"),
    approvedBy: integer("approvedBy"),
    approvedAt: timestamp("approvedAt"),
    completedBy: integer("completedBy"),
    completedAt: timestamp("completedAt"),
    cancelledBy: integer("cancelledBy"),
    cancelledAt: timestamp("cancelledAt"),
    cancellationReason: text("cancellationReason"),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqProduct: uniqueIndex("uniq_product_eol_plan_product").on(table.productId),
    idxOwnerStatus: index("idx_product_eol_plans_owner_status").on(table.ownerUserId, table.status),
    idxApproverStatus: index("idx_product_eol_plans_approver_status").on(table.approverUserId, table.status),
  }),
);
export type ProductEolPlan = typeof productEolPlans.$inferSelect;
export type InsertProductEolPlan = typeof productEolPlans.$inferInsert;

export const productEolPlanItems = pgTable(
  "product_eol_plan_items",
  {
    id: serial("id").primaryKey(),
    planId: integer("planId")
      .notNull()
      .references(() => productEolPlans.id, { onDelete: "cascade" }),
    itemKey: varchar("itemKey", { length: 48 }).$type<ProductEolItemKey>().notNull(),
    completed: boolean("completed").notNull().default(false),
    evidenceReference: text("evidenceReference"),
    completedBy: integer("completedBy"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqPlanItem: uniqueIndex("uniq_product_eol_plan_item").on(table.planId, table.itemKey),
  }),
);
export type ProductEolPlanItem = typeof productEolPlanItems.$inferSelect;
export type InsertProductEolPlanItem = typeof productEolPlanItems.$inferInsert;

/** 产品轴治理操作的不可变审计日志（软件发版、EOL 等无 projectId 的动作）。 */
export const productGovernanceEvents = pgTable(
  "product_governance_events",
  {
    id: serial("id").primaryKey(),
    productId: varchar("productId", { length: 32 })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    entityType: varchar("entityType", { length: 32 }).notNull(),
    entityId: varchar("entityId", { length: 64 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    actorUserId: integer("actorUserId").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    idxProductCreated: index("idx_product_governance_events_product_created").on(table.productId, table.createdAt),
    idxEntity: index("idx_product_governance_events_entity").on(table.entityType, table.entityId),
  }),
);
export type ProductGovernanceEvent = typeof productGovernanceEvents.$inferSelect;
export type InsertProductGovernanceEvent = typeof productGovernanceEvents.$inferInsert;

export const dingtalkApprovalConfigs = pgTable(
  "dingtalk_approval_configs",
  {
    id: serial("id").primaryKey(),
    /** 业务类型，如 mp_release / gate_override */
    businessType: varchar("businessType", { length: 64 }).notNull(),
    processCode: varchar("processCode", { length: 128 }),
    enabled: boolean("enabled").notNull().default(false),
    /** 钉钉审批发起需要部门 id；为空时后端按 -1 发起 */
    defaultDeptId: integer("defaultDeptId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqBusinessType: uniqueIndex("uniq_dingtalk_approval_config_business").on(table.businessType),
  }),
);
export type DingtalkApprovalConfig = typeof dingtalkApprovalConfigs.$inferSelect;
export type InsertDingtalkApprovalConfig = typeof dingtalkApprovalConfigs.$inferInsert;

export const EXTERNAL_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "terminated",
  "sync_failed",
  "business_blocked",
] as const;
export const externalApprovalStatusEnum = pgEnum("external_approval_status", EXTERNAL_APPROVAL_STATUSES);

export const externalApprovalInstances = pgTable(
  "external_approval_instances",
  {
    id: serial("id").primaryKey(),
    provider: varchar("provider", { length: 32 }).notNull().default("dingtalk"),
    businessType: varchar("businessType", { length: 64 }).notNull(),
    entityType: varchar("entityType", { length: 64 }).notNull(),
    entityId: varchar("entityId", { length: 128 }).notNull(),
    projectId: varchar("projectId", { length: 32 }),
    processCode: varchar("processCode", { length: 128 }),
    processInstanceId: varchar("processInstanceId", { length: 128 }),
    status: externalApprovalStatusEnum("status").notNull().default("pending"),
    title: varchar("title", { length: 256 }),
    submittedBy: integer("submittedBy").notNull(),
    originatorUserId: integer("originatorUserId"),
    dingtalkOriginatorUserId: varchar("dingtalkOriginatorUserId", { length: 128 }),
    formSnapshot: jsonb("formSnapshot").$type<Record<string, unknown>>().default({}),
    requestSnapshot: jsonb("requestSnapshot").$type<Record<string, unknown>>().default({}),
    responseSnapshot: jsonb("responseSnapshot").$type<Record<string, unknown>>().default({}),
    lastError: text("lastError"),
    approvedAt: timestamp("approvedAt"),
    rejectedAt: timestamp("rejectedAt"),
    terminatedAt: timestamp("terminatedAt"),
    syncedAt: timestamp("syncedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqProcessInstance: uniqueIndex("uniq_external_approval_process_instance").on(table.processInstanceId),
    idxEntity: index("idx_external_approval_entity").on(table.businessType, table.entityType, table.entityId),
    idxProject: index("idx_external_approval_project").on(table.projectId),
  }),
);
export type ExternalApprovalInstance = typeof externalApprovalInstances.$inferSelect;
export type InsertExternalApprovalInstance = typeof externalApprovalInstances.$inferInsert;

export const dingtalkInteractiveCards = pgTable(
  "dingtalk_interactive_cards",
  {
    id: serial("id").primaryKey(),
    outTrackId: varchar("outTrackId", { length: 128 }).notNull(),
    actionItemId: integer("actionItemId"),
    recipientUserId: integer("recipientUserId").notNull(),
    projectId: varchar("projectId", { length: 32 }),
    eventKey: varchar("eventKey", { length: 64 }).notNull(),
    entityType: varchar("entityType", { length: 32 }),
    entityId: varchar("entityId", { length: 128 }),
    title: varchar("title", { length: 256 }).notNull(),
    body: text("body"),
    actionUrl: varchar("actionUrl", { length: 1024 }),
    status: varchar("status", { length: 24 }).notNull().default("sent"),
    cardData: jsonb("cardData").$type<Record<string, unknown>>().notNull().default({}),
    lastError: text("lastError"),
    handledAt: timestamp("handledAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqOutTrack: uniqueIndex("uniq_dingtalk_interactive_card_out_track").on(table.outTrackId),
    idxActionItem: index("idx_dingtalk_interactive_cards_action_item").on(table.actionItemId),
    idxRecipientStatus: index("idx_dingtalk_interactive_cards_recipient_status").on(table.recipientUserId, table.status),
  }),
);
export type DingtalkInteractiveCard = typeof dingtalkInteractiveCards.$inferSelect;
export type InsertDingtalkInteractiveCard = typeof dingtalkInteractiveCards.$inferInsert;

/**
 * OEM 客户版本 / Customer Revision = 同一产品型号下，各客户相对 Product Revision 的差异登记。
 * SKU 是客户版本下可销售的具体版本；Customer BOM Revision 基于标准 BOM 受控派生。
 * 所有客户版本与客户 BOM Revision 变化都应通过 ECO/ECN sourceRefId 留痕，只存 delta，不复制整份 BOM。
 */
export const CUSTOMER_VARIANT_STATUSES = ["draft", "active", "on_hold", "eol"] as const;
export const customerVariantStatusEnum = pgEnum("customer_variant_status", CUSTOMER_VARIANT_STATUSES);

export const customerVariants = pgTable(
  "customer_variants",
  {
    id: serial("id").primaryKey(),
    /** 客户版本号 / Customer Revision */
    variantCode: varchar("variantCode", { length: 64 }).notNull(),
    /** SKU / 可销售具体版本 */
    customerSku: varchar("customerSku", { length: 64 }),
    /** 产品型号 id（软引用 products.id） */
    parentProductId: varchar("parentProductId", { length: 32 }).notNull(),
    /** 基于哪个 Product Revision（Rev 标签） */
    baseRevision: varchar("baseRevision", { length: 16 }).notNull().default(""),
    customerId: varchar("customerId", { length: 64 }).notNull().default(""),
    customerName: varchar("customerName", { length: 256 }).notNull().default(""),
    status: customerVariantStatusEnum("status").notNull().default("draft"),
    /** 仅记录与 base 的差异 */
    deltas: jsonb("deltas").$type<VariantDelta[]>().notNull().default([]),
    /** 认证：是否沿用产品主版本 */
    certReuseParent: boolean("certReuseParent").notNull().default(true),
    /** 受影响、需复核的认证标识 */
    certAffectedMarks: jsonb("certAffectedMarks").$type<string[]>().notNull().default([]),
    certNotes: text("certNotes"),
    /** 客户放行：签样 / golden sample 记录引用 */
    goldenSampleRef: varchar("goldenSampleRef", { length: 256 }),
    customerApproved: boolean("customerApproved").notNull().default(false),
    approvedDate: varchar("approvedDate", { length: 32 }),
    /** 来源追溯：ECO / ECN 编号，应用层要求 sourceRefId 必填 */
    sourceType: varchar("sourceType", { length: 16 }).notNull().default("plm_change"),
    sourceRefId: varchar("sourceRefId", { length: 64 }),
    introducedAt: varchar("introducedAt", { length: 32 }),
    eolAt: varchar("eolAt", { length: 32 }),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqVariantCode: uniqueIndex("uniq_customer_variant_code").on(table.variantCode),
    idxParentProduct: index("idx_customer_variants_parent").on(table.parentProductId),
    idxCustomer: index("idx_customer_variants_customer").on(table.customerId),
  })
);
export type CustomerVariant = typeof customerVariants.$inferSelect;
export type InsertCustomerVariant = typeof customerVariants.$inferInsert;

/** BOM 行：工作态(projectId) 或 冻结态(revisionId)；可引用零部件产品（where-used 基础） */
export const bomItems = pgTable(
  "bom_items",
  {
    id: serial("id").primaryKey(),
    revisionId: integer("revisionId").references(() => productRevisions.id, { onDelete: "cascade" }),
    projectId: varchar("projectId", { length: 32 }).references(() => projects.id, { onDelete: "cascade" }),
    partNumber: varchar("partNumber", { length: 64 }).notNull().default(""),
    name: varchar("name", { length: 256 }).notNull(),
    spec: varchar("spec", { length: 256 }).notNull().default(""),
    quantity: integer("quantity").notNull().default(1),
    refDesignator: varchar("refDesignator", { length: 128 }).notNull().default(""),
    componentProductId: varchar("componentProductId", { length: 32 }),
    componentRevisionId: integer("componentRevisionId"),
    supplierName: varchar("supplierName", { length: 128 }).notNull().default(""),
    unitCost: varchar("unitCost", { length: 64 }).notNull().default(""),
    sortOrder: integer("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    idxRevision: index("idx_bom_revision").on(t.revisionId),
    idxProject: index("idx_bom_project").on(t.projectId),
    idxComponent: index("idx_bom_component").on(t.componentProductId),
  })
);
export type BomItem = typeof bomItems.$inferSelect;
export type InsertBomItem = typeof bomItems.$inferInsert;

// ── 协作：评论 + 通知 ─────────────────────────────────────────────────────────
/** 通用评论：挂在任意实体上（entityType+entityId） */
export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    entityType: varchar("entityType", { length: 24 }).notNull(),
    entityId: varchar("entityId", { length: 64 }).notNull(),
    projectId: varchar("projectId", { length: 32 }),
    authorId: integer("authorId").notNull(),
    body: text("body").notNull(),
    mentions: jsonb("mentions").$type<number[]>().default([]),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({ idxEntity: index("idx_comments_entity").on(t.entityType, t.entityId) })
);
export type Comment = typeof comments.$inferSelect;
export type InsertComment = typeof comments.$inferInsert;

/** 站内通知 */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    type: varchar("type", { length: 24 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    body: text("body"),
    entityType: varchar("entityType", { length: 24 }),
    entityId: varchar("entityId", { length: 64 }),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({ idxUser: index("idx_notifications_user").on(t.userId, t.read) })
);
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ── 自动化规则：内置规则配置 + 运行审计 ────────────────────────────────────────
export const automationRules = pgTable(
  "automation_rules",
  {
    id: serial("id").primaryKey(),
    ruleKey: varchar("ruleKey", { length: 64 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    updatedBy: integer("updatedBy"),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => ({
    uqRuleKey: uniqueIndex("uq_automation_rules_rule_key").on(t.ruleKey),
  })
);
export type AutomationRuleRow = typeof automationRules.$inferSelect;
export type InsertAutomationRule = typeof automationRules.$inferInsert;

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: serial("id").primaryKey(),
    ruleKey: varchar("ruleKey", { length: 64 }).notNull(),
    projectId: varchar("projectId", { length: 32 }),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    entityType: varchar("entityType", { length: 32 }).notNull(),
    entityId: varchar("entityId", { length: 128 }),
    status: varchar("status", { length: 16 }).notNull(),
    recipients: jsonb("recipients").$type<unknown>().default([]),
    detail: text("detail"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    idxRuleEntityCreated: index("idx_automation_runs_rule_entity_created").on(
      t.ruleKey,
      t.entityId,
      t.createdAt
    ),
    idxProjectCreated: index("idx_automation_runs_project_created").on(t.projectId, t.createdAt),
  })
);
export type AutomationRunRow = typeof automationRuns.$inferSelect;
export type InsertAutomationRun = typeof automationRuns.$inferInsert;

/**
 * Atomic automation side-effect claim. Runs remain append-only audit rows;
 * this table owns the stable uniqueness key, lease and last successful fire.
 */
export const automationClaims = pgTable(
  "automation_claims",
  {
    claimKey: varchar("claimKey", { length: 256 }).primaryKey(),
    ruleKey: varchar("ruleKey", { length: 64 }).notNull(),
    projectId: varchar("projectId", { length: 32 }),
    entityId: varchar("entityId", { length: 128 }),
    sourceActivityLogId: integer("sourceActivityLogId"),
    token: varchar("token", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("running"),
    claimedAt: timestamp("claimedAt").defaultNow().notNull(),
    lastFiredAt: timestamp("lastFiredAt"),
    lastError: text("lastError"),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => ({
    idxRuleProject: index("idx_automation_claims_rule_project").on(t.ruleKey, t.projectId),
    idxSourceLog: index("idx_automation_claims_source_log").on(t.sourceActivityLogId),
  })
);
export type AutomationClaim = typeof automationClaims.$inferSelect;
export type InsertAutomationClaim = typeof automationClaims.$inferInsert;

// ── 行动项：明确指派给个人、可闭环、可去重的「事找人」底座 ────────────────
export const ACTION_ITEM_KINDS = [
  "task_approval",
  "task_rework",
  "deliverable_review",
  "deliverable_rework",
  "issue_validation",
  "critical_issue",
  "delay_impact_notify",
  "mp_release_confirm",
  "condition_followup",
  "handoff_acceptance",
  "task_ready",
] as const;
export type ActionItemKind = (typeof ACTION_ITEM_KINDS)[number];
export const actionItemKindEnum = pgEnum("action_item_kind", ACTION_ITEM_KINDS);

export const ACTION_ITEM_STATUSES = [
  "open",
  "sent",
  "read",
  "done",
  "closed",
  "escalated",
  "snoozed",
] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];
export const actionItemStatusEnum = pgEnum("action_item_status", ACTION_ITEM_STATUSES);

export const ACTION_ITEM_LEVELS = ["owner", "pm", "manager"] as const;
export type ActionItemLevel = (typeof ACTION_ITEM_LEVELS)[number];
export const actionItemLevelEnum = pgEnum("action_item_level", ACTION_ITEM_LEVELS);

export const actionItems = pgTable(
  "action_items",
  {
    id: serial("id").primaryKey(),
    kind: actionItemKindEnum("kind").notNull(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    entityType: varchar("entityType", { length: 32 }).notNull(),
    entityId: varchar("entityId", { length: 128 }).notNull(),
    dedupeKey: varchar("dedupeKey", { length: 256 }).notNull(),
    recipientUserId: integer("recipientUserId").notNull(),
    level: actionItemLevelEnum("level").notNull().default("owner"),
    title: varchar("title", { length: 256 }).notNull(),
    body: text("body"),
    actionUrl: varchar("actionUrl", { length: 1024 }).notNull(),
    status: actionItemStatusEnum("status").notNull().default("open"),
    priority: varchar("priority", { length: 16 }).notNull().default("normal"),
    dueAt: timestamp("dueAt"),
    snoozedUntil: timestamp("snoozedUntil"),
    sourceActivityLogId: integer("sourceActivityLogId"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    firstSentAt: timestamp("firstSentAt"),
    lastSentAt: timestamp("lastSentAt"),
    readAt: timestamp("readAt"),
    handledAt: timestamp("handledAt"),
    closedAt: timestamp("closedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => ({
    uqDedupeKey: uniqueIndex("uq_action_items_dedupe_key").on(t.dedupeKey),
    idxRecipientStatus: index("idx_action_items_recipient_status").on(t.recipientUserId, t.status),
    idxProjectCreated: index("idx_action_items_project_created").on(t.projectId, t.createdAt),
    idxEntity: index("idx_action_items_entity").on(t.entityType, t.entityId),
  })
);
export type ActionItem = typeof actionItems.$inferSelect;
export type InsertActionItem = typeof actionItems.$inferInsert;

export const SOP_CHANGE_STATUSES = ["draft", "pending_approval", "approved", "rejected", "published", "cancelled"] as const;
export type SopChangeStatus = (typeof SOP_CHANGE_STATUSES)[number];

/** SOP 自身的受控变更申请；发布记录不直接改写任何历史项目。 */
export const sopChangeRequests = pgTable(
  "sop_change_requests",
  {
    id: serial("id").primaryKey(),
    requestNumber: varchar("requestNumber", { length: 64 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    currentVersion: varchar("currentVersion", { length: 32 }).notNull(),
    proposedVersion: varchar("proposedVersion", { length: 32 }).notNull(),
    affectedTracks: jsonb("affectedTracks").$type<string[]>().notNull().default([]),
    changeSummary: text("changeSummary").notNull(),
    rationale: text("rationale").notNull(),
    impactAnalysis: text("impactAnalysis").notNull(),
    migrationStrategy: text("migrationStrategy").notNull(),
    rollbackPlan: text("rollbackPlan").notNull(),
    effectiveDate: date("effectiveDate", { mode: "string" }).notNull(),
    status: varchar("status", { length: 24 }).$type<SopChangeStatus>().notNull().default("draft"),
    requesterUserId: integer("requesterUserId").notNull(),
    approverUserId: integer("approverUserId").notNull(),
    approvalNote: text("approvalNote"),
    submittedAt: timestamp("submittedAt"),
    approvedAt: timestamp("approvedAt"),
    publishedAt: timestamp("publishedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({
    uniqRequestNumber: uniqueIndex("uniq_sop_change_request_number").on(table.requestNumber),
    uniqPublishedVersion: uniqueIndex("uniq_sop_published_version").on(table.proposedVersion).where(sql`${table.status} = 'published'`),
    idxApproverStatus: index("idx_sop_change_approver_status").on(table.approverUserId, table.status),
  }),
);
export type SopChangeRequest = typeof sopChangeRequests.$inferSelect;
export type InsertSopChangeRequest = typeof sopChangeRequests.$inferInsert;

/** SOP 申请的不可变事件流。 */
export const sopChangeEvents = pgTable(
  "sop_change_events",
  {
    id: serial("id").primaryKey(),
    requestId: integer("requestId").notNull().references(() => sopChangeRequests.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 48 }).notNull(),
    actorUserId: integer("actorUserId").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    idxRequestCreated: index("idx_sop_change_event_request_created").on(table.requestId, table.createdAt),
  }),
);
export type SopChangeEvent = typeof sopChangeEvents.$inferSelect;

// ── 调度心跳：单实例巡检状态 + 便宜 DB 锁 ──────────────────────────────────
export const automationHeartbeats = pgTable("automation_heartbeats", {
  schedulerKey: varchar("schedulerKey", { length: 64 }).primaryKey(),
  lastStartedAt: timestamp("lastStartedAt"),
  lastFinishedAt: timestamp("lastFinishedAt"),
  status: varchar("status", { length: 24 }).notNull().default("idle"),
  durationMs: integer("durationMs"),
  lastCursorId: integer("lastCursorId").notNull().default(0),
  lastError: text("lastError"),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type AutomationHeartbeat = typeof automationHeartbeats.$inferSelect;
export type InsertAutomationHeartbeat = typeof automationHeartbeats.$inferInsert;

// ── 自定义字段（管理员定义，项目级填值）─────────────────────────────────
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "boolean"] as const;
export const customFieldTypeEnum = pgEnum("custom_field_type", CUSTOM_FIELD_TYPES);

/** 字段定义：全局由管理员维护。values 存在各实体的 customFields jsonb 里，按 fieldKey 取。 */
export const customFieldDefs = pgTable(
  "custom_field_defs",
  {
    id: serial("id").primaryKey(),
    /** 归属实体类型，目前仅 'project' */
    entityType: varchar("entityType", { length: 24 }).notNull().default("project"),
    /** 稳定 key（slug），实体 customFields 里以此为键 */
    fieldKey: varchar("fieldKey", { length: 64 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    fieldType: customFieldTypeEnum("fieldType").notNull().default("text"),
    /** select 类型的可选项（字符串数组） */
    options: jsonb("options").$type<string[]>().notNull().default([]),
    required: boolean("required").notNull().default(false),
    sortOrder: integer("sortOrder").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => ({ uqKey: uniqueIndex("uq_custom_field_key").on(t.entityType, t.fieldKey) })
);
export type CustomFieldDef = typeof customFieldDefs.$inferSelect;
export type InsertCustomFieldDef = typeof customFieldDefs.$inferInsert;
