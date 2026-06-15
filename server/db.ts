import { eq, desc, and, or, isNull, inArray, between, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  InsertUser, users, projects, InsertProject, ProjectRow,
  projectMembers, InsertProjectMember, ProjectMember, ProjectMemberRole,
  projectPhases, ProjectPhase, InsertProjectPhase,
  projectTasks, ProjectTask, InsertProjectTask,
  projectIssues, ProjectIssue, InsertProjectIssue,
  projectRequirements, ProjectRequirement, InsertProjectRequirement,
  projectGateReviews, ProjectGateReview, InsertProjectGateReview,
  projectChangelog, ProjectChangeRecord, InsertProjectChangeRecord,
  projectFiles, InsertProjectFile, ProjectFile,
  activityLogs, InsertActivityLog, ActivityLog,
  platforms, InsertPlatform,
  products, InsertProduct, ProductRow,
  productRevisions, InsertProductRevision, ProductRevision,
  mpReleases, InsertMpRelease,
  bomItems, BomItem, InsertBomItem,
  comments, Comment,
  notifications,
  automationRules, AutomationRuleRow, InsertAutomationRule,
  automationRuns, AutomationRunRow, InsertAutomationRun,
  customFieldDefs, CustomFieldDef, InsertCustomFieldDef,
  type TaskStatus, type TaskPriority,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { getSopPhasesForCategory } from "./sop-data";
import { getPhasesForCategory } from "../shared/sop-templates";
import { scheduleForCategory, buildSchedTasks } from "../shared/schedule-graph";
import { rescheduleFrom, type Schedule } from "../shared/scheduling";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

/** 缓存钉钉 unionId 到用户行（日历用） */
export async function setUserDingtalkId(userId: number, dingtalkUserId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ dingtalkUserId }).where(eq(users.id, userId));
}

/** 缓存钉钉通讯录 userid 到用户行（工作通知用） */
export async function setUserDingtalkCorpId(userId: number, dingtalkCorpUserId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ dingtalkCorpUserId }).where(eq(users.id, userId));
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0];
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result[0];
}

export async function createUserWithPassword(data: {
  username: string;
  passwordHash: string;
  name: string;
  email?: string | null;
  mobile?: string | null;
  role?: 'user' | 'admin';
  canCreateProject?: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.insert(users).values({
    openId: data.username,
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
    email: data.email ?? null,
    mobile: data.mobile ?? null,
    loginMethod: 'password',
    role: data.role ?? 'user',
    canCreateProject: data.canCreateProject ?? false,
    lastSignedIn: new Date(),
  });
}

/** 设置/更新用户手机号；改动后清掉 dingtalkUserId 缓存，下次按新手机号重新解析 */
export async function setUserMobile(userId: number, mobile: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({ mobile: mobile || null, dingtalkUserId: null, dingtalkCorpUserId: null }).where(eq(users.id, userId));
}

export async function updateUserPassword(userId: number, passwordHash: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

/** Count total users in the database (used by /api/setup to check if setup is needed) */
export async function countUsers(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.select({ id: users.id }).from(users).limit(1);
  // For setup check we only need to know if any user exists
  return result.length;
}

// ── Project helpers ───────────────────────────────────────────────────────────

/**
 * Get all projects accessible by a user:
 * - projects they created
 * - projects they are a member of
 */
export async function getProjectsByUser(userId: number): Promise<ProjectRow[]> {
  const db = await getDb();
  if (!db) return [];

  // Get project IDs where user is a member
  const memberRows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  const memberProjectIds = memberRows.map((r) => r.projectId);

  // Get projects created by user OR where user is a member
  if (memberProjectIds.length > 0) {
    return db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.archived, false),
          or(
            eq(projects.createdBy, userId),
            inArray(projects.id, memberProjectIds)
          )
        )
      )
      .orderBy(desc(projects.updatedAt));
  }

  return db
    .select()
    .from(projects)
    .where(and(eq(projects.createdBy, userId), eq(projects.archived, false)))
    .orderBy(desc(projects.updatedAt));
}

export async function getProjectById(id: string): Promise<ProjectRow | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return result[0];
}

export async function createProject(project: InsertProject): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(projects).values(project);
}

export async function createProjectWithSeed(
  project: InsertProject,
  category: string,
  createdBy: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const phases = getSopPhasesForCategory(category);
  await db.transaction(async (tx) => {
    await tx.insert(projects).values(project);
    for (const phase of phases) {
      await tx.insert(projectPhases).values({ projectId: project.id, phaseId: phase.id });
      for (const task of phase.tasks) {
        await tx.insert(projectTasks).values({
          projectId: project.id,
          phaseId: phase.id,
          taskId: task.id,
          completed: false,
          visibleRoles: task.visibleRoles,
          updatedBy: createdBy,
        });
      }
    }
  });
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<InsertProject, "id" | "createdBy" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects).set(patch).where(eq(projects.id, id));
}

/** 更新项目周会配置 */
export async function updateProjectMeetingConfig(
  projectId: string,
  meetingConfig: { enabled: boolean; weekday: number; time: string; durationMin: number; title: string }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(projects).set({ meetingConfig }).where(eq(projects.id, projectId));
}

/** 回填/清除项目已建钉钉日程 id */
export async function updateProjectDingtalkEvent(projectId: string, dingtalkEventId: string | null): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(projects).set({ dingtalkEventId }).where(eq(projects.id, projectId));
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects).set({ archived: true }).where(eq(projects.id, id));
}

/** Get projects where user is an explicit member (not creator) */
export async function getProjectsByMember(userId: number): Promise<ProjectRow[]> {
  const db = await getDb();
  if (!db) return [];
  const memberRows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  const memberProjectIds = memberRows.map((r) => r.projectId);
  if (memberProjectIds.length === 0) return [];
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.archived, false), inArray(projects.id, memberProjectIds)))
    .orderBy(desc(projects.updatedAt));
}

export type PortfolioRow = {
  id: string; name: string; projectNumber: string; category: string; risk: string;
  currentPhase: string; startDate: string | null; targetDate: string | null; pmUserId: number | null; pmName: string | null;
  taskTotal: number; taskDone: number; overdueTasks: number; blockedTasks: number;
  openIssues: number; criticalIssues: number; projectedEnd: string | null;
};

