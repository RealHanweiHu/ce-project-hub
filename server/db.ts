import { eq, desc, and, or, isNull, inArray, between, getTableColumns, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  EXTERNAL_APPROVAL_STATUSES,
  InsertUser, users, projects, InsertProject, ProjectRow,
  projectMembers, InsertProjectMember, ProjectMember, ProjectMemberRole,
  projectPhases, ProjectPhase, InsertProjectPhase,
  projectCalendarEvents, ProjectCalendarEvent, InsertProjectCalendarEvent,
  projectTasks, ProjectTask, InsertProjectTask,
  projectIssues, ProjectIssue, InsertProjectIssue,
  projectRisks, ProjectRisk, InsertProjectRisk,
  projectGateBlockers, ProjectGateBlocker, InsertProjectGateBlocker,
  projectTestPlans, ProjectTestPlan, InsertProjectTestPlan,
  projectTestCases, ProjectTestCase, InsertProjectTestCase,
  projectTestReports, ProjectTestReport, InsertProjectTestReport,
  projectNpiReadinessChecks, ProjectNpiReadinessCheck, InsertProjectNpiReadinessCheck,
  projectSampleSignoffs, ProjectSampleSignoff, InsertProjectSampleSignoff,
  projectRequirements, ProjectRequirement, InsertProjectRequirement,
  projectGateReviews, ProjectGateReview, InsertProjectGateReview,
  projectChangelog, ProjectChangeRecord, InsertProjectChangeRecord,
  projectFiles, InsertProjectFile, ProjectFile,
  activityLogs, InsertActivityLog, ActivityLog,
  platforms, InsertPlatform,
  products, InsertProduct, ProductRow,
  productDefinitions, ProductDefinition, InsertProductDefinition,
  productDefinitionSnapshots, ProductDefinitionSnapshot, ProductDefinitionSnapshotPayload,
  productDefinitionChanges, ProductDefinitionChange, InsertProductDefinitionChange,
  productRevisions, InsertProductRevision, ProductRevision,
  mpReleases, InsertMpRelease,
  dingtalkApprovalConfigs, DingtalkApprovalConfig, InsertDingtalkApprovalConfig,
  externalApprovalInstances, ExternalApprovalInstance, InsertExternalApprovalInstance,
  dingtalkInteractiveCards, DingtalkInteractiveCard, InsertDingtalkInteractiveCard,
  customerVariants, CustomerVariant, InsertCustomerVariant,
  bomItems, BomItem, InsertBomItem,
  comments, Comment,
  notifications,
  actionItems, ActionItem, InsertActionItem,
  automationHeartbeats, AutomationHeartbeat, InsertAutomationHeartbeat,
  automationRules, AutomationRuleRow, InsertAutomationRule,
  automationRuns, AutomationRunRow, InsertAutomationRun,
  customFieldDefs, CustomFieldDef, InsertCustomFieldDef,
  projectTailoring, ProjectTailoring, InsertProjectTailoring, TailoringTarget,
  projectDeliverableOverrides, ProjectDeliverableOverride,
  projectDeliverableReviews, ProjectDeliverableReview,
  calendarExceptions,
  PROJECT_FILE_VISIBILITIES,
  type TaskStatus, type TaskPriority, type TaskApprovalStatus, type GateDecision,
  type GateReviewTraceSnapshot,
  type ProjectFileVisibility,
} from "../drizzle/schema";
import { buildRevisionChangelogSnapshot, REVISION_CHANGE_STATUSES, type RevisionChangeEntry } from "../shared/changelog-snapshot";
import { normalizeFileType, normalizeFileVersion } from "../shared/file-types";
import { ENV } from './_core/env';
import { getEffectivePhasesForProjectLike } from "../shared/npd-v3";
import { getPhasesForCategory, getReleaseGatePhase } from "../shared/sop-templates";
import { computeDownstreamImpact, type DownstreamImpactRow, type VariantStatus } from "../shared/oem-variant";
import { computeGateReadiness, type GateReadiness } from "../shared/gate-readiness";
import { getDeliverableLibrary, getEffectiveProcess, type EffectiveProcess } from "../shared/effective-process";
import { buildSchedTasks } from "../shared/schedule-graph";
import {
  forecastSchedule,
  projectedEndFromSchedule,
  type ForecastTaskState,
  type CalendarExceptions,
} from "../shared/scheduling";
import {
  computeAutoRisk,
  computeRag,
  daysBetween,
  GATE_RED_DAYS,
  GATE_AMBER_DAYS,
  ragReasons,
  type RagLevel,
  type RiskLevel,
  type RiskSignal,
} from "../shared/health";
import type { MetricGate, MetricIssue, MetricPhase, MetricTask } from "../shared/metrics";
import { computeProjectMetrics, type ProjectMetrics } from "../shared/metrics";
import { rollupPortfolioMetrics, type PortfolioMetricsRollup } from "../shared/portfolio-metrics";
import { computeManagementKpis, parseCostValue, type ManagementKpis } from "../shared/management-kpis";
import { isSystemAdminRole } from "../shared/system-roles";
import { defaultFromISO } from "./metrics-window";

let _db: ReturnType<typeof drizzle> | null = null;
const PROJECT_FILE_VISIBILITY_SET = new Set<string>(PROJECT_FILE_VISIBILITIES);

function normalizeProjectFileVisibility(value: unknown): ProjectFileVisibility {
  return typeof value === "string" && PROJECT_FILE_VISIBILITY_SET.has(value)
    ? value as ProjectFileVisibility
    : "internal";
}

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

// `deliverable-review-service` and this module form an import cycle (it imports
// `getDb` from here; we import its functions back). Under vitest's parallel pool,
// callers like getPortfolio / getPortfolioHealthForDigest fan out getGateReadiness
// via Promise.all, firing many `import("./deliverable-review-service")` in the same
// tick. While that cyclic module is mid-evaluation (yielding on its own cold
// imports), a concurrent raw `await import(...)` can receive the not-yet-populated
// namespace (`{}`), surfacing as "getReviewSatisfiedSet is not a function". Funnel
// every caller through one memoized import so they all await a single, fully
// evaluated module instead of racing separate in-flight imports.
let _deliverableReviewServicePromise: Promise<typeof import("./deliverable-review-service")> | null = null;
function loadDeliverableReviewService() {
  return (_deliverableReviewServicePromise ??= import("./deliverable-review-service"));
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
      values.role = 'owner';
      updateSet.role = 'owner';
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

export async function getUserByDingtalkIdentity(identity: {
  corpUserId?: string | null;
  unionId?: string | null;
  mobile?: string | null;
}) {
  const db = await getDb();
  if (!db) return undefined;
  const conditions = [
    identity.corpUserId ? eq(users.dingtalkCorpUserId, identity.corpUserId) : null,
    identity.unionId ? eq(users.dingtalkUserId, identity.unionId) : null,
    identity.mobile ? eq(users.mobile, identity.mobile) : null,
  ].filter((condition): condition is NonNullable<typeof condition> => condition != null);
  if (conditions.length === 0) return undefined;
  const result = await db.select().from(users).where(or(...conditions)).limit(1);
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
  role?: InsertUser["role"];
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
    role: data.role ?? 'member',
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

/** Admin/list surfaces: all non-archived projects in the workspace. */
export async function getAllActiveProjects(): Promise<ProjectRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projects)
    .where(eq(projects.archived, false))
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
  const phases = getEffectivePhasesForProjectLike({
    category,
    sopTemplateVersion: project.sopTemplateVersion,
    customFields: project.customFields,
  });
  // 安全网：currentPhase 必须是该 category 真实存在的阶段（如 jdm→input / obt→intake），
  // 否则（如非 UI 调用方沿用默认 "concept"）落到不存在的阶段。缺省取首阶段。
  const seeded = phases.some((p) => p.id === project.currentPhase)
    ? project
    : { ...project, currentPhase: phases[0]?.id ?? project.currentPhase };
  await db.transaction(async (tx) => {
    await tx.insert(projects).values(seeded);
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
  await refreshProjectTaskStatuses(project.id);
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<InsertProject, "id" | "createdBy" | "createdAt">>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any
): Promise<void> {
  const db = exec ?? (await getDb());
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

export type ProjectDingtalkMeetingSyncStatus =
  | "not_synced"
  | "pending"
  | "synced"
  | "group_fallback"
  | "failed"
  | "canceled";

/** 记录项目周会在钉钉侧的同步状态，供 UI 和后续重试/取消判断使用 */
export async function updateProjectDingtalkMeetingSync(
  projectId: string,
  patch: {
    dingtalkEventId?: string | null;
    status?: ProjectDingtalkMeetingSyncStatus;
    lastError?: string | null;
    lastSyncedAt?: Date | null;
  },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const updateSet: Partial<InsertProject> = {};
  if (patch.dingtalkEventId !== undefined) updateSet.dingtalkEventId = patch.dingtalkEventId;
  if (patch.status !== undefined) updateSet.dingtalkMeetingSyncStatus = patch.status;
  if (patch.lastError !== undefined) updateSet.dingtalkMeetingLastError = patch.lastError;
  if (patch.lastSyncedAt !== undefined) updateSet.dingtalkMeetingLastSyncedAt = patch.lastSyncedAt;
  if (Object.keys(updateSet).length === 0) return;
  await db.update(projects).set(updateSet).where(eq(projects.id, projectId));
}

export { EXTERNAL_APPROVAL_STATUSES } from "../drizzle/schema";
export type ExternalApprovalStatus = (typeof EXTERNAL_APPROVAL_STATUSES)[number];

export async function listApprovalConfigs(): Promise<DingtalkApprovalConfig[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dingtalkApprovalConfigs).orderBy(dingtalkApprovalConfigs.businessType);
}

export async function getApprovalConfig(businessType: string): Promise<DingtalkApprovalConfig | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(dingtalkApprovalConfigs)
    .where(eq(dingtalkApprovalConfigs.businessType, businessType))
    .limit(1);
  return row;
}

export async function upsertApprovalConfig(input: {
  businessType: string;
  processCode: string | null;
  enabled: boolean;
  defaultDeptId?: number | null;
}): Promise<DingtalkApprovalConfig> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getApprovalConfig(input.businessType);
  const values: InsertDingtalkApprovalConfig = {
    businessType: input.businessType,
    processCode: input.processCode?.trim() || null,
    enabled: input.enabled,
    defaultDeptId: input.defaultDeptId ?? null,
  };
  if (existing) {
    const [row] = await db
      .update(dingtalkApprovalConfigs)
      .set(values)
      .where(eq(dingtalkApprovalConfigs.businessType, input.businessType))
      .returning();
    return row;
  }
  const [row] = await db.insert(dingtalkApprovalConfigs).values(values).returning();
  return row;
}

export async function getPendingExternalApproval(input: {
  businessType: string;
  entityType: string;
  entityId: string;
}): Promise<ExternalApprovalInstance | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(externalApprovalInstances)
    .where(and(
      eq(externalApprovalInstances.businessType, input.businessType),
      eq(externalApprovalInstances.entityType, input.entityType),
      eq(externalApprovalInstances.entityId, input.entityId),
      eq(externalApprovalInstances.status, "pending"),
    ))
    .limit(1);
  return row;
}

export async function createExternalApprovalInstance(input: {
  provider?: string;
  businessType: string;
  entityType: string;
  entityId: string;
  projectId?: string | null;
  processCode?: string | null;
  processInstanceId?: string | null;
  status?: ExternalApprovalStatus;
  title?: string | null;
  submittedBy: number;
  originatorUserId?: number | null;
  dingtalkOriginatorUserId?: string | null;
  formSnapshot?: Record<string, unknown>;
  requestSnapshot?: Record<string, unknown>;
  responseSnapshot?: Record<string, unknown>;
  lastError?: string | null;
}): Promise<ExternalApprovalInstance> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const pending = await getPendingExternalApproval(input);
  if (pending) throw new Error("该业务对象已有待处理的外部审批");
  const [row] = await db.insert(externalApprovalInstances).values({
    provider: input.provider ?? "dingtalk",
    businessType: input.businessType,
    entityType: input.entityType,
    entityId: input.entityId,
    projectId: input.projectId ?? null,
    processCode: input.processCode ?? null,
    processInstanceId: input.processInstanceId ?? null,
    status: input.status ?? "pending",
    title: input.title ?? null,
    submittedBy: input.submittedBy,
    originatorUserId: input.originatorUserId ?? null,
    dingtalkOriginatorUserId: input.dingtalkOriginatorUserId ?? null,
    formSnapshot: input.formSnapshot ?? {},
    requestSnapshot: input.requestSnapshot ?? {},
    responseSnapshot: input.responseSnapshot ?? {},
    lastError: input.lastError ?? null,
  }).returning();
  return row;
}

export async function updateExternalApprovalInstance(
  id: number,
  patch: Partial<Pick<InsertExternalApprovalInstance,
    | "processInstanceId"
    | "status"
    | "responseSnapshot"
    | "requestSnapshot"
    | "lastError"
    | "approvedAt"
    | "rejectedAt"
    | "terminatedAt"
    | "syncedAt"
  >>,
): Promise<ExternalApprovalInstance | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .update(externalApprovalInstances)
    .set(patch)
    .where(eq(externalApprovalInstances.id, id))
    .returning();
  return row;
}

export async function getExternalApprovalByProcessInstanceId(
  processInstanceId: string,
): Promise<ExternalApprovalInstance | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(externalApprovalInstances)
    .where(eq(externalApprovalInstances.processInstanceId, processInstanceId))
    .limit(1);
  return row;
}

export async function getExternalApprovalById(id: number): Promise<ExternalApprovalInstance | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(externalApprovalInstances)
    .where(eq(externalApprovalInstances.id, id))
    .limit(1);
  return row;
}

export async function listExternalApprovalsForEntity(input: {
  businessType?: string;
  entityType: string;
  entityId: string;
}): Promise<ExternalApprovalInstance[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    eq(externalApprovalInstances.entityType, input.entityType),
    eq(externalApprovalInstances.entityId, input.entityId),
  ];
  if (input.businessType) conditions.push(eq(externalApprovalInstances.businessType, input.businessType));
  return db
    .select()
    .from(externalApprovalInstances)
    .where(and(...conditions))
    .orderBy(desc(externalApprovalInstances.createdAt));
}

export async function upsertDingtalkInteractiveCard(input: {
  outTrackId: string;
  actionItemId?: number | null;
  recipientUserId: number;
  projectId?: string | null;
  eventKey: string;
  entityType?: string | null;
  entityId?: string | null;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  status?: string;
  cardData?: Record<string, unknown>;
  lastError?: string | null;
}): Promise<DingtalkInteractiveCard | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const values: InsertDingtalkInteractiveCard = {
    outTrackId: input.outTrackId,
    actionItemId: input.actionItemId ?? null,
    recipientUserId: input.recipientUserId,
    projectId: input.projectId ?? null,
    eventKey: input.eventKey,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    title: input.title,
    body: input.body ?? null,
    actionUrl: input.actionUrl ?? null,
    status: input.status ?? "sent",
    cardData: input.cardData ?? {},
    lastError: input.lastError ?? null,
  };
  const [row] = await db
    .insert(dingtalkInteractiveCards)
    .values(values)
    .onConflictDoUpdate({
      target: dingtalkInteractiveCards.outTrackId,
      set: {
        ...values,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function listDingtalkInteractiveCardsForActionItem(actionItemId: number): Promise<DingtalkInteractiveCard[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(dingtalkInteractiveCards)
    .where(eq(dingtalkInteractiveCards.actionItemId, actionItemId));
}

export async function markDingtalkInteractiveCardStatus(input: {
  outTrackId: string;
  status: string;
  cardData?: Record<string, unknown>;
  lastError?: string | null;
  handledAt?: Date | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(dingtalkInteractiveCards)
    .set({
      status: input.status,
      cardData: input.cardData,
      lastError: input.lastError ?? null,
      handledAt: input.handledAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(dingtalkInteractiveCards.outTrackId, input.outTrackId));
}

type DeleteProjectResult = { storageKeys: string[] };

async function deleteProjectRows(projectId: string, options: { allowReleased: boolean }): Promise<DeleteProjectResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [project] = await db
    .select({ id: projects.id, resultRevisionId: projects.resultRevisionId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return { storageKeys: [] };

  const [release] = await db
    .select({ id: mpReleases.id })
    .from(mpReleases)
    .where(eq(mpReleases.projectId, projectId))
    .limit(1);
  const projectRevisionRows = await db
    .select({ id: productRevisions.id })
    .from(productRevisions)
    .where(eq(productRevisions.createdByProjectId, projectId));

  if (!options.allowReleased && (project.resultRevisionId !== null || release || projectRevisionRows.length > 0)) {
    throw new Error("Cannot hard-delete a released project; keep its PLM trace and archive it instead.");
  }

  const fileRows = await db
    .select({ storageKey: projectFiles.storageKey })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId));
  const revisionIds = projectRevisionRows.map((row) => row.id);

  await db.transaction(async (tx) => {
    // Product-level records may outlive the project. Remove dangling project links
    // instead of deleting product history.
    await tx.update(productDefinitionChanges)
      .set({ sourceProjectId: null })
      .where(eq(productDefinitionChanges.sourceProjectId, projectId));
    await tx.update(customerVariants)
      .set({ sourceRefId: null })
      .where(and(eq(customerVariants.sourceType, "project"), eq(customerVariants.sourceRefId, projectId)));

    if (options.allowReleased) {
      if (revisionIds.length > 0) {
        await tx.delete(bomItems).where(inArray(bomItems.revisionId, revisionIds));
      }
      await tx.delete(mpReleases).where(eq(mpReleases.projectId, projectId));
      await tx.delete(productRevisions).where(eq(productRevisions.createdByProjectId, projectId));
    } else {
      await tx.update(productRevisions)
        .set({ createdByProjectId: null })
        .where(eq(productRevisions.createdByProjectId, projectId));
    }

    await tx.delete(comments).where(or(
      eq(comments.projectId, projectId),
      and(eq(comments.entityType, "project"), eq(comments.entityId, projectId)),
    ));
    await tx.delete(notifications).where(and(
      eq(notifications.entityType, "project"),
      eq(notifications.entityId, projectId),
    ));
    await tx.delete(actionItems).where(eq(actionItems.projectId, projectId));
    await tx.delete(automationRuns).where(eq(automationRuns.projectId, projectId));
    await tx.delete(projectCalendarEvents).where(eq(projectCalendarEvents.projectId, projectId));
    await tx.delete(bomItems).where(eq(bomItems.projectId, projectId));
    await tx.delete(projectDeliverableOverrides).where(eq(projectDeliverableOverrides.projectId, projectId));
    await tx.delete(projectTailoring).where(eq(projectTailoring.projectId, projectId));
    await tx.delete(projectChangelog).where(eq(projectChangelog.projectId, projectId));
    await tx.delete(projectGateReviews).where(eq(projectGateReviews.projectId, projectId));
    await tx.delete(projectGateBlockers).where(eq(projectGateBlockers.projectId, projectId));
    await tx.delete(projectSampleSignoffs).where(eq(projectSampleSignoffs.projectId, projectId));
    await tx.delete(projectNpiReadinessChecks).where(eq(projectNpiReadinessChecks.projectId, projectId));
    await tx.delete(projectTestReports).where(eq(projectTestReports.projectId, projectId));
    await tx.delete(projectTestCases).where(eq(projectTestCases.projectId, projectId));
    await tx.delete(projectTestPlans).where(eq(projectTestPlans.projectId, projectId));
    await tx.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, projectId));
    await tx.delete(projectIssues).where(eq(projectIssues.projectId, projectId));
    await tx.delete(projectRisks).where(eq(projectRisks.projectId, projectId));
    await tx.delete(projectRequirements).where(eq(projectRequirements.projectId, projectId));
    await tx.delete(projectFiles).where(eq(projectFiles.projectId, projectId));
    await tx.delete(activityLogs).where(eq(activityLogs.projectId, projectId));
    await tx.delete(projectTasks).where(eq(projectTasks.projectId, projectId));
    await tx.delete(projectPhases).where(eq(projectPhases.projectId, projectId));
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
  });

  return { storageKeys: fileRows.map((row) => row.storageKey) };
}

export async function archiveProject(id: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects).set({ archived: true }).where(eq(projects.id, id));
}

export async function deleteProject(id: string): Promise<DeleteProjectResult> {
  return deleteProjectRows(id, { allowReleased: false });
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
  const projectScope = memberProjectIds.length > 0
    ? or(eq(projects.createdBy, userId), eq(projects.pmUserId, userId), inArray(projects.id, memberProjectIds))
    : or(eq(projects.createdBy, userId), eq(projects.pmUserId, userId));
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.archived, false), projectScope))
    .orderBy(desc(projects.updatedAt));
}

export type PortfolioRow = {
  id: string; name: string; projectNumber: string; category: string; risk: string;
  ragLevel: RagLevel;
  ragReasons: string[];
  customer: string | null;
  currentPhase: string; startDate: string | null; targetDate: string | null; pmUserId: number | null; pmName: string | null;
  myRole?: ProjectMemberRole | null;
  taskTotal: number; taskDone: number; taskInProgress: number; overdueTasks: number; blockedTasks: number;
  openIssues: number; criticalIssues: number; plannedEnd: string | null; projectedEnd: string | null;
  openRisks: number; highRisks: number; mediumRisks: number;
  progressBehindPct: number | null;
  unassignedTasks: number;
  memberGap: number;
  gateTaskTotal: number;
  gateTaskDone: number;
  gatePhaseId: string | null;
  gateName: string | null;
  gateDueDate: string | null;
  gateDone: boolean;
  gateReady: boolean | null;
  gateBlockers: number;
  gateNotReady: "red" | "amber" | null;
  deliverableGap: number;
  releaseDecision: GateDecision | null;
  releaseGateName: string | null;
  releaseGateReady: boolean;
  releaseDeliverableDone: number;
  releaseDeliverableTotal: number;
  releaseHardBlockers: number;
  releaseConditions: string | null;
};

const PORTFOLIO_REQUIRED_ROLES: ProjectMemberRole[] = ["project_manager", "pm", "rd_hw", "rd_mech", "rd_sw", "qa", "scm"];

function todayInShanghaiISO(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function maxISODate(values: Array<string | null | undefined>): string | null {
  let out: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const iso = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    if (!out || iso > out) out = iso;
  }
  return out;
}

function progressBehindPct(plannedItems: number, dueItems: number, donePlannedItems: number): number | null {
  if (plannedItems <= 0) return null;
  return Math.max(0, ((dueItems - donePlannedItems) / plannedItems) * 100);
}

function riskToRagLevel(risk: RiskLevel): RagLevel {
  if (risk === "high") return "red";
  if (risk === "medium") return "amber";
  return "green";
}

const RISK_REASON_LABEL: Record<RiskLevel, string> = {
  low: "绿灯",
  medium: "黄灯",
  high: "红灯",
};

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

