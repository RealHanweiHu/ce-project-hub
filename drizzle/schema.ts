import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  datetime,
  varchar,
  json,
  boolean,
  bigint,
  uniqueIndex,
  index,
  date,
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
  risk: varchar("risk", { length: 16 }).notNull().default("low"),
  currentPhase: varchar("currentPhase", { length: 32 }).notNull().default("concept"),
  progress: int("progress").notNull().default(0),
  startDate: varchar("startDate", { length: 32 }),
  targetDate: varchar("targetDate", { length: 32 }),
  createdBy: int("createdBy").notNull(),
  archived: boolean("archived").notNull().default(false),
  /** Soft delete support */
  deletedAt: timestamp("deletedAt"),
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
    createdAt: datetime("createdAt").notNull().default(new Date(0)),
    updatedAt: datetime("updatedAt").notNull().default(new Date(0)),
  },
  (table) => ({
    /** Each project can only have one row per phase */
    uniqProjectPhase: uniqueIndex("uniq_project_phase").on(table.projectId, table.phaseId),
  })
);

export type ProjectPhase = typeof projectPhases.$inferSelect;
export type InsertProjectPhase = typeof projectPhases.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Tasks (per-project, per-phase task completion state) — PLM Enhanced
// ─────────────────────────────────────────────────────────────────────────────

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const RISK_LEVELS = ["none", "low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const APPROVAL_STATUSES = ["not_required", "pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * project_tasks table - tracks completion state and details for each SOP task.
 * Enhanced with PLM responsibility tracking fields.
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
    /** Assigned user (FK → users.id) */
    assigneeUserId: int("assigneeUserId"),
    /** Collaborators (JSON array of user IDs) */
    collaboratorUserIds: json("collaboratorUserIds").$type<number[]>().default([]),
    /** Due date for this task (DATE column, YYYY-MM-DD string at runtime) */
    dueDate: date("dueDate", { mode: "string" }),
    /** Task workflow status */
    status: mysqlEnum("status", TASK_STATUSES).notNull().default("todo"),
    /** Task priority */
    priority: mysqlEnum("priority", TASK_PRIORITIES).notNull().default("medium"),
    /** Risk level assessment */
    riskLevel: mysqlEnum("riskLevel", RISK_LEVELS).notNull().default("none"),
    /** Approval status for sensitive tasks */
    approvalStatus: mysqlEnum("approvalStatus", APPROVAL_STATUSES).notNull().default("not_required"),
    /** Predecessor task IDs (JSON array for Finish-to-Start dependencies) */
    predecessorTaskIds: json("predecessorTaskIds").$type<number[]>().default([]),
    /** Delay reason when task is overdue */
    delayReason: text("delayReason"),
    /** Completion evidence (file IDs or description) */
    completionEvidence: text("completionEvidence"),
    /** Timestamp when task was marked done */
    completedAt: timestamp("completedAt"),
    updatedBy: int("updatedBy"),
    /** Soft delete */
    deletedAt: timestamp("deletedAt"),
    createdAt: datetime("createdAt").notNull().default(new Date(0)),
    updatedAt: datetime("updatedAt").notNull().default(new Date(0)),
  },
  (table) => ({
    /** Each project/phase can only have one row per task template id */
    uniqProjectPhaseTask: uniqueIndex("uniq_project_phase_task").on(
      table.projectId,
      table.phaseId,
      table.taskId
    ),
    /** Speed up queries by project + status */
    idxProjectStatus: index("idx_tasks_project_status").on(table.projectId, table.status),
    /** Speed up assignee queries */
    idxAssignee: index("idx_tasks_assignee").on(table.assigneeUserId),
  })
);

export type ProjectTask = typeof projectTasks.$inferSelect;
export type InsertProjectTask = typeof projectTasks.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Issues — Upgraded to 8D/CAPA Closed-Loop Quality Management
// ─────────────────────────────────────────────────────────────────────────────