/** 跨项目组合看板：用户可见项目 + 每项目健康度聚合(任务/逾期/阻塞/开放问题/预计完成) */
export async function getPortfolio(userId: number): Promise<PortfolioRow[]> {
  const db = await getDb();
  if (!db) return [];
  // 总览全员只读可见全部未归档项目（详情/编辑仍按各自权限拦截），避免信息闭塞。
  const allProjects = await db.select().from(projects).where(eq(projects.archived, false));
  const projById = new Map<string, ProjectRow>();
  for (const p of allProjects) projById.set(p.id, p);
  const ids = Array.from(projById.keys());
  if (ids.length === 0) return [];

  const taskAgg = await db.select({
    projectId: projectTasks.projectId,
    total: drizzleSql<number>`count(*)::int`,
    done: drizzleSql<number>`count(*) filter (where ${projectTasks.status} in ('done','skipped'))::int`,
    overdue: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null and ${projectTasks.dueDate} < CURRENT_DATE and ${projectTasks.status} not in ('done','skipped'))::int`,
    blocked: drizzleSql<number>`count(*) filter (where ${projectTasks.status} = 'blocked')::int`,
    projectedEnd: drizzleSql<string | null>`max(${projectTasks.dueDate})::text`,
  }).from(projectTasks).where(inArray(projectTasks.projectId, ids)).groupBy(projectTasks.projectId);

  const issueAgg = await db.select({
    projectId: projectIssues.projectId,
    open: drizzleSql<number>`count(*) filter (where ${projectIssues.status} in ('open','in_progress'))::int`,
    critical: drizzleSql<number>`count(*) filter (where ${projectIssues.status} in ('open','in_progress') and ${projectIssues.severity} in ('P0','P1'))::int`,
  }).from(projectIssues).where(inArray(projectIssues.projectId, ids)).groupBy(projectIssues.projectId);

  const pmIds = Array.from(new Set(Array.from(projById.values()).map((p) => p.pmUserId).filter((x): x is number => !!x)));
  const pmRows = pmIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, pmIds)) : [];
  const pmName = new Map(pmRows.map((r) => [r.id, r.name]));
  const taskMap = new Map(taskAgg.map((t) => [t.projectId, t]));
  const issueMap = new Map(issueAgg.map((i) => [i.projectId, i]));

  return Array.from(projById.values()).map((p) => {
    const t = taskMap.get(p.id);
    const i = issueMap.get(p.id);
    return {
      id: p.id, name: p.name, projectNumber: p.projectNumber, category: p.category, risk: p.risk,
      currentPhase: p.currentPhase, startDate: p.startDate, targetDate: p.targetDate,
      pmUserId: p.pmUserId ?? null,
      pmName: p.pmUserId ? (pmName.get(p.pmUserId) ?? null) : null,
      taskTotal: t?.total ?? 0, taskDone: t?.done ?? 0, overdueTasks: t?.overdue ?? 0, blockedTasks: t?.blocked ?? 0,
      openIssues: i?.open ?? 0, criticalIssues: i?.critical ?? 0, projectedEnd: t?.projectedEnd ?? null,
    };
  });
}

// ── Project Member helpers ────────────────────────────────────────────────────

/** Get all members of a project, joined with user info */
/** 周会参与人：项目成员 ∪ PM，返回用户记录(id=userId + mobile + 钉钉缓存)，供日程同步解析钉钉身份 */
export async function getMeetingParticipants(
  projectId: string,
  pmUserId: number | null
): Promise<Array<{ id: number; mobile: string | null; dingtalkUserId: string | null }>> {
  const db = await getDb();
  if (!db) return [];
  const memberRows = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId));
  const ids = new Set<number>(memberRows.map((r) => r.userId));
  if (pmUserId) ids.add(pmUserId);
  if (ids.size === 0) return [];
  return db.select({ id: users.id, mobile: users.mobile, dingtalkUserId: users.dingtalkUserId })
    .from(users).where(inArray(users.id, Array.from(ids)));
}

export async function getProjectMembers(projectId: string): Promise<Array<ProjectMember & {
  userName: string | null;
  userEmail: string | null;
}>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: projectMembers.id,
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
      jobTitle: projectMembers.jobTitle,
      invitedBy: projectMembers.invitedBy,
      createdAt: projectMembers.createdAt,
      updatedAt: projectMembers.updatedAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(projectMembers)
    .leftJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.createdAt);
  return rows as Array<ProjectMember & { userName: string | null; userEmail: string | null }>;
}

/** Get a specific member's role in a project */
export async function getProjectMember(projectId: string, userId: number): Promise<ProjectMember | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return result[0];
}

/** Add a member to a project */
export async function addProjectMember(member: InsertProjectMember): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(projectMembers).values(member);
}

/**
 * 确保某用户是项目成员;不存在则按给定角色加入,已存在则不动(不覆盖既有角色)。
 * 返回是否新加入。用于「选了 PM 自动给访问权」。
 */
export async function ensureProjectMember(
  projectId: string,
  userId: number,
  role: ProjectMemberRole,
  invitedBy: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getProjectMember(projectId, userId);
  if (existing) return false;
  await db.insert(projectMembers).values({ projectId, userId, role, invitedBy });
  return true;
}

/** Update a member's role or jobTitle */
export async function updateProjectMember(
  projectId: string,
  userId: number,
  patch: { role?: ProjectMemberRole; jobTitle?: string | null }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(projectMembers)
    .set(patch)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

/** Remove a member from a project */
export async function removeProjectMember(projectId: string, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

// ── Project Phases helpers ────────────────────────────────────────────────────

/** Get all phase records for a project */
export async function getProjectPhases(projectId: string): Promise<ProjectPhase[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectPhases)
    .where(eq(projectPhases.projectId, projectId))
    .orderBy(projectPhases.id);
}

/** Upsert a project phase record (create if not exists, update if exists) */
export async function upsertProjectPhase(
  projectId: string,
  phaseId: string,
  patch: { startDate?: string | null; endDate?: string | null; notes?: string | null }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select()
    .from(projectPhases)
    .where(and(eq(projectPhases.projectId, projectId), eq(projectPhases.phaseId, phaseId)))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(projectPhases)
      .set(patch)
      .where(and(eq(projectPhases.projectId, projectId), eq(projectPhases.phaseId, phaseId)));
  } else {
    await db.insert(projectPhases).values({ projectId, phaseId, ...patch });
  }
}

// ── Project Tasks helpers ─────────────────────────────────────────────────────

/** Get all task records for a project (optionally filtered by phase) */
export async function getProjectTasks(projectId: string, phaseId?: string): Promise<ProjectTask[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = phaseId
    ? and(eq(projectTasks.projectId, projectId), eq(projectTasks.phaseId, phaseId))
    : eq(projectTasks.projectId, projectId);
  return db.select().from(projectTasks).where(conditions).orderBy(projectTasks.id);
}

/** Upsert a task record (create or update by projectId+phaseId+taskId) */
export async function upsertProjectTask(
  projectId: string,
  phaseId: string,
  taskId: string,
  patch: { completed?: boolean; instructions?: string | null; visibleRoles?: string[]; status?: TaskStatus; completedAt?: Date | null; updatedBy?: number | null }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select()
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.projectId, projectId),
        eq(projectTasks.phaseId, phaseId),
        eq(projectTasks.taskId, taskId)
      )
    )
    .limit(1);
  const dbPatch = toDbPatch(patch);
  if (existing.length > 0) {
    await db
      .update(projectTasks)
      .set(dbPatch)
      .where(
        and(
          eq(projectTasks.projectId, projectId),
          eq(projectTasks.phaseId, phaseId),
          eq(projectTasks.taskId, taskId)
        )
      );
  } else {
    await db.insert(projectTasks).values({ projectId, phaseId, taskId, ...dbPatch });
  }
}

/**
 * Seed project_phases and project_tasks from SOP template on project creation.
 * Creates phase records and task records (all unchecked) based on category.
 */
export async function seedProjectPhasesAndTasks(
  projectId: string,
  category: string,
  createdBy: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const phases = getSopPhasesForCategory(category);
  for (const phase of phases) {
    // Insert phase record
    await db.insert(projectPhases).values({ projectId, phaseId: phase.id });
    // Insert task records
    for (const task of phase.tasks) {
      await db.insert(projectTasks).values({
        projectId,
        phaseId: phase.id,
        taskId: task.id,
        completed: false,
        visibleRoles: task.visibleRoles,
        updatedBy: createdBy,
      });
    }
  }
}

// ── Project Issues helpers ────────────────────────────────────────────────────

/** Get all issues for a project (optionally filtered by phase) */
export async function getProjectIssues(projectId: string, phaseId?: string): Promise<ProjectIssue[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = phaseId
    ? and(eq(projectIssues.projectId, projectId), eq(projectIssues.phaseId, phaseId))
    : eq(projectIssues.projectId, projectId);
  return db.select().from(projectIssues).where(conditions).orderBy(desc(projectIssues.createdAt));
}

/** Create a new issue */
export async function createProjectIssue(issue: InsertProjectIssue): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectIssues).values(issue).returning({ id: projectIssues.id });
  return result[0].id;
}

/** Update an issue */
export async function updateProjectIssue(
  id: number,
  patch: Partial<Omit<InsertProjectIssue, "id" | "projectId" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectIssues).set(patch).where(eq(projectIssues.id, id));
}

/** Delete an issue */
export async function deleteProjectIssue(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectIssues).where(eq(projectIssues.id, id));
}

// ── Project Requirements helpers ─────────────────────────────────────────────

const REQ_ORDER = [
  drizzleSql`CASE ${projectRequirements.priority} WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END`,
  desc(projectRequirements.createdAt),
] as const;

/** Get all requirements for a project (严格按 projectId,内部用). */
export async function getProjectRequirements(projectId: string): Promise<ProjectRequirement[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectRequirements)
    .where(eq(projectRequirements.projectId, projectId))
    .orderBy(...REQ_ORDER);
}

/** 单条查询(按 id),用于鉴权与转化。 */
export async function getRequirementById(id: number): Promise<ProjectRequirement | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(projectRequirements).where(eq(projectRequirements.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * 统一需求池查询。一套池子,多个过滤视图:
 * - project: 本项目提出(projectId=X) ∪ 本产品待承接(productId=P 且 projectId 为空)
 * - product: 该产品的全部需求(productId=P)
 * - global:  全部需求
 */
export type RequirementFilter =
  | { scope: "project"; projectId: string; productId: string | null }
  | { scope: "product"; productId: string }
  | { scope: "global" };

export async function getRequirements(filter: RequirementFilter): Promise<ProjectRequirement[]> {
  const db = await getDb();
  if (!db) return [];
  let where;
  if (filter.scope === "project") {
    where = filter.productId
      ? or(
          eq(projectRequirements.projectId, filter.projectId),
          and(isNull(projectRequirements.projectId), eq(projectRequirements.productId, filter.productId))
        )
      : eq(projectRequirements.projectId, filter.projectId);
  } else if (filter.scope === "product") {
    where = eq(projectRequirements.productId, filter.productId);
  } else {
    where = undefined;
  }
  const q = db.select().from(projectRequirements);
  return (where ? q.where(where) : q).orderBy(...REQ_ORDER);
}

/** Create a new requirement pool item. */
export async function createProjectRequirement(requirement: InsertProjectRequirement): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .insert(projectRequirements)
    .values(requirement)
    .returning({ id: projectRequirements.id });
  return result[0].id;
}

/** Update a requirement pool item. */
export async function updateProjectRequirement(
  id: number,
  patch: Partial<Omit<InsertProjectRequirement, "id" | "projectId" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectRequirements).set(patch).where(eq(projectRequirements.id, id));
}

/**
 * 采纳转化:把需求归属到目标项目 + 标记转化目标 + 状态。
 * 与 updateProjectRequirement 不同,允许写 projectId(采纳即承接)。
 */
export async function adoptAndLinkRequirement(
  id: number,
  patch: Partial<Pick<InsertProjectRequirement,
    "projectId" | "status" | "convertedType" | "convertedId" | "targetPhaseId" | "linkedTaskId" | "decisionNote">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectRequirements).set(patch).where(eq(projectRequirements.id, id));
}

/** Delete a requirement pool item. */
export async function deleteProjectRequirement(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectRequirements).where(eq(projectRequirements.id, id));
}

// ── Custom Field Definition helpers ──────────────────────────────────────────

/** List custom field definitions for an entity type (active only by default). */
export async function getCustomFieldDefs(
  entityType = "project",
  includeArchived = false
): Promise<CustomFieldDef[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = includeArchived
    ? eq(customFieldDefs.entityType, entityType)
    : and(eq(customFieldDefs.entityType, entityType), eq(customFieldDefs.archived, false));
  return db
    .select()
    .from(customFieldDefs)
    .where(conditions)
    .orderBy(customFieldDefs.sortOrder, customFieldDefs.id);
}

/** Create a custom field definition. */
export async function createCustomFieldDef(def: InsertCustomFieldDef): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(customFieldDefs).values(def).returning({ id: customFieldDefs.id });
  return result[0].id;
}

/** Update a custom field definition. */
export async function updateCustomFieldDef(
  id: number,
  patch: Partial<Omit<InsertCustomFieldDef, "id" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(customFieldDefs).set(patch).where(eq(customFieldDefs.id, id));
}

/** Delete a custom field definition. */
export async function deleteCustomFieldDef(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(customFieldDefs).where(eq(customFieldDefs.id, id));
}

// ── Gate Reviews helpers ──────────────────────────────────────────────────────

/** Get all gate reviews for a project (optionally filtered by phase) */
export async function getProjectGateReviews(projectId: string, phaseId?: string): Promise<ProjectGateReview[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = phaseId
    ? and(eq(projectGateReviews.projectId, projectId), eq(projectGateReviews.phaseId, phaseId))
    : eq(projectGateReviews.projectId, projectId);
  return db.select().from(projectGateReviews).where(conditions).orderBy(projectGateReviews.createdAt);
}

/** Create a gate review */
export async function createProjectGateReview(review: InsertProjectGateReview): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectGateReviews).values(review).returning({ id: projectGateReviews.id });
  return result[0].id;
}

/** Update a gate review */
export async function updateProjectGateReview(
  id: number,
  patch: Partial<Omit<InsertProjectGateReview, "id" | "projectId" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectGateReviews).set(patch).where(eq(projectGateReviews.id, id));
}

/** Delete a gate review */
export async function deleteProjectGateReview(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectGateReviews).where(eq(projectGateReviews.id, id));
}

// ── Changelog helpers ─────────────────────────────────────────────────────────

/** Get all changelog records for a project */
export async function getProjectChangelog(projectId: string): Promise<ProjectChangeRecord[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectChangelog)
    .where(eq(projectChangelog.projectId, projectId))
    .orderBy(desc(projectChangelog.createdAt));
}

/** Create a changelog record */
export async function createProjectChangeRecord(record: InsertProjectChangeRecord): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectChangelog).values(record).returning({ id: projectChangelog.id });
  return result[0].id;
}

/** Update a changelog record */
export async function updateProjectChangeRecord(
  id: number,
  patch: Partial<Omit<InsertProjectChangeRecord, "id" | "projectId" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectChangelog).set(patch).where(eq(projectChangelog.id, id));
}

/** Delete a changelog record */
export async function deleteProjectChangeRecord(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectChangelog).where(eq(projectChangelog.id, id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Files
// ─────────────────────────────────────────────────────────────────────────────


/** Insert a file metadata record after uploading to S3 */
export async function createProjectFile(record: Omit<InsertProjectFile, "id" | "createdAt">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectFiles).values(record).returning({ id: projectFiles.id });
  return result[0].id;
}

/** List all files for a project, optionally filtered by phase and/or taskId */
export async function getProjectFiles(
  projectId: string,
  phaseId?: string,
  taskId?: string
): Promise<ProjectFile[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions: ReturnType<typeof eq>[] = [eq(projectFiles.projectId, projectId)];
  if (phaseId) conditions.push(eq(projectFiles.phaseId, phaseId));
  if (taskId) conditions.push(eq(projectFiles.taskId, taskId));
  return db
    .select()
    .from(projectFiles)
    .where(and(...conditions))
    .orderBy(projectFiles.createdAt);
}

export async function getProjectFileById(id: number): Promise<ProjectFile | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.id, id))
    .limit(1);
  return row;
}

/**
 * Delete a file metadata record.
 * Returns the storageKey so the caller can invalidate the S3 object.
 * Returns null if the record was not found.
 */
export async function deleteProjectFile(id: number): Promise<{ storageKey: string } | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select({ storageKey: projectFiles.storageKey })
    .from(projectFiles)
    .where(eq(projectFiles.id, id))
    .limit(1);
  if (!row) return null;
  await db.delete(projectFiles).where(eq(projectFiles.id, id));
  return { storageKey: row.storageKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity Logs
// ─────────────────────────────────────────────────────────────────────────────

/** Append an immutable activity log entry */
export async function createActivityLog(
  record: Omit<InsertActivityLog, "id" | "createdAt">
): Promise<void> {
  const db = await getDb();
  if (!db) {
    // Non-fatal: activity logging should never block the main operation
    console.warn("[ActivityLog] Database not available, skipping log entry");
    return;
  }
  try {
    await db.insert(activityLogs).values(record);
  } catch (err) {
    // Non-fatal: log the error but don't propagate
    console.error("[ActivityLog] Failed to write log entry:", err);
  }
}

/** Fetch recent activity logs for a project (newest first) */
export async function getActivityLogs(
  projectId: string,
  limit = 50
): Promise<ActivityLog[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(activityLogs)
    .where(eq(activityLogs.projectId, projectId))
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Meta (assignment, due date, status, priority)
// ─────────────────────────────────────────────────────────────────────────────

export type TaskMetaPatch = {
  assigneeUserId?: number | null;
  /** YYYY-MM-DD string (column is mode:'string', so pass as-is) */
  dueDate?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  completedAt?: Date | null;
  /** 派生镜像列，勿手动传；由 status 推导。见 deriveCompletion */
  completed?: boolean;
  updatedBy?: number | null;
};

/**
 * status 是唯一主状态；completed/completedAt 由它派生。
 * completed 镜像「字面已完成」(status==='done')；进度统计中 skipped 也算已解决，
 * 但那由各处直接读 status 处理(见 getPortfolio / useProjectData)，与此镜像无关。
 */
function deriveCompletion(patch: TaskMetaPatch): TaskMetaPatch {
  if (patch.status === undefined) return patch;
  const isDone = patch.status === "done";
  return {
    ...patch,
    completed: isDone,
    completedAt: isDone ? (patch.completedAt ?? new Date()) : null,
  };
}

/** Convert TaskMetaPatch to a drizzle-compatible set object */
function toDbPatch(patch: TaskMetaPatch) {
  // dueDate column uses mode:'string', so pass the YYYY-MM-DD string directly
  return { ...patch };
}

/**
 * Update task meta fields (assignee, dueDate, status, priority, completedAt).
 * Upserts the row if it doesn't exist yet.
 */
export async function updateTaskMeta(
  projectId: string,
  phaseId: string,
  taskId: string,
  patch: TaskMetaPatch
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select({ id: projectTasks.id })
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.projectId, projectId),
        eq(projectTasks.phaseId, phaseId),
        eq(projectTasks.taskId, taskId)
      )
    )
    .limit(1);
  const dbPatch = toDbPatch(deriveCompletion(patch));
  if (existing.length > 0) {
    await db
      .update(projectTasks)
      .set(dbPatch)
      .where(
        and(
          eq(projectTasks.projectId, projectId),
          eq(projectTasks.phaseId, phaseId),
          eq(projectTasks.taskId, taskId)
        )
      );
  } else {
    await db.insert(projectTasks).values({ projectId, phaseId, taskId, ...dbPatch });
  }
}

/**
 * 卡片勾选「完成」：status 是主状态，勾选即把 status 设为 done/todo，
 * completed/completedAt 随之派生。行不存在则插入。
 */
export async function setTaskCompletion(
  projectId: string,
  phaseId: string,
  taskId: string,
  completed: boolean,
  updatedBy?: number | null
): Promise<void> {
  await upsertProjectTask(projectId, phaseId, taskId, {
    completed,
    status: completed ? "done" : "todo",
    completedAt: completed ? new Date() : null,
    updatedBy: updatedBy ?? null,
  });
}

/**
 * 切换某任务下单个交付物的完成状态（合并到 deliverables jsonb map）。
 * 行不存在则插入。返回更新后的完成 map。
 */
export async function setTaskDeliverable(
  projectId: string,
  phaseId: string,
  taskId: string,
  name: string,
  done: boolean,
  updatedBy?: number | null
): Promise<Record<string, boolean>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select({ id: projectTasks.id, deliverables: projectTasks.deliverables })
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.projectId, projectId),
        eq(projectTasks.phaseId, phaseId),
        eq(projectTasks.taskId, taskId)
      )
    )
    .limit(1);
  const current = existing[0]?.deliverables ?? {};
  const next = { ...current, [name]: done };
  if (existing.length > 0) {
    await db
      .update(projectTasks)
      .set({ deliverables: next, updatedBy: updatedBy ?? null })
      .where(eq(projectTasks.id, existing[0].id));
  } else {
    await db.insert(projectTasks).values({ projectId, phaseId, taskId, deliverables: next, updatedBy: updatedBy ?? null });
  }
  return next;
}

/**
 * 按角色把未分配的任务自动指派给对应项目成员（responsible role 取自任务 visibleRoles 首个非管理角色）。
 * 不覆盖已手动分配的任务。返回新建的分配明细，供上层发钉钉通知。
 */
export async function assignTasksByRole(
  projectId: string,
  updatedBy: number
): Promise<Array<{ userId: number; taskId: string; phaseId: string; dueDate: string | null }>> {
  const db = await getDb();
  if (!db) return [];
  const members = await getProjectMembers(projectId);
  const roleToUser = new Map<string, number>();
  for (const m of members) if (!roleToUser.has(m.role)) roleToUser.set(m.role, m.userId);
  const tasks = await getProjectTasks(projectId);
  const out: Array<{ userId: number; taskId: string; phaseId: string; dueDate: string | null }> = [];
  for (const t of tasks) {
    if (t.assigneeUserId) continue; // 不覆盖已分配
    const roles = (t.visibleRoles as string[] | null) ?? [];
    // 责任角色 = visibleRoles 首个非管理角色;Gate/无角色任务归 PM。
    const primary = roles.find((r) => r !== "manager" && r !== "owner") ?? "pm";
    // 只分给该角色对应成员;该角色没配人则留空(让缺口可见),不强塞给 PM。
    const userId = roleToUser.get(primary);
    if (!userId) continue;
    await db.update(projectTasks).set({ assigneeUserId: userId, updatedBy }).where(eq(projectTasks.id, t.id));
    out.push({ userId, taskId: t.taskId, phaseId: t.phaseId, dueDate: t.dueDate ?? null });
  }
  return out;
}

// ── 自动排期：生成 / 联动重排 ─────────────────────────────────────────────────

/** 按项目 category + 开始日重生成整套任务起止日，写回 project_tasks。返回写入任务数。 */
export async function applyProjectSchedule(projectId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const project = await getProjectById(projectId);
  if (!project?.startDate) return 0;
  const schedule = scheduleForCategory(project.category, project.startDate);
  let n = 0;
  for (const [taskId, d] of Object.entries(schedule)) {
    await db.update(projectTasks)
      .set({ startDate: d.start, dueDate: d.due })
      .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.taskId, taskId)));
    n += 1;
  }
  return n;
}

/** 改某任务起止后，只向后联动重排其传递后继；返回受影响并更新的任务数。 */
export async function rescheduleProjectFromTask(
  projectId: string, taskId: string, start: string, due: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const project = await getProjectById(projectId);
  if (!project) return 0;
  const schedTasks = buildSchedTasks(getPhasesForCategory(project.category));
  const rows = await db
    .select({ taskId: projectTasks.taskId, startDate: projectTasks.startDate, dueDate: projectTasks.dueDate })
    .from(projectTasks).where(eq(projectTasks.projectId, projectId));
  const current: Schedule = {};
  for (const r of rows) if (r.startDate && r.dueDate) current[r.taskId] = { start: r.startDate, due: r.dueDate };
  const next = rescheduleFrom(schedTasks, current, taskId, { start, due });
  let n = 0;
  for (const [id, d] of Object.entries(next)) {
    if (current[id]?.start === d.start && current[id]?.due === d.due) continue;
    await db.update(projectTasks)
      .set({ startDate: d.start, dueDate: d.due })
      .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.taskId, id)));
    n += 1;
  }
  return n;
}

export type TaskWithContext = ProjectTask & {
  projectName: string;
  projectNumber: string;
  projectCategory: string;
};

/**
 * Return all non-done tasks assigned to a specific user, across all projects.
 * Ordered by priority (critical→low) then dueDate (earliest first, nulls last).
 */
export async function getMyTasks(userId: number): Promise<TaskWithContext[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      phaseId: projectTasks.phaseId,
      taskId: projectTasks.taskId,
      completed: projectTasks.completed,
      instructions: projectTasks.instructions,
      visibleRoles: projectTasks.visibleRoles,
      assigneeUserId: projectTasks.assigneeUserId,
      dueDate: projectTasks.dueDate,
      status: projectTasks.status,
      priority: projectTasks.priority,
      completedAt: projectTasks.completedAt,
      updatedBy: projectTasks.updatedBy,
      createdAt: projectTasks.createdAt,
      updatedAt: projectTasks.updatedAt,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
      projectCategory: projects.category,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projectTasks.projectId, projects.id))
    .where(
      and(
        eq(projectTasks.assigneeUserId, userId),
        eq(projects.archived, false),
        drizzleSql`${projectTasks.status} != 'done'`,
        drizzleSql`${projectTasks.status} != 'skipped'`
      )
    )
    .orderBy(
      drizzleSql`CASE ${projectTasks.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      drizzleSql`${projectTasks.dueDate} IS NULL`,
      projectTasks.dueDate
    );
  return rows as TaskWithContext[];
}

/**
 * Return all tasks where dueDate < today and status != 'done'.
 * Optionally filtered to specific projectIds.
 * Ordered by dueDate ASC (most overdue first).
 */
export async function getOverdueTasks(projectIds?: string[]): Promise<TaskWithContext[]> {
  const db = await getDb();
  if (!db) return [];
  if (projectIds && projectIds.length === 0) return [];
  const today = new Date().toISOString().slice(0, 10);
  const baseConditions = [
    eq(projects.archived, false),
    drizzleSql`${projectTasks.dueDate} IS NOT NULL`,
    drizzleSql`${projectTasks.dueDate} < ${today}`,
    drizzleSql`${projectTasks.status} != 'done'`,
    drizzleSql`${projectTasks.status} != 'skipped'`,
  ];
  const whereClause = projectIds
    ? and(...baseConditions, inArray(projectTasks.projectId, projectIds))
    : and(...baseConditions);
  const rows = await db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      phaseId: projectTasks.phaseId,
      taskId: projectTasks.taskId,
      completed: projectTasks.completed,
      instructions: projectTasks.instructions,
      visibleRoles: projectTasks.visibleRoles,
      assigneeUserId: projectTasks.assigneeUserId,
      dueDate: projectTasks.dueDate,
      status: projectTasks.status,
      priority: projectTasks.priority,
      completedAt: projectTasks.completedAt,
      updatedBy: projectTasks.updatedBy,
      createdAt: projectTasks.createdAt,
      updatedAt: projectTasks.updatedAt,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
      projectCategory: projects.category,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projectTasks.projectId, projects.id))
    .where(whereClause)
    .orderBy(projectTasks.dueDate);
  return rows as TaskWithContext[];
}