function forecastProjectEnd(
  project: Pick<ProjectRow, "category" | "startDate">,
  rows: Array<{
    taskId: string;
    status: string;
    completed: boolean;
    startDate: string | null;
    dueDate: string | null;
    completedAt: Date | null;
  }>,
  todayISO: string,
  cal?: CalendarExceptions
): string | null {
  const effectiveRows = rows.filter((row) => row.status !== "skipped");
  if (effectiveRows.length === 0) return null;
  const hasScheduleSignal = !!project.startDate || effectiveRows.some((row) => row.startDate || row.dueDate || row.completedAt);
  if (!hasScheduleSignal) return null;
  const rowIds = new Set(effectiveRows.map((row) => row.taskId));
  const schedTasks = buildSchedTasks(getPhasesForCategory(project.category)).filter((task) => rowIds.has(task.id));
  if (schedTasks.length === 0) return maxISODate(effectiveRows.map((row) => row.dueDate));
  const states: ForecastTaskState[] = effectiveRows.map((row) => ({
    id: row.taskId,
    startDate: row.startDate,
    dueDate: row.dueDate,
    completed: row.completed,
    status: row.status,
    completedAtISO: row.completedAt ? todayInShanghaiISO(row.completedAt) : null,
  }));
  return projectedEndFromSchedule(forecastSchedule(schedTasks, states, todayISO, project.startDate, cal));
}

function computePortfolioHealth(input: {
  projectedEnd: string | null;
  targetDate: string | null;
  overdueTasks: number;
  blockedTasks: number;
  openIssues: number;
  criticalIssues: number;
  riskSignal: RiskSignal;
  progressBehindPct: number | null;
  gateNotReady: "red" | "amber" | null;
  overrideRisk?: RiskLevel | null;
  overrideReason?: string | null;
}): { ragLevel: RagLevel; risk: "low" | "medium" | "high"; reasons: string[] } {
  const ragInput = { risk: "low" as const, ...input };
  const autoReasons = ragReasons(ragInput);
  const autoRisk = computeAutoRisk(input);
  if (input.overrideRisk) {
    const reason = input.overrideReason?.trim();
    const effectiveRisk = maxRiskLevel(input.overrideRisk, autoRisk);
    const autoIsHigher = RISK_RANK[autoRisk] > RISK_RANK[input.overrideRisk];
    return {
      ragLevel: riskToRagLevel(effectiveRisk),
      risk: effectiveRisk,
      reasons: [
        `手动覆盖:${RISK_REASON_LABEL[input.overrideRisk]}${reason ? ` - ${reason}` : ""}`,
        ...(autoIsHigher ? [`自动信号更高:${RISK_REASON_LABEL[autoRisk]}`] : []),
        ...autoReasons,
      ],
    };
  }
  const ragLevel = computeRag(ragInput);
  return {
    ragLevel,
    risk: autoRisk,
    reasons: autoReasons,
  };
}

function riskSignalFromCounts(highRisks: number, mediumRisks: number): RiskSignal {
  if (highRisks > 0) return "high";
  if (mediumRisks > 0) return "medium";
  return null;
}

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function getRiskAggByProjectIds(db: DbClient, projectIds: string[]) {
  if (projectIds.length === 0) return [];
  return db.select({
    projectId: projectRisks.projectId,
    openRisks: drizzleSql<number>`count(*) filter (where ${projectRisks.status} <> 'closed')::int`,
    highRisks: drizzleSql<number>`count(*) filter (where ${projectRisks.status} <> 'closed' and ${projectRisks.severity} = 'high')::int`,
    mediumRisks: drizzleSql<number>`count(*) filter (where ${projectRisks.status} <> 'closed' and ${projectRisks.severity} = 'medium')::int`,
  }).from(projectRisks).where(inArray(projectRisks.projectId, projectIds)).groupBy(projectRisks.projectId);
}

/** 跨项目组合看板：用户可见项目 + 每项目健康度聚合(任务/逾期/阻塞/开放问题/预计完成) */
export async function getPortfolio(userId: number): Promise<PortfolioRow[]> {
  const db = await getDb();
  if (!db) return [];
  const viewer = await getUserById(userId);
  const viewerIsAdmin = isSystemAdminRole(viewer?.role);
  const allProjects = viewerIsAdmin
    ? await db.select().from(projects).where(eq(projects.archived, false))
    : await getProjectsByMember(userId);
  const projById = new Map<string, ProjectRow>();
  for (const p of allProjects) projById.set(p.id, p);
  const ids = Array.from(projById.keys());
  if (ids.length === 0) return [];
  const todayISO = todayInShanghaiISO();

  const taskAgg = await db.select({
    projectId: projectTasks.projectId,
    total: drizzleSql<number>`count(*)::int`,
    done: drizzleSql<number>`count(*) filter (where ${projectTasks.status} in ('done','skipped'))::int`,
    inProgress: drizzleSql<number>`count(*) filter (where ${projectTasks.status} = 'in_progress')::int`,
    overdue: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null and ${projectTasks.dueDate} < ${todayISO} and ${projectTasks.status} not in ('done','skipped'))::int`,
    blocked: drizzleSql<number>`count(*) filter (where ${projectTasks.status} = 'blocked')::int`,
    unassigned: drizzleSql<number>`count(*) filter (where ${projectTasks.assigneeUserId} is null and ${projectTasks.status} not in ('done','skipped'))::int`,
    plannedItems: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null)::int`,
    dueItems: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null and ${projectTasks.dueDate} <= ${todayISO})::int`,
    donePlannedItems: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null and ${projectTasks.status} in ('done','skipped'))::int`,
    plannedEnd: drizzleSql<string | null>`max(${projectTasks.dueDate})::text`,
  }).from(projectTasks).where(inArray(projectTasks.projectId, ids)).groupBy(projectTasks.projectId);

  const taskRows = await db.select({
    projectId: projectTasks.projectId,
    taskId: projectTasks.taskId,
    status: projectTasks.status,
    completed: projectTasks.completed,
    startDate: projectTasks.startDate,
    dueDate: projectTasks.dueDate,
    completedAt: projectTasks.completedAt,
  }).from(projectTasks).where(inArray(projectTasks.projectId, ids));

  const issueAgg = await db.select({
    projectId: projectIssues.projectId,
    open: drizzleSql<number>`count(*) filter (where ${projectIssues.status} in ('open','in_progress'))::int`,
    critical: drizzleSql<number>`count(*) filter (where ${projectIssues.status} in ('open','in_progress') and ${projectIssues.severity} in ('P0','P1'))::int`,
  }).from(projectIssues).where(inArray(projectIssues.projectId, ids)).groupBy(projectIssues.projectId);

  const riskAgg = await getRiskAggByProjectIds(db, ids);

  const memberRows = await db.select({
    projectId: projectMembers.projectId,
    role: projectMembers.role,
  }).from(projectMembers).where(inArray(projectMembers.projectId, ids));

  // 当前用户在每个项目的成员角色（用于总览决定其视角：管理层大盘 / PM 工作台 / 我的任务）
  const myMemberRows = await db.select({
    projectId: projectMembers.projectId,
    role: projectMembers.role,
  }).from(projectMembers).where(and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, ids)));
  const myRoleMap = new Map<string, ProjectMemberRole>(myMemberRows.map((r) => [r.projectId, r.role]));
  const rank: Record<string, number> = {
    viewer: 0, rd_hw: 1, rd_sw: 1, rd_mech: 1, qa: 1, scm: 1, pe: 1, mfg: 1, sales: 1, cert: 1, battery_safety: 1,
    external_customer: 0, supplier: 0,
    pm: 2, project_manager: 3, manager: 3, owner: 4,
  };
  const higher = (a: ProjectMemberRole | null, b: ProjectMemberRole | null): ProjectMemberRole | null =>
    !a ? b : !b ? a : (rank[b] > rank[a] ? b : a);

  const pmIds = Array.from(new Set(Array.from(projById.values()).map((p) => p.pmUserId).filter((x): x is number => !!x)));
  const pmRows = pmIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, pmIds)) : [];
  const pmName = new Map(pmRows.map((r) => [r.id, r.name]));
  const taskMap = new Map(taskAgg.map((t) => [t.projectId, t]));
  const taskRowsByProject = new Map<string, typeof taskRows>();
  for (const row of taskRows) {
    const list = taskRowsByProject.get(row.projectId) ?? [];
    list.push(row);
    taskRowsByProject.set(row.projectId, list);
  }
  const taskByProjectTask = new Map(taskRows.map((t) => [`${t.projectId}:${t.taskId}`, t]));
  const issueMap = new Map(issueAgg.map((i) => [i.projectId, i]));
  const riskMap = new Map(riskAgg.map((r) => [r.projectId, r]));
  const roleMap = new Map<string, Set<ProjectMemberRole>>();
  for (const row of memberRows) {
    const roles = roleMap.get(row.projectId) ?? new Set<ProjectMemberRole>();
    roles.add(row.role);
    roleMap.set(row.projectId, roles);
  }
  const cal = await getCalendarExceptions();

  return Promise.all(Array.from(projById.values()).map(async (p) => {
    const t = taskMap.get(p.id);
    const projectTaskRows = taskRowsByProject.get(p.id) ?? [];
    const i = issueMap.get(p.id);
    const r = riskMap.get(p.id);
    const openRisks = r?.openRisks ?? 0;
    const highRisks = r?.highRisks ?? 0;
    const mediumRisks = r?.mediumRisks ?? 0;
    const roles = new Set(roleMap.get(p.id) ?? []);
    if (p.pmUserId) roles.add("project_manager");
    const memberGap = PORTFOLIO_REQUIRED_ROLES.filter((role) => !roles.has(role)).length;
    const myRole = (() => {
      let role: ProjectMemberRole | null = myRoleMap.get(p.id) ?? null;
      if (p.pmUserId === userId) role = higher(role, "project_manager");
      if (p.createdBy === userId) role = higher(role, "owner");
      if (viewerIsAdmin) role = higher(role, "manager");
      return role;
    })();
    const isExternalRole = myRole === "external_customer" || myRole === "supplier";
    const phases = getPhasesForCategory(p.category);
    const phase = phases.find((item) => item.id === p.currentPhase) ?? null;
    const gateTaskIds = phases.map((item) => item.gateTaskId).filter(Boolean);
    const gateTaskTotal = gateTaskIds.length;
    const gateTaskDone = gateTaskIds.filter((taskId) => {
      const gate = taskByProjectTask.get(`${p.id}:${taskId}`);
      return !!gate && (gate.status === "done" || gate.status === "skipped" || gate.completed);
    }).length;
    const gateTask = phase ? taskByProjectTask.get(`${p.id}:${phase.gateTaskId}`) : undefined;
    const gateDone = !!gateTask && (gateTask.status === "done" || gateTask.status === "skipped" || gateTask.completed);
    const [readiness, releaseGate] = await Promise.all([
      phase ? getGateReadiness(p.id, phase.id) : Promise.resolve(null),
      getReleaseGateStatus(p),
    ]);
    const deliverableDim = readiness?.dimensions.find((d) => d.dimension === "deliverables");
    const gateBlockers = gateDone ? 0 : readiness?.blockerCount ?? 0;
    let gateNotReady: "red" | "amber" | null = null;
    if (!gateDone && readiness && !readiness.ready && gateTask?.dueDate) {
      const distance = daysBetween(todayISO, gateTask.dueDate);
      gateNotReady = distance !== null && distance <= GATE_RED_DAYS
        ? "red"
        : distance !== null && distance <= GATE_AMBER_DAYS
          ? "amber"
          : null;
    }
    const releaseHardBlockers = releaseGate.dimensions.filter((d) => !d.ok && d.dimension !== "review_conditions").length;
    const progressBehind = progressBehindPct(t?.plannedItems ?? 0, t?.dueItems ?? 0, t?.donePlannedItems ?? 0);
    const projectedEnd = forecastProjectEnd(p, projectTaskRows, todayISO, cal);
    const health = computePortfolioHealth({
      projectedEnd,
      targetDate: p.targetDate,
      overdueTasks: t?.overdue ?? 0,
      blockedTasks: t?.blocked ?? 0,
      openIssues: i?.open ?? 0,
      criticalIssues: i?.critical ?? 0,
      riskSignal: riskSignalFromCounts(highRisks, mediumRisks),
      progressBehindPct: progressBehind,
      gateNotReady,
      overrideRisk: p.riskOverrideRisk,
      overrideReason: p.riskOverrideReason,
    });
    return {
      id: p.id, name: p.name, projectNumber: p.projectNumber, category: p.category, risk: isExternalRole ? "low" as RiskLevel : health.risk,
      ragLevel: isExternalRole ? "green" as RagLevel : health.ragLevel,
      ragReasons: isExternalRole ? [] : health.reasons,
      customer: p.customer ?? null,
      currentPhase: p.currentPhase, startDate: p.startDate, targetDate: p.targetDate,
      pmUserId: p.pmUserId ?? null,
      pmName: p.pmUserId ? (pmName.get(p.pmUserId) ?? null) : null,
      // 当前用户对本项目的有效角色（成员角色 ∪ pm/owner/admin 兜底），供前端定视角
      myRole,
      taskTotal: isExternalRole ? 0 : t?.total ?? 0,
      taskDone: isExternalRole ? 0 : t?.done ?? 0,
      taskInProgress: isExternalRole ? 0 : t?.inProgress ?? 0,
      overdueTasks: isExternalRole ? 0 : t?.overdue ?? 0,
      blockedTasks: isExternalRole ? 0 : t?.blocked ?? 0,
      openIssues: isExternalRole ? 0 : i?.open ?? 0,
      criticalIssues: isExternalRole ? 0 : i?.critical ?? 0,
      openRisks: isExternalRole ? 0 : openRisks,
      highRisks: isExternalRole ? 0 : highRisks,
      mediumRisks: isExternalRole ? 0 : mediumRisks,
      plannedEnd: isExternalRole ? null : t?.plannedEnd ?? null,
      projectedEnd: isExternalRole ? null : projectedEnd,
      progressBehindPct: isExternalRole ? null : progressBehind,
      unassignedTasks: isExternalRole ? 0 : t?.unassigned ?? 0,
      memberGap: isExternalRole ? 0 : memberGap,
      gateTaskTotal: isExternalRole ? 0 : gateTaskTotal,
      gateTaskDone: isExternalRole ? 0 : gateTaskDone,
      gatePhaseId: isExternalRole ? null : phase?.id ?? null,
      gateName: isExternalRole ? null : phase?.gate ?? null,
      gateDueDate: isExternalRole ? null : gateTask?.dueDate ?? null,
      gateDone: isExternalRole ? false : gateDone,
      gateReady: isExternalRole ? null : gateDone ? true : readiness?.ready ?? null,
      gateBlockers: isExternalRole ? 0 : gateBlockers,
      gateNotReady: isExternalRole ? null : gateNotReady,
      deliverableGap: isExternalRole ? 0 : deliverableDim?.blockers.length ?? 0,
      releaseDecision: isExternalRole ? null : releaseGate.decision,
      releaseGateName: isExternalRole ? null : releaseGate.gateName || null,
      releaseGateReady: isExternalRole ? false : releaseGate.ready,
      releaseDeliverableDone: isExternalRole ? 0 : releaseGate.deliverables.done,
      releaseDeliverableTotal: isExternalRole ? 0 : releaseGate.deliverables.total,
      releaseHardBlockers: isExternalRole ? 0 : releaseHardBlockers,
      releaseConditions: isExternalRole ? null : releaseGate.conditions ?? null,
    };
  }));
}

/** digest 用：全量活跃项目的健康聚合（不依赖用户视角）。SQL 一律用传入 todayISO。 */
export type PortfolioHealthRow = {
  id: string; name: string; projectNumber: string; category: string; risk: string;
  ragLevel: RagLevel;
  ragReasons: string[];
  currentPhase: string; targetDate: string | null; pmUserId: number | null; pmName: string | null;
  overdueTasks: number; blockedTasks: number; openIssues: number; criticalIssues: number;
  openRisks: number; highRisks: number; mediumRisks: number;
  plannedEnd: string | null;
  projectedEnd: string | null;
  plannedItems: number;
  dueItems: number;
  donePlannedItems: number;
  progressBehindPct: number | null;
  gateNotReady: "red" | "amber" | null;
};

export async function getPortfolioHealthForDigest(todayISO: string): Promise<PortfolioHealthRow[]> {
  const db = await getDb();
  if (!db) return [];
  const projRows = await db.select().from(projects).where(eq(projects.archived, false));
  if (projRows.length === 0) return [];
  const ids = projRows.map((p) => p.id);

  const taskAgg = await db.select({
    projectId: projectTasks.projectId,
    overdue: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null and ${projectTasks.dueDate} < ${todayISO} and ${projectTasks.status} not in ('done','skipped'))::int`,
    blocked: drizzleSql<number>`count(*) filter (where ${projectTasks.status} = 'blocked')::int`,
    plannedItems: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null)::int`,
    dueItems: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null and ${projectTasks.dueDate} <= ${todayISO})::int`,
    donePlannedItems: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null and ${projectTasks.status} in ('done','skipped'))::int`,
    plannedEnd: drizzleSql<string | null>`max(${projectTasks.dueDate})::text`,
  }).from(projectTasks).where(inArray(projectTasks.projectId, ids)).groupBy(projectTasks.projectId);

  const issueAgg = await db.select({
    projectId: projectIssues.projectId,
    open: drizzleSql<number>`count(*) filter (where ${projectIssues.status} in ('open','in_progress'))::int`,
    critical: drizzleSql<number>`count(*) filter (where ${projectIssues.status} in ('open','in_progress') and ${projectIssues.severity} in ('P0','P1'))::int`,
  }).from(projectIssues).where(inArray(projectIssues.projectId, ids)).groupBy(projectIssues.projectId);

  const riskAgg = await getRiskAggByProjectIds(db, ids);

  const taskRows = await db.select({
    projectId: projectTasks.projectId,
    taskId: projectTasks.taskId,
    status: projectTasks.status,
    completed: projectTasks.completed,
    startDate: projectTasks.startDate,
    dueDate: projectTasks.dueDate,
    completedAt: projectTasks.completedAt,
  }).from(projectTasks).where(inArray(projectTasks.projectId, ids));

  const pmIds = Array.from(new Set(projRows.map((p) => p.pmUserId).filter((x): x is number => !!x)));
  const pmRows = pmIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, pmIds)) : [];
  const pmName = new Map(pmRows.map((r) => [r.id, r.name]));
  const taskMap = new Map(taskAgg.map((t) => [t.projectId, t]));
  const taskRowsByProject = new Map<string, typeof taskRows>();
  for (const row of taskRows) {
    const list = taskRowsByProject.get(row.projectId) ?? [];
    list.push(row);
    taskRowsByProject.set(row.projectId, list);
  }
  const issueMap = new Map(issueAgg.map((i) => [i.projectId, i]));
  const riskMap = new Map(riskAgg.map((r) => [r.projectId, r]));
  const gateByProject = new Map<string, "red" | "amber">();
  await Promise.all(projRows.map(async (p) => {
    const phases = getPhasesForCategory(p.category);
    const phase = phases.find((item) => item.id === p.currentPhase);
    if (!phase) return;
    const gate = (taskRowsByProject.get(p.id) ?? []).find((task) => task.taskId === phase.gateTaskId);
    if (!gate?.dueDate || gate.status === "done" || gate.status === "skipped" || gate.completed) return;
    const readiness = await getGateReadiness(p.id, phase.id);
    if (!readiness || readiness.ready) return;
    const d = daysBetween(todayISO, gate.dueDate);
    if (d === null) return;
    const level: "red" | "amber" | null = d <= GATE_RED_DAYS ? "red" : d <= GATE_AMBER_DAYS ? "amber" : null;
    if (level === null) return;
    gateByProject.set(p.id, level);
  }));

  const cal = await getCalendarExceptions();
  return projRows.map((p) => {
    const t = taskMap.get(p.id);
    const i = issueMap.get(p.id);
    const r = riskMap.get(p.id);
    const openRisks = r?.openRisks ?? 0;
    const highRisks = r?.highRisks ?? 0;
    const mediumRisks = r?.mediumRisks ?? 0;
    const gateNotReady = gateByProject.get(p.id) ?? null;
    const progressBehind = progressBehindPct(t?.plannedItems ?? 0, t?.dueItems ?? 0, t?.donePlannedItems ?? 0);
    const projectedEnd = forecastProjectEnd(p, taskRowsByProject.get(p.id) ?? [], todayISO, cal);
    const health = computePortfolioHealth({
      projectedEnd,
      targetDate: p.targetDate,
      overdueTasks: t?.overdue ?? 0,
      blockedTasks: t?.blocked ?? 0,
      openIssues: i?.open ?? 0,
      criticalIssues: i?.critical ?? 0,
      riskSignal: riskSignalFromCounts(highRisks, mediumRisks),
      progressBehindPct: progressBehind,
      gateNotReady,
      overrideRisk: p.riskOverrideRisk,
      overrideReason: p.riskOverrideReason,
    });
    return {
      id: p.id, name: p.name, projectNumber: p.projectNumber, category: p.category, risk: health.risk,
      ragLevel: health.ragLevel,
      ragReasons: health.reasons,
      currentPhase: p.currentPhase, targetDate: p.targetDate, pmUserId: p.pmUserId ?? null,
      pmName: p.pmUserId ? (pmName.get(p.pmUserId) ?? null) : null,
      overdueTasks: t?.overdue ?? 0, blockedTasks: t?.blocked ?? 0,
      openIssues: i?.open ?? 0, criticalIssues: i?.critical ?? 0,
      openRisks, highRisks, mediumRisks,
      plannedEnd: t?.plannedEnd ?? null,
      projectedEnd,
      plannedItems: t?.plannedItems ?? 0, dueItems: t?.dueItems ?? 0, donePlannedItems: t?.donePlannedItems ?? 0,
      progressBehindPct: progressBehind,
      gateNotReady,
    };
  });
}

/** digest 当期去重：某 ruleKey+entityId(periodKey) 是否已有任意状态的 run（fired 或 skipped 都算已处理）。 */
export async function hasAutomationRunForEntity(input: { ruleKey: string; entityId: string }): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: automationRuns.id }).from(automationRuns)
    .where(and(eq(automationRuns.ruleKey, input.ruleKey), eq(automationRuns.entityId, input.entityId)))
    .limit(1);
  return rows.length > 0;
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
  userUsername: string | null;
  userOpenId: string | null;
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
      userUsername: users.username,
      userOpenId: users.openId,
    })
    .from(projectMembers)
    .leftJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.createdAt);
  return rows as Array<ProjectMember & {
    userName: string | null;
    userEmail: string | null;
    userUsername: string | null;
    userOpenId: string | null;
  }>;
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

/** 某产品派生的全部未归档项目（定义冻结等产品级事件按项目扇出通知用） */
export async function getProjectsByProductId(productId: string): Promise<Array<{ id: string; name: string }>> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.productId, productId), eq(projects.archived, false)));
}

/**
 * All of a user's project memberships in one query, as projectId → role.
 * Lets callers resolve effective roles for many projects without an N+1
 * of per-project getProjectMember lookups (see projects.list).
 */
export async function getProjectRolesForUser(userId: number): Promise<Map<string, ProjectMemberRole>> {
  const db = await getDb();
  if (!db) return new Map();
  const rows = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  return new Map(rows.map((r) => [r.projectId, r.role as ProjectMemberRole]));
}

