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
import type { VariantDelta } from "../shared/oem-variant";

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

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

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
  role: userRoleEnum("role").default("user").notNull(),
  /**
   * Whether this user can create new projects.
   * Granted by admin. Typically given to PM, managers, and project leads.
   * System admin (role='admin') always has this permission regardless of this field.
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

/**
 * Projects table - stores CE product development project metadata.
 * All phase/task/issue/gate/changelog data live in separate tables.
 */
export const projects = pgTable("projects", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  projectNumber: varchar("projectNumber", { length: 64 }).notNull().default(""),
  /** Product category: maps to SOP template */
  category: varchar("category", { length: 64 }).notNull().default("npd"),
  /**
   * Project manager user id (FK to users.id).
   * Use JOIN to get display name; no pmName string field.
   */
  pmUserId: integer("pmUserId"),
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
  /** Reserved for future organization/workspace support */
  orgId: integer("orgId"),
  /** 派生自哪个产品（PLM 脊梁）。现有项目为空。 */
  productId: varchar("productId", { length: 32 }),
  /** NPD 创建时锁定的产品定义快照，用于项目交接与后续追溯 */
  productDefinitionSnapshotId: integer("productDefinitionSnapshotId"),
  /** 派生起点版本（量产后项目指向当前 Rev） */
  baseRevisionId: integer("baseRevisionId"),
  /** 发布时回填的产出版本 */
  resultRevisionId: integer("resultRevisionId"),
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

// ─────────────────────────────────────────────────────────────────────────────
// Project Member Roles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Project member roles in CE product development context.
 *
 * Permission levels (high → low):
 *   owner      - 项目创建者，全部权限，不可被移除
 *   manager    - 管理层/决策层，可通过 Gate 评审，可管理成员
 *   pm         - 产品经理，可编辑项目信息、任务、问题、变更记录
 *   rd_hw      - 硬件研发，可编辑任务和问题
 *   rd_sw      - 软件研发，可编辑任务和问题
 *   rd_mech    - 结构/ID 研发，可编辑任务和问题
 *   qa         - 测试/品质，可编辑问题清单（Issue List）
 *   scm        - 供应链/采购，可编辑变更记录中的成本相关字段
 *   viewer     - 只读，仅查看，不可修改任何内容
 */
export const PROJECT_MEMBER_ROLES = [
  "owner",
  "manager",
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
  "viewer",
] as const;

export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

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
    projectId: varchar("projectId", { length: 32 }).notNull(),
    userId: integer("userId").notNull(),
    /** Role determines what the member can do in this project */
    role: projectMemberRoleEnum("role").notNull().default("viewer"),
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
    projectId: varchar("projectId", { length: 32 }).notNull(),
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
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    /** Task id matching SOP template (e.g. 'c1', 'p3', 'd5') */
    taskId: varchar("taskId", { length: 32 }).notNull(),
    /** Whether the task is checked/completed */
    completed: boolean("completed").notNull().default(false),
    /** Task-level instructions / notes */
    instructions: text("instructions"),
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
    /** Due date for this task (DATE column, YYYY-MM-DD string at runtime) */
    dueDate: date("dueDate", { mode: "string" }),
    /** 自动排期生成的任务开始日（YYYY-MM-DD） */
    startDate: date("startDate", { mode: "string" }),
    /** Task workflow status */
    status: taskStatusEnum("status").notNull().default("todo"),
    /** Timestamp when workflow status last changed */
    statusChangedAt: timestamp("statusChangedAt").defaultNow().notNull(),
    /** Task priority */
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    /** Timestamp when task was marked done */
    completedAt: timestamp("completedAt"),
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
    /** 溯源：问题挂在产品上（永久），projectId 为来源项目（可空，量产后客诉无项目） */
    productId: varchar("productId", { length: 32 }),
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

/**
 * project_gate_reviews table - gate review records per project/phase.
 */
export const projectGateReviews = pgTable(
  "project_gate_reviews",
  {
    id: serial("id").primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    phaseName: varchar("phaseName", { length: 256 }).notNull().default(""),
    gateName: varchar("gateName", { length: 256 }).notNull().default(""),
    reviewDate: varchar("reviewDate", { length: 32 }).notNull(),
    /** Comma-separated participant names */
    participants: text("participants"),
    decision: gateDecisionEnum("decision").notNull().default("conditional"),
    /** Conditions if conditional approval */
    conditions: text("conditions"),
    notes: text("notes"),
    /** Review round number (1 = first, 2 = re-review, etc.) */
    roundNumber: integer("roundNumber").notNull().default(1),
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
  })
);

export type ProjectGateReview = typeof projectGateReviews.$inferSelect;
export type InsertProjectGateReview = typeof projectGateReviews.$inferInsert;

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
  "task.update_instructions",
  "task.update_meta",
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

/** 主版本 / Product Revision = 产品型号下的冻结版本（PLM 轴）；版本链由项目串起 */
export const productRevisions = pgTable(
  "product_revisions",
  {
    id: serial("id").primaryKey(),
    productId: varchar("productId", { length: 32 }).notNull(),
    /** Rev A / B / C */
    revisionLabel: varchar("revisionLabel", { length: 16 }).notNull(),
    /** 父版本（自引用，量产后版本链） */
    parentRevisionId: integer("parentRevisionId"),
    /** 产出该版本的来源项目 */
    createdByProjectId: varchar("createdByProjectId", { length: 32 }),
    /** draft | released | superseded */
    status: varchar("status", { length: 16 }).notNull().default("draft"),
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

/** 量产发布记录 = 冻结快照（两轴交接点） */
export const mpReleases = pgTable("mp_releases", {
  id: serial("id").primaryKey(),
  productId: varchar("productId", { length: 32 }).notNull(),
  revisionId: integer("revisionId").notNull(),
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
  releasedBy: integer("releasedBy").notNull(),
  releasedAt: timestamp("releasedAt").defaultNow().notNull(),
});
export type MpRelease = typeof mpReleases.$inferSelect;
export type InsertMpRelease = typeof mpReleases.$inferInsert;

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
    status: varchar("status", { length: 32 }).notNull().default("pending"),
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

/**
 * OEM 客户版本 / Customer Revision = 同一产品型号下，各客户相对 Product Revision 的差异登记。
 * SKU 是客户版本下可销售的具体版本；Customer BOM Revision 基于标准 BOM 受控派生。
 * 所有客户版本与客户 BOM Revision 变化都应通过 ECO/ECN sourceRefId 留痕，只存 delta，不复制整份 BOM。
 */
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
    /** draft | active | on_hold | eol */
    status: varchar("status", { length: 16 }).notNull().default("draft"),
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
    revisionId: integer("revisionId"),
    projectId: varchar("projectId", { length: 32 }),
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
    entityId: varchar("entityId", { length: 64 }),
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