/**
 * Return all tasks with status = 'blocked'.
 * Optionally filtered to specific projectIds.
 * Ordered by priority (critical→low) then projectId.
 */
export async function getBlockedTasks(projectIds?: string[]): Promise<TaskWithContext[]> {
  const db = await getDb();
  if (!db) return [];
  if (projectIds && projectIds.length === 0) return [];
  const baseConditions = [
    eq(projectTasks.status, "blocked"),
    eq(projects.archived, false),
  ];
  const whereClause = projectIds
    ? and(...baseConditions, inArray(projectTasks.projectId, projectIds))
    : and(...baseConditions);
  const rows = await db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      phaseId: projectTasks.phaseId,
      taskId: projectTasks.taskId,
      completed: projectTasks.completed,
      instructions: projectTasks.instructions,
      visibleRoles: projectTasks.visibleRoles,
      assigneeUserId: projectTasks.assigneeUserId,
      dueDate: projectTasks.dueDate,
      status: projectTasks.status,
      priority: projectTasks.priority,
      completedAt: projectTasks.completedAt,
      updatedBy: projectTasks.updatedBy,
      createdAt: projectTasks.createdAt,
      updatedAt: projectTasks.updatedAt,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
      projectCategory: projects.category,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projectTasks.projectId, projects.id))
    .where(whereClause)
    .orderBy(
      drizzleSql`CASE ${projectTasks.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      projectTasks.projectId
    );
  return rows as TaskWithContext[];
}

// ── Test helpers (not used in production code) ────────────────────────────────
/**
 * Hard-delete a project and ALL its child records.
 * Only for use in tests — production uses soft-delete (archived=true).
 */
export async function hardDeleteProjectForTest(projectId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Delete child records first (no FK cascade configured)
  await db.delete(projectChangelog).where(eq(projectChangelog.projectId, projectId));
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, projectId));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, projectId));
  await db.delete(projectRequirements).where(eq(projectRequirements.projectId, projectId));
  await db.delete(projectFiles).where(eq(projectFiles.projectId, projectId));
  await db.delete(activityLogs).where(eq(activityLogs.projectId, projectId));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, projectId));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, projectId));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
}

// ── PLM spine: platforms / products / revisions ───────────────────────────────

export async function createPlatform(p: InsertPlatform): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(platforms).values(p);
}

export async function createProduct(p: InsertProduct): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(products).values(p);
}

export async function getProductById(id: string): Promise<ProductRow | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const r = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return r[0];
}

export async function listProductsByCategory(category?: string): Promise<ProductRow[]> {
  const db = await getDb();
  if (!db) return [];
  if (category) {
    return db.select().from(products).where(eq(products.category, category)).orderBy(desc(products.updatedAt));
  }
  return db.select().from(products).orderBy(desc(products.updatedAt));
}

export async function createProductRevision(r: InsertProductRevision): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const res = await db.insert(productRevisions).values(r).returning({ id: productRevisions.id });
  return res[0].id;
}

export async function listProductRevisions(productId: string): Promise<ProductRevision[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productRevisions)
    .where(eq(productRevisions.productId, productId))
    .orderBy(productRevisions.id);
}

// ── MP Release 量产发布 ───────────────────────────────────────────────────────

/** 关联项目到产品；同时把项目派生起点设为产品当前版本 */
export async function setProjectProduct(projectId: string, productId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const product = await getProductById(productId);
  await db.update(projects)
    .set({ productId, baseRevisionId: product?.currentRevisionId ?? null })
    .where(eq(projects.id, projectId));
}

/** 开放的 P0/P1 问题数（未 resolved/closed/wont_fix） */
export async function getOpenP0P1Count(projectId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: projectIssues.id })
    .from(projectIssues)
    .where(and(
      eq(projectIssues.projectId, projectId),
      inArray(projectIssues.severity, ["P0", "P1"]),
      drizzleSql`${projectIssues.status} NOT IN ('resolved','closed','wont_fix')`
    ));
  return rows.length;
}

/** 下一个版本号字母 Rev A/B/C… */
export async function nextRevisionLabel(productId: string): Promise<string> {
  const revs = await listProductRevisions(productId);
  return `Rev ${String.fromCharCode(65 + revs.length)}`;
}

/**
 * 量产发布：前置校验 → 事务内 生成 Revision + 发布记录 + 产品转量产态 + 项目归档。
 * 抛错表示校验未过（绕不过去的硬闸）。
 */
export async function releaseProject(input: {
  projectId: string; releasedBy: number; notes?: string;
}): Promise<{ revisionId: number; revisionLabel: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("项目不存在");
  if (!project.productId) throw new Error("项目未关联产品，无法发布");
  const openCount = await getOpenP0P1Count(input.projectId);
  if (openCount > 0) throw new Error(`存在 ${openCount} 个未关闭的 P0/P1 问题，不能发布`);

  const productId = project.productId;
  const label = await nextRevisionLabel(productId);

  return db.transaction(async (tx) => {
    const open = await tx.select().from(projectIssues)
      .where(and(eq(projectIssues.projectId, input.projectId),
        drizzleSql`${projectIssues.status} NOT IN ('resolved','closed','wont_fix')`));

    const [rev] = await tx.insert(productRevisions).values({
      productId, revisionLabel: label,
      parentRevisionId: project.baseRevisionId ?? null,
      createdByProjectId: input.projectId,
      status: "released", releasedAt: new Date(), releasedBy: input.releasedBy,
    }).returning({ id: productRevisions.id });

    // 冻结工作态 BOM 进新版本，并写入发布快照
    const frozenBom = await freezeBomToRevision(input.projectId, rev.id, tx);

    await tx.insert(mpReleases).values({
      productId, revisionId: rev.id, projectId: input.projectId,
      snapshotBom: frozenBom as unknown[],
      openIssues: open as unknown[], notes: input.notes ?? null,
      releasedBy: input.releasedBy,
    } as InsertMpRelease);

    await tx.update(products)
      .set({ currentRevisionId: rev.id, lifecycleState: "mass_production" })
      .where(eq(products.id, productId));

    await tx.update(projects)
      .set({ resultRevisionId: rev.id, archived: true })
      .where(eq(projects.id, input.projectId));

    return { revisionId: rev.id, revisionLabel: label };
  });
}

// ── BOM ───────────────────────────────────────────────────────────────────────

export async function addBomLine(projectId: string, line: Partial<InsertBomItem> & { name: string }): Promise<number> {
  const db = await getDb(); if (!db) throw new Error("Database not available");
  const r = await db.insert(bomItems).values({ ...line, projectId, revisionId: null }).returning({ id: bomItems.id });
  return r[0].id;
}
export async function updateBomLine(id: number, patch: Partial<InsertBomItem>): Promise<void> {
  const db = await getDb(); if (!db) throw new Error("Database not available");
  await db.update(bomItems).set(patch).where(eq(bomItems.id, id));
}
export async function deleteBomLine(id: number): Promise<void> {
  const db = await getDb(); if (!db) throw new Error("Database not available");
  await db.delete(bomItems).where(eq(bomItems.id, id));
}
export async function listWorkingBom(projectId: string): Promise<BomItem[]> {
  const db = await getDb(); if (!db) return [];
  return db.select().from(bomItems).where(eq(bomItems.projectId, projectId)).orderBy(bomItems.sortOrder, bomItems.id);
}
export async function listFrozenBom(revisionId: number): Promise<BomItem[]> {
  const db = await getDb(); if (!db) return [];
  return db.select().from(bomItems).where(eq(bomItems.revisionId, revisionId)).orderBy(bomItems.sortOrder, bomItems.id);
}

/** 把项目工作态 BOM 复制冻结到某版本。exec 传入事务则用之。返回被冻结的行。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function freezeBomToRevision(projectId: string, revisionId: number, exec?: any): Promise<BomItem[]> {
  const db = exec ?? (await getDb()); if (!db) throw new Error("Database not available");
  const rows: BomItem[] = await db.select().from(bomItems).where(eq(bomItems.projectId, projectId));
  for (const r of rows) {
    await db.insert(bomItems).values({
      revisionId, projectId: null,
      partNumber: r.partNumber, name: r.name, spec: r.spec, quantity: r.quantity,
      refDesignator: r.refDesignator, componentProductId: r.componentProductId,
      componentRevisionId: r.componentRevisionId, supplierName: r.supplierName,
      unitCost: r.unitCost, sortOrder: r.sortOrder,
    });
  }
  return rows;
}

/** where-used：某零部件产品被哪些整机产品的冻结 BOM 引用 */
export async function whereUsed(componentProductId: string): Promise<{ productId: string; productName: string; revisionLabel: string }[]> {
  const db = await getDb(); if (!db) return [];
  return db.select({
    productId: products.id, productName: products.name, revisionLabel: productRevisions.revisionLabel,
  }).from(bomItems)
    .innerJoin(productRevisions, eq(bomItems.revisionId, productRevisions.id))
    .innerJoin(products, eq(productRevisions.productId, products.id))
    .where(eq(bomItems.componentProductId, componentProductId));
}

/** 两版本 BOM diff（按 partNumber+name 匹配） */
export async function bomDiff(revA: number, revB: number): Promise<{ added: BomItem[]; removed: BomItem[]; changed: BomItem[] }> {
  const a = await listFrozenBom(revA); const b = await listFrozenBom(revB);
  const key = (x: BomItem) => `${x.partNumber}|${x.name}`;
  const am = new Map(a.map((x) => [key(x), x])); const bm = new Map(b.map((x) => [key(x), x]));
  const added = b.filter((x) => !am.has(key(x)));
  const removed = a.filter((x) => !bm.has(key(x)));
  const changed = b.filter((x) => {
    const o = am.get(key(x));
    return o && (o.quantity !== x.quantity || o.unitCost !== x.unitCost);
  });
  return { added, removed, changed };
}

// ── 协作：评论 + @提及 + 通知 ─────────────────────────────────────────────────

/** 从正文提取 @username，匹配候选用户名（不区分大小写），返回命中用户 id */
export function parseMentions(body: string, candidates: { id: number; username: string | null }[]): number[] {
  const names = new Set((body.match(/@([A-Za-z0-9_.\-]+)/g) || []).map((m) => m.slice(1).toLowerCase()));
  if (names.size === 0) return [];
  return candidates.filter((c) => c.username && names.has(c.username.toLowerCase())).map((c) => c.id);
}

export async function createNotification(n: {
  userId: number; type: string; title: string; body?: string | null;
  entityType?: string | null; entityId?: string | null;
}): Promise<void> {
  const db = await getDb(); if (!db) return;
  await db.insert(notifications).values({
    userId: n.userId, type: n.type, title: n.title,
    body: n.body ?? null, entityType: n.entityType ?? null, entityId: n.entityId ?? null,
  });
}

export async function addComment(input: {
  entityType: string; entityId: string; projectId?: string | null; authorId: number; body: string;
}): Promise<Comment> {
  const db = await getDb(); if (!db) throw new Error("Database not available");
  const candidates = await db.select({ id: users.id, username: users.username }).from(users);
  const mentions = parseMentions(input.body, candidates);
  const [c] = await db.insert(comments).values({
    entityType: input.entityType, entityId: input.entityId,
    projectId: input.projectId ?? null, authorId: input.authorId, body: input.body, mentions,
  }).returning();
  const author = await getUserById(input.authorId);
  for (const uid of mentions) {
    if (uid === input.authorId) continue;
    await createNotification({
      userId: uid, type: "mention",
      title: `${author?.name || "有人"} 在评论中提到了你`,
      body: input.body.slice(0, 140), entityType: input.entityType, entityId: input.entityId,
    });
  }
  if (mentions.length > 0) {
    const { pushWebhook } = await import("./_core/notify");
    const authorName = author?.name || author?.username || "有人";
    const mentionedNames = candidates
      .filter((u) => mentions.includes(u.id))
      .map((u) => `@${u.username || u.id}`)
      .join(" ");
    const entityLabel = ({ issue: "问题", task: "任务", change: "变更", changelog: "变更", project: "项目" } as Record<string, string>)[input.entityType] || input.entityType;
    const projName = input.projectId ? (await getProjectById(input.projectId))?.name : null;
    const where = projName ? `「${projName}」的${entityLabel}` : entityLabel;
    const excerpt = input.body.slice(0, 140);
    const link = ENV.appBaseUrl ? `${ENV.appBaseUrl}/` : null;
    const plain = `💬 ${authorName} 在${where}评论中提到了 ${mentionedNames}：${excerpt}${link ? `\n${link}` : ""}`;
    const markdown =
      `#### 💬 有人在评论中 @ 了你\n` +
      `**${authorName}** 在${where}评论中提到了 ${mentionedNames}\n\n` +
      `> ${excerpt}\n\n` +
      (link ? `[在 CE Project Hub 中查看](${link})` : "");
    await pushWebhook(plain, { title: "有人@了你", markdown });
  }
  return c;
}