async function ensureProjectCalendarEventsTable(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(drizzleSql`
    CREATE TABLE IF NOT EXISTS "project_calendar_events" (
      "id" serial PRIMARY KEY,
      "projectId" varchar(32) NOT NULL,
      "title" varchar(256) NOT NULL,
      "description" text,
      "eventDate" date NOT NULL,
      "startTime" varchar(5) NOT NULL,
      "durationMin" integer NOT NULL DEFAULT 60,
      "organizerUserId" integer NOT NULL,
      "dingtalkEventId" varchar(128),
      "dingtalkSyncStatus" varchar(24) NOT NULL DEFAULT 'not_synced',
      "createdBy" integer NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(drizzleSql`CREATE INDEX IF NOT EXISTS "idx_project_calendar_events_project_date" ON "project_calendar_events" ("projectId", "eventDate")`);
  await db.execute(drizzleSql`CREATE INDEX IF NOT EXISTS "idx_project_calendar_events_date" ON "project_calendar_events" ("eventDate")`);
}

export async function createProjectCalendarEvent(
  event: InsertProjectCalendarEvent,
): Promise<ProjectCalendarEvent> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await ensureProjectCalendarEventsTable();
  const [row] = await db.insert(projectCalendarEvents).values(event).returning();
  return row;
}

export async function updateProjectCalendarEventSync(
  id: number,
  patch: Pick<InsertProjectCalendarEvent, "dingtalkEventId" | "dingtalkSyncStatus">,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await ensureProjectCalendarEventsTable();
  await db.update(projectCalendarEvents).set(patch).where(eq(projectCalendarEvents.id, id));
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
  patch: {
    completed?: boolean;
    instructions?: string | null;
    visibleRoles?: string[];
    assigneeUserId?: number | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    completedAt?: Date | null;
    updatedBy?: number | null;
    dueDate?: string | null;
    startDate?: string | null;
    requiresApproval?: boolean;
    approverUserId?: number | null;
    approvalStatus?: TaskApprovalStatus;
    approvalNote?: string | null;
    approvalRequestedBy?: number | null;
    approvalRequestedAt?: Date | null;
    approvalDecidedBy?: number | null;
    approvalDecidedAt?: Date | null;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any
): Promise<void> {
  const db = exec ?? (await getDb());
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
  const dbPatch = toTaskDbPatch(patch, existing[0] ?? null);
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
  createdBy: number,
  templateVersion?: string | null,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(projectId);
  const phases = getEffectivePhasesForProjectLike(project ?? {
    category,
    sopTemplateVersion: templateVersion,
  });
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

/** Get a single issue by global id (用于评论等按实体反查项目归属) */
export async function getIssueById(id: number): Promise<ProjectIssue | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(projectIssues).where(eq(projectIssues.id, id)).limit(1);
  return row ?? null;
}

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

// ── Project Risk helpers ─────────────────────────────────────────────────────

const RISK_ORDER = [
  drizzleSql`CASE ${projectRisks.status} WHEN 'open' THEN 0 WHEN 'mitigating' THEN 1 WHEN 'watching' THEN 2 ELSE 3 END`,
  drizzleSql`CASE ${projectRisks.severity} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
  desc(projectRisks.createdAt),
] as const;

export async function getProjectRisks(projectId: string): Promise<ProjectRisk[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectRisks)
    .where(eq(projectRisks.projectId, projectId))
    .orderBy(...RISK_ORDER);
}

export async function getProjectRiskById(id: number): Promise<ProjectRisk | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(projectRisks).where(eq(projectRisks.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createProjectRisk(risk: InsertProjectRisk): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectRisks).values(risk).returning({ id: projectRisks.id });
  return result[0].id;
}

export async function updateProjectRisk(
  id: number,
  patch: Partial<Omit<InsertProjectRisk, "id" | "projectId" | "createdAt" | "updatedAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectRisks).set(patch).where(eq(projectRisks.id, id));
}

export async function deleteProjectRisk(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectRisks).where(eq(projectRisks.id, id));
}

// ── Project Gate Blocker helpers ─────────────────────────────────────────────

const GATE_BLOCKER_ORDER = [
  drizzleSql`CASE ${projectGateBlockers.status} WHEN 'open' THEN 0 ELSE 1 END`,
  drizzleSql`CASE ${projectGateBlockers.blockerType} WHEN 'quality' THEN 0 ELSE 1 END`,
  desc(projectGateBlockers.createdAt),
] as const;

export async function getProjectGateBlockers(
  projectId: string,
  phaseId?: string,
): Promise<ProjectGateBlocker[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectGateBlockers)
    .where(phaseId
      ? and(eq(projectGateBlockers.projectId, projectId), eq(projectGateBlockers.phaseId, phaseId))
      : eq(projectGateBlockers.projectId, projectId))
    .orderBy(...GATE_BLOCKER_ORDER);
}

export async function getProjectGateBlockerById(id: number): Promise<ProjectGateBlocker | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(projectGateBlockers).where(eq(projectGateBlockers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createProjectGateBlocker(blocker: InsertProjectGateBlocker): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectGateBlockers).values(blocker).returning({ id: projectGateBlockers.id });
  return result[0].id;
}

export async function resolveProjectGateBlocker(id: number, resolvedBy: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectGateBlockers)
    .set({ status: "resolved", resolvedBy, resolvedAt: new Date() })
    .where(eq(projectGateBlockers.id, id));
}

// ── Project Test Plan / Report helpers ──────────────────────────────────────

const TEST_PLAN_ORDER = [
  drizzleSql`CASE ${projectTestPlans.status} WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END`,
  desc(projectTestPlans.createdAt),
] as const;

const TEST_REPORT_ORDER = [
  drizzleSql`CASE ${projectTestReports.reviewStatus} WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END`,
  desc(projectTestReports.createdAt),
] as const;

const TEST_CASE_ORDER = [
  drizzleSql`CASE ${projectTestCases.status} WHEN 'failed' THEN 0 WHEN 'blocked' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END`,
  desc(projectTestCases.updatedAt),
] as const;

export type PhaseTestReadiness = {
  required: boolean;
  phaseLabel: string;
  planCount: number;
  approvedReports: number;
  pendingReports: number;
  failedReports: number;
  reportWithoutFileCount: number;
  unresolvedFailedCaseCount: number;
  blockers: string[];
};

function isFormalTestPhase(phaseId: string): boolean {
  return phaseId === "evt" || phaseId === "dvt" || phaseId === "pvt";
}

export async function getProjectTestPlans(projectId: string, phaseId?: string): Promise<ProjectTestPlan[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectTestPlans)
    .where(phaseId
      ? and(eq(projectTestPlans.projectId, projectId), eq(projectTestPlans.phaseId, phaseId))
      : eq(projectTestPlans.projectId, projectId))
    .orderBy(...TEST_PLAN_ORDER);
}

export async function getProjectTestReports(projectId: string, phaseId?: string): Promise<ProjectTestReport[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectTestReports)
    .where(phaseId
      ? and(eq(projectTestReports.projectId, projectId), eq(projectTestReports.phaseId, phaseId))
      : eq(projectTestReports.projectId, projectId))
    .orderBy(...TEST_REPORT_ORDER);
}

export async function getProjectTestPlanById(id: number): Promise<ProjectTestPlan | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(projectTestPlans).where(eq(projectTestPlans.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getProjectTestReportById(id: number): Promise<ProjectTestReport | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(projectTestReports).where(eq(projectTestReports.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getProjectTestCases(projectId: string, phaseId?: string, planId?: number): Promise<ProjectTestCase[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions: ReturnType<typeof eq>[] = [eq(projectTestCases.projectId, projectId)];
  if (phaseId) conditions.push(eq(projectTestCases.phaseId, phaseId));
  if (planId) conditions.push(eq(projectTestCases.planId, planId));
  return db
    .select()
    .from(projectTestCases)
    .where(and(...conditions))
    .orderBy(...TEST_CASE_ORDER);
}

export async function getProjectTestCaseById(id: number): Promise<ProjectTestCase | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(projectTestCases).where(eq(projectTestCases.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createProjectTestPlan(plan: InsertProjectTestPlan): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectTestPlans).values(plan).returning({ id: projectTestPlans.id });
  return result[0].id;
}

export async function updateProjectTestPlan(
  id: number,
  patch: Partial<Omit<InsertProjectTestPlan, "id" | "projectId" | "phaseId" | "createdBy" | "createdAt">>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectTestPlans).set(patch).where(eq(projectTestPlans.id, id));
}

export async function createProjectTestCase(testCase: InsertProjectTestCase): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectTestCases).values(testCase).returning({ id: projectTestCases.id });
  return result[0].id;
}

export async function updateProjectTestCase(
  id: number,
  patch: Partial<Omit<InsertProjectTestCase, "id" | "projectId" | "phaseId" | "createdBy" | "createdAt">>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectTestCases).set(patch).where(eq(projectTestCases.id, id));
}

export async function linkProjectTestCaseIssue(id: number, issueId: number, updatedBy: number): Promise<void> {
  await updateProjectTestCase(id, { relatedIssueId: issueId, updatedBy });
}

export async function createProjectTestReport(report: InsertProjectTestReport): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectTestReports).values(report).returning({ id: projectTestReports.id });
  return result[0].id;
}

export async function updateProjectTestReport(
  id: number,
  patch: Partial<Omit<InsertProjectTestReport, "id" | "projectId" | "phaseId" | "submittedBy" | "createdAt">>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectTestReports).set(patch).where(eq(projectTestReports.id, id));
}

export async function reviewProjectTestReport(
  id: number,
  reviewerId: number,
  reviewStatus: "approved" | "rejected",
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(projectTestReports)
    .set({ reviewStatus, reviewedBy: reviewerId, reviewedAt: new Date() })
    .where(eq(projectTestReports.id, id));
}

export async function getPhaseTestReadiness(
  projectId: string,
  phaseId: string,
  phaseLabel?: string,
): Promise<PhaseTestReadiness> {
  const required = isFormalTestPhase(phaseId);
  const label = phaseLabel ?? phaseId.toUpperCase();
  if (!required) {
    return {
      required: false,
      phaseLabel: label,
      planCount: 0,
      approvedReports: 0,
      pendingReports: 0,
      failedReports: 0,
      reportWithoutFileCount: 0,
      unresolvedFailedCaseCount: 0,
      blockers: [],
    };
  }

  const [plans, reports] = await Promise.all([
    getProjectTestPlans(projectId, phaseId),
    getProjectTestReports(projectId, phaseId),
  ]);
  const activePlans = plans.filter((plan) => plan.status !== "completed");
  const acceptedReports = reports.filter((report) =>
    report.reviewStatus === "approved"
    && (report.result === "pass" || report.result === "conditional")
    && report.fileId != null
  );
  const pendingReports = reports.filter((report) => report.reviewStatus === "pending");
  const failedReports = reports.filter((report) => report.result === "fail" && report.reviewStatus !== "rejected");
  const reportWithoutFileCount = reports.filter((report) =>
    report.reviewStatus !== "rejected" && report.fileId == null
  ).length;
  const testCases = await getProjectTestCases(projectId, phaseId);
  const failedOrBlockedCases = testCases.filter((testCase) => testCase.status === "failed" || testCase.status === "blocked");
  const issueIds = Array.from(new Set(
    failedOrBlockedCases
      .map((testCase) => testCase.relatedIssueId)
      .filter((id): id is number => typeof id === "number")
  ));
  const db = await getDb();
  const issueRows = db && issueIds.length > 0
    ? await db.select({ id: projectIssues.id, status: projectIssues.status })
      .from(projectIssues)
      .where(inArray(projectIssues.id, issueIds))
    : [];
  const issueStatusById = new Map(issueRows.map((issue) => [issue.id, issue.status]));
  const closedIssueStatuses = new Set(["resolved", "closed", "wont_fix"]);
  const unresolvedFailedCaseCount = failedOrBlockedCases.filter((testCase) => {
    if (!testCase.relatedIssueId) return true;
    const status = issueStatusById.get(testCase.relatedIssueId);
    return !status || !closedIssueStatuses.has(status);
  }).length;
  const blockers: string[] = [];

  if (activePlans.length === 0) blockers.push(`${label} 缺少测试计划`);
  if (reports.length === 0) {
    blockers.push(`${label} 缺少测试报告`);
  } else if (acceptedReports.length === 0) {
    blockers.push(`${label} 缺少已复核通过/有条件通过测试报告`);
  }
  if (pendingReports.length > 0) blockers.push(`${pendingReports.length} 个测试报告待 QA 复核`);
  if (failedReports.length > 0) blockers.push(`${failedReports.length} 个测试报告结论为 Fail`);
  if (reportWithoutFileCount > 0) blockers.push(`${reportWithoutFileCount} 个测试报告未绑定正式文件`);
  if (unresolvedFailedCaseCount > 0) blockers.push(`${unresolvedFailedCaseCount} 个失败/阻塞测试项未完成 Issue 闭环`);

  return {
    required: true,
    phaseLabel: label,
    planCount: activePlans.length,
    approvedReports: acceptedReports.length,
    pendingReports: pendingReports.length,
    failedReports: failedReports.length,
    reportWithoutFileCount,
    unresolvedFailedCaseCount,
    blockers,
  };
}

// ── Project NPI Readiness / Sample Signoff helpers ──────────────────────────

const NPI_READINESS_ORDER = [
  drizzleSql`CASE ${projectNpiReadinessChecks.status} WHEN 'blocked' THEN 0 WHEN 'pending' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END`,
  desc(projectNpiReadinessChecks.updatedAt),
] as const;

const SAMPLE_SIGNOFF_ORDER = [
  drizzleSql`CASE ${projectSampleSignoffs.status} WHEN 'rejected' THEN 0 WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END`,
  desc(projectSampleSignoffs.updatedAt),
] as const;

export type PhaseNpiReadiness = {
  required: boolean;
  phaseLabel: string;
  checkCount: number;
  readyCount: number;
  blockedCount: number;
  pendingCount: number;
  missingEvidenceCount: number;
  blockers: string[];
};

export type PhaseSampleSignoffReadiness = {
  required: boolean;
  phaseLabel: string;
  signoffCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  blockers: string[];
};

function isNpiReadinessGatePhase(phaseId: string): boolean {
  return phaseId === "pvt" || phaseId === "mp";
}

function isCustomerSignoffGatePhase(phaseId: string): boolean {
  return phaseId === "pvt";
}

const NPI_EVIDENCE_REQUIRED_CATEGORIES = new Set([
  "process_flow",
  "sop_wi",
  "fixture",
  "test_program",
  "trial_run",
  "yield",
]);

export async function getProjectNpiReadinessChecks(
  projectId: string,
  phaseId?: string,
): Promise<ProjectNpiReadinessCheck[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectNpiReadinessChecks)
    .where(phaseId
      ? and(eq(projectNpiReadinessChecks.projectId, projectId), eq(projectNpiReadinessChecks.phaseId, phaseId))
      : eq(projectNpiReadinessChecks.projectId, projectId))
    .orderBy(...NPI_READINESS_ORDER);
}

export async function getProjectNpiReadinessCheckById(id: number): Promise<ProjectNpiReadinessCheck | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(projectNpiReadinessChecks).where(eq(projectNpiReadinessChecks.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createProjectNpiReadinessCheck(check: InsertProjectNpiReadinessCheck): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectNpiReadinessChecks).values(check).returning({ id: projectNpiReadinessChecks.id });
  return result[0].id;
}

export async function updateProjectNpiReadinessCheck(
  id: number,
  patch: Partial<Omit<InsertProjectNpiReadinessCheck, "id" | "projectId" | "phaseId" | "createdBy" | "createdAt">>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectNpiReadinessChecks).set(patch).where(eq(projectNpiReadinessChecks.id, id));
}

export async function linkProjectNpiReadinessIssue(id: number, issueId: number, updatedBy: number): Promise<void> {
  await updateProjectNpiReadinessCheck(id, { relatedIssueId: issueId, updatedBy });
}

export async function getPhaseNpiReadiness(
  projectId: string,
  phaseId: string,
  phaseLabel?: string,
): Promise<PhaseNpiReadiness> {
  const required = isNpiReadinessGatePhase(phaseId);
  const label = phaseLabel ?? phaseId.toUpperCase();
  const checks = await getProjectNpiReadinessChecks(projectId, phaseId);
  const readyChecks = checks.filter((check) => check.status === "ready" || check.status === "waived");
  const blockedChecks = checks.filter((check) => check.status === "blocked");
  const pendingChecks = checks.filter((check) => check.status === "pending");
  const missingEvidenceChecks = checks.filter((check) =>
    check.status === "ready"
    && !check.evidenceFileId
    && NPI_EVIDENCE_REQUIRED_CATEGORIES.has(check.category)
  );
  const blockers: string[] = [];

  if (required && checks.length === 0) blockers.push(`${label} 缺少 PE/NPI readiness 检查`);
  for (const check of blockedChecks) blockers.push(`NPI 阻断: ${check.title}`);
  for (const check of pendingChecks) blockers.push(`NPI 待确认: ${check.title}`);
  for (const check of missingEvidenceChecks) blockers.push(`NPI 缺少证据文件: ${check.title}`);

  return {
    required,
    phaseLabel: label,
    checkCount: checks.length,
    readyCount: readyChecks.length,
    blockedCount: blockedChecks.length,
    pendingCount: pendingChecks.length,
    missingEvidenceCount: missingEvidenceChecks.length,
    blockers,
  };
}

export async function getProjectSampleSignoffs(
  projectId: string,
  phaseId?: string,
  audience?: "customer" | "supplier" | "internal",
): Promise<ProjectSampleSignoff[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions: ReturnType<typeof eq>[] = [eq(projectSampleSignoffs.projectId, projectId)];
  if (phaseId) conditions.push(eq(projectSampleSignoffs.phaseId, phaseId));
  if (audience) conditions.push(eq(projectSampleSignoffs.audience, audience));
  return db
    .select()
    .from(projectSampleSignoffs)
    .where(and(...conditions))
    .orderBy(...SAMPLE_SIGNOFF_ORDER);
}

export async function getProjectSampleSignoffById(id: number): Promise<ProjectSampleSignoff | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(projectSampleSignoffs).where(eq(projectSampleSignoffs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createProjectSampleSignoff(signoff: InsertProjectSampleSignoff): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectSampleSignoffs).values(signoff).returning({ id: projectSampleSignoffs.id });
  return result[0].id;
}

export async function updateProjectSampleSignoff(
  id: number,
  patch: Partial<Omit<InsertProjectSampleSignoff, "id" | "projectId" | "phaseId" | "requestedBy" | "createdAt">>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectSampleSignoffs).set(patch).where(eq(projectSampleSignoffs.id, id));
}

export async function respondProjectSampleSignoff(
  id: number,
  respondedBy: number,
  status: "approved" | "rejected" | "waived",
  responseNote?: string | null,
): Promise<void> {
  await updateProjectSampleSignoff(id, {
    status,
    respondedBy,
    respondedAt: new Date(),
    responseNote: responseNote ?? null,
  });
}

