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
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
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