export async function listComments(entityType: string, entityId: string) {
  const db = await getDb(); if (!db) return [];
  return db.select({
    id: comments.id, body: comments.body, authorId: comments.authorId,
    authorName: users.name, mentions: comments.mentions, createdAt: comments.createdAt,
  }).from(comments).leftJoin(users, eq(comments.authorId, users.id))
    .where(and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)))
    .orderBy(comments.createdAt);
}

export async function listNotifications(userId: number, unreadOnly = false) {
  const db = await getDb(); if (!db) return [];
  const cond = unreadOnly
    ? and(eq(notifications.userId, userId), eq(notifications.read, false))
    : eq(notifications.userId, userId);
  return db.select().from(notifications).where(cond).orderBy(desc(notifications.createdAt)).limit(50);
}

export async function unreadCount(userId: number): Promise<number> {
  const db = await getDb(); if (!db) return 0;
  const r = await db.select({ id: notifications.id }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return r.length;
}

export async function markRead(id: number): Promise<void> {
  const db = await getDb(); if (!db) return;
  await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
}

export async function markAllRead(userId: number): Promise<void> {
  const db = await getDb(); if (!db) return;
  await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));
}

// ── 自动化规则：配置 + 运行审计 ────────────────────────────────────────────────

export type AutomationRuleDefault = {
  ruleKey: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

export async function seedAutomationRuleDefaults(defaults: AutomationRuleDefault[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const rule of defaults) {
    await db.insert(automationRules).values({
      ruleKey: rule.ruleKey,
      enabled: rule.enabled,
      config: rule.config,
    } satisfies InsertAutomationRule).onConflictDoNothing({
      target: automationRules.ruleKey,
    });
  }
}

export async function listAutomationRuleRows(): Promise<AutomationRuleRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(automationRules).orderBy(automationRules.id);
}