export async function getPhaseSampleSignoffReadiness(
  projectId: string,
  phaseId: string,
  phaseLabel?: string,
): Promise<PhaseSampleSignoffReadiness> {
  const label = phaseLabel ?? phaseId.toUpperCase();
  const [project, signoffs] = await Promise.all([
    getProjectById(projectId),
    getProjectSampleSignoffs(projectId, phaseId),
  ]);
  const hasNamedCustomer = Boolean(project?.customer?.trim());
  const customerRows = signoffs.filter((row) => row.audience === "customer");
  const required = isCustomerSignoffGatePhase(phaseId) && hasNamedCustomer;
  const approved = signoffs.filter((row) => row.status === "approved" || row.status === "waived");
  const pending = signoffs.filter((row) => row.status === "pending");
  const rejected = signoffs.filter((row) => row.status === "rejected");
  const blockers: string[] = [];

  if (required && customerRows.length === 0) blockers.push(`${label} 缺少客户样品 / Golden Sample 签样项`);
  for (const row of rejected) blockers.push(`签样被拒绝: ${row.title}`);
  for (const row of pending) blockers.push(`签样待确认: ${row.title}`);

  return {
    required: required || signoffs.length > 0,
    phaseLabel: label,
    signoffCount: signoffs.length,
    approvedCount: approved.length,
    pendingCount: pending.length,
    rejectedCount: rejected.length,
    blockers,
  };
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

export async function getProjectMetricsData(
  projectId: string,
  _fromISO: string,
  _toISO: string,
  phaseId?: string,
): Promise<{
  tasks: MetricTask[];
  issues: MetricIssue[];
  gates: MetricGate[];
  phases: MetricPhase[];
  totalTaskCount: number;
}> {
  const db = await getDb();
  if (!db) {
    return { tasks: [], issues: [], gates: [], phases: [], totalTaskCount: 0 };
  }
  const taskWhere = phaseId
    ? and(eq(projectTasks.projectId, projectId), eq(projectTasks.phaseId, phaseId))
    : eq(projectTasks.projectId, projectId);
  const issueWhere = phaseId
    ? and(eq(projectIssues.projectId, projectId), eq(projectIssues.phaseId, phaseId))
    : eq(projectIssues.projectId, projectId);
  const gateWhere = phaseId
    ? and(eq(projectGateReviews.projectId, projectId), eq(projectGateReviews.phaseId, phaseId))
    : eq(projectGateReviews.projectId, projectId);
  const phaseWhere = phaseId
    ? and(eq(projectPhases.projectId, projectId), eq(projectPhases.phaseId, phaseId))
    : eq(projectPhases.projectId, projectId);

  const [tasks, issues, gates, phases] = await Promise.all([
    db
      .select({
        phaseId: projectTasks.phaseId,
        createdAt: drizzleSql<string>`to_char(${projectTasks.createdAt}, 'YYYY-MM-DD')`,
        completedAt: drizzleSql<string | null>`to_char(${projectTasks.completedAt}, 'YYYY-MM-DD')`,
        dueDate: projectTasks.dueDate,
        status: projectTasks.status,
      })
      .from(projectTasks)
      .where(taskWhere)
      .orderBy(projectTasks.id),
    db
      .select({
        foundDate: projectIssues.foundDate,
        closedDate: projectIssues.closedDate,
        severity: projectIssues.severity,
        status: projectIssues.status,
        category: projectIssues.category,
      })
      .from(projectIssues)
      .where(issueWhere)
      .orderBy(projectIssues.createdAt),
    db
      .select({
        phaseId: projectGateReviews.phaseId,
        decision: projectGateReviews.decision,
        roundNumber: projectGateReviews.roundNumber,
      })
      .from(projectGateReviews)
      .where(gateWhere)
      .orderBy(projectGateReviews.createdAt),
    db
      .select({
        phaseId: projectPhases.phaseId,
        startDate: projectPhases.startDate,
        endDate: projectPhases.endDate,
      })
      .from(projectPhases)
      .where(phaseWhere)
      .orderBy(projectPhases.id),
  ]);

  return {
    tasks,
    issues,
    gates,
    phases,
    totalTaskCount: tasks.length,
  };
}

/** 组合度量 rollup：逐项目复用单项目度量，装行 + 精确池化聚合。范围=getPortfolio（全部未归档，前端按 lens 收口）。 */
export async function getPortfolioMetricsData(userId: number): Promise<PortfolioMetricsRollup> {
  const portfolio = await getPortfolio(userId);
  const todayISO = todayInShanghaiISO();
  const input = await Promise.all(portfolio.map(async (p) => {
    const raw = await getProjectMetricsData(p.id, "", todayISO);
    const fromISO = defaultFromISO(p.startDate, raw, todayISO);
    const metrics = computeProjectMetrics({ ...raw, window: { fromISO, toISO: todayISO } });
    return { projectId: p.id, name: p.name, ragLevel: p.ragLevel, metrics };
  }));
  return rollupPortfolioMetrics(input);
}

/** 管理层决策 KPI：延误预测 / Gate 一次通过 / P0P1 aging / 验证关闭率 / BOM 成本偏差 / 客户风险排行。 */
export async function getManagementKpisData(userId: number): Promise<ManagementKpis> {
  const db = await getDb();
  const portfolio = await getPortfolio(userId);
  const todayISO = todayInShanghaiISO();
  if (!db || portfolio.length === 0) {
    return computeManagementKpis({
      portfolio,
      gateReviews: [],
      issues: [],
      validationItems: [],
      bomCosts: [],
      todayISO,
    });
  }

  const projectIds = portfolio.map((project) => project.id);
  const projectById = new Map(portfolio.map((project) => [project.id, project]));
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      customer: projects.customer,
      customFields: projects.customFields,
      productDefinitionSnapshotId: projects.productDefinitionSnapshotId,
    })
    .from(projects)
    .where(inArray(projects.id, projectIds));

  const snapshotIds = Array.from(new Set(
    projectRows
      .map((project) => project.productDefinitionSnapshotId)
      .filter((id): id is number => typeof id === "number")
  ));

  const [gateRows, issueRows, testRows, bomRows, snapshotRows] = await Promise.all([
    db
      .select({
        projectId: projectGateReviews.projectId,
        phaseId: projectGateReviews.phaseId,
        decision: projectGateReviews.decision,
        roundNumber: projectGateReviews.roundNumber,
        reviewDate: projectGateReviews.reviewDate,
      })
      .from(projectGateReviews)
      .where(inArray(projectGateReviews.projectId, projectIds)),
    db
      .select({
        id: projectIssues.id,
        projectId: projectIssues.projectId,
        phaseId: projectIssues.phaseId,
        title: projectIssues.title,
        severity: projectIssues.severity,
        status: projectIssues.status,
        foundDate: projectIssues.foundDate,
        targetDate: projectIssues.targetDate,
        owner: projectIssues.owner,
      })
      .from(projectIssues)
      .where(inArray(projectIssues.projectId, projectIds)),
    db
      .select({
        projectId: projectTestCases.projectId,
        phaseId: projectTestCases.phaseId,
        status: projectTestCases.status,
        relatedIssueId: projectTestCases.relatedIssueId,
      })
      .from(projectTestCases)
      .where(and(
        inArray(projectTestCases.projectId, projectIds),
        inArray(projectTestCases.phaseId, ["evt", "dvt", "pvt"])
      )),
    db
      .select({
        projectId: bomItems.projectId,
        quantity: bomItems.quantity,
        unitCost: bomItems.unitCost,
      })
      .from(bomItems)
      .where(inArray(bomItems.projectId, projectIds)),
    snapshotIds.length > 0
      ? db
        .select({
          id: productDefinitionSnapshots.id,
          snapshot: productDefinitionSnapshots.snapshot,
        })
        .from(productDefinitionSnapshots)
        .where(inArray(productDefinitionSnapshots.id, snapshotIds))
      : Promise.resolve([]),
  ]);

  const issueStatusById = new Map(issueRows.map((issue) => [issue.id, issue.status]));
  const snapshotsById = new Map(snapshotRows.map((snapshot) => [snapshot.id, snapshot.snapshot]));
  const targetCostByProject = new Map<string, number | null>();
  for (const project of projectRows) {
    const snapshotTarget = project.productDefinitionSnapshotId
      ? snapshotsById.get(project.productDefinitionSnapshotId)?.targetCost
      : null;
    const fields = project.customFields ?? {};
    const customTarget = fields.targetCost ?? fields.target_cost ?? fields.bomTargetCost ?? fields.bom_target_cost;
    targetCostByProject.set(project.id, parseCostValue(snapshotTarget) ?? parseCostValue(customTarget));
  }

  const bomAgg = new Map<string, { cost: number; lineCount: number; pricedLines: number }>();
  for (const row of bomRows) {
    if (!row.projectId) continue;
    const current = bomAgg.get(row.projectId) ?? { cost: 0, lineCount: 0, pricedLines: 0 };
    current.lineCount += 1;
    const unitCost = parseCostValue(row.unitCost);
    if (unitCost != null) {
      current.cost += unitCost * row.quantity;
      current.pricedLines += 1;
    }
    bomAgg.set(row.projectId, current);
  }

  return computeManagementKpis({
    portfolio,
    gateReviews: gateRows,
    issues: issueRows.map((issue) => ({
      projectId: issue.projectId,
      projectName: projectById.get(issue.projectId)?.name ?? issue.projectId,
      phaseId: issue.phaseId,
      title: issue.title,
      severity: issue.severity,
      status: issue.status,
      foundDate: issue.foundDate,
      targetDate: issue.targetDate,
      owner: issue.owner,
    })),
    validationItems: testRows.map((testCase) => ({
      projectId: testCase.projectId,
      phaseId: testCase.phaseId,
      status: testCase.status,
      relatedIssueStatus: testCase.relatedIssueId ? issueStatusById.get(testCase.relatedIssueId) ?? null : null,
    })),
    bomCosts: portfolio.map((project) => {
      const bom = bomAgg.get(project.id);
      return {
        projectId: project.id,
        projectName: project.name,
        customer: project.customer,
        targetCost: targetCostByProject.get(project.id) ?? null,
        workingBomCost: bom && bom.pricedLines > 0 ? Math.round(bom.cost * 100) / 100 : null,
        lineCount: bom?.lineCount ?? 0,
      };
    }),
    todayISO,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildGateReviewTraceSnapshot(exec: any, input: {
  projectId: string;
  phaseId: string;
  gateName?: string | null;
}): Promise<GateReviewTraceSnapshot> {
  const [project] = await exec
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  const productId = project?.productId ?? null;
  const revisionIds = Array.from(new Set([
    project?.baseRevisionId ?? null,
    project?.resultRevisionId ?? null,
  ].filter((id): id is number => typeof id === "number")));

  const [
    product,
    revisions,
    bomRows,
    variantRows,
    testPlansRows,
    testReportsRows,
    testCaseRows,
    npiRows,
    sampleSignoffRows,
  ] = await Promise.all([
    productId
      ? exec.select().from(products).where(eq(products.id, productId)).limit(1)
      : Promise.resolve([]),
    revisionIds.length > 0
      ? exec.select().from(productRevisions).where(inArray(productRevisions.id, revisionIds))
      : Promise.resolve([]),
    exec
      .select()
      .from(bomItems)
      .where(eq(bomItems.projectId, input.projectId))
      .orderBy(bomItems.sortOrder, bomItems.id),
    productId
      ? exec
        .select()
        .from(customerVariants)
        .where(eq(customerVariants.parentProductId, productId))
        .orderBy(customerVariants.variantCode)
      : Promise.resolve([]),
    exec
      .select()
      .from(projectTestPlans)
      .where(and(eq(projectTestPlans.projectId, input.projectId), eq(projectTestPlans.phaseId, input.phaseId)))
      .orderBy(projectTestPlans.createdAt),
    exec
      .select()
      .from(projectTestReports)
      .where(and(eq(projectTestReports.projectId, input.projectId), eq(projectTestReports.phaseId, input.phaseId)))
      .orderBy(projectTestReports.createdAt),
    exec
      .select()
      .from(projectTestCases)
      .where(and(eq(projectTestCases.projectId, input.projectId), eq(projectTestCases.phaseId, input.phaseId)))
      .orderBy(projectTestCases.createdAt),
    exec
      .select()
      .from(projectNpiReadinessChecks)
      .where(and(eq(projectNpiReadinessChecks.projectId, input.projectId), eq(projectNpiReadinessChecks.phaseId, input.phaseId)))
      .orderBy(projectNpiReadinessChecks.createdAt),
    exec
      .select()
      .from(projectSampleSignoffs)
      .where(and(eq(projectSampleSignoffs.projectId, input.projectId), eq(projectSampleSignoffs.phaseId, input.phaseId)))
      .orderBy(projectSampleSignoffs.createdAt),
  ]);
  const productRow = product[0] as ProductRow | undefined;
  const testReports = testReportsRows as ProjectTestReport[];
  const testCases = testCaseRows as ProjectTestCase[];
  const npiChecks = npiRows as ProjectNpiReadinessCheck[];
  const sampleSignoffs = sampleSignoffRows as ProjectSampleSignoff[];
  const failedCases = testCases.filter((row) => row.status === "failed" || row.status === "blocked");
  const failedIssueIds = Array.from(new Set(
    failedCases
      .map((row) => row.relatedIssueId)
      .filter((id): id is number => typeof id === "number")
  ));
  const failedIssueRows = failedIssueIds.length > 0
    ? await exec
      .select({ id: projectIssues.id, status: projectIssues.status })
      .from(projectIssues)
      .where(inArray(projectIssues.id, failedIssueIds))
    : [];
  const failedIssueStatusById = new Map((failedIssueRows as Array<{ id: number; status: string }>).map((row) => [row.id, row.status]));
  const closedTraceIssueStatuses = new Set(["resolved", "closed", "wont_fix"]);
  const unresolvedFailedCaseCount = failedCases.filter((row) => {
    if (!row.relatedIssueId) return true;
    const status = failedIssueStatusById.get(row.relatedIssueId);
    return !status || !closedTraceIssueStatuses.has(status);
  }).length;
  const byRevisionId = new Map((revisions as ProductRevision[]).map((revision) => [revision.id, revision]));
  const toRevision = (id: number | null | undefined) => {
    const revision = typeof id === "number" ? byRevisionId.get(id) : undefined;
    return revision
      ? { id: revision.id, revisionLabel: revision.revisionLabel, status: revision.status }
      : null;
  };

  return {
    capturedAt: new Date().toISOString(),
    projectId: input.projectId,
    phaseId: input.phaseId,
    gateName: input.gateName ?? "",
    product: productRow
      ? {
        id: productRow.id,
        productNumber: productRow.productNumber,
        name: productRow.name,
        lifecycleState: productRow.lifecycleState,
      }
      : null,
    baseRevision: toRevision(project?.baseRevisionId),
    resultRevision: toRevision(project?.resultRevisionId),
    workingBom: {
      lineCount: (bomRows as BomItem[]).length,
      rows: (bomRows as BomItem[]).map((row) => ({
        partNumber: row.partNumber,
        name: row.name,
        spec: row.spec,
        quantity: row.quantity,
        refDesignator: row.refDesignator,
        componentProductId: row.componentProductId,
        componentRevisionId: row.componentRevisionId,
        sortOrder: row.sortOrder,
      })),
    },
    customerVariants: (variantRows as CustomerVariant[]).map((variant) => ({
      id: variant.id,
      variantCode: variant.variantCode,
      customerSku: variant.customerSku,
      customerId: variant.customerId,
      customerName: variant.customerName,
      baseRevision: variant.baseRevision,
      status: variant.status,
      customerBomRevision: (variant.deltas ?? [])
        .find((delta) => delta.note === "customer_bom_revision" && delta.variantValue.trim())
        ?.variantValue ?? null,
      customerApproved: variant.customerApproved,
      goldenSampleRef: variant.goldenSampleRef,
    })),
    testEvidence: {
      planCount: (testPlansRows as ProjectTestPlan[]).length,
      reportCount: testReports.length,
      approvedReportCount: testReports.filter((row) =>
        row.reviewStatus === "approved" && (row.result === "pass" || row.result === "conditional") && row.fileId != null
      ).length,
      failedCaseCount: failedCases.length,
      unresolvedFailedCaseCount,
      reports: testReports.map((row) => ({
        id: row.id,
        title: row.title,
        reportNo: row.reportNo,
        result: row.result,
        reviewStatus: row.reviewStatus,
        fileId: row.fileId,
      })),
      failedCases: failedCases.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        severity: row.severity,
        sampleSerials: row.sampleSerials ?? [],
        relatedIssueId: row.relatedIssueId,
      })),
    },
    npiEvidence: {
      checkCount: npiChecks.length,
      openCheckCount: npiChecks.filter((row) => row.status === "pending" || row.status === "blocked").length,
      checks: npiChecks.map((row) => ({
        id: row.id,
        title: row.title,
        category: row.category,
        status: row.status,
        evidenceFileId: row.evidenceFileId,
        relatedIssueId: row.relatedIssueId,
      })),
    },
    sampleSignoffs: {
      signoffCount: sampleSignoffs.length,
      openSignoffCount: sampleSignoffs.filter((row) => row.status === "pending" || row.status === "rejected").length,
      signoffs: sampleSignoffs.map((row) => ({
        id: row.id,
        title: row.title,
        signoffType: row.signoffType,
        audience: row.audience,
        status: row.status,
        sampleSerials: row.sampleSerials ?? [],
        fileId: row.fileId,
        respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
      })),
    },
  };
}

/** Create a gate review */
export async function createProjectGateReview(
  review: InsertProjectGateReview,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async (tx: any): Promise<number> => {
    await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${`${review.projectId}:${review.phaseId}`}))`);
    const latest = await tx
      .select({ maxRound: drizzleSql<number>`coalesce(max(${projectGateReviews.roundNumber}), 0)::int` })
      .from(projectGateReviews)
      .where(and(
        eq(projectGateReviews.projectId, review.projectId),
        eq(projectGateReviews.phaseId, review.phaseId),
      ));
    const nextRound = (latest[0]?.maxRound ?? 0) + 1;
    const traceSnapshot = await buildGateReviewTraceSnapshot(tx, review);
    const result = await tx
      .insert(projectGateReviews)
      .values({
        ...review,
        roundNumber: nextRound,
        productId: traceSnapshot.product?.id ?? null,
        baseRevisionId: traceSnapshot.baseRevision?.id ?? null,
        resultRevisionId: traceSnapshot.resultRevision?.id ?? null,
        traceSnapshot,
      })
      .returning({ id: projectGateReviews.id });
    return result[0].id;
  };
  // exec 传入外层事务则并入之（advisory lock 绑定该事务）；否则自开事务
  if (exec) return run(exec);
  return db.transaction(run);
}

/**
 * 原子化「Gate 通过/有条件通过/不通过」：记录评审 → (非不通过时)标记 gate task 完成 → (复审当前阶段时)推进 currentPhase。
 * 三笔写入在同一事务：任一步失败整体回滚，不留「评审已记录但任务/阶段没动」的中间态
 * （否则重试会产生第二轮评审记录）。advisory lock 同时防并发重复评审。
 * 替代旧的"客户端三笔分散写 + 600ms 防抖"路径（会因竞态/取消导致部分持久化）。
 */
export async function confirmGateReview(input: {
  projectId: string;
  phaseId: string;
  gateTaskId: string | null;
  phaseName?: string | null;
  gateName?: string | null;
  reviewDate: string;
  participants?: string | null;
  decision: GateDecision;
  conditions?: string | null;
  notes?: string | null;
  createdBy: number;
}): Promise<{ reviewId: number; roundNumber: number; advancedTo: string | null }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("Project not found");

  const { reviewId, advancedTo } = await db.transaction(async (tx) => {
    // 1) 记录评审（顾问锁并入本事务，自动算 roundNumber）
    const reviewId = await createProjectGateReview({
      projectId: input.projectId,
      phaseId: input.phaseId,
      phaseName: input.phaseName ?? "",
      gateName: input.gateName ?? "",
      reviewDate: input.reviewDate,
      participants: input.participants ?? null,
      decision: input.decision,
      conditions: input.conditions ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    }, tx);

    let advancedTo: string | null = null;
    if (input.decision !== "rejected") {
      // 2) 标记 gate task 完成
      if (input.gateTaskId) {
        await setTaskCompletion(input.projectId, input.phaseId, input.gateTaskId, true, input.createdBy, tx);
      }
      // 3) 仅当复审的是「当前阶段」且存在下一阶段时才推进
      if (project.currentPhase === input.phaseId) {
        const phases = getPhasesForCategory(project.category);
        const idx = phases.findIndex((p) => p.id === input.phaseId);
        const next = idx >= 0 && idx < phases.length - 1 ? phases[idx + 1] : null;
        if (next) {
          await updateProject(input.projectId, { currentPhase: next.id }, tx);
          advancedTo = next.id;
        }
      }
    }
    return { reviewId, advancedTo };
  });

  const reviews = await getProjectGateReviews(input.projectId, input.phaseId);
  const roundNumber = reviews.find((r) => r.id === reviewId)?.roundNumber ?? 1;
  return { reviewId, roundNumber, advancedTo };
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

/** Get a single change record by global id (用于评论等按实体反查项目归属) */
export async function getChangelogRecordById(id: number): Promise<ProjectChangeRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(projectChangelog).where(eq(projectChangelog.id, id)).limit(1);
  return row ?? null;
}

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
  const normalized = {
    ...record,
    fileType: normalizeFileType(record.fileType),
    fileVersion: normalizeFileVersion(record.fileVersion),
    visibility: normalizeProjectFileVisibility(record.visibility),
  };
  const result = await db.insert(projectFiles).values(normalized).returning({ id: projectFiles.id });
  // 上传新版本后触发交付物重审（若已审核过则回退待审）
  if (record.deliverableName && record.phaseId) {
    const { resetReviewOnReupload, maybeAutoSubmitDeliverableReviewOnUpload } = await loadDeliverableReviewService();
    await resetReviewOnReupload(record.projectId, record.phaseId, record.deliverableName, record.uploadedBy);
    await maybeAutoSubmitDeliverableReviewOnUpload({
      projectId: record.projectId,
      phaseId: record.phaseId,
      deliverableName: record.deliverableName,
      uploadedBy: record.uploadedBy,
    }).catch((error) => {
      console.warn("[deliverable-review] auto submit on upload failed (non-fatal):", error);
    });
  }
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
 * Resolve the owning projectId for a stored object by its storage key.
 * Used by the /storage proxy to authorize downloads. Returns null if no
 * file record references this key.
 */
export async function getProjectIdByStorageKey(storageKey: string): Promise<string | null> {
  const access = await getProjectFileAccessByStorageKey(storageKey);
  return access?.projectId ?? null;
}

export async function getProjectFileAccessByStorageKey(
  storageKey: string,
): Promise<{ projectId: string; visibility: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ projectId: projectFiles.projectId, visibility: projectFiles.visibility })
    .from(projectFiles)
    .where(eq(projectFiles.storageKey, storageKey))
    .limit(1);
  return row ?? null;
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
  record: Omit<InsertActivityLog, "id" | "createdAt">,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any
): Promise<void> {
  const db = exec ?? (await getDb());
  if (!db) {
    // Non-fatal: activity logging should never block the main operation
    console.warn("[ActivityLog] Database not available, skipping log entry");
    return;
  }
  try {
    await db.insert(activityLogs).values(record);
  } catch (err) {
    // Non-fatal: log the error but don't propagate
    // （在事务内失败会使整个事务中止回滚——日志与业务写入同生共死是预期行为）
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

/**
 * 单个任务的活动日志（新→旧）。任务唯一身份是 (projectId, phaseId, taskId)，
 * 而 activity 的 entityId 只是 taskId、phaseId 在 meta 里；必须带 phaseId 过滤，
 * 否则不同阶段同名 taskId 会串任务。
 */
export async function getTaskActivityLogs(
  projectId: string,
  phaseId: string,
  taskId: string,
  limit = 100
): Promise<ActivityLog[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.projectId, projectId),
        eq(activityLogs.entityType, "task"),
        eq(activityLogs.entityId, taskId),
        drizzleSql`${activityLogs.meta}->>'phaseId' = ${phaseId}`
      )
    )
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit);
}

/** Fetch activity logs after a cursor, oldest first, for the event tailer. */
export async function listActivityLogsAfter(cursorId: number, limit = 100): Promise<ActivityLog[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(activityLogs)
    .where(drizzleSql`${activityLogs.id} > ${Math.max(0, cursorId)}`)
    .orderBy(activityLogs.id)
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function getLatestActivityLogId(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ id: drizzleSql<number>`coalesce(max(${activityLogs.id}), 0)`.as("id") })
    .from(activityLogs);
  return Number(row?.id ?? 0);
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
  /** 派生审计列：状态变化时更新。 */
  statusChangedAt?: Date;
  /** 派生镜像列，勿手动传；由 status 推导。见 deriveCompletion */
  completed?: boolean;
  updatedBy?: number | null;
  // 逐任务审批闸门列
  requiresApproval?: boolean;
  approverUserId?: number | null;
  approvalStatus?: TaskApprovalStatus;
  approvalNote?: string | null;
  approvalRequestedBy?: number | null;
  approvalRequestedAt?: Date | null;
  approvalDecidedBy?: number | null;
  approvalDecidedAt?: Date | null;
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

function toTaskDbPatch(patch: TaskMetaPatch, current?: Pick<ProjectTask, "status"> | null): TaskMetaPatch {
  const dbPatch = toDbPatch(deriveCompletion(patch));
  if (dbPatch.status !== undefined && dbPatch.status !== current?.status) {
    return { ...dbPatch, statusChangedAt: new Date() };
  }
  return dbPatch;
}

function getTaskDependencyMap(category: string | undefined): Map<string, string[]> {
  return new Map(
    buildSchedTasks(getPhasesForCategory(category)).map((task) => [task.id, task.dependsOn ?? []])
  );
}

function automaticTaskStatus(
  task: ProjectTask,
  rowsByTaskId: Map<string, ProjectTask>,
  dependencies: Map<string, string[]>,
  todayISO: string
): TaskStatus {
  if (task.status === "skipped") return "skipped";
  // 待审批是显式保留态：勾完成进入待审后不被排期/依赖重算吞掉；completed 仍为 false → 下游依赖视为未完成。
  if (task.status === "pending_approval") return "pending_approval";
  if (task.completed || task.status === "done") return "done";

  if (task.startDate && task.startDate > todayISO) return "todo";

  const unresolvedDependency = (dependencies.get(task.taskId) ?? []).some((dependencyId) => {
    const dependency = rowsByTaskId.get(dependencyId);
    if (!dependency) return true;
    return dependency.status !== "done" && dependency.status !== "skipped" && !dependency.completed;
  });
  if (unresolvedDependency) return "blocked";

  if (task.startDate && task.startDate <= todayISO) return "in_progress";
  if (task.assigneeUserId) return "in_progress";
  if (task.dueDate && task.dueDate <= todayISO) return "in_progress";
  return "todo";
}

export function applyAutomaticTaskStatuses(
  rows: ProjectTask[],
  category: string | undefined,
  todayISO = todayInShanghaiISO()
): ProjectTask[] {
  const dependencies = getTaskDependencyMap(category);
  const rowsByTaskId = new Map(rows.map((row) => [row.taskId, row]));
  const now = new Date();

  return rows.map((row) => {
    const status = automaticTaskStatus(row, rowsByTaskId, dependencies, todayISO);
    const completed = status === "done";
    const completedAt = completed ? (row.completedAt ?? now) : null;
    if (row.status === status && row.completed === completed && row.completedAt === completedAt) return row;
    return { ...row, status, completed, completedAt };
  });
}

/**
 * Recalculate operational task status from dependencies, schedule, assignment,
 * and completion. Manual non-terminal status changes are intentionally not a
 * control surface; "done" and "skipped" remain explicit terminal states.
 */
export async function refreshProjectTaskStatuses(
  projectId: string,
  todayISO = todayInShanghaiISO(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any
): Promise<number> {
  const db = exec ?? (await getDb());
  if (!db) return 0;
  const project = await getProjectById(projectId);
  if (!project) return 0;
  const rows: ProjectTask[] = await db.select().from(projectTasks).where(eq(projectTasks.projectId, projectId));
  if (rows.length === 0) return 0;

  const nextRows = applyAutomaticTaskStatuses(rows, project.category, todayISO);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  let changed = 0;

  for (const next of nextRows) {
    const current = rowsById.get(next.id);
    if (!current) continue;
    const shouldUpdate =
      current.status !== next.status ||
      current.completed !== next.completed ||
      (next.status === "done" && !current.completedAt) ||
      (next.status !== "done" && !!current.completedAt);
    if (!shouldUpdate) continue;
    const updatePatch: Partial<ProjectTask> = {
      status: next.status,
      completed: next.completed,
      completedAt: next.status === "done" ? (current.completedAt ?? next.completedAt ?? new Date()) : null,
    };
    if (current.status !== next.status) updatePatch.statusChangedAt = new Date();
    await db
      .update(projectTasks)
      .set(updatePatch)
      .where(eq(projectTasks.id, current.id));
    changed += 1;
  }

  return changed;
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
    .select({ id: projectTasks.id, status: projectTasks.status })
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.projectId, projectId),
        eq(projectTasks.phaseId, phaseId),
        eq(projectTasks.taskId, taskId)
      )
    )
    .limit(1);
  const dbPatch = toTaskDbPatch(patch, existing[0] ?? null);
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
  if (patch.status === undefined) {
    await refreshProjectTaskStatuses(projectId);
  }
}

/**
 * 卡片勾选「完成」：status 是主状态，勾选即把 status 设为 done/todo，
 * completed/completedAt 随之派生。行不存在则插入。
 */
export type CompletionOutcome = "completed" | "uncompleted" | "submitted";

export async function setTaskCompletion(
  projectId: string,
  phaseId: string,
  taskId: string,
  completed: boolean,
  updatedBy?: number | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any
): Promise<{ outcome: CompletionOutcome }> {
  const db = exec ?? (await getDb());
  const current = db
    ? (
        await db
          .select()
          .from(projectTasks)
          .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.phaseId, phaseId), eq(projectTasks.taskId, taskId)))
          .limit(1)
      )[0]
    : null;

  // 需审批任务勾完成 → 进入待审批（completed 仍 false，不计入进度/看板完成/Gate）
  if (completed && current?.requiresApproval) {
    await upsertProjectTask(projectId, phaseId, taskId, {
      status: "pending_approval",
      approvalStatus: "pending",
      approvalRequestedBy: updatedBy ?? null,
      approvalRequestedAt: new Date(),
      updatedBy: updatedBy ?? null,
    }, exec);
    await refreshProjectTaskStatuses(projectId, undefined, exec);
    if (updatedBy != null) {
      await createActivityLog({
        projectId, userId: updatedBy, action: "task.submit_approval",
        entityType: "task", entityId: taskId,
        meta: { phaseId, approver: current?.approverUserId ?? null },
      }, exec);
    }
    return { outcome: "submitted" };
  }

  // 普通完成
  if (completed) {
    await upsertProjectTask(projectId, phaseId, taskId, {
      status: "done", completedAt: new Date(), updatedBy: updatedBy ?? null,
    }, exec);
    await refreshProjectTaskStatuses(projectId, undefined, exec);
    if (updatedBy != null) {
      await createActivityLog({
        projectId, userId: updatedBy, action: "task.complete",
        entityType: "task", entityId: taskId, meta: { phaseId },
      }, exec);
    }
    return { outcome: "completed" };
  }

  // 取消勾选（含撤回 pending_approval）：清审批待审，status 交 refresh 归位
  await upsertProjectTask(projectId, phaseId, taskId, {
    status: "todo", completedAt: null,
    approvalStatus: "none", approvalRequestedBy: null, approvalRequestedAt: null,
    updatedBy: updatedBy ?? null,
  }, exec);
  await refreshProjectTaskStatuses(projectId, undefined, exec);
  if (updatedBy != null) {
    await createActivityLog({
      projectId, userId: updatedBy, action: "task.uncomplete",
      entityType: "task", entityId: taskId, meta: { phaseId },
    }, exec);
  }
  return { outcome: "uncompleted" };
}

/**
 * 配置某任务的审批闸门（需审批开关 + 审批人）。
 * 关开关且当前为 pending_approval → 取消在途审批（approvalStatus=none、completed=false），
 * status 交给 refresh 按 automaticTaskStatus 归位（不擅自判通过）。
 */
export async function setTaskApprovalConfig(
  projectId: string,
  phaseId: string,
  taskId: string,
  cfg: { requiresApproval: boolean; approverUserId: number | null },
  actorBy?: number | null
): Promise<void> {
  const db = await getDb();
  const current = db
    ? (
        await db
          .select()
          .from(projectTasks)
          .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.phaseId, phaseId), eq(projectTasks.taskId, taskId)))
          .limit(1)
      )[0]
    : null;
  const patch: Parameters<typeof upsertProjectTask>[3] = {
    requiresApproval: cfg.requiresApproval,
    approverUserId: cfg.approverUserId,
    updatedBy: actorBy ?? null,
  };
  if (!cfg.requiresApproval && current?.status === "pending_approval") {
    patch.status = "todo";
    patch.completedAt = null;
    patch.approvalStatus = "none";
    patch.approvalRequestedBy = null;
    patch.approvalRequestedAt = null;
  }
  await upsertProjectTask(projectId, phaseId, taskId, patch);
  await refreshProjectTaskStatuses(projectId);
  if (actorBy != null) {
    await createActivityLog({
      projectId, userId: actorBy, action: "task.update_meta",
      entityType: "task", entityId: taskId,
      meta: { phaseId, requiresApproval: cfg.requiresApproval, approverUserId: cfg.approverUserId },
    });
  }
}

/**
 * 审批裁决：通过 → done/completed=true；驳回 → 清待审、completed=false，
 * status 交给 refresh 按 automaticTaskStatus 归位（todo/in_progress/blocked 皆可能）。
 * isProxy=true（actor 非指定审批人，即 admin 代审）会在日志 meta.proxyBy 记录。
 */
export async function decideTaskApproval(
  projectId: string,
  phaseId: string,
  taskId: string,
  decision: "approved" | "rejected",
  actor: number,
  note: string | null,
  isProxy: boolean
): Promise<void> {
  const db = await getDb();
  const current = db
    ? (
        await db
          .select()
          .from(projectTasks)
          .where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.phaseId, phaseId), eq(projectTasks.taskId, taskId)))
          .limit(1)
      )[0]
    : null;
  const requester = current?.approvalRequestedBy ?? null;
  if (decision === "approved") {
    await upsertProjectTask(projectId, phaseId, taskId, {
      status: "done", completedAt: new Date(),
      approvalStatus: "approved", approvalDecidedBy: actor, approvalDecidedAt: new Date(),
      approvalNote: note, updatedBy: actor,
    });
  } else {
    await upsertProjectTask(projectId, phaseId, taskId, {
      status: "todo", completedAt: null,
      approvalStatus: "rejected", approvalDecidedBy: actor, approvalDecidedAt: new Date(),
      approvalNote: note, updatedBy: actor,
    });
  }
  await refreshProjectTaskStatuses(projectId);
  await createActivityLog({
    projectId, userId: actor, action: decision === "approved" ? "task.approve" : "task.reject",
    entityType: "task", entityId: taskId,
    meta: { phaseId, note, approver: current?.approverUserId ?? null, requester, proxyBy: isProxy ? actor : undefined },
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

function normalizeTailoringTargets(targets: TailoringTarget[]): TailoringTarget[] {
  const seen = new Set<string>();
  const normalized: TailoringTarget[] = [];
  for (const target of targets) {
    const key = target.scope === "phase"
      ? `phase:${target.phaseId}`
      : `task:${target.phaseId}:${target.taskId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(target);
  }
  return normalized;
}