export const ISSUE_SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export const ISSUE_STATUSES = [
  "open",           // D1: 问题发现
  "contained",      // D3: 临时措施已实施
  "root_caused",    // D4: 根因已确认
  "correcting",     // D5/D6: 永久对策实施中
  "verifying",      // D7: 验证中
  "closed",         // D8: 关闭
  "wont_fix",       // 不修复
] as const;
export const ISSUE_CATEGORIES = [
  "hardware", "software", "mechanical", "thermal",
  "reliability", "safety", "performance", "other",
] as const;

export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

/**
 * project_issues table - 8D/CAPA closed-loop quality management.
 * Follows the 8D problem-solving methodology.
 */
export const projectIssues = mysqlTable(
  "project_issues",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    /** Auto-generated issue number (e.g. ISS-001) */
    issueNumber: varchar("issueNumber", { length: 32 }),
    title: varchar("title", { length: 512 }).notNull(),
    description: text("description"),
    severity: mysqlEnum("severity", ISSUE_SEVERITIES).notNull().default("P2"),
    status: mysqlEnum("status", ISSUE_STATUSES).notNull().default("open"),
    category: mysqlEnum("category", ISSUE_CATEGORIES).notNull().default("other"),

    // ── D1: Problem Discovery ──
    /** Responsible person (display name) */
    owner: varchar("owner", { length: 256 }),
    /** Owner user ID (FK → users.id) */
    ownerUserId: int("ownerUserId"),
    reporter: varchar("reporter", { length: 256 }),
    /** Responsible department */
    responsibleDept: varchar("responsibleDept", { length: 128 }),
    foundDate: varchar("foundDate", { length: 32 }),
    targetDate: varchar("targetDate", { length: 32 }),

    // ── D3: Containment Action (临时措施) ──
    containmentAction: text("containmentAction"),
    containmentDate: varchar("containmentDate", { length: 32 }),
    containmentVerified: boolean("containmentVerified").notNull().default(false),

    // ── D4: Root Cause Analysis (根因分析) ──
    rootCause: text("rootCause"),
    /** Root cause analysis method (5-Why, Fishbone, FTA, etc.) */
    rootCauseMethod: varchar("rootCauseMethod", { length: 64 }),

    // ── D5/D6: Permanent Corrective Action (永久对策) ──
    correctiveAction: text("correctiveAction"),
    correctiveActionDate: varchar("correctiveActionDate", { length: 32 }),
    /** Legacy field alias */
    solution: text("solution"),

    // ── D7: Verification (验证结果) ──
    verificationResult: text("verificationResult"),
    verificationDate: varchar("verificationDate", { length: 32 }),
    verifiedBy: int("verifiedBy"),

    // ── D8: Closure & Prevention ──
    closedDate: varchar("closedDate", { length: 32 }),
    closedBy: int("closedBy"),
    /** Preventive action to avoid recurrence */
    preventiveAction: text("preventiveAction"),
    /** Recurrence tracking: has this issue recurred? */
    recurrenceCount: int("recurrenceCount").notNull().default(0),
    /** Link to related recurrence issue IDs */
    relatedIssueIds: json("relatedIssueIds").$type<number[]>().default([]),

    relatedTaskId: varchar("relatedTaskId", { length: 64 }),
    /** User id of the creator (for permission checks) */
    creatorId: int("creatorId"),
    /** Soft delete */
    deletedAt: timestamp("deletedAt"),
    createdAt: datetime("createdAt").notNull().default(new Date(0)),
    updatedAt: datetime("updatedAt").notNull().default(new Date(0)),
  },
  (table) => ({
    /** Speed up issue list queries filtered by project/phase/status/severity */
    idxProjectPhaseStatusSeverity: index("idx_issues_project_phase_status_severity").on(
      table.projectId,
      table.phaseId,
      table.status,
      table.severity
    ),
    /** Speed up owner queries */
    idxOwner: index("idx_issues_owner").on(table.ownerUserId),
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
    /** Required deliverables check (JSON: {fileId, name, status}) */
    deliverableChecks: json("deliverableChecks").$type<Array<{fileId?: number; name: string; status: string}>>().default([]),
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
// Change Log / Decisions (ECR/ECN)
// ─────────────────────────────────────────────────────────────────────────────

export const CHANGE_TYPES = [
  "decision",  // 老板拍板 / 关键决策
  "tradeoff",  // 方案取舍
  "eco",       // ECO — Engineering Change Order
  "ecn",       // ECN — Engineering Change Notice
  "ecr",       // ECR — Engineering Change Request
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
    /** Affected BOM item IDs */
    affectedBomItemIds: json("affectedBomItemIds").$type<number[]>().default([]),
    status: mysqlEnum("status", CHANGE_STATUSES).notNull().default("proposed"),
    costImpact: varchar("costImpact", { length: 256 }),
    scheduleImpact: varchar("scheduleImpact", { length: 256 }),
    notes: text("notes"),
    createdDate: varchar("createdDate", { length: 32 }),
    implementedDate: varchar("implementedDate", { length: 32 }),
    creatorId: int("creatorId"),
    /** Soft delete */
    deletedAt: timestamp("deletedAt"),
    createdAt: datetime("createdAt").notNull().default(new Date(0)),
    updatedAt: datetime("updatedAt").notNull().default(new Date(0)),
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
// Project Files — Independent Document Governance with Versioning
// ─────────────────────────────────────────────────────────────────────────────

export const FILE_APPROVAL_STATUSES = ["draft", "pending_review", "approved", "rejected", "obsolete"] as const;
export type FileApprovalStatus = (typeof FILE_APPROVAL_STATUSES)[number];

export const FILE_CATEGORIES = [
  "prd", "bom", "drawing", "test_report", "certification",
  "trial_report", "specification", "manual", "other",
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

/**
 * project_files table - independent document governance with versioning.
 * Files are not just attachments; they are controlled deliverables.
 */
export const projectFiles = mysqlTable(
  "project_files",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    /** Optional: associate file with a specific phase */
    phaseId: varchar("phaseId", { length: 32 }),
    /** Optional: associate file with a specific task within the phase */
    taskId: varchar("taskId", { length: 32 }),
    /** Original file name as uploaded */
    name: varchar("name", { length: 256 }).notNull(),
    mimeType: varchar("mimeType", { length: 128 }).notNull().default("application/octet-stream"),
    /** File size in bytes */
    size: bigint("size", { mode: "number" }).notNull().default(0),
    /** S3 object key (relative path within the bucket) */
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    /** Served URL path (e.g. /manus-storage/{key}) */
    storageUrl: varchar("storageUrl", { length: 512 }).notNull(),

    // ── Version Management ──
    /** Version number (e.g. "1.0", "2.1") */
    version: varchar("version", { length: 16 }).notNull().default("1.0"),
    /** Whether this is the latest version */
    isLatest: boolean("isLatest").notNull().default(true),
    /** Previous version file ID (for version chain) */
    previousVersionId: int("previousVersionId"),
    /** File content hash (SHA-256) for deduplication */
    contentHash: varchar("contentHash", { length: 64 }),

    // ── Approval & Category ──
    /** Document category for gate deliverable matching */
    category: mysqlEnum("category", FILE_CATEGORIES).notNull().default("other"),
    /** Approval status */
    approvalStatus: mysqlEnum("approvalStatus", FILE_APPROVAL_STATUSES).notNull().default("draft"),
    /** Approved by user ID */
    approvedBy: int("approvedBy"),
    /** Approval date */
    approvedAt: timestamp("approvedAt"),

    /** User id of the uploader */
    uploadedBy: int("uploadedBy").notNull(),
    /** Soft delete */
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    /** Speed up queries filtering files by project */
    idxProject: index("idx_project_files_project").on(table.projectId),
    /** Speed up queries filtering files by project + phase */
    idxProjectPhase: index("idx_project_files_project_phase").on(table.projectId, table.phaseId),
    /** Speed up version chain queries */
    idxPreviousVersion: index("idx_project_files_prev_version").on(table.previousVersionId),
  })
);

export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = typeof projectFiles.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// BOM (Bill of Materials) — Factory PLM Core
// ─────────────────────────────────────────────────────────────────────────────

export const BOM_ITEM_TYPES = ["component", "sub_assembly", "raw_material", "packaging", "consumable"] as const;
export type BomItemType = (typeof BOM_ITEM_TYPES)[number];

/**
 * project_bom table - Bill of Materials management.
 * Tracks materials, suppliers, costs, and alternatives.
 */
export const projectBom = mysqlTable(
  "project_bom",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    /** BOM version (e.g. "A", "B", "C") */
    bomVersion: varchar("bomVersion", { length: 16 }).notNull().default("A"),
    /** Part number */
    partNumber: varchar("partNumber", { length: 64 }).notNull(),
    /** Part name / description */
    partName: varchar("partName", { length: 256 }).notNull(),
    /** Item type */
    itemType: mysqlEnum("itemType", BOM_ITEM_TYPES).notNull().default("component"),
    /** Quantity per unit */
    quantity: int("quantity").notNull().default(1),
    /** Unit (pcs, kg, m, etc.) */
    unit: varchar("unit", { length: 16 }).notNull().default("pcs"),
    /** Primary supplier */
    supplier: varchar("supplier", { length: 256 }),
    /** Supplier part number */
    supplierPartNumber: varchar("supplierPartNumber", { length: 128 }),
    /** Unit cost (stored as string for precision) */
    unitCost: varchar("unitCost", { length: 32 }),
    /** Currency */
    currency: varchar("currency", { length: 8 }).notNull().default("CNY"),
    /** Lead time in days */
    leadTimeDays: int("leadTimeDays"),
    /** Whether this is a critical/long-lead-time component */
    isCritical: boolean("isCritical").notNull().default(false),
    /** Alternative part IDs (JSON array) */
    alternatePartIds: json("alternatePartIds").$type<number[]>().default([]),
    /** Specification / notes */
    specification: text("specification"),
    /** Related ECN change record ID */
    relatedChangeId: int("relatedChangeId"),
    createdBy: int("createdBy"),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    idxProject: index("idx_bom_project").on(table.projectId),
    idxPartNumber: index("idx_bom_part_number").on(table.projectId, table.partNumber),
  })
);