export async function updateAutomationRuleRow(input: {
  ruleKey: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  updatedBy?: number | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(automationRules).values({
    ruleKey: input.ruleKey,
    enabled: input.enabled ?? false,
    config: input.config ?? {},
    updatedBy: input.updatedBy ?? null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: automationRules.ruleKey,
    set: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.config !== undefined ? { config: input.config } : {}),
      updatedBy: input.updatedBy ?? null,
      updatedAt: new Date(),
    },
  });
}

export async function createAutomationRun(record: Omit<InsertAutomationRun, "id" | "createdAt">): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(automationRuns).values(record);
}

export async function hasRecentAutomationFire(input: {
  ruleKey: string;
  entityId: string;
  since: Date;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(and(
      eq(automationRuns.ruleKey, input.ruleKey),
      eq(automationRuns.entityId, input.entityId),
      eq(automationRuns.status, "fired"),
      drizzleSql`${automationRuns.createdAt} >= ${input.since}`
    ))
    .limit(1);
  return rows.length > 0;
}

export async function listAutomationRuns(input: {
  projectId?: string | null;
  limit?: number;
} = {}): Promise<AutomationRunRow[]> {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  if (input.projectId) {
    return db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.projectId, input.projectId))
      .orderBy(desc(automationRuns.createdAt))
      .limit(limit);
  }
  return db.select().from(automationRuns).orderBy(desc(automationRuns.createdAt)).limit(limit);
}