function resolveTailoringTargetTasks(
  category: string,
  targets: TailoringTarget[]
): Array<{ phaseId: string; taskId: string }> {
  const phases = getPhasesForCategory(category);
  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
  const tasks: Array<{ phaseId: string; taskId: string }> = [];
  const seen = new Set<string>();

  for (const target of normalizeTailoringTargets(targets)) {
    const phase = phaseById.get(target.phaseId);
    if (!phase) throw new Error(`裁剪阶段不存在: ${target.phaseId}`);
    if (target.scope === "phase") {
      for (const task of phase.tasks) {
        const key = `${phase.id}:${task.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tasks.push({ phaseId: phase.id, taskId: task.id });
      }
      continue;
    }
    const task = phase.tasks.find((item) => item.id === target.taskId);
    if (!task) throw new Error(`裁剪任务不存在: ${target.phaseId}/${target.taskId}`);
    const key = `${phase.id}:${task.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({ phaseId: phase.id, taskId: task.id });
  }

  return tasks;
}

function assertNoReleaseGateTailoring(category: string, targets: TailoringTarget[]): void {
  const phases = getPhasesForCategory(category);
  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
  for (const target of normalizeTailoringTargets(targets)) {
    const phase = phaseById.get(target.phaseId);
    if (!phase) continue;
    if (target.scope === "phase" && phase.isReleaseGate) {
      throw new Error("MP Release 阶段不可裁剪");
    }
    if (target.scope === "task" && phase.isReleaseGate && target.taskId === phase.gateTaskId) {
      throw new Error("MP Release Gate 任务不可裁剪");
    }
  }
}

export async function listProjectTailoring(projectId: string): Promise<ProjectTailoring[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectTailoring)
    .where(eq(projectTailoring.projectId, projectId))
    .orderBy(desc(projectTailoring.proposedAt));
}

export async function createProjectTailoringRequest(input: {
  projectId: string;
  reasonType: InsertProjectTailoring["reasonType"];
  reasonNote?: string;
  targets: TailoringTarget[];
  proposedBy: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("项目不存在");
  const targets = normalizeTailoringTargets(input.targets);
  if (targets.length === 0) throw new Error("请至少选择一个裁剪对象");
  assertNoReleaseGateTailoring(project.category, targets);

  const resolvedTasks = resolveTailoringTargetTasks(project.category, targets);
  const taskRows = await getProjectTasks(input.projectId);
  const taskByKey = new Map(taskRows.map((task) => [`${task.phaseId}:${task.taskId}`, task]));
  for (const task of resolvedTasks) {
    const row = taskByKey.get(`${task.phaseId}:${task.taskId}`);
    if (row?.status === "done" || row?.completed) {
      throw new Error("已完成的阶段/任务不能申请裁剪");
    }
  }

  const [row] = await db
    .insert(projectTailoring)
    .values({
      projectId: input.projectId,
      reasonType: input.reasonType,
      reasonNote: input.reasonNote ?? "",
      targets,
      proposedBy: input.proposedBy,
      status: "pending",
    })
    .returning({ id: projectTailoring.id });
  return row.id;
}

async function getProjectTailoringById(id: number): Promise<ProjectTailoring | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(projectTailoring).where(eq(projectTailoring.id, id)).limit(1);
  return rows[0];
}

async function applyTailoringTargets(
  projectId: string,
  category: string,
  targets: TailoringTarget[],
  updatedBy: number
): Promise<void> {
  const tasks = resolveTailoringTargetTasks(category, targets);
  for (const task of tasks) {
    const rows = await getProjectTasks(projectId, task.phaseId);
    const existing = rows.find((row) => row.taskId === task.taskId);
    if (existing?.status === "done") continue;
    await updateTaskMeta(projectId, task.phaseId, task.taskId, {
      status: "skipped",
      updatedBy,
    });
  }
}

function taskCoveredByTailoring(
  task: { phaseId: string; taskId: string },
  sets: { tailoredPhaseIds: Set<string>; tailoredTaskIds: Set<string> }
): boolean {
  return (
    sets.tailoredPhaseIds.has(task.phaseId) ||
    sets.tailoredTaskIds.has(task.taskId) ||
    sets.tailoredTaskIds.has(`${task.phaseId}:${task.taskId}`)
  );
}

export async function getApprovedTailoringSets(projectId: string): Promise<{
  tailoredPhaseIds: Set<string>;
  tailoredTaskIds: Set<string>;
}> {
  const db = await getDb();
  const tailoredPhaseIds = new Set<string>();
  const tailoredTaskIds = new Set<string>();
  if (!db) return { tailoredPhaseIds, tailoredTaskIds };

  const rows = await db
    .select({ targets: projectTailoring.targets })
    .from(projectTailoring)
    .where(and(eq(projectTailoring.projectId, projectId), eq(projectTailoring.status, "approved")));

  for (const row of rows) {
    for (const target of row.targets ?? []) {
      if (target.scope === "phase") tailoredPhaseIds.add(target.phaseId);
      else {
        tailoredTaskIds.add(target.taskId);
        tailoredTaskIds.add(`${target.phaseId}:${target.taskId}`);
      }
    }
  }

  return { tailoredPhaseIds, tailoredTaskIds };
}

export async function reviewProjectTailoring(input: {
  id: number;
  decision: "approved" | "rejected";
  reviewedBy: number;
  reviewNote?: string | null;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tailoring = await getProjectTailoringById(input.id);
  if (!tailoring) throw new Error("裁剪申请不存在");
  if (tailoring.status !== "pending") throw new Error("只有待审批申请可处理");
  const project = await getProjectById(tailoring.projectId);
  if (!project) throw new Error("项目不存在");

  if (input.decision === "approved") {
    assertNoReleaseGateTailoring(project.category, tailoring.targets ?? []);
    await applyTailoringTargets(tailoring.projectId, project.category, tailoring.targets ?? [], input.reviewedBy);
  }

  await db
    .update(projectTailoring)
    .set({
      status: input.decision,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
      reviewNote: input.reviewNote ?? null,
    })
    .where(eq(projectTailoring.id, input.id));
  return tailoring.projectId;
}

export async function revokeProjectTailoring(input: {
  id: number;
  reviewedBy: number;
  reviewNote?: string | null;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tailoring = await getProjectTailoringById(input.id);
  if (!tailoring) throw new Error("裁剪申请不存在");
  if (tailoring.status !== "approved") throw new Error("只有已通过裁剪可撤销");
  const project = await getProjectById(tailoring.projectId);
  if (!project) throw new Error("项目不存在");

  await db
    .update(projectTailoring)
    .set({
      status: "revoked",
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
      reviewNote: input.reviewNote ?? null,
    })
    .where(eq(projectTailoring.id, input.id));

  const remainingSets = await getApprovedTailoringSets(tailoring.projectId);
  const tasks = resolveTailoringTargetTasks(project.category, tailoring.targets ?? []);
  for (const task of tasks) {
    if (taskCoveredByTailoring(task, remainingSets)) continue;
    const rows = await getProjectTasks(tailoring.projectId, task.phaseId);
    const row = rows.find((item) => item.taskId === task.taskId);
    if (row?.status !== "skipped") continue;
    await updateTaskMeta(tailoring.projectId, task.phaseId, task.taskId, {
      status: "todo",
      updatedBy: input.reviewedBy,
    });
  }
  return tailoring.projectId;
}

export async function listDeliverableOverrides(projectId: string): Promise<ProjectDeliverableOverride[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectDeliverableOverrides)
    .where(eq(projectDeliverableOverrides.projectId, projectId))
    .orderBy(projectDeliverableOverrides.nodePhaseId, projectDeliverableOverrides.deliverableName);
}

export async function setDeliverableOverride(input: {
  projectId: string;
  nodePhaseId: string;
  deliverableName: string;
  action: "add" | "remove" | "clear";
  createdBy: number;
  reason?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("项目不存在");
  const phases = getPhasesForCategory(project.category);
  if (!phases.some((phase) => phase.id === input.nodePhaseId)) {
    throw new Error("交付物提交节点不存在");
  }

  if (input.action !== "clear") {
    const library = getDeliverableLibrary(project.category);
    if (!library.includes(input.deliverableName)) {
      throw new Error("交付物不在当前品类资源库中");
    }
  }

  const whereClause = and(
    eq(projectDeliverableOverrides.projectId, input.projectId),
    eq(projectDeliverableOverrides.nodePhaseId, input.nodePhaseId),
    eq(projectDeliverableOverrides.deliverableName, input.deliverableName)
  );

  if (input.action === "clear") {
    await db.delete(projectDeliverableOverrides).where(whereClause);
    return;
  }

  const existing = await db
    .select({ id: projectDeliverableOverrides.id })
    .from(projectDeliverableOverrides)
    .where(whereClause)
    .limit(1);

  if (existing[0]) {
    await db
      .update(projectDeliverableOverrides)
      .set({ action: input.action, ...(input.reason !== undefined ? { reason: input.reason } : {}) })
      .where(eq(projectDeliverableOverrides.id, existing[0].id));
    return;
  }

  await db.insert(projectDeliverableOverrides).values({
    projectId: input.projectId,
    nodePhaseId: input.nodePhaseId,
    deliverableName: input.deliverableName,
    action: input.action,
    reason: input.reason ?? null,
    createdBy: input.createdBy,
  });
}

/**
 * 存量 grandfather：把已过会 Gate 上本次新增的必备交付物，写成一次性豁免
 * （remove override + reason）。幂等：已存在同键 override 则跳过（不覆盖用户已有裁剪）。
 * 返回实际新增的豁免条数。SYSTEM_ACTOR 作为 createdBy 记录来源。
 */
export async function applyGrandfatherExemptions(
  exemptions: { projectId: string; nodePhaseId: string; deliverableName: string }[],
  reason: string,
  createdBy = 0,
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let inserted = 0;
  for (const ex of exemptions) {
    const res = await db
      .insert(projectDeliverableOverrides)
      .values({
        projectId: ex.projectId,
        nodePhaseId: ex.nodePhaseId,
        deliverableName: ex.deliverableName,
        action: "remove",
        reason,
        createdBy,
      })
      .onConflictDoNothing({
        target: [
          projectDeliverableOverrides.projectId,
          projectDeliverableOverrides.nodePhaseId,
          projectDeliverableOverrides.deliverableName,
        ],
      })
      .returning({ id: projectDeliverableOverrides.id });
    inserted += res.length;
  }
  return inserted;
}

export async function getProjectEffectiveProcess(projectId: string): Promise<EffectiveProcess | null> {
  const project = await getProjectById(projectId);
  if (!project) return null;
  const sets = await getApprovedTailoringSets(projectId);
  const overrides = await listDeliverableOverrides(projectId);
  return getEffectiveProcess(
    project.category,
    sets.tailoredPhaseIds,
    sets.tailoredTaskIds,
    overrides.map((override) => ({
      nodePhaseId: override.nodePhaseId,
      deliverableName: override.deliverableName,
      action: override.action,
    }))
  );
}

/**
 * 按角色把未分配的任务自动指派给对应项目成员（responsible role 取自任务 visibleRoles 首个非管理角色）。
 * 不覆盖已手动分配的任务。返回新建的分配明细，供上层发钉钉通知。
 * roleOverrides:显式角色分工(立项向导),优先于成员表推导——成员表一人一角色,
 * 表达不了创建者兼任/一人多角色,向导里填了什么就按什么派。
 */
export async function assignTasksByRole(
  projectId: string,
  updatedBy: number,
  roleOverrides?: Record<string, number>
): Promise<Array<{ userId: number; taskId: string; phaseId: string; dueDate: string | null; instructions: string | null }>> {
  const db = await getDb();
  if (!db) return [];
  const members = await getProjectMembers(projectId);
  const roleToUser = new Map<string, number>();
  for (const m of members) if (!roleToUser.has(m.role)) roleToUser.set(m.role, m.userId);
  if (roleOverrides) for (const [role, userId] of Object.entries(roleOverrides)) roleToUser.set(role, userId);
  const tasks = await getProjectTasks(projectId);
  const out: Array<{ userId: number; taskId: string; phaseId: string; dueDate: string | null; instructions: string | null }> = [];
  for (const t of tasks) {
    if (t.assigneeUserId) continue; // 不覆盖已分配
    const roles = (t.visibleRoles as string[] | null) ?? [];
    // 责任角色 = visibleRoles 首个非管理角色;Gate/无角色任务优先归项目经理/PMO。
    const primary = roles.find((r) => !["project_manager", "manager", "owner"].includes(r))
      ?? (roleToUser.has("project_manager") ? "project_manager" : "pm");
    // 只分给该角色对应成员;该角色没配人则留空(让缺口可见),不强塞给 PM。
    const userId = roleToUser.get(primary);
    if (!userId) continue;
    await db.update(projectTasks).set({ assigneeUserId: userId, updatedBy }).where(eq(projectTasks.id, t.id));
    out.push({ userId, taskId: t.taskId, phaseId: t.phaseId, dueDate: t.dueDate ?? null, instructions: t.instructions ?? null });
  }
  if (out.length > 0) await refreshProjectTaskStatuses(projectId);
  return out;
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
      statusChangedAt: projectTasks.statusChangedAt,
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
  const today = todayInShanghaiISO();
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
      statusChangedAt: projectTasks.statusChangedAt,
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
      statusChangedAt: projectTasks.statusChangedAt,
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

/**
 * Return active tasks that cannot find their owner yet.
 * These are not action items themselves; the scheduler asks the PM/owner to assign them.
 */
export async function getUnassignedActiveTasks(projectIds?: string[]): Promise<TaskWithContext[]> {
  const db = await getDb();
  if (!db) return [];
  if (projectIds && projectIds.length === 0) return [];
  const baseConditions = [
    eq(projects.archived, false),
    isNull(projectTasks.assigneeUserId),
    drizzleSql`${projectTasks.status} NOT IN ('done','skipped','pending_approval')`,
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
      statusChangedAt: projectTasks.statusChangedAt,
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
      drizzleSql`${projectTasks.dueDate} IS NULL`,
      projectTasks.dueDate,
      projectTasks.projectId
    );
  return rows as TaskWithContext[];
}

// ── 个人每日摘要：状态扫描型聚合输入 ────────────────────────────────────────

export const PERSONAL_DAILY_DIGEST_ITEM_KINDS = [
  "task_overdue",
  "task_due_soon",
  "task_blocked",
  "deliverable_review",
  "issue_critical",
  "issue_overdue",
  "issue_due_soon",
] as const;
export type PersonalDailyDigestItemKind = (typeof PERSONAL_DAILY_DIGEST_ITEM_KINDS)[number];

export type PersonalDailyDigestItem = {
  recipientUserId: number;
  kind: PersonalDailyDigestItemKind;
  projectId: string;
  projectName: string;
  projectNumber: string;
  projectCategory: string;
  phaseId: string | null;
  entityType: "task" | "issue" | "deliverable_review";
  entityId: string;
  title: string;
  dueDate: string | null;
  status: string | null;
  severity: string | null;
};

export async function getPersonalDailyDigestItems(input: {
  todayISO: string;
  dueSoonDays: number;
  includePendingReviews?: boolean;
  includeProjectExceptions?: boolean;
}): Promise<PersonalDailyDigestItem[]> {
  const db = await getDb();
  if (!db) return [];
  const soonISO = addDaysISO(input.todayISO, input.dueSoonDays);
  const items: PersonalDailyDigestItem[] = [];

  const taskRows = await db
    .select({
      recipientUserId: projectTasks.assigneeUserId,
      projectId: projectTasks.projectId,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
      projectCategory: projects.category,
      phaseId: projectTasks.phaseId,
      taskId: projectTasks.taskId,
      dueDate: projectTasks.dueDate,
      status: projectTasks.status,
      priority: projectTasks.priority,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projectTasks.projectId, projects.id))
    .where(and(
      eq(projects.archived, false),
      drizzleSql`${projectTasks.assigneeUserId} IS NOT NULL`,
      drizzleSql`${projectTasks.dueDate} IS NOT NULL`,
      drizzleSql`${projectTasks.dueDate} <= ${soonISO}`,
      drizzleSql`${projectTasks.status} NOT IN ('done','skipped','blocked')`,
    ));

  for (const row of taskRows) {
    if (!row.recipientUserId) continue;
    items.push({
      recipientUserId: row.recipientUserId,
      kind: row.dueDate && row.dueDate < input.todayISO ? "task_overdue" : "task_due_soon",
      projectId: row.projectId,
      projectName: row.projectName,
      projectNumber: row.projectNumber,
      projectCategory: row.projectCategory,
      phaseId: row.phaseId,
      entityType: "task",
      entityId: `${row.projectId}:${row.phaseId}:${row.taskId}`,
      title: row.taskId,
      dueDate: row.dueDate,
      status: row.status,
      severity: row.priority,
    });
  }

  const blockedRows = await db
    .select({
      recipientUserId: projectTasks.assigneeUserId,
      projectId: projectTasks.projectId,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
      projectCategory: projects.category,
      phaseId: projectTasks.phaseId,
      taskId: projectTasks.taskId,
      dueDate: projectTasks.dueDate,
      status: projectTasks.status,
      priority: projectTasks.priority,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projectTasks.projectId, projects.id))
    .where(and(
      eq(projects.archived, false),
      eq(projectTasks.status, "blocked"),
      drizzleSql`${projectTasks.assigneeUserId} IS NOT NULL`,
    ));

  for (const row of blockedRows) {
    if (!row.recipientUserId) continue;
    items.push({
      recipientUserId: row.recipientUserId,
      kind: "task_blocked",
      projectId: row.projectId,
      projectName: row.projectName,
      projectNumber: row.projectNumber,
      projectCategory: row.projectCategory,
      phaseId: row.phaseId,
      entityType: "task",
      entityId: `${row.projectId}:${row.phaseId}:${row.taskId}`,
      title: row.taskId,
      dueDate: row.dueDate,
      status: row.status,
      severity: row.priority,
    });
  }

  if (input.includePendingReviews !== false) {
    const reviewRows = await db
      .select({
        recipientUserId: projectDeliverableReviews.reviewerUserId,
        projectId: projectDeliverableReviews.projectId,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        projectCategory: projects.category,
        phaseId: projectDeliverableReviews.phaseId,
        id: projectDeliverableReviews.id,
        deliverableName: projectDeliverableReviews.deliverableName,
        status: projectDeliverableReviews.status,
      })
      .from(projectDeliverableReviews)
      .innerJoin(projects, eq(projectDeliverableReviews.projectId, projects.id))
      .where(and(
        eq(projects.archived, false),
        eq(projectDeliverableReviews.status, "pending"),
      ));

    for (const row of reviewRows) {
      items.push({
        recipientUserId: row.recipientUserId,
        kind: "deliverable_review",
        projectId: row.projectId,
        projectName: row.projectName,
        projectNumber: row.projectNumber,
        projectCategory: row.projectCategory,
        phaseId: row.phaseId,
        entityType: "deliverable_review",
        entityId: `${row.id}:pending`,
        title: row.deliverableName,
        dueDate: null,
        status: row.status,
        severity: null,
      });
    }
  }

  if (input.includeProjectExceptions !== false) {
    const issueRows = await db
      .select({
        recipientUserId: projects.pmUserId,
        projectId: projectIssues.projectId,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        projectCategory: projects.category,
        phaseId: projectIssues.phaseId,
        id: projectIssues.id,
        title: projectIssues.title,
        targetDate: projectIssues.targetDate,
        status: projectIssues.status,
        severity: projectIssues.severity,
      })
      .from(projectIssues)
      .innerJoin(projects, eq(projectIssues.projectId, projects.id))
      .where(and(
        eq(projects.archived, false),
        drizzleSql`${projects.pmUserId} IS NOT NULL`,
        drizzleSql`${projectIssues.status} NOT IN ('resolved','closed','wont_fix')`,
        or(
          inArray(projectIssues.severity, ["P0", "P1"] as const),
          and(
            drizzleSql`${projectIssues.targetDate} IS NOT NULL`,
            drizzleSql`${projectIssues.targetDate} <> ''`,
            drizzleSql`${projectIssues.targetDate} <= ${soonISO}`,
          ),
        ),
      ));

    for (const row of issueRows) {
      if (!row.recipientUserId) continue;
      const isCritical = row.severity === "P0" || row.severity === "P1";
      items.push({
        recipientUserId: row.recipientUserId,
        kind: isCritical
          ? "issue_critical"
          : row.targetDate && row.targetDate < input.todayISO
            ? "issue_overdue"
            : "issue_due_soon",
        projectId: row.projectId,
        projectName: row.projectName,
        projectNumber: row.projectNumber,
        projectCategory: row.projectCategory,
        phaseId: row.phaseId,
        entityType: "issue",
        entityId: String(row.id),
        title: row.title,
        dueDate: row.targetDate || null,
        status: row.status,
        severity: row.severity,
      });
    }
  }

  const rank: Record<PersonalDailyDigestItemKind, number> = {
    issue_critical: 0,
    task_blocked: 1,
    task_overdue: 2,
    issue_overdue: 3,
    deliverable_review: 4,
    task_due_soon: 5,
    issue_due_soon: 6,
  };
  return items.sort((a, b) =>
    rank[a.kind] - rank[b.kind] ||
    (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99") ||
    a.projectName.localeCompare(b.projectName)
  );
}

function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ── Test helpers (not used in production code) ────────────────────────────────
/**
 * Force-delete a project and ALL its child records, including release artifacts.
 * Only for use in tests.
 */
export async function hardDeleteProjectForTest(projectId: string): Promise<void> {
  await deleteProjectRows(projectId, { allowReleased: true });
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

type ProductDefinitionPatch = Partial<Omit<
  InsertProductDefinition,
  "id" | "productId" | "createdBy" | "createdAt" | "updatedAt" | "status" | "confirmedBy" | "confirmedAt"
>>;

function withoutUndefined<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

export async function getProductDefinitionByProductId(productId: string): Promise<ProductDefinition | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(productDefinitions).where(eq(productDefinitions.productId, productId)).limit(1);
  return rows[0];
}

export async function listProductDefinitionStatuses(): Promise<Array<{
  productId: string;
  status: ProductDefinition["status"];
  confirmedAt: Date | null;
}>> {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    productId: productDefinitions.productId,
    status: productDefinitions.status,
    confirmedAt: productDefinitions.confirmedAt,
  }).from(productDefinitions);
}

function toProductDefinitionSnapshotPayload(definition: ProductDefinition): ProductDefinitionSnapshotPayload {
  return {
    title: definition.title,
    opportunityName: definition.opportunityName,
    opportunitySource: definition.opportunitySource,
    targetCustomers: definition.targetCustomers,
    targetMarkets: definition.targetMarkets,
    applicationScenarios: definition.applicationScenarios,
    competitors: definition.competitors,
    priceBand: definition.priceBand,
    positioning: definition.positioning,
    sellingPoints: definition.sellingPoints,
    differentiationStrategy: definition.differentiationStrategy,
    prdSummary: definition.prdSummary,
    specs: definition.specs,
    targetCost: definition.targetCost,
    targetPrice: definition.targetPrice,
    targetGrossMargin: definition.targetGrossMargin,
    skuPlan: definition.skuPlan,
  };
}

export async function listProductDefinitionSnapshots(productId: string): Promise<ProductDefinitionSnapshot[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(productDefinitionSnapshots)
    .where(eq(productDefinitionSnapshots.productId, productId))
    .orderBy(desc(productDefinitionSnapshots.versionNumber));
}

export async function getLatestProductDefinitionSnapshot(productId: string): Promise<ProductDefinitionSnapshot | undefined> {
  const snapshots = await listProductDefinitionSnapshots(productId);
  return snapshots[0];
}

export async function getProductDefinitionSnapshotById(id: number): Promise<ProductDefinitionSnapshot | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(productDefinitionSnapshots).where(eq(productDefinitionSnapshots.id, id)).limit(1);
  return rows[0];
}

async function createProductDefinitionSnapshot(definition: ProductDefinition, actorId: number): Promise<ProductDefinitionSnapshot> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const latest = await db.select({ versionNumber: productDefinitionSnapshots.versionNumber })
    .from(productDefinitionSnapshots)
    .where(eq(productDefinitionSnapshots.productId, definition.productId))
    .orderBy(desc(productDefinitionSnapshots.versionNumber))
    .limit(1);
  const confirmedAt = definition.confirmedAt ?? new Date();
  const rows = await db.insert(productDefinitionSnapshots)
    .values({
      productId: definition.productId,
      definitionId: definition.id,
      versionNumber: (latest[0]?.versionNumber ?? 0) + 1,
      title: definition.title,
      snapshot: toProductDefinitionSnapshotPayload(definition),
      confirmedBy: actorId,
      confirmedAt,
    })
    .returning();
  return rows[0];
}

export async function upsertProductDefinition(
  productId: string,
  actorId: number,
  patch: ProductDefinitionPatch,
): Promise<ProductDefinition> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getProductDefinitionByProductId(productId);
  const clean = withoutUndefined(patch);
  if (existing) {
    const rows = await db.update(productDefinitions)
      .set({
        ...clean,
        status: "draft",
        confirmedBy: null,
        confirmedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(productDefinitions.productId, productId))
      .returning();
    return rows[0];
  }
  const rows = await db.insert(productDefinitions)
    .values({ productId, createdBy: actorId, ...clean })
    .returning();
  return rows[0];
}

export async function confirmProductDefinition(productId: string, actorId: number): Promise<ProductDefinition> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getProductDefinitionByProductId(productId);
  if (!existing) throw new Error("产品定义不存在");
  if (existing.status === "confirmed") {
    const snapshots = await listProductDefinitionSnapshots(productId);
    if (snapshots.length === 0) {
      await createProductDefinitionSnapshot(existing, actorId);
    }
    return existing;
  }
  const rows = await db.update(productDefinitions)
    .set({
      status: "confirmed",
      confirmedBy: actorId,
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(productDefinitions.productId, productId))
    .returning();
  await createProductDefinitionSnapshot(rows[0], actorId);
  return rows[0];
}

type ProductDefinitionChangePatch = Partial<Omit<
  InsertProductDefinitionChange,
  "id" | "productId" | "createdBy" | "createdAt" | "updatedAt" | "approvedBy" | "approvedAt"
>>;

export async function listProductDefinitionChanges(productId: string): Promise<ProductDefinitionChange[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(productDefinitionChanges)
    .where(eq(productDefinitionChanges.productId, productId))
    .orderBy(desc(productDefinitionChanges.createdAt));
}

export async function getProductDefinitionChangeById(id: number): Promise<ProductDefinitionChange | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(productDefinitionChanges).where(eq(productDefinitionChanges.id, id)).limit(1);
  return rows[0];
}

export async function createProductDefinitionChange(
  record: Omit<InsertProductDefinitionChange, "id" | "createdAt" | "updatedAt" | "approvedBy" | "approvedAt">
): Promise<ProductDefinitionChange> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.insert(productDefinitionChanges).values(record).returning();
  return rows[0];
}