export type ProjectBomItem = typeof projectBom.$inferSelect;
export type InsertProjectBomItem = typeof projectBom.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Comments — Discussion Threads on Tasks/Issues/Changes
// ─────────────────────────────────────────────────────────────────────────────

export const COMMENT_TARGET_TYPES = ["task", "issue", "change", "file", "gate_review"] as const;
export type CommentTargetType = (typeof COMMENT_TARGET_TYPES)[number];

/**
 * comments table - threaded discussions on any entity.
 */
export const comments = mysqlTable(
  "comments",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Target entity type */
    targetType: mysqlEnum("targetType", COMMENT_TARGET_TYPES).notNull(),
    /** Target entity ID */
    targetId: int("targetId").notNull(),
    /** Project context */
    projectId: varchar("projectId", { length: 32 }).notNull(),
    /** Comment author */
    authorId: int("authorId").notNull(),
    /** Comment content (supports markdown) */
    content: text("content").notNull(),
    /** Mentioned user IDs (for notification) */
    mentionedUserIds: json("mentionedUserIds").$type<number[]>().default([]),
    /** Parent comment ID for threading */
    parentId: int("parentId"),
    /** Soft delete */
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    idxTarget: index("idx_comments_target").on(table.targetType, table.targetId),
    idxProject: index("idx_comments_project").on(table.projectId),
  })
);