/** 逾期或 14 天内到期的未完成任务（逾期催办 + 截止前提醒 共用此扫描，规则各自精确过滤） */
export async function getAutomationDueTasks(): Promise<ProjectTask[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectTasks)
    .where(and(
      drizzleSql`${projectTasks.dueDate} IS NOT NULL`,
      drizzleSql`${projectTasks.dueDate} <= CURRENT_DATE + INTERVAL '14 days'`,
      drizzleSql`${projectTasks.status} NOT IN ('done','skipped')`
    ));
}

/** 逾期或 14 天内到期的未关闭问题 */
export async function getAutomationDueIssues(): Promise<ProjectIssue[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectIssues)
    .where(and(
      drizzleSql`${projectIssues.targetDate} IS NOT NULL`,
      drizzleSql`${projectIssues.targetDate} <> ''`,
      drizzleSql`${projectIssues.targetDate} <= TO_CHAR(CURRENT_DATE + INTERVAL '14 days', 'YYYY-MM-DD')`,
      drizzleSql`${projectIssues.status} NOT IN ('resolved','closed','wont_fix')`
    ));
}

/** Gate 前置未完扫描：跨活跃项目，找"未完成且 dueDate 已设"的 gate 任务 + 其阶段内未完成前置数。 */
export async function getAutomationGatePrereqs(): Promise<Array<{
  projectId: string; taskId: string; phaseId: string; dueDate: string | null; status: string; incompletePrereqCount: number; title: string;
}>> {
  const db = await getDb();
  if (!db) return [];
  const projs = await db.select({ id: projects.id, category: projects.category }).from(projects).where(eq(projects.archived, false));
  const out: Array<{ projectId: string; taskId: string; phaseId: string; dueDate: string | null; status: string; incompletePrereqCount: number; title: string }> = [];
  for (const p of projs) {
    const phases = getPhasesForCategory(p.category);
    const rows = await db.select({ taskId: projectTasks.taskId, status: projectTasks.status, dueDate: projectTasks.dueDate, completed: projectTasks.completed })
      .from(projectTasks).where(eq(projectTasks.projectId, p.id));
    const byTask = new Map(rows.map((r) => [r.taskId, r]));
    const isDone = (id: string) => { const r = byTask.get(id); return r ? (r.status === "done" || r.status === "skipped" || !!r.completed) : false; };
    for (const phase of phases) {
      const gate = byTask.get(phase.gateTaskId);
      if (!gate?.dueDate || isDone(phase.gateTaskId)) continue;
      let incomplete = 0;
      for (const t of phase.tasks) { if (t.id !== phase.gateTaskId && !isDone(t.id)) incomplete += 1; }
      if (incomplete > 0) {
        out.push({ projectId: p.id, taskId: phase.gateTaskId, phaseId: phase.id, dueDate: gate.dueDate, status: gate.status, incompletePrereqCount: incomplete, title: phase.gate || phase.gateTaskId });
      }
    }
  }
  return out;
}