export async function updateProductDefinitionChange(
  id: number,
  actorId: number,
  patch: ProductDefinitionChangePatch,
): Promise<ProductDefinitionChange | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getProductDefinitionChangeById(id);
  if (!existing) return undefined;
  const clean = withoutUndefined(patch);
  const shouldStampApproval = clean.status === "approved" && existing.status !== "approved";
  const shouldClearApproval = clean.status && clean.status !== "approved";
  const rows = await db.update(productDefinitionChanges)
    .set({
      ...clean,
      approvedBy: shouldStampApproval ? actorId : shouldClearApproval ? null : existing.approvedBy,
      approvedAt: shouldStampApproval ? new Date() : shouldClearApproval ? null : existing.approvedAt,
      updatedAt: new Date(),
    })
    .where(eq(productDefinitionChanges.id, id))
    .returning();
  return rows[0];
}

export type ProductDefinitionDeviationReport = {
  baselineStatus: ProductDefinition["status"] | "missing";
  confirmedAt: Date | null;
  deviated: boolean;
  approvedDeviationCount: number;
  pendingChangeCount: number;
  items: ProductDefinitionChange[];
};

export async function getProductDefinitionDeviation(productId: string): Promise<ProductDefinitionDeviationReport> {
  const definition = await getProductDefinitionByProductId(productId);
  const changes = await listProductDefinitionChanges(productId);
  const approvedItems = changes.filter((change) => change.status === "approved" || change.status === "implemented");
  const pendingItems = changes.filter((change) => change.status === "proposed");
  return {
    baselineStatus: definition?.status ?? "missing",
    confirmedAt: definition?.confirmedAt ?? null,
    deviated: definition?.status === "confirmed" && approvedItems.length > 0,
    approvedDeviationCount: approvedItems.length,
    pendingChangeCount: pendingItems.length,
    items: approvedItems,
  };
}

export async function createProductRevision(r: InsertProductRevision): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const res = await db.insert(productRevisions).values(r).returning({ id: productRevisions.id });
  return res[0].id;
}

export async function listProductRevisions(productId: string): Promise<Array<ProductRevision & { snapshotChangelog: RevisionChangeEntry[] }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    rev: productRevisions,
    snapshotChangelog: mpReleases.snapshotChangelog,
  })
    .from(productRevisions)
    .leftJoin(mpReleases, eq(mpReleases.revisionId, productRevisions.id))
    .where(eq(productRevisions.productId, productId))
    .orderBy(productRevisions.id);
  return rows.map((r) => ({
    ...r.rev,
    snapshotChangelog: ((r.snapshotChangelog as RevisionChangeEntry[] | null) ?? []),
  }));
}

// ── OEM 客户版本（Customer Revision，PLM 侧登记，不开项目） ───────────────────

export async function createCustomerVariant(v: InsertCustomerVariant): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const res = await db.insert(customerVariants).values(v).returning({ id: customerVariants.id });
  return res[0].id;
}

/** 某客户名下的全部客户版本（对账 / 改版 / 召回） */
export async function listVariantsByCustomer(customerId: string): Promise<CustomerVariant[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerVariants)
    .where(eq(customerVariants.customerId, customerId))
    .orderBy(desc(customerVariants.updatedAt));
}

/** 某产品型号下的全部客户版本 */
export async function listVariantsByParentProduct(parentProductId: string): Promise<CustomerVariant[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerVariants)
    .where(eq(customerVariants.parentProductId, parentProductId))
    .orderBy(customerVariants.variantCode);
}

/**
 * 某产品型号的下游引用 SKU 影响清单。供自有 ECO Gate：主版本 / BOM Revision 一改即列出受影响客户版本，
 * 并标出认证/物料波及。纯计算复用 shared/oem-variant.computeDownstreamImpact。
 */
