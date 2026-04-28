import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
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

/**
 * Projects table - stores CE product development projects.
 * The `data` column holds the full project JSON (phases, tasks, issues, gate reviews, change log, etc.)
 */
export const projects = mysqlTable("projects", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  projectNumber: varchar("projectNumber", { length: 64 }).notNull().default(""),
  category: varchar("category", { length: 16 }).notNull().default("npd"),
  pm: varchar("pm", { length: 128 }).notNull().default(""),
  risk: varchar("risk", { length: 16 }).notNull().default("low"),
  currentPhase: varchar("currentPhase", { length: 32 }).notNull().default("concept"),
  progress: int("progress").notNull().default(0),
  startDate: varchar("startDate", { length: 32 }),
  targetDate: varchar("targetDate", { length: 32 }),
  /** Full project JSON data (phases, tasks, issues, gate reviews, change log, phaseDates) */
  data: json("data").notNull().$type<Record<string, unknown>>(),
  createdBy: int("createdBy").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

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

export type ProjectMemberRole = typeof PROJECT_MEMBER_ROLES[number];

/**
 * project_members table - maps users to projects with a specific role.
 * The project creator is automatically added as 'owner'.
 */
export const projectMembers = mysqlTable("project_members", {
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
});

export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = typeof projectMembers.$inferInsert;
