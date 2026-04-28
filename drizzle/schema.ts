import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  boolean,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** User identifier - stores username for password auth (kept as openId for DB compatibility) */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  /** Username for login - same as openId for password-auth users */
  username: varchar("username", { length: 64 }).unique(),
  /** bcrypt hashed password. Null for legacy OAuth-only users. */
  passwordHash: varchar("passwordHash", { length: 256 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /**
   * Whether this user can create new projects.
   * Granted by admin. Typically given to PM, managers, and project leads.
   * System admin (role='admin') always has this permission regardless of this field.
   */
  canCreateProject: boolean("canCreateProject").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Projects (metadata only — no more data JSON blob)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Projects table - stores CE product development project metadata.
 * All phase/task/issue/gate/changelog data live in separate tables.
 */
export const projects = mysqlTable("projects", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  projectNumber: varchar("projectNumber", { length: 64 }).notNull().default(""),
  /** Product category: maps to SOP template */
  category: varchar("category", { length: 64 }).notNull().default("npd"),
  /**
   * Project manager user id (FK to users.id).
   * Use JOIN to get display name; no pmName string field.
   */
  pmUserId: int("pmUserId"),
  risk: mysqlEnum("risk", ["low", "medium", "high"]).notNull().default("low"),
  currentPhase: varchar("currentPhase", { length: 32 }).notNull().default("concept"),
  progress: int("progress").notNull().default(0),
  startDate: varchar("startDate", { length: 32 }),
  targetDate: varchar("targetDate", { length: 32 }),
  createdBy: int("createdBy").notNull(),
  archived: boolean("archived").notNull().default(false),
  /** Reserved for future organization/workspace support */
  orgId: int("orgId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  "viewer",
] as const;

export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

/**
 * project_members table - maps users to projects with a specific role.
 * The project creator is automatically added as 'owner'.
 * UNIQUE(projectId, userId) prevents duplicate membership.
 */
export const projectMembers = mysqlTable(
  "project_members",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    userId: int("userId").notNull(),
    /** Role determines what the member can do in this project */
    role: mysqlEnum("role", PROJECT_MEMBER_ROLES).notNull().default("viewer"),
    /** Display name for this member's job title (e.g. "硬件工程师", "测试主管") */
    jobTitle: varchar("jobTitle", { length: 64 }),
    invitedBy: int("invitedBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
export const projectPhases = mysqlTable(
  "project_phases",
  {
    id: int("id").autoincrement().primaryKey(),
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
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    /** Each project can only have one row per phase */
    uniqProjectPhase: uniqueIndex("uniq_project_phase").on(table.projectId, table.phaseId),
  })
);

export type ProjectPhase = typeof projectPhases.$inferSelect;
export type InsertProjectPhase = typeof projectPhases.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Tasks (per-project, per-phase task completion state)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * project_tasks table - tracks completion state and details for each SOP task.
 * One row per (project, phase, task) triple.
 */
export const projectTasks = mysqlTable(
  "project_tasks",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    /** Task id matching SOP template (e.g. 'c1', 'p3', 'd5') */
    taskId: varchar("taskId", { length: 32 }).notNull(),
    /** Whether the task is checked/completed */
    completed: boolean("completed").notNull().default(false),
    /** Task-level instructions / notes */
    instructions: text("instructions"),
    /**
     * Roles that can see this task.
     * JSON array of ProjectMemberRole strings.
     * Empty array = visible to all members.
     */
    visibleRoles: json("visibleRoles").$type<string[]>().default([]),
    updatedBy: int("updatedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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

/**
 * project_issues table - issue tracking per project/phase.
 */
export const projectIssues = mysqlTable(
  "project_issues",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    severity: mysqlEnum("severity", ISSUE_SEVERITIES).notNull().default("P2"),
    status: mysqlEnum("status", ISSUE_STATUSES).notNull().default("open"),
    category: mysqlEnum("category", ISSUE_CATEGORIES).notNull().default("other"),
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
    creatorId: int("creatorId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
// Gate Reviews
// ─────────────────────────────────────────────────────────────────────────────

export const GATE_DECISIONS = ["approved", "conditional", "rejected"] as const;
export type GateDecision = (typeof GATE_DECISIONS)[number];

/**
 * project_gate_reviews table - gate review records per project/phase.
 */
export const projectGateReviews = mysqlTable(
  "project_gate_reviews",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    phaseName: varchar("phaseName", { length: 256 }).notNull().default(""),
    gateName: varchar("gateName", { length: 256 }).notNull().default(""),
    reviewDate: varchar("reviewDate", { length: 32 }).notNull(),
    /** Comma-separated participant names */
    participants: text("participants"),
    decision: mysqlEnum("decision", GATE_DECISIONS).notNull().default("conditional"),
    /** Conditions if conditional approval */
    conditions: text("conditions"),
    notes: text("notes"),
    /** Review round number (1 = first, 2 = re-review, etc.) */
    roundNumber: int("roundNumber").notNull().default(1),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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

/**
 * project_changelog table - change records and decisions per project.
 */
export const projectChangelog = mysqlTable(
  "project_changelog",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    /** Auto-generated number e.g. ECR-001, ECN-002 */
    number: varchar("number", { length: 64 }).notNull().default(""),
    type: mysqlEnum("type", CHANGE_TYPES).notNull().default("other"),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    reason: text("reason"),
    decisionMaker: varchar("decisionMaker", { length: 256 }),
    /** JSON array of phase ids affected */
    affectedPhases: json("affectedPhases").$type<string[]>().default([]),
    status: mysqlEnum("status", CHANGE_STATUSES).notNull().default("proposed"),
    costImpact: varchar("costImpact", { length: 128 }),
    scheduleImpact: varchar("scheduleImpact", { length: 128 }),
    notes: text("notes"),
    createdDate: varchar("createdDate", { length: 32 }),
    implementedDate: varchar("implementedDate", { length: 32 }),
    creatorId: int("creatorId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    /** Speed up changelog list queries filtered by project/type/status */
    idxProjectTypeStatus: index("idx_changelog_project_type_status").on(
      table.projectId,
      table.type,
      table.status
    ),
  })
);

export type ProjectChangeRecord = typeof projectChangelog.$inferSelect;
export type InsertProjectChangeRecord = typeof projectChangelog.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Project Files (object storage metadata)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * project_files table - metadata for files uploaded to object storage.
 * Actual file bytes live in S3; this table stores the reference.
 */
export const projectFiles = mysqlTable(
  "project_files",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    /** Optional: associate file with a specific phase */
    phaseId: varchar("phaseId", { length: 32 }),
    /** Original file name as uploaded */
    name: varchar("name", { length: 256 }).notNull(),
    mimeType: varchar("mimeType", { length: 128 }).notNull().default("application/octet-stream"),
    /** File size in bytes */
    size: bigint("size", { mode: "number" }).notNull().default(0),
    /** S3 object key (relative path within the bucket) */
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    /** Served URL path (e.g. /manus-storage/{key}) */
    storageUrl: varchar("storageUrl", { length: 512 }).notNull(),
    /** User id of the uploader */
    uploadedBy: int("uploadedBy").notNull(),
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
  "task.update_visible_roles",
  // Issues
  "issue.create",
  "issue.update",
  "issue.close",
  "issue.delete",
  // Gate reviews
  "gate.create",
  "gate.update",
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
export const activityLogs = mysqlTable(
  "activity_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Project this activity belongs to */
    projectId: varchar("projectId", { length: 32 }).notNull(),
    /** User who performed the action */
    userId: int("userId").notNull(),
    /** Action type (see ACTIVITY_ACTIONS) */
    action: varchar("action", { length: 64 }).notNull(),
    /** Entity type affected (e.g. 'issue', 'task', 'file') */
    entityType: varchar("entityType", { length: 32 }),
    /** Entity id affected (numeric or string id) */
    entityId: varchar("entityId", { length: 64 }),
    /** Additional context as JSON (e.g. { title, from, to }) */
    meta: json("meta").$type<Record<string, unknown>>(),
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
export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  ownerId: int("ownerId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;