/** 里程碑日历事件：阶段截止 / Gate 评审 / 项目目标日。 */
export type CalendarEvent = {
  date: string;          // YYYY-MM-DD
  type: "phase" | "gate" | "target";
  projectId: string;
  projectName: string;
  label: string;
};

/**
 * 在 [fromDate, toDate] 时间窗内聚合用户可见项目(owned ∪ member)的里程碑级事件。
 * 仅里程碑：阶段截止日(projectPhases.endDate)、Gate评审(projectGateReviews.reviewDate)、项目目标日(projects.targetDate)。
 */
export async function getCalendar(userId: number, fromDate: string, toDate: string): Promise<CalendarEvent[]> {
  const db = await getDb();
  if (!db) return [];
  // 总览日历全员只读可见全部未归档项目里程碑（详情/编辑仍按各自权限），避免信息闭塞。
  const allProjects = await db.select().from(projects).where(eq(projects.archived, false));
  const projById = new Map<string, ProjectRow>();
  for (const p of allProjects) projById.set(p.id, p);
  const ids = Array.from(projById.keys());
  if (ids.length === 0) return [];

  const inWindow = (d: string | null): d is string => !!d && d >= fromDate && d <= toDate;
  const events: CalendarEvent[] = [];

  for (const p of Array.from(projById.values())) {
    if (inWindow(p.targetDate)) {
      events.push({ date: p.targetDate, type: "target", projectId: p.id, projectName: p.name, label: "目标交付" });
    }
  }

  const phaseRows = await db.select({
    projectId: projectPhases.projectId, phaseId: projectPhases.phaseId, endDate: projectPhases.endDate,
  }).from(projectPhases).where(and(inArray(projectPhases.projectId, ids), between(projectPhases.endDate, fromDate, toDate)));
  for (const r of phaseRows) {
    const p = projById.get(r.projectId);
    if (p) events.push({ date: r.endDate!, type: "phase", projectId: p.id, projectName: p.name, label: `${r.phaseId} 阶段截止` });
  }

  const gateRows = await db.select({
    projectId: projectGateReviews.projectId, reviewDate: projectGateReviews.reviewDate, gateName: projectGateReviews.gateName,
  }).from(projectGateReviews).where(and(inArray(projectGateReviews.projectId, ids), between(projectGateReviews.reviewDate, fromDate, toDate)));
  for (const r of gateRows) {
    const p = projById.get(r.projectId);
    if (p) events.push({ date: r.reviewDate!, type: "gate", projectId: p.id, projectName: p.name, label: r.gateName || "Gate 评审" });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}