export type Comment = typeof comments.$inferSelect;
export type InsertComment = typeof comments.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Notifications — Multi-channel Notification Center
// ─────────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_TYPES = [
  "task_assigned", "task_due_soon", "task_overdue", "task_escalated",
  "issue_created", "issue_escalated", "issue_closed",
  "gate_review_scheduled", "gate_review_completed",
  "comment_mention", "comment_reply",
  "file_approval_needed", "file_approved", "file_rejected",
  "change_proposed", "change_approved",
  "project_update",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * notifications table - in-app notification center.
 */
export const notifications = mysqlTable(
  "notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Recipient user ID */
    userId: int("userId").notNull(),
    /** Notification type */
    type: varchar("type", { length: 64 }).notNull(),
    /** Notification title */
    title: varchar("title", { length: 256 }).notNull(),
    /** Notification body */
    body: text("body"),
    /** Related project ID */
    projectId: varchar("projectId", { length: 32 }),
    /** Link to navigate to */
    link: varchar("link", { length: 512 }),
    /** Whether the notification has been read */
    isRead: boolean("isRead").notNull().default(false),
    /** Additional metadata */
    meta: json("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    idxUser: index("idx_notifications_user").on(table.userId),
    idxUserRead: index("idx_notifications_user_read").on(table.userId, table.isRead),
  })
);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Activity Logs — Enhanced Audit Trail with Old/New Values
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
  "task.create",
  "task.complete",
  "task.uncomplete",
  "task.update",
  "task.update_instructions",
  "task.update_visible_roles",
  "task.assign",
  "task.escalate",
  "task.delete",
  // Issues (8D flow)
  "issue.create",
  "issue.update",
  "issue.contain",
  "issue.root_cause",
  "issue.correct",
  "issue.verify",
  "issue.close",
  "issue.delete",
  // Gate reviews
  "gate.create",
  "gate.update",
  // Changelog / ECR / ECN
  "change.create",
  "change.update",
  "change.approve",
  "change.reject",
  "change.implement",
  "change.delete",
  // Files
  "file.upload",
  "file.new_version",
  "file.approve",
  "file.reject",
  "file.delete",
  // BOM
  "bom.create",
  "bom.update",
  "bom.delete",
  // Members
  "member.invite",
  "member.update_role",
  "member.remove",
  // Comments
  "comment.create",
  "comment.delete",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/**
 * activity_logs table - immutable audit trail for key project operations.
 * Enhanced with old/new value tracking for full traceability.
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
    /** Old values before the change (JSON) */
    oldValues: json("oldValues").$type<Record<string, unknown>>(),
    /** New values after the change (JSON) */
    newValues: json("newValues").$type<Record<string, unknown>>(),
    /** Source of the action (web, api, system, webhook) */
    source: varchar("source", { length: 32 }).notNull().default("web"),
    /** Request ID for tracing */
    requestId: varchar("requestId", { length: 64 }),
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
    /** Speed up entity-specific audit queries */
    idxEntity: index("idx_activity_logs_entity").on(table.entityType, table.entityId),
  })
);

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = typeof activityLogs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Phase Deliverables — Required Documents per Gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * phase_deliverables table - defines required deliverables for each phase/gate.
 * Used to enforce document completeness before gate review.
 */
export const phaseDeliverables = mysqlTable(
  "phase_deliverables",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: varchar("projectId", { length: 32 }).notNull(),
    phaseId: varchar("phaseId", { length: 32 }).notNull(),
    /** Deliverable name (e.g. "PRD", "BOM", "测试报告") */
    name: varchar("name", { length: 256 }).notNull(),
    /** File category this deliverable expects */
    fileCategory: mysqlEnum("fileCategory", FILE_CATEGORIES).notNull().default("other"),
    /** Whether this deliverable is mandatory for gate passage */
    isMandatory: boolean("isMandatory").notNull().default(true),
    /** Linked file ID (when uploaded) */
    fileId: int("fileId"),
    /** Status: pending, uploaded, approved */
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    idxProjectPhase: index("idx_deliverables_project_phase").on(table.projectId, table.phaseId),
  })
);

export type PhaseDeliverable = typeof phaseDeliverables.$inferSelect;
export type InsertPhaseDeliverable = typeof phaseDeliverables.$inferInsert;

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