export async function getDownstreamVariantImpact(
  parentProductId: string,
  opts?: { onlyActive?: boolean; changedBomLines?: string[] },
): Promise<DownstreamImpactRow[]> {
  const rows = await listVariantsByParentProduct(parentProductId);
  return computeDownstreamImpact(
    rows.map((v) => ({
      variantCode: v.variantCode,
      customerSku: v.customerSku,
      customerName: v.customerName,
      status: v.status as VariantStatus,
      deltas: v.deltas ?? [],
      certReuseParent: v.certReuseParent,
      certAffectedMarks: v.certAffectedMarks,
    })),
    opts,
  );
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

/** 取最新 Gate 记录：roundNumber 最大；并列取 createdAt 最新；再并列取 id 最大。 */
function pickLatestReview(reviews: ProjectGateReview[]): ProjectGateReview | null {
  if (reviews.length === 0) return null;
  return reviews.reduce((best, r) => {
    if (r.roundNumber !== best.roundNumber) return r.roundNumber > best.roundNumber ? r : best;
    if (r.createdAt.getTime() !== best.createdAt.getTime()) return r.createdAt > best.createdAt ? r : best;
    return r.id > best.id ? r : best;
  });
}

export interface ReleaseGateStatus {
  phaseId: string | null;
  gateName: string;
  ready: boolean;
  decision: GateDecision | null;
  conditions: string | null;
  roundNumber: number;
  deliverables: { done: number; total: number; missing: string[] };
  dimensions: GateReadiness["dimensions"];
}

/** 计算某项目「MP Release 前置 Gate」的最新决议与 Gate Readiness。 */
export async function getReleaseGateStatus(project: ProjectRow): Promise<ReleaseGateStatus> {
  const phase = getReleaseGatePhase(project.category);
  if (!phase) {
    return {
      phaseId: null,
      gateName: "",
      ready: false,
      decision: null,
      conditions: null,
      roundNumber: 0,
      deliverables: { done: 0, total: 0, missing: [] },
      dimensions: [],
    };
  }
  const [reviews, effective, readiness] = await Promise.all([
    getProjectGateReviews(project.id, phase.id),
    getProjectEffectiveProcess(project.id),
    getGateReadiness(project.id, phase.id),
  ]);
  const latest = pickLatestReview(reviews);
  const effectivePhase = effective?.phases.find((item) => item.id === phase.id);
  const expectedDeliverables = effectivePhase?.submittedDeliverables ?? Array.from(
    new Set([...(phase.deliverables ?? []), ...(phase.gateStandard?.requiredDeliverables ?? [])])
  );
  const deliverableDim = readiness?.dimensions.find((d) => d.dimension === "deliverables");
  const missing = deliverableDim?.blockers ?? [];
  const total = deliverableDim ? expectedDeliverables.length : 0;
  const done = Math.max(0, total - missing.length);
  return {
    phaseId: phase.id,
    gateName: latest?.gateName || phase.gate,
    ready: readiness?.ready ?? false,
    decision: latest?.decision ?? null,
    conditions: latest?.conditions ?? null,
    roundNumber: latest?.roundNumber ?? 0,
    deliverables: { done, total, missing },
    dimensions: readiness?.dimensions ?? [],
  };
}

/** 阶段级未闭环 P0/P1（resolved 仍需报告人/QA 验证，closed/wont_fix 才放行）。 */
export async function getPhaseOpenP0P1(projectId: string, phaseId: string): Promise<{ count: number; titles: string[] }> {
  const db = await getDb();
  if (!db) return { count: 0, titles: [] };
  const rows = await db.select({ title: projectIssues.title })
    .from(projectIssues)
    .where(and(
      eq(projectIssues.projectId, projectId),
      eq(projectIssues.phaseId, phaseId),
      inArray(projectIssues.severity, ["P0", "P1"] as const),
      inArray(projectIssues.status, ["open", "in_progress", "resolved"] as const),
    ));
  return { count: rows.length, titles: rows.map((r) => r.title) };
}

/** 跨活跃项目，gate 任务有 dueDate 且未完成（供就绪度推送扫描；与 getAutomationGatePrereqs 并存）。 */
export async function getApproachingGates(): Promise<Array<{
  projectId: string; phaseId: string; gateTaskId: string; gateName: string; dueDate: string; status: string;
}>> {
  const db = await getDb();
  if (!db) return [];
  const projs = await db.select({ id: projects.id, category: projects.category }).from(projects).where(eq(projects.archived, false));
  if (projs.length === 0) return [];
  const projectIds = projs.map((p) => p.id);
  const allTasks = await db.select({ projectId: projectTasks.projectId, taskId: projectTasks.taskId, status: projectTasks.status, dueDate: projectTasks.dueDate, completed: projectTasks.completed })
    .from(projectTasks).where(inArray(projectTasks.projectId, projectIds));
  const tasksByProject = new Map<string, typeof allTasks>();
  for (const task of allTasks) {
    const list = tasksByProject.get(task.projectId) ?? [];
    list.push(task);
    tasksByProject.set(task.projectId, list);
  }
  const out: Array<{ projectId: string; phaseId: string; gateTaskId: string; gateName: string; dueDate: string; status: string }> = [];
  for (const p of projs) {
    const phases = getPhasesForCategory(p.category);
    const rows = tasksByProject.get(p.id) ?? [];
    const byTask = new Map(rows.map((r) => [r.taskId, r]));
    for (const phase of phases) {
      const gate = byTask.get(phase.gateTaskId);
      if (!gate?.dueDate) continue;
      const done = gate.status === "done" || gate.status === "skipped" || !!gate.completed;
      if (done) continue;
      out.push({ projectId: p.id, phaseId: phase.id, gateTaskId: phase.gateTaskId, gateName: phase.gate, dueDate: gate.dueDate, status: gate.status });
    }
  }
  return out;
}

/** 计算某项目某 phase 的 Gate 就绪度。phase 不存在→null。 */
export async function getGateReadiness(projectId: string, phaseId: string): Promise<GateReadiness | null> {
  const db = await getDb();
  if (!db) return null;
  const [project, effective] = await Promise.all([
    getProjectById(projectId),
    getProjectEffectiveProcess(projectId),
  ]);
  if (!project) return null;
  const phase = getPhasesForCategory(project.category).find((p) => p.id === phaseId);
  if (!phase) return null;

  // 裁剪集成：被裁阶段的 Gate 视为 N/A（不阻塞）；非裁剪阶段的应交付物用"有效提交集"（含归集+override）。
  const effPhase = effective?.phases.find((p) => p.id === phaseId);
  if (effPhase?.tailored) {
    return { phaseId, gateName: phase.gate, ready: true, dimensions: [], blockerCount: 0 };
  }

  const required = effPhase?.submittedDeliverables ?? phase.gateStandard.requiredDeliverables;
  // 8 组只读查询彼此独立，并行拉取（此前串行 10 次往返是 portfolio N+1 的主放大器）
  const [tasks, uploadedSet, critical, testReports, npiReadiness, sampleSignoffs, gateBlockers, reviews] = await Promise.all([
    getProjectTasks(projectId, phaseId),
    loadDeliverableReviewService().then(({ getReviewSatisfiedSet }) => getReviewSatisfiedSet(projectId, phaseId, required)),
    getPhaseOpenP0P1(projectId, phaseId),
    getPhaseTestReadiness(projectId, phaseId, phaseId.toUpperCase()),
    getPhaseNpiReadiness(projectId, phaseId, phaseId.toUpperCase()),
    getPhaseSampleSignoffReadiness(projectId, phaseId, phaseId.toUpperCase()),
    getProjectGateBlockers(projectId, phaseId),
    getProjectGateReviews(projectId, phaseId),
  ]);

  const byTask = new Map(tasks.map((t) => [t.taskId, t]));
  const isDone = (id: string) => {
    const t = byTask.get(id);
    return t ? (t.status === "done" || t.status === "skipped" || !!t.completed) : false;
  };
  const incompleteTaskIds = phase.tasks
    .filter((t) => t.id !== phase.gateTaskId)
    .filter((t) => !(effective?.isTaskTailored(phaseId, t.id) ?? false))
    .filter((t) => !isDone(t.id))
    .map((t) => t.id);

  const uploaded = Array.from(uploadedSet);
  const openGateBlockerTitles = gateBlockers
    .filter((blocker) => blocker.status === "open")
    .map((blocker) => `${blocker.blockerType === "quality" ? "QA" : "PE/NPI"}: ${blocker.title}`);
  const latest = pickLatestReview(reviews);

  return computeGateReadiness({
    phaseId, gateName: phase.gate,
    prereq: { incompleteTaskIds },
    deliverables: { required, uploaded },
    testReports,
    npiReadiness,
    sampleSignoffs,
    criticalIssues: { titles: critical.titles },
    roleBlocks: { titles: openGateBlockerTitles },
    latestReview: latest ? { decision: latest.decision as "approved" | "conditional" | "rejected", conditions: latest.conditions ?? null, notes: latest.notes ?? null } : null,
  });
}

/** Release override 专用授权（非全局权限矩阵）：创建人 / PM / 项目 owner|manager / 系统 admin。 */
export async function isReleaseOverrideAuthorized(
  project: ProjectRow,
  actor: { id: number; role: string },
): Promise<boolean> {
  if (isSystemAdminRole(actor.role)) return true;
  if (project.createdBy === actor.id) return true;
  if (project.pmUserId === actor.id) return true;
  const member = await getProjectMember(project.id, actor.id);
  return member?.role === "owner" || member?.role === "manager";
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
  projectId: string;
  actor: { id: number; role: string };
  notes?: string;
  override?: { overrideReason: string; followUpOwner: number; dueDate: string };
  externalApprovalInstanceId?: number | null;
}): Promise<{ revisionId: number; revisionLabel: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("项目不存在");
  const canReleaseActor = await isReleaseOverrideAuthorized(project, input.actor);
  if (!canReleaseActor) throw new Error("无权限量产发布（需项目创建人/PM/manager 或系统管理员）");

  // —— 绝对硬卡 1：已关联产品 ——
  if (!project.productId) throw new Error("项目未关联产品，无法发布");
  // —— 绝对硬卡 2：P0/P1 全关闭 ——
  const openCount = await getOpenP0P1Count(input.projectId);
  if (openCount > 0) throw new Error(`存在 ${openCount} 个未关闭的 P0/P1 问题，不能发布`);

  // —— 前置 Gate ——
  const gate = await getReleaseGateStatus(project);
  if (!gate.phaseId) throw new Error("未定义 MP Release 前置 Gate，无法发布");
  const failedHardDimensions = gate.dimensions.filter((d) => !d.ok && d.dimension !== "review_conditions");
  const deliverableBlock = failedHardDimensions.find((d) => d.dimension === "deliverables");
  // —— 绝对硬卡 3：交付物审核合格 ——
  if (deliverableBlock) {
    throw new Error(`前置 Gate 必备交付物未审核通过（${gate.deliverables.done}/${gate.deliverables.total}）`);
  }
  const otherHardBlocks = failedHardDimensions.filter((d) => d.dimension !== "deliverables");
  if (otherHardBlocks.length > 0) {
    throw new Error(`前置 Gate 未就绪：${otherHardBlocks.map((d) => d.summary).join("；")}`);
  }
  // —— 绝对硬卡 4：Gate 有记录且非 rejected ——
  if (gate.decision === null || gate.decision === "rejected") {
    throw new Error("前置 Gate 未通过（无评审记录或已驳回），不能发布");
  }

  // —— conditional 仅授权用户留痕强制 ——
  let overridden = false;
  if (gate.decision === "conditional") {
    if (!input.override) throw new Error("前置 Gate 为有条件通过，需 owner/PM/manager 填写理由强制发布");
    const ov = input.override;
    if (!ov.overrideReason?.trim() || !ov.followUpOwner || !ov.dueDate?.trim()) {
      throw new Error("强制发布需填写理由、跟进负责人与截止日期");
    }
    overridden = true;
  }

  const productId = project.productId;

  return db.transaction(async (tx) => {
    await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${`release:${input.projectId}`}))`);
    await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${`product:${productId}`}))`);
    const existingRelease = await tx.select({ id: mpReleases.id })
      .from(mpReleases)
      .where(eq(mpReleases.projectId, input.projectId))
      .limit(1);
    if (existingRelease.length > 0) throw new Error("项目已发布，不能重复发布");

    const existingRevisions = await tx.select({ id: productRevisions.id })
      .from(productRevisions)
      .where(eq(productRevisions.productId, productId));
    const label = `Rev ${String.fromCharCode(65 + existingRevisions.length)}`;

    const open = await tx.select().from(projectIssues)
      .where(and(eq(projectIssues.projectId, input.projectId),
        drizzleSql`${projectIssues.status} NOT IN ('resolved','closed','wont_fix')`));

    const [rev] = await tx.insert(productRevisions).values({
      productId, revisionLabel: label,
      parentRevisionId: project.baseRevisionId ?? null,
      createdByProjectId: input.projectId,
      status: "released", releasedAt: new Date(), releasedBy: input.actor.id,
    }).returning({ id: productRevisions.id });

    const frozenBom = await freezeBomToRevision(input.projectId, rev.id, tx);

    // 盖章：把本项目 implemented+approved 的变更并入新版本，并由返回行生成快照(集合天然一致)
    const stampedChanges = await tx.update(projectChangelog)
      .set({ revisionId: rev.id })
      .where(and(
        eq(projectChangelog.projectId, input.projectId),
        inArray(projectChangelog.status, [...REVISION_CHANGE_STATUSES]),
      ))
      .returning();
    const snapshotChangelog = buildRevisionChangelogSnapshot(stampedChanges as any);

    await tx.insert(mpReleases).values({
      productId, revisionId: rev.id, projectId: input.projectId,
      externalApprovalInstanceId: input.externalApprovalInstanceId ?? null,
      snapshotBom: frozenBom as unknown[],
      snapshotChangelog: snapshotChangelog as unknown[],
      openIssues: open as unknown[], notes: input.notes ?? null,
      releasedBy: input.actor.id,
      overridden,
      overrideReason: overridden ? input.override!.overrideReason : null,
      acceptedBy: overridden ? input.actor.id : null,
      acceptedAt: overridden ? new Date() : null,
      conditionsSnapshot: overridden ? gate.conditions : null,
      followUpOwner: overridden ? input.override!.followUpOwner : null,
      dueDate: overridden ? input.override!.dueDate : null,
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
export async function getBomLineById(id: number): Promise<BomItem | undefined> {
  const db = await getDb(); if (!db) return undefined;
  const [row] = await db.select().from(bomItems).where(eq(bomItems.id, id)).limit(1);
  return row;
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

/** 用户是否有权看某产品线的商业数据：管理员，或该产品下具备商业权限的项目角色。 */
export async function userCanSeeProductCommercials(userId: number, isAdmin: boolean, productId: string | null | undefined): Promise<boolean> {
  if (isAdmin) return true;
  if (!productId) return false;
  const db = await getDb();
  if (!db) return false;
  const commercialRoles: ProjectMemberRole[] = ["owner", "manager", "project_manager", "pm", "scm"];
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projects.productId, productId),
        or(
          eq(projects.createdBy, userId),
          eq(projects.pmUserId, userId),
          and(
            eq(projectMembers.userId, userId),
            inArray(projectMembers.role, commercialRoles),
          ),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** 某冻结版本所属的产品 id */
export async function getProductIdByRevisionId(revisionId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ productId: productRevisions.productId })
    .from(productRevisions)
    .where(eq(productRevisions.id, revisionId))
    .limit(1);
  return row?.productId ?? null;
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

type MentionCandidate = {
  id: number;
  username: string | null;
  openId?: string | null;
};

function mentionHandles(candidate: MentionCandidate): string[] {
  return [candidate.username, candidate.openId, `u${candidate.id}`]
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .map((name) => name.toLowerCase());
}

/** 从正文提取 @handle，匹配候选用户名 / openId / u{userId}（不区分大小写），返回命中用户 id */
export function parseMentions(body: string, candidates: MentionCandidate[]): number[] {
  const names = new Set((body.match(/@([A-Za-z0-9_.\-]+)/g) || []).map((m) => m.slice(1).toLowerCase()));
  if (names.size === 0) return [];
  return candidates
    .filter((c) => mentionHandles(c).some((name) => names.has(name)))
    .map((c) => c.id);
}

async function getCommentMentionCandidates(projectId: string | null | undefined): Promise<MentionCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  if (!projectId) {
    return db.select({ id: users.id, username: users.username, openId: users.openId }).from(users);
  }

  const members = await getProjectMembers(projectId);
  const project = await getProjectById(projectId);
  const byId = new Map<number, MentionCandidate>();
  for (const member of members) {
    byId.set(member.userId, {
      id: member.userId,
      username: member.userUsername,
      openId: member.userOpenId,
    });
  }
  if (project?.createdBy && !byId.has(project.createdBy)) {
    const owner = await getUserById(project.createdBy);
    if (owner) {
      byId.set(owner.id, {
        id: owner.id,
        username: owner.username,
        openId: owner.openId,
      });
    }
  }
  return Array.from(byId.values());
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
  const candidates = await getCommentMentionCandidates(input.projectId);
  const mentions = parseMentions(input.body, candidates);
  const [c] = await db.insert(comments).values({
    entityType: input.entityType, entityId: input.entityId,
    projectId: input.projectId ?? null, authorId: input.authorId, body: input.body, mentions,
  }).returning();
  const author = await getUserById(input.authorId);
  const recipientIds = mentions.filter((uid) => uid !== input.authorId);
  if (recipientIds.length > 0) {
    const { notifyPersonal } = await import("./notification-gateway");
    const { buildProjectActionPath } = await import("../shared/action-links");
    const authorName = author?.name || author?.username || "有人";
    const mentionedNames = candidates
      .filter((u) => mentions.includes(u.id))
      .map((u) => `@${u.username || u.openId || `u${u.id}`}`)
      .join(" ");
    const entityLabel = ({ issue: "问题", task: "任务", change: "变更", changelog: "变更", project: "项目" } as Record<string, string>)[input.entityType] || input.entityType;
    const projName = input.projectId ? (await getProjectById(input.projectId))?.name : null;
    const where = projName ? `「${projName}」的${entityLabel}` : entityLabel;
    const excerpt = input.body.slice(0, 140);
    const markdown =
      `#### 有人在评论中 @ 了你\n` +
      `**${authorName}** 在${where}评论中提到了 ${mentionedNames}\n\n` +
      `> ${excerpt}`;
    await notifyPersonal({
      eventKey: "mention",
      userIds: recipientIds,
      title: `${authorName} 在评论中提到了你`,
      body: excerpt,
      markdown,
      entityType: input.entityType,
      entityId: input.entityId,
      actionPath: input.projectId ? buildProjectActionPath({ projectId: input.projectId, tab: "comments" }) : "/",
      priority: "normal",
      bestEffortDingtalk: true,
    });
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
  // COUNT in SQL rather than fetching all unread rows to count them in JS —
  // this is polled every 30s per user by the notification bell.
  const [r] = await db.select({ c: drizzleSql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return r?.c ?? 0;
}

export async function markRead(id: number): Promise<void> {
  const db = await getDb(); if (!db) return;
  await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
}

export async function markAllRead(userId: number): Promise<void> {
  const db = await getDb(); if (!db) return;
  await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));
}

export type UserNotificationPrefs = {
  dingtalk?: {
    enabled?: boolean;
    quietHours?: {
      startHour?: number;
      endHour?: number;
      timezone?: string;
    };
    maxImmediatePerDay?: number;
  };
};

export type NotificationDeliveryProfile = {
  userId: number;
  prefs: UserNotificationPrefs;
  immediateSent24h: number;
};

function parseNotificationPrefs(value: unknown): UserNotificationPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as UserNotificationPrefs;
}

export async function getNotificationDeliveryProfiles(userIds: number[]): Promise<Map<number, NotificationDeliveryProfile>> {
  const uniqueUserIds = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)));
  const profiles = new Map(uniqueUserIds.map((userId) => [
    userId,
    { userId, prefs: {}, immediateSent24h: 0 } satisfies NotificationDeliveryProfile,
  ]));
  if (uniqueUserIds.length === 0) return profiles;
  const db = await getDb();
  if (!db) return profiles;

  try {
    const idList = drizzleSql.join(uniqueUserIds.map((id) => drizzleSql`${id}`), drizzleSql`, `);
    const result = await db.execute(drizzleSql`
      SELECT
        u.id,
        COALESCE(u."notificationPrefs", '{}'::jsonb) AS prefs,
        (
          SELECT count(*)::int
          FROM action_items ai
          WHERE ai."recipientUserId" = u.id
            AND ai."firstSentAt" >= now() - interval '24 hours'
        ) AS immediate_sent_24h
      FROM users u
      WHERE u.id IN (${idList})
    `);
    const rows = rowsFromExecute<{ id: number | string; prefs: unknown; immediate_sent_24h: number | string | null }>(result);
    for (const row of rows) {
      const userId = Number(row.id);
      profiles.set(userId, {
        userId,
        prefs: parseNotificationPrefs(row.prefs),
        immediateSent24h: toInt(row.immediate_sent_24h),
      });
    }
  } catch (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error, "notificationPrefs")) return profiles;
    throw error;
  }
  return profiles;
}

export async function getUserNotificationPrefs(userId: number): Promise<UserNotificationPrefs> {
  const db = await getDb();
  if (!db) return {};
  try {
    const result = await db.execute(drizzleSql`
      SELECT COALESCE("notificationPrefs", '{}'::jsonb) AS prefs
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `);
    const [row] = rowsFromExecute<{ prefs: unknown }>(result);
    return parseNotificationPrefs(row?.prefs);
  } catch (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error, "notificationPrefs")) return {};
    throw error;
  }
}

export async function updateUserNotificationPrefs(
  userId: number,
  prefs: UserNotificationPrefs,
): Promise<UserNotificationPrefs> {
  const db = await getDb();
  if (!db) return prefs;
  try {
    const result = await db.execute(drizzleSql`
      UPDATE users
      SET "notificationPrefs" = ${JSON.stringify(prefs)}::jsonb,
          "updatedAt" = now()
      WHERE id = ${userId}
      RETURNING "notificationPrefs" AS prefs
    `);
    const [row] = rowsFromExecute<{ prefs: unknown }>(result);
    return parseNotificationPrefs(row?.prefs) ?? prefs;
  } catch (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error, "notificationPrefs")) return prefs;
    throw error;
  }
}

// ── 行动项：唯一可行动通知底座 ───────────────────────────────────────────────

const ACTIVE_ACTION_ITEM_STATUSES = ["open", "sent", "read", "escalated", "snoozed"] as const;

function isMissingRelationError(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const code = (current as { code?: unknown }).code;
    if (code === "42P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const code = (current as { code?: unknown }).code;
    const message = String((current as { message?: unknown }).message ?? "");
    if (code === "42703" && message.includes(columnName)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type UpsertActionItemInput = {
  kind: InsertActionItem["kind"];
  projectId: string;
  entityType: string;
  entityId: string;
  dedupeKey: string;
  recipientUserId: number;
  title: string;
  body?: string | null;
  actionUrl: string;
  level?: InsertActionItem["level"];
  priority?: string;
  dueAt?: Date | null;
  snoozedUntil?: Date | null;
  sourceActivityLogId?: number | null;
  metadata?: Record<string, unknown>;
};

export async function upsertActionItem(input: UpsertActionItemInput): Promise<{
  actionItem: ActionItem | null;
  shouldNotify: boolean;
}> {
  const db = await getDb();
  if (!db) return { actionItem: null, shouldNotify: false };

  try {
    const [existing] = await db
      .select()
      .from(actionItems)
      .where(eq(actionItems.dedupeKey, input.dedupeKey))
      .limit(1);
    const now = new Date();

    if (existing) {
      const shouldNotify = existing.status === "done" || existing.status === "closed";
      const [row] = await db
        .update(actionItems)
        .set({
          kind: input.kind,
          projectId: input.projectId,
          entityType: input.entityType,
          entityId: input.entityId,
          recipientUserId: input.recipientUserId,
          level: input.level ?? existing.level,
          title: input.title,
          body: input.body ?? null,
          actionUrl: input.actionUrl,
          status: shouldNotify ? "open" : existing.status,
          priority: input.priority ?? existing.priority,
          dueAt: input.dueAt ?? null,
          snoozedUntil: input.snoozedUntil ?? null,
          sourceActivityLogId: input.sourceActivityLogId ?? existing.sourceActivityLogId,
          metadata: input.metadata ?? existing.metadata ?? {},
          handledAt: shouldNotify ? null : existing.handledAt,
          closedAt: shouldNotify ? null : existing.closedAt,
          updatedAt: now,
        })
        .where(eq(actionItems.id, existing.id))
        .returning();
      return { actionItem: row ?? existing, shouldNotify };
    }

    const [row] = await db
      .insert(actionItems)
      .values({
        kind: input.kind,
        projectId: input.projectId,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey: input.dedupeKey,
        recipientUserId: input.recipientUserId,
        level: input.level ?? "owner",
        title: input.title,
        body: input.body ?? null,
        actionUrl: input.actionUrl,
        status: "open",
        priority: input.priority ?? "normal",
        dueAt: input.dueAt ?? null,
        snoozedUntil: input.snoozedUntil ?? null,
        sourceActivityLogId: input.sourceActivityLogId ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    return { actionItem: row ?? null, shouldNotify: Boolean(row) };
  } catch (error) {
    if (isMissingRelationError(error)) return { actionItem: null, shouldNotify: true };
    throw error;
  }
}

export async function markActionItemSent(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(actionItems)
      .set({
        status: "sent",
        firstSentAt: drizzleSql`coalesce(${actionItems.firstSentAt}, now())`,
        lastSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(actionItems.id, id));
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
  }
}

export async function closeActionItems(input: {
  dedupeKey?: string;
  kind?: InsertActionItem["kind"];
  entityType?: string;
  entityId?: string;
  recipientUserId?: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const conditions = [];
  if (input.dedupeKey) conditions.push(eq(actionItems.dedupeKey, input.dedupeKey));
  if (input.kind) conditions.push(eq(actionItems.kind, input.kind));
  if (input.entityType) conditions.push(eq(actionItems.entityType, input.entityType));
  if (input.entityId) conditions.push(eq(actionItems.entityId, input.entityId));
  if (input.recipientUserId) conditions.push(eq(actionItems.recipientUserId, input.recipientUserId));
  if (conditions.length === 0) return;
  try {
    await db
      .update(actionItems)
      .set({
        status: "closed",
        handledAt: new Date(),
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(...conditions));
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
  }
}

export async function completeActionItem(input: {
  id: number;
  recipientUserId: number;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const [row] = await db
      .update(actionItems)
      .set({
        status: "done",
        handledAt: new Date(),
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(actionItems.id, input.id),
        eq(actionItems.recipientUserId, input.recipientUserId),
        inArray(actionItems.status, ACTIVE_ACTION_ITEM_STATUSES),
      ))
      .returning({ id: actionItems.id });
    return Boolean(row);
  } catch (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }
}

export async function snoozeActionItem(input: {
  id: number;
  recipientUserId: number;
  snoozedUntil: Date;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const [row] = await db
      .update(actionItems)
      .set({
        status: "snoozed",
        snoozedUntil: input.snoozedUntil,
        updatedAt: new Date(),
      })
      .where(and(
        eq(actionItems.id, input.id),
        eq(actionItems.recipientUserId, input.recipientUserId),
        inArray(actionItems.status, ACTIVE_ACTION_ITEM_STATUSES),
      ))
      .returning({ id: actionItems.id });
    return Boolean(row);
  } catch (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }
}

export async function listOpenActionItemsForUser(userId: number, limit = 100): Promise<ActionItem[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    await db
      .update(actionItems)
      .set({
        status: "sent",
        snoozedUntil: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(actionItems.recipientUserId, userId),
        eq(actionItems.status, "snoozed"),
        drizzleSql`${actionItems.snoozedUntil} <= now()`,
      ));

    return await db
      .select()
      .from(actionItems)
      .where(and(
        eq(actionItems.recipientUserId, userId),
        inArray(actionItems.status, ACTIVE_ACTION_ITEM_STATUSES),
        or(isNull(actionItems.snoozedUntil), drizzleSql`${actionItems.snoozedUntil} <= now()`),
      ))
      .orderBy(
        drizzleSql`CASE ${actionItems.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`,
        drizzleSql`${actionItems.dueAt} IS NULL`,
        actionItems.dueAt,
        desc(actionItems.createdAt),
      )
      .limit(Math.min(Math.max(limit, 1), 200));
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function listSnoozedActionItemsForUser(userId: number, limit = 50): Promise<ActionItem[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(actionItems)
      .where(and(
        eq(actionItems.recipientUserId, userId),
        eq(actionItems.status, "snoozed"),
        drizzleSql`${actionItems.snoozedUntil} > now()`,
      ))
      .orderBy(actionItems.snoozedUntil, desc(actionItems.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export type ActionItemSlaRow = ActionItem & {
  projectName: string;
  projectNumber: string;
  pmUserId: number | null;
  managerUserIds: number[];
};

export async function listActionItemsForSla(): Promise<ActionItemSlaRow[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select({
        actionItem: actionItems,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        pmUserId: projects.pmUserId,
      })
      .from(actionItems)
      .innerJoin(projects, eq(actionItems.projectId, projects.id))
      .where(and(
        eq(projects.archived, false),
        eq(actionItems.level, "owner"),
        inArray(actionItems.status, ACTIVE_ACTION_ITEM_STATUSES),
        or(isNull(actionItems.snoozedUntil), drizzleSql`${actionItems.snoozedUntil} <= now()`),
      ));
    if (rows.length === 0) return [];
    const projectIds = Array.from(new Set(rows.map((row) => row.actionItem.projectId)));
    const managerRows = await db
      .select({ projectId: projectMembers.projectId, userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(
        inArray(projectMembers.projectId, projectIds),
        eq(projectMembers.role, "manager"),
      ));
    const managersByProject = new Map<string, number[]>();
    for (const row of managerRows) {
      const list = managersByProject.get(row.projectId) ?? [];
      list.push(row.userId);
      managersByProject.set(row.projectId, list);
    }
    return rows.map((row) => ({
      ...row.actionItem,
      projectName: row.projectName,
      projectNumber: row.projectNumber,
      pmUserId: row.pmUserId ?? null,
      managerUserIds: managersByProject.get(row.actionItem.projectId) ?? [],
    }));
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

export async function patchActionItemMetadata(
  id: number,
  patch: Record<string, unknown>,
  status?: InsertActionItem["status"],
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const [existing] = await db
      .select({ metadata: actionItems.metadata })
      .from(actionItems)
      .where(eq(actionItems.id, id))
      .limit(1);
    if (!existing) return;
    await db
      .update(actionItems)
      .set({
        metadata: { ...(existing.metadata ?? {}), ...patch },
        ...(status ? { status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(actionItems.id, id));
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
  }
}

export const AUTOMATION_SCHEDULER_KEY = "scheduled_scan";

async function ensureAutomationHeartbeatCursorColumn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): Promise<void> {
  await db.execute(drizzleSql`
    ALTER TABLE "automation_heartbeats"
    ADD COLUMN IF NOT EXISTS "lastCursorId" integer DEFAULT 0 NOT NULL
  `);
}

export async function tryStartAutomationHeartbeat(
  schedulerKey = AUTOMATION_SCHEDULER_KEY,
  staleAfterMs = 10 * 60 * 1000,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  try {
    await db
      .insert(automationHeartbeats)
      .values({
        schedulerKey,
        status: "idle",
        updatedAt: now,
      } satisfies InsertAutomationHeartbeat)
      .onConflictDoNothing({ target: automationHeartbeats.schedulerKey });

    const rows = await db
      .update(automationHeartbeats)
      .set({
        status: "running",
        lastStartedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(and(
        eq(automationHeartbeats.schedulerKey, schedulerKey),
        drizzleSql`(${automationHeartbeats.status} != 'running' OR ${automationHeartbeats.updatedAt} < ${staleBefore})`,
      ))
      .returning({ schedulerKey: automationHeartbeats.schedulerKey });
    return rows.length > 0;
  } catch (error) {
    if (isMissingColumnError(error, "lastCursorId")) {
      await ensureAutomationHeartbeatCursorColumn(db);
      return tryStartAutomationHeartbeat(schedulerKey, staleAfterMs);
    }
    if (isMissingRelationError(error)) return true;
    throw error;
  }
}

export async function finishAutomationHeartbeat(input: {
  schedulerKey?: string;
  status: "success" | "error" | "skipped";
  durationMs?: number | null;
  lastCursorId?: number;
  error?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(automationHeartbeats)
      .set({
        status: input.status,
        lastFinishedAt: new Date(),
        durationMs: input.durationMs ?? null,
        ...(input.lastCursorId !== undefined ? { lastCursorId: input.lastCursorId } : {}),
        lastError: input.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(automationHeartbeats.schedulerKey, input.schedulerKey ?? AUTOMATION_SCHEDULER_KEY));
  } catch (error) {
    if (isMissingColumnError(error, "lastCursorId")) {
      await ensureAutomationHeartbeatCursorColumn(db);
      return finishAutomationHeartbeat(input);
    }
    if (!isMissingRelationError(error)) throw error;
  }
}

export async function getAutomationHeartbeat(
  schedulerKey = AUTOMATION_SCHEDULER_KEY,
): Promise<AutomationHeartbeat | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select()
      .from(automationHeartbeats)
      .where(eq(automationHeartbeats.schedulerKey, schedulerKey))
      .limit(1);
    return row ?? null;
  } catch (error) {
    if (isMissingColumnError(error, "lastCursorId")) {
      await ensureAutomationHeartbeatCursorColumn(db);
      return getAutomationHeartbeat(schedulerKey);
    }
    if (isMissingRelationError(error)) return null;
    throw error;
  }
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
  const activeRunScope = or(isNull(automationRuns.projectId), eq(projects.archived, false));
  if (input.projectId) {
    return db
      .select(getTableColumns(automationRuns))
      .from(automationRuns)
      .leftJoin(projects, eq(automationRuns.projectId, projects.id))
      .where(and(eq(automationRuns.projectId, input.projectId), activeRunScope))
      .orderBy(desc(automationRuns.createdAt))
      .limit(limit);
  }
  return db
    .select(getTableColumns(automationRuns))
    .from(automationRuns)
    .leftJoin(projects, eq(automationRuns.projectId, projects.id))
    .where(activeRunScope)
    .orderBy(desc(automationRuns.createdAt))
    .limit(limit);
}

type AutomationPressureKindRow = {
  kind: string;
  total: number;
  sent: number;
  open: number;
  handled: number;
  escalated: number;
  readUnresolved: number;
  openOver24h: number;
  medianResponseHours: number | null;
};

export type AutomationPressureMetrics = {
  windowDays: number;
  since: string;
  actionItems: {
    total: number;
    sent: number;
    open: number;
    handled: number;
    escalated: number;
    readUnresolved: number;
    openOver24h: number;
    uniqueRecipients: number;
    perRecipientPerDay: number | null;
    closeRatePct: number | null;
    escalationRatePct: number | null;
    readNoActionRatePct: number | null;
    medianResponseHours: number | null;
    byKind: AutomationPressureKindRow[];
  };
  notifications: {
    total: number;
    unread: number;
    uniqueRecipients: number;
    perRecipientPerDay: number | null;
  };
  dingtalkCards: {
    total: number;
    sent: number;
    handled: number;
    failed: number;
    handleRatePct: number | null;
    failureRatePct: number | null;
  };
  runs: {
    total: number;
    errors: number;
    errorRatePct: number | null;
  };
};

function rowsFromExecute<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[] | undefined) ?? []) as T[];
}

function toInt(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratePct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function perRecipientPerDay(total: number, recipients: number, windowDays: number): number | null {
  if (total <= 0 || recipients <= 0 || windowDays <= 0) return null;
  return Math.round((total / recipients / windowDays) * 100) / 100;
}

export async function getAutomationPressureMetrics(windowDays = 7): Promise<AutomationPressureMetrics> {
  const db = await getDb();
  const days = Math.min(Math.max(Math.floor(windowDays), 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const empty: AutomationPressureMetrics = {
    windowDays: days,
    since: since.toISOString(),
    actionItems: {
      total: 0,
      sent: 0,
      open: 0,
      handled: 0,
      escalated: 0,
      readUnresolved: 0,
      openOver24h: 0,
      uniqueRecipients: 0,
      perRecipientPerDay: null,
      closeRatePct: null,
      escalationRatePct: null,
      readNoActionRatePct: null,
      medianResponseHours: null,
      byKind: [],
    },
    notifications: {
      total: 0,
      unread: 0,
      uniqueRecipients: 0,
      perRecipientPerDay: null,
    },
    dingtalkCards: {
      total: 0,
      sent: 0,
      handled: 0,
      failed: 0,
      handleRatePct: null,
      failureRatePct: null,
    },
    runs: {
      total: 0,
      errors: 0,
      errorRatePct: null,
    },
  };
  if (!db) return empty;

  try {
    const actionSummaryRows = rowsFromExecute<{
      total: number | string | null;
      sent: number | string | null;
      open: number | string | null;
      handled: number | string | null;
      escalated: number | string | null;
      read_unresolved: number | string | null;
      open_over_24h: number | string | null;
      unique_recipients: number | string | null;
      median_response_hours: number | string | null;
    }>(await db.execute(drizzleSql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE ai."firstSentAt" IS NOT NULL)::int AS sent,
        count(*) FILTER (WHERE ai.status IN ('open','sent','read','escalated','snoozed'))::int AS open,
        count(*) FILTER (WHERE ai."handledAt" IS NOT NULL)::int AS handled,
        count(*) FILTER (WHERE ai.level <> 'owner' OR ai.status = 'escalated')::int AS escalated,
        count(*) FILTER (WHERE ai.status = 'read')::int AS read_unresolved,
        count(*) FILTER (
          WHERE ai.status IN ('open','sent','read','escalated','snoozed')
            AND ai."createdAt" <= now() - interval '24 hours'
        )::int AS open_over_24h,
        count(DISTINCT ai."recipientUserId")::int AS unique_recipients,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY extract(epoch FROM (ai."handledAt" - coalesce(ai."firstSentAt", ai."createdAt"))) / 3600
        ) FILTER (WHERE ai."handledAt" IS NOT NULL)::float AS median_response_hours
      FROM action_items ai
      INNER JOIN projects p ON p.id = ai."projectId"
      WHERE p.archived = false AND ai."createdAt" >= ${since}
    `));

    const actionKindRows = rowsFromExecute<{
      kind: string;
      total: number | string | null;
      sent: number | string | null;
      open: number | string | null;
      handled: number | string | null;
      escalated: number | string | null;
      read_unresolved: number | string | null;
      open_over_24h: number | string | null;
      median_response_hours: number | string | null;
    }>(await db.execute(drizzleSql`
      SELECT
        ai.kind::text AS kind,
        count(*)::int AS total,
        count(*) FILTER (WHERE ai."firstSentAt" IS NOT NULL)::int AS sent,
        count(*) FILTER (WHERE ai.status IN ('open','sent','read','escalated','snoozed'))::int AS open,
        count(*) FILTER (WHERE ai."handledAt" IS NOT NULL)::int AS handled,
        count(*) FILTER (WHERE ai.level <> 'owner' OR ai.status = 'escalated')::int AS escalated,
        count(*) FILTER (WHERE ai.status = 'read')::int AS read_unresolved,
        count(*) FILTER (
          WHERE ai.status IN ('open','sent','read','escalated','snoozed')
            AND ai."createdAt" <= now() - interval '24 hours'
        )::int AS open_over_24h,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY extract(epoch FROM (ai."handledAt" - coalesce(ai."firstSentAt", ai."createdAt"))) / 3600
        ) FILTER (WHERE ai."handledAt" IS NOT NULL)::float AS median_response_hours
      FROM action_items ai
      INNER JOIN projects p ON p.id = ai."projectId"
      WHERE p.archived = false AND ai."createdAt" >= ${since}
      GROUP BY ai.kind
      ORDER BY total DESC, kind
    `));

    const notificationRows = rowsFromExecute<{
      total: number | string | null;
      unread: number | string | null;
      unique_recipients: number | string | null;
    }>(await db.execute(drizzleSql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE read = false)::int AS unread,
        count(DISTINCT "userId")::int AS unique_recipients
      FROM notifications
      WHERE "createdAt" >= ${since}
    `));

    const runRows = rowsFromExecute<{
      total: number | string | null;
      errors: number | string | null;
    }>(await db.execute(drizzleSql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status IN ('error','failed'))::int AS errors
      FROM automation_runs
      WHERE "createdAt" >= ${since}
    `));

    let dingtalkCardRows: Array<{
      total: number | string | null;
      sent: number | string | null;
      handled: number | string | null;
      failed: number | string | null;
    }> = [];
    try {
      dingtalkCardRows = rowsFromExecute(await db.execute(drizzleSql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE status IN ('sent','handled'))::int AS sent,
          count(*) FILTER (WHERE status = 'handled')::int AS handled,
          count(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM dingtalk_interactive_cards
        WHERE "createdAt" >= ${since}
      `));
    } catch (error) {
      if (!isMissingRelationError(error)) throw error;
    }

    const summary = actionSummaryRows[0];
    const total = toInt(summary?.total);
    const sent = toInt(summary?.sent);
    const handled = toInt(summary?.handled);
    const escalated = toInt(summary?.escalated);
    const readUnresolved = toInt(summary?.read_unresolved);
    const uniqueRecipients = toInt(summary?.unique_recipients);
    const notificationSummary = notificationRows[0];
    const notificationTotal = toInt(notificationSummary?.total);
    const notificationRecipients = toInt(notificationSummary?.unique_recipients);
    const runSummary = runRows[0];
    const runTotal = toInt(runSummary?.total);
    const runErrors = toInt(runSummary?.errors);
    const cardSummary = dingtalkCardRows[0];
    const cardTotal = toInt(cardSummary?.total);
    const cardHandled = toInt(cardSummary?.handled);
    const cardFailed = toInt(cardSummary?.failed);

    return {
      windowDays: days,
      since: since.toISOString(),
      actionItems: {
        total,
        sent,
        open: toInt(summary?.open),
        handled,
        escalated,
        readUnresolved,
        openOver24h: toInt(summary?.open_over_24h),
        uniqueRecipients,
        perRecipientPerDay: perRecipientPerDay(sent, uniqueRecipients, days),
        closeRatePct: ratePct(handled, total),
        escalationRatePct: ratePct(escalated, total),
        readNoActionRatePct: ratePct(readUnresolved, total),
        medianResponseHours: toNullableNumber(summary?.median_response_hours),
        byKind: actionKindRows.map((row) => ({
          kind: row.kind,
          total: toInt(row.total),
          sent: toInt(row.sent),
          open: toInt(row.open),
          handled: toInt(row.handled),
          escalated: toInt(row.escalated),
          readUnresolved: toInt(row.read_unresolved),
          openOver24h: toInt(row.open_over_24h),
          medianResponseHours: toNullableNumber(row.median_response_hours),
        })),
      },
      notifications: {
        total: notificationTotal,
        unread: toInt(notificationSummary?.unread),
        uniqueRecipients: notificationRecipients,
        perRecipientPerDay: perRecipientPerDay(notificationTotal, notificationRecipients, days),
      },
      dingtalkCards: {
        total: cardTotal,
        sent: toInt(cardSummary?.sent),
        handled: cardHandled,
        failed: cardFailed,
        handleRatePct: ratePct(cardHandled, cardTotal),
        failureRatePct: ratePct(cardFailed, cardTotal),
      },
      runs: {
        total: runTotal,
        errors: runErrors,
        errorRatePct: ratePct(runErrors, runTotal),
      },
    };
  } catch (error) {
    if (isMissingRelationError(error)) return empty;
    throw error;
  }
}

export type AutomationDueTask = ProjectTask & {
  projectCategory: string;
};

/** 逾期或 14 天内到期的未完成任务（逾期催办 + 截止前提醒 共用此扫描，规则各自精确过滤） */
export async function getAutomationDueTasks(): Promise<AutomationDueTask[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      ...getTableColumns(projectTasks),
      projectCategory: projects.category,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projectTasks.projectId, projects.id))
    .where(and(
      eq(projects.archived, false),
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
    .select(getTableColumns(projectIssues))
    .from(projectIssues)
    .innerJoin(projects, eq(projectIssues.projectId, projects.id))
    .where(and(
      eq(projects.archived, false),
      drizzleSql`${projectIssues.targetDate} IS NOT NULL`,
      drizzleSql`${projectIssues.targetDate} <> ''`,
      drizzleSql`${projectIssues.targetDate} <= TO_CHAR(CURRENT_DATE + INTERVAL '14 days', 'YYYY-MM-DD')`,
      drizzleSql`${projectIssues.status} NOT IN ('resolved','closed','wont_fix')`
    ));
}

/** 未关闭 P0/P1 问题：异常升级扫描使用，即使未设置 targetDate 也会升级。 */
export async function getAutomationCriticalIssues(): Promise<ProjectIssue[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select(getTableColumns(projectIssues))
    .from(projectIssues)
    .innerJoin(projects, eq(projectIssues.projectId, projects.id))
    .where(and(
      eq(projects.archived, false),
      inArray(projectIssues.severity, ["P0", "P1"] as const),
      inArray(projectIssues.status, ["open", "in_progress"] as const),
    ));
}

/** 待审交付物：异常升级扫描使用。 */
export async function getAutomationPendingDeliverableReviews(): Promise<ProjectDeliverableReview[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select(getTableColumns(projectDeliverableReviews))
    .from(projectDeliverableReviews)
    .innerJoin(projects, eq(projectDeliverableReviews.projectId, projects.id))
    .where(and(
      eq(projects.archived, false),
      eq(projectDeliverableReviews.status, "pending"),
    ));
}

/** Gate 前置未完扫描：跨活跃项目，找"未完成且 dueDate 已设"的 gate 任务 + 其阶段内未完成前置数。 */
export async function getAutomationGatePrereqs(): Promise<Array<{
  projectId: string; taskId: string; phaseId: string; dueDate: string | null; status: string; incompletePrereqCount: number; title: string;
}>> {
  const db = await getDb();
  if (!db) return [];
  const projs = await db.select({ id: projects.id, category: projects.category }).from(projects).where(eq(projects.archived, false));
  if (projs.length === 0) return [];
  const projectIds = projs.map((p) => p.id);
  const allTasks = await db.select({ projectId: projectTasks.projectId, taskId: projectTasks.taskId, status: projectTasks.status, dueDate: projectTasks.dueDate, completed: projectTasks.completed })
    .from(projectTasks).where(inArray(projectTasks.projectId, projectIds));
  const tasksByProject = new Map<string, typeof allTasks>();
  for (const task of allTasks) {
    const list = tasksByProject.get(task.projectId) ?? [];
    list.push(task);
    tasksByProject.set(task.projectId, list);
  }
  const out: Array<{ projectId: string; taskId: string; phaseId: string; dueDate: string | null; status: string; incompletePrereqCount: number; title: string }> = [];
  for (const p of projs) {
    const phases = getPhasesForCategory(p.category);
    const rows = tasksByProject.get(p.id) ?? [];
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
  type: "task" | "phase" | "gate" | "target" | "schedule";
  projectId: string;
  projectName: string;
  label: string;
  startTime?: string | null;
  durationMin?: number | null;
  dingtalkSyncStatus?: string | null;
  phaseId?: string | null;
  taskId?: string | null;
  status?: TaskStatus | null;
  priority?: TaskPriority | null;
};

/**
 * 在 [fromDate, toDate] 时间窗内聚合日历事件。
 * 里程碑全员可见；普通任务排期只对 admin、创建者和项目成员可见。
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

  const [viewer] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  const taskProjectIds = new Set<string>();
  if (isSystemAdminRole(viewer?.role)) {
    ids.forEach((id) => taskProjectIds.add(id));
  } else {
    for (const p of allProjects) {
      if (p.createdBy === userId) taskProjectIds.add(p.id);
    }
    const memberRows = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, userId));
    for (const row of memberRows) {
      if (projById.has(row.projectId)) taskProjectIds.add(row.projectId);
    }
  }

  const inWindow = (d: string | null): d is string => !!d && d >= fromDate && d <= toDate;
  const events: CalendarEvent[] = [];

  // 被裁阶段的截止里程碑不上日历（按项目聚合已批准裁剪的阶段集）
  const tailoredByProject = new Map<string, { phaseIds: Set<string>; taskIds: Set<string> }>();
  for (const pid of ids) {
    const sets = await getApprovedTailoringSets(pid);
    tailoredByProject.set(pid, { phaseIds: sets.tailoredPhaseIds, taskIds: sets.tailoredTaskIds });
  }

  for (const p of Array.from(projById.values())) {
    if (inWindow(p.targetDate)) {
      events.push({ date: p.targetDate, type: "target", projectId: p.id, projectName: p.name, label: "目标交付" });
    }
  }

  const phaseRows = await db.select({
    projectId: projectPhases.projectId, phaseId: projectPhases.phaseId, endDate: projectPhases.endDate,
  }).from(projectPhases).where(and(inArray(projectPhases.projectId, ids), between(projectPhases.endDate, fromDate, toDate)));
  for (const r of phaseRows) {
    if (tailoredByProject.get(r.projectId)?.phaseIds.has(r.phaseId)) continue;
    const p = projById.get(r.projectId);
    const phase = p ? getPhasesForCategory(p.category).find((item) => item.id === r.phaseId) : null;
    if (p) events.push({ date: r.endDate!, type: "phase", projectId: p.id, projectName: p.name, label: `${phase?.name ?? r.phaseId} 截止` });
  }

  const taskRows = await db.select({
    projectId: projectTasks.projectId,
    phaseId: projectTasks.phaseId,
    taskId: projectTasks.taskId,
    dueDate: projectTasks.dueDate,
    status: projectTasks.status,
    priority: projectTasks.priority,
  }).from(projectTasks).where(and(
    inArray(projectTasks.projectId, ids),
    between(projectTasks.dueDate, fromDate, toDate),
  ));
  for (const r of taskRows) {
    const p = projById.get(r.projectId);
    if (!p) continue;
    const tailored = tailoredByProject.get(r.projectId);
    if (
      tailored?.phaseIds.has(r.phaseId) ||
      tailored?.taskIds.has(r.taskId) ||
      tailored?.taskIds.has(`${r.phaseId}:${r.taskId}`)
    ) continue;
    const phase = getPhasesForCategory(p.category).find((item) => item.id === r.phaseId);
    if (phase?.gateTaskId === r.taskId) {
      events.push({
        date: r.dueDate!,
        type: "gate",
        projectId: p.id,
        projectName: p.name,
        label: `${phase.gate || phase.name} 截止`,
      });
      continue;
    }
    if (!taskProjectIds.has(r.projectId) || r.status === "done" || r.status === "skipped") continue;
    const task = phase?.tasks.find((item) => item.id === r.taskId);
    events.push({
      date: r.dueDate!,
      type: "task",
      projectId: p.id,
      projectName: p.name,
      label: task?.name ?? r.taskId,
      phaseId: r.phaseId,
      taskId: r.taskId,
      status: r.status,
      priority: r.priority,
    });
  }

  const gateRows = await db.select({
    projectId: projectGateReviews.projectId, reviewDate: projectGateReviews.reviewDate, gateName: projectGateReviews.gateName,
  }).from(projectGateReviews).where(and(inArray(projectGateReviews.projectId, ids), between(projectGateReviews.reviewDate, fromDate, toDate)));
  for (const r of gateRows) {
    const p = projById.get(r.projectId);
    if (p) events.push({ date: r.reviewDate!, type: "gate", projectId: p.id, projectName: p.name, label: r.gateName || "Gate 评审" });
  }

  await ensureProjectCalendarEventsTable();
  const scheduleRows = await db.select({
    projectId: projectCalendarEvents.projectId,
    title: projectCalendarEvents.title,
    eventDate: projectCalendarEvents.eventDate,
    startTime: projectCalendarEvents.startTime,
    durationMin: projectCalendarEvents.durationMin,
    dingtalkSyncStatus: projectCalendarEvents.dingtalkSyncStatus,
  }).from(projectCalendarEvents).where(and(inArray(projectCalendarEvents.projectId, ids), between(projectCalendarEvents.eventDate, fromDate, toDate)));
  for (const r of scheduleRows) {
    const p = projById.get(r.projectId);
    if (p) {
      events.push({
        date: r.eventDate,
        type: "schedule",
        projectId: p.id,
        projectName: p.name,
        label: r.title,
        startTime: r.startTime,
        durationMin: r.durationMin,
        dingtalkSyncStatus: r.dingtalkSyncStatus,
      });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

/** 全局节假日例外 → 引擎输入。无 DB 时返回空集(退回仅周末口径)。 */
export async function getCalendarExceptions(): Promise<CalendarExceptions> {
  const db = await getDb();
  if (!db) return { holidays: new Set(), makeupWorkdays: new Set() };
  const rows = await db
    .select({ date: calendarExceptions.date, type: calendarExceptions.type })
    .from(calendarExceptions);
  const holidays = new Set<string>();
  const makeupWorkdays = new Set<string>();
  for (const r of rows) {
    if (r.type === "makeup_workday") makeupWorkdays.add(r.date);
    else holidays.add(r.date);
  }
  return { holidays, makeupWorkdays };
}
