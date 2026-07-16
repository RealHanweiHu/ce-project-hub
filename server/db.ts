import { eq, desc, and, or, isNull, inArray, between, lt, lte, gte, getTableColumns, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { nanoid } from "nanoid";
import {
  EXTERNAL_APPROVAL_STATUSES,
  InsertUser, users, projects, InsertProject, ProjectRow,
  projectMembers, InsertProjectMember, ProjectMember, ProjectMemberRole,
  projectRoleDelegations, ProjectRoleDelegation, InsertProjectRoleDelegation,
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
  projectGateSignoffRounds, ProjectGateSignoffRound, InsertProjectGateSignoffRound,
  projectGateSignoffAdditions, ProjectGateSignoffAddition, InsertProjectGateSignoffAddition,
  projectGateSignoffs, ProjectGateSignoff, InsertProjectGateSignoff,
  projectChangeScopeDeclarations, ProjectChangeScopeDeclarationRow, InsertProjectChangeScopeDeclaration,
  projectStabilityReports, ProjectStabilityReport, InsertProjectStabilityReport,
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
  productCertificates, ProductCertificate, InsertProductCertificate,
  projectConditions, ProjectCondition, InsertProjectCondition,
  projectCloseHandoffs, ProjectCloseHandoff,
  projectCloseHandoffItems, ProjectCloseHandoffItem,
  projectTerminationReviews, projectTerminationItems,
  productServiceCases, ProductServiceCase, InsertProductServiceCase,
  projectExpenses, ProjectExpense, InsertProjectExpense,
  productSoftwareReleases, ProductSoftwareRelease, InsertProductSoftwareRelease,
  productEolPlans, ProductEolPlan,
  productEolPlanItems, ProductEolPlanItem,
  productGovernanceEvents, ProductGovernanceEvent, InsertProductGovernanceEvent,
  PRODUCT_EOL_ITEM_KEYS, type ProductEolItemKey,
  PROJECT_CLOSE_HANDOFF_ITEM_KEYS, type ProjectCloseHandoffItemKey,
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
  automationClaims,
  customFieldDefs, CustomFieldDef, InsertCustomFieldDef,
  projectCollections, ProjectCollection,
  projectCollectionItems,
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
import {
  getEffectivePhasesForProjectLike,
  getNpdV3RedlinePolicy,
  isNpdV3RedlineAuditDeliverable,
  type ProjectTemplateLike,
} from "../shared/npd-v3";
import {
  getDerivativeEffectivePhases,
  getDerivativeEffectiveTaskIds,
  getDerivativeModuleAffectedTaskIds,
  getDerivativeTailoredTaskIds,
  getPhasesForCategory,
  normalizeDerivativeReuseStrategy,
  SOP_TEMPLATE_VERSION_CURRENT,
  type DerivativeReuseStrategy,
} from "../shared/sop-templates";
import { computeDownstreamImpact, type DownstreamImpactRow, type VariantStatus } from "../shared/oem-variant";
import { computeGateReadiness, type GateReadiness } from "../shared/gate-readiness";
import {
  getDeliverableLibraryForPhases,
  getEffectiveProcess,
  type EffectiveProcess,
} from "../shared/effective-process";
import {
  buildGateSignoffRequirements,
  gateSignoffsReady,
  promoteGateSignoffRequirement,
  type GateSignoffRequirement,
  type GateSignoffSlot,
  type GateSignoffStatus,
} from "../shared/gate-signoffs";
import {
  isHighRiskProtectedDeliverable,
  isHighRiskProtectedTask,
  isHighSopRisk,
  phaseContainsHighRiskControls,
  restoreHighRiskTasks,
  deriveSopRiskAssessment,
  EMPTY_CHANGE_SCOPE_DECLARATION,
  type ProjectChangeScopeDeclaration,
  type ProjectSopRiskLevel,
  type SopRiskAssessment,
} from "../shared/sop-risk";
import {
  certificationRequirementLabel,
  evaluateCertificationCoverage,
  getRequiredCertificationCoverage,
  type CertificationCoverageRecord,
} from "../shared/certification";
import {
  DERIVATIVE_AUTO_EXEMPT_REASON,
  getDerivativeAutoExemptDeliverables,
} from "../shared/derivative-deliverable-tailoring";
import { buildOperationalProjectSchedTasks, buildSchedTasks } from "../shared/schedule-graph";
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
import {
  MANAGEMENT_VALIDATION_PHASES,
  computeManagementKpis,
  parseCostValue,
  type ManagementKpis,
} from "../shared/management-kpis";
import { isSystemAdminRole } from "../shared/system-roles";
import { normalizeExtraRoles } from "../shared/project-roles";
import { defaultFromISO } from "./metrics-window";
import { buildProjectActionPath } from "../shared/action-links";

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

export async function getUsersByIds(ids: readonly number[]) {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(inArray(users.id, uniqueIds));
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

/** 归档/终止审计视图；正常关闭与异常终止通过 lifecycle 区分。 */
export async function getArchivedProjects(userId: number, includeAll = false): Promise<ProjectRow[]> {
  const db = await getDb();
  if (!db) return [];
  if (includeAll) return db.select().from(projects).where(eq(projects.archived, true)).orderBy(desc(projects.updatedAt));
  const memberships = await db.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, userId));
  const ids = memberships.map((row) => row.projectId);
  const access = ids.length > 0
    ? or(eq(projects.createdBy, userId), eq(projects.pmUserId, userId), inArray(projects.id, ids))
    : or(eq(projects.createdBy, userId), eq(projects.pmUserId, userId));
  return db.select().from(projects).where(and(eq(projects.archived, true), access)).orderBy(desc(projects.updatedAt));
}

/** Automation-only project scope: paused/terminated projects are excluded. */
export async function getAutomationActiveProjects(): Promise<ProjectRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projects).where(and(
    eq(projects.archived, false),
    eq(projects.lifecycle, "active"),
  )).orderBy(desc(projects.updatedAt));
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
  createdBy: number,
  riskDeclaration?: { declaration: ProjectChangeScopeDeclaration; assessment: SopRiskAssessment },
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
    if (riskDeclaration) {
      await tx.insert(projectChangeScopeDeclarations).values({
        projectId: project.id,
        version: 1,
        declaration: riskDeclaration.declaration,
        assessment: riskDeclaration.assessment,
        ruleVersion: riskDeclaration.assessment.ruleVersion,
        declaredBy: createdBy,
      });
    }
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

export async function getLatestProjectChangeScopeDeclaration(
  projectId: string,
): Promise<ProjectChangeScopeDeclarationRow | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(projectChangeScopeDeclarations)
    .where(eq(projectChangeScopeDeclarations.projectId, projectId))
    .orderBy(desc(projectChangeScopeDeclarations.version))
    .limit(1);
  return row ?? null;
}

export async function createProjectChangeScopeDeclarationVersion(input: {
  projectId: string;
  declaration: ProjectChangeScopeDeclaration;
  assessment: SopRiskAssessment;
  declaredBy: number;
}): Promise<ProjectChangeScopeDeclarationRow> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const projectBefore = await getProjectById(input.projectId);
  if (!projectBefore) throw new Error("Project not found");
  const row = await db.transaction(async (tx) => {
    await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${`${input.projectId}:risk-scope`}))`);
    const [latest] = await tx.select({
      maxVersion: drizzleSql<number>`coalesce(max(${projectChangeScopeDeclarations.version}), 0)::int`,
    }).from(projectChangeScopeDeclarations)
      .where(eq(projectChangeScopeDeclarations.projectId, input.projectId));
    const [created] = await tx.insert(projectChangeScopeDeclarations).values({
      projectId: input.projectId,
      version: (latest?.maxVersion ?? 0) + 1,
      declaration: input.declaration,
      assessment: input.assessment,
      ruleVersion: input.assessment.ruleVersion,
      declaredBy: input.declaredBy,
    } as InsertProjectChangeScopeDeclaration).returning();
    await tx.update(projects).set({
      safetyRiskLevel: input.assessment.safetyRiskLevel,
      regulatoryRiskLevel: input.assessment.regulatoryRiskLevel,
      updatedAt: new Date(),
    }).where(eq(projects.id, input.projectId));
    return created;
  });
  const riskIncreased =
    (projectBefore.safetyRiskLevel !== "high" && input.assessment.safetyRiskLevel === "high") ||
    (projectBefore.regulatoryRiskLevel !== "high" && input.assessment.regulatoryRiskLevel === "high");
  if (riskIncreased) {
    await supersedeOpenGateSignoffRounds(input.projectId, input.declaredBy, "风险升级：按新矩阵重开会签轮次");
  }
  return row;
}

export async function confirmProjectChangeScopeDeclaration(input: {
  projectId: string;
  version: number;
  kind: "engineering" | "qa_or_cert";
  confirmedBy: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectChangeScopeDeclarations).set(input.kind === "engineering"
    ? { engineeringConfirmedBy: input.confirmedBy, engineeringConfirmedAt: new Date() }
    : { qaOrCertConfirmedBy: input.confirmedBy, qaOrCertConfirmedAt: new Date() })
    .where(and(
      eq(projectChangeScopeDeclarations.projectId, input.projectId),
      eq(projectChangeScopeDeclarations.version, input.version),
    ));
}

export async function listProductCertificates(productId: string): Promise<ProductCertificate[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productCertificates)
    .where(eq(productCertificates.productId, productId))
    .orderBy(desc(productCertificates.createdAt), desc(productCertificates.id));
}

export async function createProductCertificate(
  input: Omit<InsertProductCertificate, "id" | "status" | "reviewedBy" | "reviewedAt" | "createdAt" | "updatedAt">,
): Promise<ProductCertificate> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!input.certificateNumber?.trim() && !input.evidenceReference?.trim()) {
    throw new Error("证书编号与证据引用至少填写一项");
  }
  if (input.scopeType === "project" && !input.projectId) throw new Error("项目范围证书必须关联项目");
  if (input.scopeType === "revision" && !input.revisionId) throw new Error("Revision 范围证书必须关联版本");
  if (input.scopeType === "revision" && input.reuseApproved && !input.reuseBasis?.trim()) {
    throw new Error("Revision 复用批准必须填写复用边界和依据");
  }
  const [row] = await db.insert(productCertificates).values({ ...input, status: "draft" }).returning();
  return row;
}

export async function reviewProductCertificate(input: {
  id: number;
  status: "valid" | "revoked";
  reviewedBy: number;
}): Promise<ProductCertificate> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(productCertificates).where(eq(productCertificates.id, input.id)).limit(1);
  if (!existing) throw new Error("证书记录不存在");
  if (input.status === "valid") {
    if (!existing.certificateNumber?.trim() && !existing.evidenceReference?.trim()) {
      throw new Error("缺少证书编号或证据引用，不能确认有效");
    }
    if (existing.scopeType === "revision" && (!existing.reuseApproved || !existing.reuseBasis?.trim())) {
      throw new Error("Revision 复用证书缺少批准和复用依据");
    }
  }
  const [row] = await db.update(productCertificates).set({
    status: input.status,
    reviewedBy: input.reviewedBy,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(productCertificates.id, input.id)).returning();
  return row;
}

export async function evaluateProductCertificationCoverage(input: {
  productId: string;
  projectId: string;
  declaration: ProjectChangeScopeDeclaration;
  baselineTargetMarkets?: string[] | null;
  baseRevisionId?: number | null;
  resultRevisionId?: number | null;
  todayISO?: string;
}): Promise<ReturnType<typeof evaluateCertificationCoverage> & { requirements: ReturnType<typeof getRequiredCertificationCoverage> }> {
  const records = await listProductCertificates(input.productId);
  const requirements = getRequiredCertificationCoverage({
    declaration: input.declaration,
    baselineTargetMarkets: input.baselineTargetMarkets,
  });
  const result = evaluateCertificationCoverage({
    requirements,
    records: records as CertificationCoverageRecord[],
    projectId: input.projectId,
    baseRevisionId: input.baseRevisionId,
    resultRevisionId: input.resultRevisionId,
    todayISO: input.todayISO ?? new Date().toISOString().slice(0, 10),
  });
  return { ...result, requirements };
}

export async function getProjectCertificationCoverage(projectId: string) {
  const [project, declaration] = await Promise.all([
    getProjectById(projectId),
    getLatestProjectChangeScopeDeclaration(projectId),
  ]);
  if (!project) throw new Error("项目不存在");
  const product = project.productId ? await getProductById(project.productId) : null;
  const scope = declaration?.declaration ?? EMPTY_CHANGE_SCOPE_DECLARATION;
  const todayISO = new Date().toISOString().slice(0, 10);
  const coverageThroughISO = project.targetDate && project.targetDate > todayISO ? project.targetDate : todayISO;
  if (!project.productId) {
    const requirements = getRequiredCertificationCoverage({ declaration: scope, baselineTargetMarkets: [] });
    return {
      requirements,
      covered: requirements.length === 0,
      missing: requirements,
      coveredByRequirement: requirements.map((requirement) => ({ requirement, certificateId: null })),
      coverageThroughISO,
    };
  }
  const result = await evaluateProductCertificationCoverage({
    productId: project.productId,
    projectId,
    declaration: scope,
    baselineTargetMarkets: product?.targetMarkets ?? [],
    baseRevisionId: project.baseRevisionId,
    resultRevisionId: project.resultRevisionId,
    todayISO: coverageThroughISO,
  });
  return { ...result, coverageThroughISO };
}

export async function listProjectConditions(projectId: string): Promise<ProjectCondition[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectConditions)
    .where(eq(projectConditions.projectId, projectId))
    .orderBy(projectConditions.status, projectConditions.dueDate, projectConditions.id);
}

export async function createProjectCondition(
  input: Omit<InsertProjectCondition, "id" | "status" | "resolvedBy" | "resolvedAt" | "createdAt" | "updatedAt">,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any,
): Promise<ProjectCondition> {
  const db = exec ?? await getDb();
  if (!db) throw new Error("Database not available");
  if (!input.description.trim()) throw new Error("条件或让步内容不能为空");
  const [row] = await db.insert(projectConditions).values({ ...input, status: "open" })
    .onConflictDoUpdate({
      target: [projectConditions.sourceType, projectConditions.sourceId],
      set: {
        title: input.title,
        description: input.description,
        ownerUserId: input.ownerUserId,
        dueDate: input.dueDate,
        updatedAt: new Date(),
      },
    }).returning();
  await db.insert(actionItems).values({
    kind: "condition_followup",
    projectId: input.projectId,
    entityType: "condition",
    entityId: String(row.id),
    dedupeKey: `condition:${row.id}:owner`,
    recipientUserId: input.ownerUserId,
    level: "owner",
    title: input.title,
    body: input.description,
    actionUrl: buildProjectActionPath({ projectId: input.projectId, tab: "overview" }),
    status: "open",
    priority: "high",
    dueAt: new Date(`${input.dueDate}T23:59:59Z`),
    metadata: { conditionId: row.id, sourceType: input.sourceType, dueDate: input.dueDate },
  }).onConflictDoUpdate({
    target: actionItems.dedupeKey,
    set: {
      recipientUserId: input.ownerUserId,
      title: input.title,
      body: input.description,
      status: "open",
      dueAt: new Date(`${input.dueDate}T23:59:59Z`),
      metadata: { conditionId: row.id, sourceType: input.sourceType, dueDate: input.dueDate },
      handledAt: null,
      closedAt: null,
      updatedAt: new Date(),
    },
  });
  return row;
}

export async function extendProjectCondition(input: {
  id: number;
  projectId: string;
  dueDate: string;
  note: string;
  updatedBy: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.select().from(projectConditions).where(and(
    eq(projectConditions.id, input.id),
    eq(projectConditions.projectId, input.projectId),
  )).limit(1);
  if (!row) throw new Error("条件项不存在");
  if (row.status !== "open") throw new Error("只有未关闭条件项可以延期");
  await db.update(projectConditions).set({
    dueDate: input.dueDate,
    resolutionNote: input.note,
    updatedAt: new Date(),
  }).where(eq(projectConditions.id, input.id));
  await db.update(actionItems).set({
    dueAt: new Date(`${input.dueDate}T23:59:59Z`),
    metadata: { conditionId: input.id, sourceType: row.sourceType, dueDate: input.dueDate, extensionNote: input.note },
    updatedAt: new Date(),
  }).where(and(eq(actionItems.entityType, "condition"), eq(actionItems.entityId, String(input.id))));
}

export async function resolveProjectCondition(input: {
  id: number;
  projectId: string;
  resolution: "closed" | "converted_to_eco";
  linkedEcoProjectId?: string | null;
  note: string;
  resolvedBy: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.select().from(projectConditions).where(and(
    eq(projectConditions.id, input.id),
    eq(projectConditions.projectId, input.projectId),
  )).limit(1);
  if (!row) throw new Error("条件项不存在");
  if (row.status !== "open") throw new Error("条件项已闭环");
  if (!input.note.trim()) throw new Error("闭环说明不能为空");
  if (input.resolution === "converted_to_eco") {
    if (!input.linkedEcoProjectId) throw new Error("转 ECO 必须选择目标 ECO 项目");
    const [source, eco] = await Promise.all([
      getProjectById(input.projectId),
      getProjectById(input.linkedEcoProjectId),
    ]);
    if (!eco || eco.category !== "eco") throw new Error("目标项目不是 ECO");
    if (source?.productId && eco.productId !== source.productId) throw new Error("目标 ECO 必须关联同一产品");
  }
  await db.update(projectConditions).set({
    status: input.resolution,
    linkedEcoProjectId: input.resolution === "converted_to_eco" ? input.linkedEcoProjectId : null,
    resolutionNote: input.note,
    resolvedBy: input.resolvedBy,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(projectConditions.id, input.id));
  await db.update(actionItems).set({
    status: "closed",
    handledAt: new Date(),
    closedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(actionItems.entityType, "condition"), eq(actionItems.entityId, String(input.id))));
}

export async function getProjectConditionsReadiness(projectId: string): Promise<{
  ready: boolean;
  openCount: number;
  blockers: string[];
}> {
  const rows = await listProjectConditions(projectId);
  const open = rows.filter((row) => row.status === "open");
  return {
    ready: open.length === 0,
    openCount: open.length,
    blockers: open.map((row) => `${row.title}（负责人 #${row.ownerUserId}，截止 ${row.dueDate}）`),
  };
}

export type ProjectCloseHandoffBundle = {
  handoff: ProjectCloseHandoff;
  items: ProjectCloseHandoffItem[];
};

export async function getProjectCloseHandoff(projectId: string): Promise<ProjectCloseHandoffBundle | null> {
  const db = await getDb();
  if (!db) return null;
  const [handoff] = await db.select().from(projectCloseHandoffs)
    .where(eq(projectCloseHandoffs.projectId, projectId))
    .limit(1);
  if (!handoff) return null;
  const items = await db.select().from(projectCloseHandoffItems)
    .where(eq(projectCloseHandoffItems.handoffId, handoff.id))
    .orderBy(projectCloseHandoffItems.id);
  return { handoff, items };
}

function closeHandoffContentBlockers(bundle: ProjectCloseHandoffBundle | null): string[] {
  if (!bundle) return ["尚未建立正式量产移交单"];
  const blockers: string[] = [];
  if (!bundle.handoff.maintenanceOwnerUserId) blockers.push("未指定产品维护责任人");
  if (!bundle.handoff.afterSalesOwnerUserId) blockers.push("未指定售后责任人");
  if (!bundle.handoff.scopeSummary.trim()) blockers.push("未说明量产维护边界");
  const itemByKey = new Map(bundle.items.map((item) => [item.itemKey, item]));
  for (const key of PROJECT_CLOSE_HANDOFF_ITEM_KEYS) {
    const item = itemByKey.get(key);
    if (!item?.completed) blockers.push(`移交清单未完成：${key}`);
    else if (!item.evidenceReference?.trim()) blockers.push(`移交清单缺少证据引用：${key}`);
  }
  return blockers;
}

export async function saveProjectCloseHandoffDraft(input: {
  projectId: string;
  maintenanceOwnerUserId: number;
  afterSalesOwnerUserId: number;
  scopeSummary: string;
  items: Array<{ itemKey: ProjectCloseHandoffItemKey; completed: boolean; evidenceReference: string | null }>;
  savedBy: number;
}): Promise<ProjectCloseHandoffBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("项目不存在");
  if (!project.productId) throw new Error("项目未关联产品，不能建立关闭移交单");
  if (!project.resultRevisionId) throw new Error("量产版本尚未发布，不能提交关闭移交");
  const uniqueItems = new Map(input.items.map((item) => [item.itemKey, item]));
  const bundle = await db.transaction(async (tx) => {
    await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${`${input.projectId}:close-handoff`}))`);
    const [handoff] = await tx.insert(projectCloseHandoffs).values({
      projectId: input.projectId,
      productId: project.productId!,
      revisionId: project.resultRevisionId,
      status: "draft",
      maintenanceOwnerUserId: input.maintenanceOwnerUserId,
      afterSalesOwnerUserId: input.afterSalesOwnerUserId,
      scopeSummary: input.scopeSummary.trim(),
      submittedBy: null,
      submittedAt: null,
      acceptedBy: null,
      acceptedAt: null,
      createdBy: input.savedBy,
    }).onConflictDoUpdate({
      target: projectCloseHandoffs.projectId,
      set: {
        productId: project.productId!,
        revisionId: project.resultRevisionId,
        status: "draft",
        maintenanceOwnerUserId: input.maintenanceOwnerUserId,
        afterSalesOwnerUserId: input.afterSalesOwnerUserId,
        scopeSummary: input.scopeSummary.trim(),
        submittedBy: null,
        submittedAt: null,
        acceptedBy: null,
        acceptedAt: null,
        updatedAt: new Date(),
      },
    }).returning();
    for (const itemKey of PROJECT_CLOSE_HANDOFF_ITEM_KEYS) {
      const item = uniqueItems.get(itemKey) ?? { itemKey, completed: false, evidenceReference: null };
      await tx.insert(projectCloseHandoffItems).values({
        handoffId: handoff.id,
        itemKey,
        completed: item.completed,
        evidenceReference: item.evidenceReference?.trim() || null,
        completedBy: item.completed ? input.savedBy : null,
        completedAt: item.completed ? new Date() : null,
      }).onConflictDoUpdate({
        target: [projectCloseHandoffItems.handoffId, projectCloseHandoffItems.itemKey],
        set: {
          completed: item.completed,
          evidenceReference: item.evidenceReference?.trim() || null,
          completedBy: item.completed ? input.savedBy : null,
          completedAt: item.completed ? new Date() : null,
          updatedAt: new Date(),
        },
      });
    }
    await tx.update(actionItems).set({
      status: "closed",
      handledAt: new Date(),
      closedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(actionItems.entityType, "close_handoff"), eq(actionItems.entityId, String(handoff.id))));
    const items = await tx.select().from(projectCloseHandoffItems)
      .where(eq(projectCloseHandoffItems.handoffId, handoff.id))
      .orderBy(projectCloseHandoffItems.id);
    return { handoff, items };
  });
  return bundle;
}

export async function submitProjectCloseHandoff(projectId: string, submittedBy: number): Promise<ProjectCloseHandoffBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bundle = await getProjectCloseHandoff(projectId);
  const blockers = closeHandoffContentBlockers(bundle);
  if (!bundle || blockers.length > 0) throw new Error(`移交单尚未就绪：${blockers.join("；")}`);
  if (bundle.handoff.status === "accepted") throw new Error("移交单已被接收");
  const [handoff] = await db.update(projectCloseHandoffs).set({
    status: "pending_acceptance",
    submittedBy,
    submittedAt: new Date(),
    acceptedBy: null,
    acceptedAt: null,
    updatedAt: new Date(),
  }).where(eq(projectCloseHandoffs.id, bundle.handoff.id)).returning();
  await db.insert(actionItems).values({
    kind: "handoff_acceptance",
    projectId,
    entityType: "close_handoff",
    entityId: String(handoff.id),
    dedupeKey: `close-handoff:${handoff.id}:acceptance`,
    recipientUserId: handoff.maintenanceOwnerUserId,
    level: "owner",
    title: "请接收量产项目关闭移交",
    body: handoff.scopeSummary,
    actionUrl: buildProjectActionPath({ projectId, tab: "overview" }),
    status: "open",
    priority: "high",
    metadata: { handoffId: handoff.id, productId: handoff.productId, revisionId: handoff.revisionId },
  }).onConflictDoUpdate({
    target: actionItems.dedupeKey,
    set: {
      recipientUserId: handoff.maintenanceOwnerUserId,
      body: handoff.scopeSummary,
      status: "open",
      handledAt: null,
      closedAt: null,
      updatedAt: new Date(),
    },
  });
  return { handoff, items: bundle.items };
}

export async function acceptProjectCloseHandoff(projectId: string, acceptedBy: number, allowAdmin = false): Promise<ProjectCloseHandoffBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bundle = await getProjectCloseHandoff(projectId);
  if (!bundle) throw new Error("移交单不存在");
  const blockers = closeHandoffContentBlockers(bundle);
  if (blockers.length > 0) throw new Error(`移交单尚未就绪：${blockers.join("；")}`);
  if (bundle.handoff.status !== "pending_acceptance") throw new Error("移交单尚未提交接收");
  if (!allowAdmin && bundle.handoff.maintenanceOwnerUserId !== acceptedBy) {
    throw new Error("只有指定的产品维护责任人可以接收移交");
  }
  const handoff = await db.transaction(async (tx) => {
    const [accepted] = await tx.update(projectCloseHandoffs).set({
      status: "accepted",
      acceptedBy,
      acceptedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(projectCloseHandoffs.id, bundle.handoff.id)).returning();
    await tx.update(products).set({
      maintenanceOwnerUserId: accepted.maintenanceOwnerUserId,
      afterSalesOwnerUserId: accepted.afterSalesOwnerUserId,
      updatedAt: new Date(),
    }).where(eq(products.id, accepted.productId));
    await tx.update(actionItems).set({
      status: "done",
      handledAt: new Date(),
      closedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(actionItems.entityType, "close_handoff"), eq(actionItems.entityId, String(accepted.id))));
    return accepted;
  });
  return { handoff, items: bundle.items };
}

export async function getProjectCloseHandoffReadiness(projectId: string): Promise<{
  ready: boolean;
  status: ProjectCloseHandoff["status"] | "missing";
  blockers: string[];
  handoff: ProjectCloseHandoff | null;
  items: ProjectCloseHandoffItem[];
}> {
  const [bundle, project] = await Promise.all([
    getProjectCloseHandoff(projectId),
    getProjectById(projectId),
  ]);
  const blockers = closeHandoffContentBlockers(bundle);
  if (!project) blockers.push("项目不存在");
  else {
    if (!project.productId) blockers.push("项目未关联产品");
    if (!project.resultRevisionId) blockers.push("量产版本尚未发布");
    if (bundle && project.productId && bundle.handoff.productId !== project.productId) {
      blockers.push("移交单关联产品与项目当前产品不一致，必须重新编制");
    }
    if (bundle && project.resultRevisionId && bundle.handoff.revisionId !== project.resultRevisionId) {
      blockers.push("移交单 Revision 与项目发布版本不一致，必须重新编制");
    }
  }
  if (bundle && bundle.handoff.status !== "accepted") {
    blockers.push(bundle.handoff.status === "pending_acceptance"
      ? "产品维护责任人尚未接收移交"
      : "移交单尚未提交给产品维护责任人");
  }
  return {
    ready: blockers.length === 0,
    status: bundle?.handoff.status ?? "missing",
    blockers,
    handoff: bundle?.handoff ?? null,
    items: bundle?.items ?? [],
  };
}

export async function listProductServiceCases(productId: string): Promise<ProductServiceCase[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productServiceCases)
    .where(eq(productServiceCases.productId, productId))
    .orderBy(desc(productServiceCases.createdAt), desc(productServiceCases.id));
}

export async function createProductServiceCase(
  input: Omit<InsertProductServiceCase, "id" | "status" | "linkedEcoProjectId" | "resolutionNote" | "createdAt" | "updatedAt">,
): Promise<ProductServiceCase> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(productServiceCases).values({
    ...input,
    status: "open",
    linkedEcoProjectId: null,
    resolutionNote: null,
  }).returning();
  return row;
}

export async function updateProductServiceCase(input: {
  id: number;
  productId: string;
  status: ProductServiceCase["status"];
  ownerUserId?: number;
  linkedEcoProjectId?: string | null;
  resolutionNote?: string | null;
}): Promise<ProductServiceCase> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(productServiceCases).set({
    status: input.status,
    ownerUserId: input.ownerUserId,
    linkedEcoProjectId: input.linkedEcoProjectId,
    resolutionNote: input.resolutionNote,
    updatedAt: new Date(),
  }).where(and(eq(productServiceCases.id, input.id), eq(productServiceCases.productId, input.productId))).returning();
  if (!row) throw new Error("售后记录不存在");
  return row;
}

export type ProjectExpenseCurrencySummary = {
  currency: string;
  budgetAmountMinor: number;
  actualAmountMinor: number;
  varianceAmountMinor: number;
  itemCount: number;
};

export async function listProjectExpenses(projectId: string): Promise<ProjectExpense[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectExpenses)
    .where(eq(projectExpenses.projectId, projectId))
    .orderBy(projectExpenses.status, desc(projectExpenses.updatedAt), desc(projectExpenses.id));
}

export async function getProjectExpenseSummary(projectId: string): Promise<ProjectExpenseCurrencySummary[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    currency: projectExpenses.currency,
    budgetAmountMinor: drizzleSql<number>`coalesce(sum(${projectExpenses.budgetAmountMinor}) filter (where ${projectExpenses.status} <> 'cancelled'), 0)::int`,
    actualAmountMinor: drizzleSql<number>`coalesce(sum(${projectExpenses.actualAmountMinor}) filter (where ${projectExpenses.status} <> 'cancelled'), 0)::int`,
    itemCount: drizzleSql<number>`count(*) filter (where ${projectExpenses.status} <> 'cancelled')::int`,
  }).from(projectExpenses)
    .where(eq(projectExpenses.projectId, projectId))
    .groupBy(projectExpenses.currency)
    .orderBy(projectExpenses.currency);
  return rows.map((row) => ({
    ...row,
    varianceAmountMinor: row.actualAmountMinor - row.budgetAmountMinor,
  }));
}

export async function createProjectExpense(
  input: Omit<InsertProjectExpense, "id" | "createdAt" | "updatedAt">,
): Promise<ProjectExpense> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(projectExpenses).values(input).returning();
  return row;
}

export async function updateProjectExpense(input: {
  id: number;
  projectId: string;
  patch: Partial<Omit<InsertProjectExpense, "id" | "projectId" | "createdBy" | "createdAt" | "updatedAt">>;
}): Promise<ProjectExpense> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(projectExpenses).set({ ...input.patch, updatedAt: new Date() })
    .where(and(eq(projectExpenses.id, input.id), eq(projectExpenses.projectId, input.projectId)))
    .returning();
  if (!row) throw new Error("费用记录不存在");
  return row;
}

export async function deleteProjectExpense(id: number, projectId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.select().from(projectExpenses).where(and(
    eq(projectExpenses.id, id),
    eq(projectExpenses.projectId, projectId),
  )).limit(1);
  if (!row) throw new Error("费用记录不存在");
  if (row.actualAmountMinor > 0 || row.status === "paid") {
    throw new Error("已有实际支出或已付款的记录不能删除，请改为取消并保留审计痕迹");
  }
  await db.delete(projectExpenses).where(eq(projectExpenses.id, id));
}

export async function listProductSoftwareReleases(productId: string): Promise<ProductSoftwareRelease[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productSoftwareReleases)
    .where(eq(productSoftwareReleases.productId, productId))
    .orderBy(desc(productSoftwareReleases.createdAt), desc(productSoftwareReleases.id));
}

export async function createProductGovernanceEvent(input: Omit<InsertProductGovernanceEvent, "id" | "createdAt">): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(productGovernanceEvents).values(input);
}

export async function listProductGovernanceEvents(productId: string): Promise<ProductGovernanceEvent[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productGovernanceEvents)
    .where(eq(productGovernanceEvents.productId, productId))
    .orderBy(desc(productGovernanceEvents.createdAt), desc(productGovernanceEvents.id));
}

export async function saveProductSoftwareReleaseDraft(input: {
  id?: number | null;
  releaseNumber: string;
  productId: string;
  baseRevisionId: number;
  version: string;
  scopeSummary: string;
  releaseNotes: string;
  compatibilityNotes: string;
  safetyRelated: boolean;
  bomOrManufacturingImpact: boolean;
  regressionEvidenceReference: string;
  rolloutPlan: string;
  rollbackPlan: string;
  qaOwnerUserId: number;
  savedBy: number;
}): Promise<ProductSoftwareRelease> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (input.id) {
    const [existing] = await db.select().from(productSoftwareReleases).where(and(
      eq(productSoftwareReleases.id, input.id),
      eq(productSoftwareReleases.productId, input.productId),
    )).limit(1);
    if (!existing) throw new Error("软件发版单不存在");
    if (existing.status !== "draft") throw new Error("只有草稿状态的软件发版单可以修改");
    const [row] = await db.update(productSoftwareReleases).set({
      baseRevisionId: input.baseRevisionId,
      version: input.version.trim(),
      scopeSummary: input.scopeSummary.trim(),
      releaseNotes: input.releaseNotes.trim(),
      compatibilityNotes: input.compatibilityNotes.trim(),
      safetyRelated: input.safetyRelated,
      bomOrManufacturingImpact: input.bomOrManufacturingImpact,
      regressionEvidenceReference: input.regressionEvidenceReference.trim(),
      rolloutPlan: input.rolloutPlan.trim(),
      rollbackPlan: input.rollbackPlan.trim(),
      qaOwnerUserId: input.qaOwnerUserId,
      updatedAt: new Date(),
    }).where(eq(productSoftwareReleases.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(productSoftwareReleases).values({
    releaseNumber: input.releaseNumber,
    productId: input.productId,
    baseRevisionId: input.baseRevisionId,
    version: input.version.trim(),
    status: "draft",
    scopeSummary: input.scopeSummary.trim(),
    releaseNotes: input.releaseNotes.trim(),
    compatibilityNotes: input.compatibilityNotes.trim(),
    safetyRelated: input.safetyRelated,
    bomOrManufacturingImpact: input.bomOrManufacturingImpact,
    regressionEvidenceReference: input.regressionEvidenceReference.trim(),
    rolloutPlan: input.rolloutPlan.trim(),
    rollbackPlan: input.rollbackPlan.trim(),
    rolloutPercent: 0,
    qaOwnerUserId: input.qaOwnerUserId,
    createdBy: input.savedBy,
  }).returning();
  return row;
}

export async function submitProductSoftwareRelease(id: number, productId: string, submittedBy: number): Promise<ProductSoftwareRelease> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(productSoftwareReleases).where(and(
    eq(productSoftwareReleases.id, id), eq(productSoftwareReleases.productId, productId),
  )).limit(1);
  if (!existing) throw new Error("软件发版单不存在");
  if (existing.status !== "draft") throw new Error("只有草稿可以提交验证");
  const required = [existing.scopeSummary, existing.releaseNotes, existing.compatibilityNotes, existing.regressionEvidenceReference, existing.rolloutPlan, existing.rollbackPlan];
  if (required.some((value) => !value.trim())) throw new Error("回归证据、兼容范围、灰度计划和回滚方案必须完整");
  const [row] = await db.update(productSoftwareReleases).set({
    status: "pending_validation",
    submittedBy,
    submittedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(productSoftwareReleases.id, id)).returning();
  return row;
}

export async function validateProductSoftwareRelease(id: number, productId: string, validatedBy: number, allowAdmin = false): Promise<ProductSoftwareRelease> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(productSoftwareReleases).where(and(
    eq(productSoftwareReleases.id, id), eq(productSoftwareReleases.productId, productId),
  )).limit(1);
  if (!existing) throw new Error("软件发版单不存在");
  if (existing.status !== "pending_validation") throw new Error("发版单当前不在待验证状态");
  if (!allowAdmin && existing.qaOwnerUserId !== validatedBy) throw new Error("只有指定验证责任人可以确认回归通过");
  const [row] = await db.update(productSoftwareReleases).set({
    status: "validated",
    validatedBy,
    validatedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(productSoftwareReleases.id, id)).returning();
  return row;
}

export async function rolloutProductSoftwareRelease(input: {
  id: number;
  productId: string;
  rolloutPercent: number;
  releasedBy: number;
}): Promise<ProductSoftwareRelease> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(productSoftwareReleases).where(and(
    eq(productSoftwareReleases.id, input.id), eq(productSoftwareReleases.productId, input.productId),
  )).limit(1);
  if (!existing) throw new Error("软件发版单不存在");
  if (!["validated", "staged"].includes(existing.status)) throw new Error("只有验证通过或灰度中的版本可以推进发布");
  if (input.rolloutPercent <= existing.rolloutPercent || input.rolloutPercent > 100) throw new Error("灰度比例必须单向提高且不超过 100%");
  const [row] = await db.update(productSoftwareReleases).set({
    status: input.rolloutPercent === 100 ? "released" : "staged",
    rolloutPercent: input.rolloutPercent,
    releasedBy: input.releasedBy,
    releasedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(productSoftwareReleases.id, input.id)).returning();
  return row;
}

export async function rollbackProductSoftwareRelease(input: {
  id: number;
  productId: string;
  reason: string;
  rolledBackBy: number;
}): Promise<ProductSoftwareRelease> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(productSoftwareReleases).where(and(
    eq(productSoftwareReleases.id, input.id), eq(productSoftwareReleases.productId, input.productId),
  )).limit(1);
  if (!existing) throw new Error("软件发版单不存在");
  if (!["staged", "released"].includes(existing.status)) throw new Error("只有灰度中或已发布版本可以回滚");
  if (!input.reason.trim()) throw new Error("回滚原因不能为空");
  const [row] = await db.update(productSoftwareReleases).set({
    status: "rolled_back",
    rolledBackBy: input.rolledBackBy,
    rolledBackAt: new Date(),
    rollbackReason: input.reason.trim(),
    updatedAt: new Date(),
  }).where(eq(productSoftwareReleases.id, input.id)).returning();
  return row;
}

export async function cancelProductSoftwareRelease(input: {
  id: number;
  productId: string;
  reason: string;
}): Promise<ProductSoftwareRelease> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(productSoftwareReleases).where(and(
    eq(productSoftwareReleases.id, input.id), eq(productSoftwareReleases.productId, input.productId),
  )).limit(1);
  if (!existing) throw new Error("软件发版单不存在");
  if (!["draft", "pending_validation", "validated"].includes(existing.status)) throw new Error("灰度或正式发布后的版本不能取消，只能执行回滚");
  const [row] = await db.update(productSoftwareReleases).set({
    status: "cancelled",
    rollbackReason: input.reason.trim(),
    updatedAt: new Date(),
  }).where(eq(productSoftwareReleases.id, input.id)).returning();
  return row;
}

export type ProductEolPlanBundle = { plan: ProductEolPlan; items: ProductEolPlanItem[] };

export async function getProductEolPlan(productId: string): Promise<ProductEolPlanBundle | null> {
  const db = await getDb();
  if (!db) return null;
  const [plan] = await db.select().from(productEolPlans).where(eq(productEolPlans.productId, productId)).limit(1);
  if (!plan) return null;
  const items = await db.select().from(productEolPlanItems)
    .where(eq(productEolPlanItems.planId, plan.id))
    .orderBy(productEolPlanItems.id);
  return { plan, items };
}

export async function saveProductEolPlanDraft(input: {
  productId: string;
  reason: string;
  lastOrderDate: string;
  lastShipDate: string;
  serviceEndDate: string;
  sparePartsYears: number;
  inventoryDisposition: string;
  customerCommunicationPlan: string;
  supplierExitPlan: string;
  replacementProductId: string | null;
  ownerUserId: number;
  approverUserId: number;
  items: Array<{ itemKey: ProductEolItemKey; completed: boolean; evidenceReference: string | null }>;
  savedBy: number;
}): Promise<ProductEolPlanBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getProductEolPlan(input.productId);
  if (existing?.plan.status === "completed") throw new Error("已完成停产的产品不能重开 EOL 方案");
  if (existing && !["draft", "cancelled"].includes(existing.plan.status)) {
    throw new Error("待审批或已批准的 EOL 方案不能改写核心内容；如需变更请先取消并重新编制");
  }
  const itemByKey = new Map(input.items.map((item) => [item.itemKey, item]));
  return db.transaction(async (tx) => {
    const [plan] = await tx.insert(productEolPlans).values({
      productId: input.productId,
      status: "draft",
      reason: input.reason.trim(),
      lastOrderDate: input.lastOrderDate,
      lastShipDate: input.lastShipDate,
      serviceEndDate: input.serviceEndDate,
      sparePartsYears: input.sparePartsYears,
      inventoryDisposition: input.inventoryDisposition.trim(),
      customerCommunicationPlan: input.customerCommunicationPlan.trim(),
      supplierExitPlan: input.supplierExitPlan.trim(),
      replacementProductId: input.replacementProductId,
      ownerUserId: input.ownerUserId,
      approverUserId: input.approverUserId,
      createdBy: input.savedBy,
    }).onConflictDoUpdate({
      target: productEolPlans.productId,
      set: {
        status: "draft",
        reason: input.reason.trim(),
        lastOrderDate: input.lastOrderDate,
        lastShipDate: input.lastShipDate,
        serviceEndDate: input.serviceEndDate,
        sparePartsYears: input.sparePartsYears,
        inventoryDisposition: input.inventoryDisposition.trim(),
        customerCommunicationPlan: input.customerCommunicationPlan.trim(),
        supplierExitPlan: input.supplierExitPlan.trim(),
        replacementProductId: input.replacementProductId,
        ownerUserId: input.ownerUserId,
        approverUserId: input.approverUserId,
        submittedBy: null, submittedAt: null,
        approvedBy: null, approvedAt: null,
        cancelledBy: null, cancelledAt: null, cancellationReason: null,
        updatedAt: new Date(),
      },
    }).returning();
    for (const itemKey of PRODUCT_EOL_ITEM_KEYS) {
      const item = itemByKey.get(itemKey) ?? { itemKey, completed: false, evidenceReference: null };
      await tx.insert(productEolPlanItems).values({
        planId: plan.id,
        itemKey,
        completed: item.completed,
        evidenceReference: item.evidenceReference?.trim() || null,
        completedBy: item.completed ? input.savedBy : null,
        completedAt: item.completed ? new Date() : null,
      }).onConflictDoUpdate({
        target: [productEolPlanItems.planId, productEolPlanItems.itemKey],
        set: {
          completed: item.completed,
          evidenceReference: item.evidenceReference?.trim() || null,
          completedBy: item.completed ? input.savedBy : null,
          completedAt: item.completed ? new Date() : null,
          updatedAt: new Date(),
        },
      });
    }
    const items = await tx.select().from(productEolPlanItems).where(eq(productEolPlanItems.planId, plan.id)).orderBy(productEolPlanItems.id);
    return { plan, items };
  });
}

export async function updateProductEolPlanItems(input: {
  productId: string;
  items: Array<{ itemKey: ProductEolItemKey; completed: boolean; evidenceReference: string | null }>;
  updatedBy: number;
}): Promise<ProductEolPlanBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bundle = await getProductEolPlan(input.productId);
  if (!bundle) throw new Error("EOL 方案不存在");
  if (bundle.plan.status !== "approved") throw new Error("只有已批准的 EOL 方案可以执行关闭清单");
  const itemByKey = new Map(input.items.map((item) => [item.itemKey, item]));
  const items = await db.transaction(async (tx) => {
    for (const itemKey of PRODUCT_EOL_ITEM_KEYS) {
      const item = itemByKey.get(itemKey) ?? { itemKey, completed: false, evidenceReference: null };
      await tx.insert(productEolPlanItems).values({
        planId: bundle.plan.id,
        itemKey,
        completed: item.completed,
        evidenceReference: item.evidenceReference?.trim() || null,
        completedBy: item.completed ? input.updatedBy : null,
        completedAt: item.completed ? new Date() : null,
      }).onConflictDoUpdate({
        target: [productEolPlanItems.planId, productEolPlanItems.itemKey],
        set: {
          completed: item.completed,
          evidenceReference: item.evidenceReference?.trim() || null,
          completedBy: item.completed ? input.updatedBy : null,
          completedAt: item.completed ? new Date() : null,
          updatedAt: new Date(),
        },
      });
    }
    return tx.select().from(productEolPlanItems).where(eq(productEolPlanItems.planId, bundle.plan.id)).orderBy(productEolPlanItems.id);
  });
  return { plan: bundle.plan, items };
}

function eolPlanContentBlockers(bundle: ProductEolPlanBundle | null): string[] {
  if (!bundle) return ["尚未建立 EOL 方案"];
  const p = bundle.plan;
  const blockers: string[] = [];
  if (!p.reason.trim()) blockers.push("停产原因未填写");
  if (p.lastOrderDate > p.lastShipDate) blockers.push("末次下单日期不能晚于末次出货日期");
  if (p.lastShipDate > p.serviceEndDate) blockers.push("服务终止日期不能早于末次出货日期");
  const serviceMinimum = new Date(`${p.lastShipDate}T00:00:00Z`);
  serviceMinimum.setUTCFullYear(serviceMinimum.getUTCFullYear() + p.sparePartsYears);
  if (p.serviceEndDate < serviceMinimum.toISOString().slice(0, 10)) blockers.push("服务终止日期未覆盖承诺的备件年限");
  if (!p.inventoryDisposition.trim()) blockers.push("库存处置方案未填写");
  if (!p.customerCommunicationPlan.trim()) blockers.push("客户通知方案未填写");
  if (!p.supplierExitPlan.trim()) blockers.push("供应商退出方案未填写");
  return blockers;
}

export async function submitProductEolPlan(productId: string, submittedBy: number): Promise<ProductEolPlan> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bundle = await getProductEolPlan(productId);
  const blockers = eolPlanContentBlockers(bundle);
  if (!bundle || blockers.length > 0) throw new Error(`EOL 方案尚未就绪：${blockers.join("；")}`);
  if (bundle.plan.status !== "draft") throw new Error("只有草稿 EOL 方案可以提交审批");
  const [plan] = await db.update(productEolPlans).set({
    status: "pending_approval",
    submittedBy,
    submittedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(productEolPlans.id, bundle.plan.id)).returning();
  return plan;
}

export async function approveProductEolPlan(productId: string, approvedBy: number, allowAdmin = false): Promise<ProductEolPlan> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bundle = await getProductEolPlan(productId);
  if (!bundle) throw new Error("EOL 方案不存在");
  if (bundle.plan.status !== "pending_approval") throw new Error("EOL 方案不在待审批状态");
  if (!allowAdmin && bundle.plan.approverUserId !== approvedBy) throw new Error("只有指定审批人可以批准 EOL 方案");
  const [plan] = await db.update(productEolPlans).set({
    status: "approved",
    approvedBy,
    approvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(productEolPlans.id, bundle.plan.id)).returning();
  return plan;
}

export async function getProductEolReadiness(productId: string, todayISO = new Date().toISOString().slice(0, 10)): Promise<{
  ready: boolean;
  status: ProductEolPlan["status"] | "missing";
  blockers: string[];
  plan: ProductEolPlan | null;
  items: ProductEolPlanItem[];
}> {
  const db = await getDb();
  if (!db) return { ready: false, status: "missing", blockers: ["数据库不可用"], plan: null, items: [] };
  const bundle = await getProductEolPlan(productId);
  const blockers = eolPlanContentBlockers(bundle);
  if (bundle) {
    if (bundle.plan.status !== "approved") blockers.push(bundle.plan.status === "pending_approval" ? "EOL 方案尚未批准" : "EOL 方案尚未提交或已结束");
    if (bundle.plan.lastShipDate > todayISO) blockers.push(`末次出货日期尚未到达（${bundle.plan.lastShipDate}）`);
    const itemByKey = new Map(bundle.items.map((item) => [item.itemKey, item]));
    for (const itemKey of PRODUCT_EOL_ITEM_KEYS) {
      const item = itemByKey.get(itemKey);
      if (!item?.completed) blockers.push(`EOL 清单未完成：${itemKey}`);
      else if (!item.evidenceReference?.trim()) blockers.push(`EOL 清单缺少证据：${itemKey}`);
    }
  }
  const [activeProjects, openCriticalCases, activeReleases] = await Promise.all([
    db.select({ id: projects.id }).from(projects).where(and(eq(projects.productId, productId), eq(projects.archived, false))),
    db.select({ id: productServiceCases.id }).from(productServiceCases).where(and(
      eq(productServiceCases.productId, productId),
      inArray(productServiceCases.severity, ["P0", "P1"]),
      inArray(productServiceCases.status, ["open", "in_progress"]),
    )),
    db.select({ id: productSoftwareReleases.id }).from(productSoftwareReleases).where(and(
      eq(productSoftwareReleases.productId, productId),
      inArray(productSoftwareReleases.status, ["draft", "pending_validation", "validated", "staged"]),
    )),
  ]);
  if (activeProjects.length > 0) blockers.push(`仍有 ${activeProjects.length} 个未归档项目`);
  if (openCriticalCases.length > 0) blockers.push(`仍有 ${openCriticalCases.length} 个未关闭 P0/P1 售后问题`);
  if (activeReleases.length > 0) blockers.push(`仍有 ${activeReleases.length} 个未结束的软件发版单`);
  return { ready: blockers.length === 0, status: bundle?.plan.status ?? "missing", blockers, plan: bundle?.plan ?? null, items: bundle?.items ?? [] };
}

export async function completeProductEolPlan(productId: string, completedBy: number): Promise<ProductEolPlan> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const readiness = await getProductEolReadiness(productId);
  if (!readiness.ready || !readiness.plan) throw new Error(`产品尚不能完成停产：${readiness.blockers.join("；")}`);
  return db.transaction(async (tx) => {
    const [plan] = await tx.update(productEolPlans).set({
      status: "completed",
      completedBy,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(productEolPlans.id, readiness.plan!.id)).returning();
    await tx.update(products).set({ lifecycleState: "eol", updatedAt: new Date() }).where(eq(products.id, productId));
    return plan;
  });
}

export async function cancelProductEolPlan(productId: string, cancelledBy: number, reason: string): Promise<ProductEolPlan> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bundle = await getProductEolPlan(productId);
  if (!bundle) throw new Error("EOL 方案不存在");
  if (bundle.plan.status === "completed") throw new Error("已完成停产的方案不能取消");
  if (!reason.trim()) throw new Error("取消原因不能为空");
  const [plan] = await db.update(productEolPlans).set({
    status: "cancelled",
    cancelledBy,
    cancelledAt: new Date(),
    cancellationReason: reason.trim(),
    updatedAt: new Date(),
  }).where(eq(productEolPlans.id, bundle.plan.id)).returning();
  return plan;
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

export type ProjectPhaseProgress = { phaseId: string; total: number; done: number; progress: number };
export type ProjectProgressSummary = { progress: number; phaseProgress: ProjectPhaseProgress[] };

/**
 * §5 统一状态口径：进度只在服务端算一次，所有页面（列表/总览/详情/甘特/摘要）
 * 消费同一结果。口径与原客户端算法一致：skipped 双侧剔除；某阶段任务全被
 * skipped 视为该阶段 100%。
 */
export async function getProjectProgressSummaries(
  projectIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any,
): Promise<Map<string, ProjectProgressSummary>> {
  const map = new Map<string, ProjectProgressSummary>();
  if (projectIds.length === 0) return map;
  const db = exec ?? (await getDb());
  if (!db) return map;
  const rows = await db.select({
    projectId: projectTasks.projectId,
    phaseId: projectTasks.phaseId,
    raw: drizzleSql<number>`count(*)::int`,
    total: drizzleSql<number>`count(*) filter (where ${projectTasks.status} <> 'skipped')::int`,
    done: drizzleSql<number>`count(*) filter (where ${projectTasks.status} = 'done')::int`,
  }).from(projectTasks)
    .where(inArray(projectTasks.projectId, projectIds))
    .groupBy(projectTasks.projectId, projectTasks.phaseId);
  type AggRow = { projectId: string; phaseId: string; raw: number; total: number; done: number };
  const grouped = new Map<string, AggRow[]>();
  for (const row of rows as AggRow[]) {
    const list = grouped.get(row.projectId) ?? [];
    list.push(row);
    grouped.set(row.projectId, list);
  }
  grouped.forEach((phaseRows, projectId) => {
    let total = 0; let done = 0; let raw = 0;
    const phaseProgress = phaseRows.map((row) => {
      total += row.total; done += row.done; raw += row.raw;
      const pct = row.total === 0 ? (row.raw > 0 ? 100 : 0) : Math.round((row.done / row.total) * 100);
      return { phaseId: row.phaseId, total: row.total, done: row.done, progress: pct };
    });
    const progress = total === 0 ? (raw > 0 ? 100 : 0) : Math.round((done / total) * 100);
    map.set(projectId, { progress, phaseProgress });
  });
  return map;
}

export async function getProjectProgressSummary(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any,
): Promise<ProjectProgressSummary> {
  const map = await getProjectProgressSummaries([projectId], exec);
  return map.get(projectId) ?? { progress: 0, phaseProgress: [] };
}

export type PortfolioRow = {
  id: string; name: string; projectNumber: string; category: string; risk: string;
  sopTemplateVersion: string | null;
  customFields: unknown;
  ragLevel: RagLevel;
  ragReasons: string[];
  customer: string | null;
  currentPhase: string; startDate: string | null; targetDate: string | null; pmUserId: number | null; pmName: string | null;
  myRole?: ProjectMemberRole | null;
  progress: number;
  phaseProgress: ProjectPhaseProgress[];
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
  expenseCurrency: string | null;
  expenseCurrencyCount: number;
  expenseBudgetMinor: number | null;
  expenseActualMinor: number | null;
  expenseVarianceMinor: number | null;
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
  project: Pick<ProjectRow, "category" | "startDate" | "sopTemplateVersion" | "customFields">,
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
  // 与排期、状态、开始/完成守卫共用同一运行时图；审批裁剪不会断开上游依赖。
  const schedTasks = buildOperationalProjectSchedTasks(project, rows);
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

  const expenseAgg = await db.select({
    projectId: projectExpenses.projectId,
    currency: projectExpenses.currency,
    budgetAmountMinor: drizzleSql<number>`coalesce(sum(${projectExpenses.budgetAmountMinor}) filter (where ${projectExpenses.status} <> 'cancelled'), 0)::int`,
    actualAmountMinor: drizzleSql<number>`coalesce(sum(${projectExpenses.actualAmountMinor}) filter (where ${projectExpenses.status} <> 'cancelled'), 0)::int`,
  }).from(projectExpenses)
    .where(inArray(projectExpenses.projectId, ids))
    .groupBy(projectExpenses.projectId, projectExpenses.currency);

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
  const progressMap = await getProjectProgressSummaries(ids);
  const taskRowsByProject = new Map<string, typeof taskRows>();
  for (const row of taskRows) {
    const list = taskRowsByProject.get(row.projectId) ?? [];
    list.push(row);
    taskRowsByProject.set(row.projectId, list);
  }
  const taskByProjectTask = new Map(taskRows.map((t) => [`${t.projectId}:${t.taskId}`, t]));
  const issueMap = new Map(issueAgg.map((i) => [i.projectId, i]));
  const riskMap = new Map(riskAgg.map((r) => [r.projectId, r]));
  const expensesByProject = new Map<string, typeof expenseAgg>();
  for (const row of expenseAgg) {
    const rows = expensesByProject.get(row.projectId) ?? [];
    rows.push(row);
    expensesByProject.set(row.projectId, rows);
  }
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
    const canViewExpenses = viewerIsAdmin || !!myRole && ["owner", "manager", "project_manager", "pm", "scm"].includes(myRole);
    const expenseRows = canViewExpenses ? (expensesByProject.get(p.id) ?? []) : [];
    const singleExpense = expenseRows.length === 1 ? expenseRows[0] : null;
    const phases = getEffectivePhasesForProjectLike(p);
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
      sopTemplateVersion: p.sopTemplateVersion,
      customFields: p.customFields,
      ragLevel: isExternalRole ? "green" as RagLevel : health.ragLevel,
      ragReasons: isExternalRole ? [] : health.reasons,
      customer: p.customer ?? null,
      currentPhase: p.currentPhase, startDate: p.startDate, targetDate: p.targetDate,
      pmUserId: p.pmUserId ?? null,
      pmName: p.pmUserId ? (pmName.get(p.pmUserId) ?? null) : null,
      // 当前用户对本项目的有效角色（成员角色 ∪ pm/owner/admin 兜底），供前端定视角
      myRole,
      progress: progressMap.get(p.id)?.progress ?? 0,
      phaseProgress: isExternalRole ? [] : progressMap.get(p.id)?.phaseProgress ?? [],
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
      expenseCurrency: singleExpense?.currency ?? null,
      expenseCurrencyCount: expenseRows.length,
      expenseBudgetMinor: singleExpense?.budgetAmountMinor ?? null,
      expenseActualMinor: singleExpense?.actualAmountMinor ?? null,
      expenseVarianceMinor: singleExpense ? singleExpense.actualAmountMinor - singleExpense.budgetAmountMinor : null,
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
  const projRows = await db.select().from(projects).where(and(
    eq(projects.archived, false),
    eq(projects.lifecycle, "active"),
  ));
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
    const phases = getEffectivePhasesForProjectLike(p);
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
      extraRoles: projectMembers.extraRoles,
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

export async function listProjectRoleDelegations(projectId: string): Promise<ProjectRoleDelegation[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectRoleDelegations)
    .where(eq(projectRoleDelegations.projectId, projectId))
    .orderBy(desc(projectRoleDelegations.createdAt));
}

export async function getActiveProjectRoleDelegationsForUser(
  projectId: string,
  userId: number,
  today: string,
): Promise<ProjectRoleDelegation[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectRoleDelegations).where(and(
    eq(projectRoleDelegations.projectId, projectId),
    eq(projectRoleDelegations.toUserId, userId),
    eq(projectRoleDelegations.active, true),
    lte(projectRoleDelegations.startDate, today),
    gte(projectRoleDelegations.endDate, today),
  ));
}

export async function createProjectRoleDelegation(
  input: InsertProjectRoleDelegation,
): Promise<ProjectRoleDelegation> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(projectRoleDelegations).values(input).returning();
  return row;
}

export async function revokeProjectRoleDelegation(
  projectId: string,
  id: number,
  revokedBy: number,
): Promise<ProjectRoleDelegation | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.update(projectRoleDelegations).set({
    active: false,
    revokedBy,
    revokedAt: new Date(),
  }).where(and(
    eq(projectRoleDelegations.id, id),
    eq(projectRoleDelegations.projectId, projectId),
    eq(projectRoleDelegations.active, true),
  )).returning();
  return row;
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
  if (existing) {
    if (role !== "owner" && role !== existing.role) {
      const extraRoles = normalizeExtraRoles(existing.role, [...existing.extraRoles, role]);
      await db.update(projectMembers)
        .set({ extraRoles })
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    }
    return false;
  }
  await db.insert(projectMembers).values({ projectId, userId, role, invitedBy });
  return true;
}

/** Update a member's role or jobTitle */
export async function updateProjectMember(
  projectId: string,
  userId: number,
  patch: { role?: ProjectMemberRole; extraRoles?: ProjectMemberRole[]; jobTitle?: string | null }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getProjectMember(projectId, userId);
  if (!existing) return;
  const role = patch.role ?? existing.role;
  const normalizedPatch = {
    ...patch,
    extraRoles: normalizeExtraRoles(role, patch.extraRoles ?? existing.extraRoles),
  };
  await db
    .update(projectMembers)
    .set(normalizedPatch)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

/** Remove a member from a project */
export async function removeProjectMember(projectId: string, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async (tx) => {
    const [project] = await tx.select({
      createdBy: projects.createdBy,
      pmUserId: projects.pmUserId,
    }).from(projects).where(eq(projects.id, projectId)).limit(1);
    const replacementReviewer = project?.pmUserId && project.pmUserId !== userId
      ? project.pmUserId
      : project?.createdBy;
    const now = new Date();

    await tx.update(projectTasks).set({
      assigneeUserId: null,
      updatedAt: now,
    }).where(and(
      eq(projectTasks.projectId, projectId),
      eq(projectTasks.assigneeUserId, userId),
    ));
    await tx.update(projectTasks).set({
      requiresApproval: false,
      approverUserId: null,
      approvalStatus: "none",
      approvalNote: null,
      approvalRequestedBy: null,
      approvalRequestedAt: null,
      approvalDecidedBy: null,
      approvalDecidedAt: null,
      status: drizzleSql`CASE WHEN ${projectTasks.status} = 'pending_approval' THEN 'todo'::task_status ELSE ${projectTasks.status} END`,
      updatedAt: now,
    }).where(and(
      eq(projectTasks.projectId, projectId),
      eq(projectTasks.approverUserId, userId),
    ));
    if (replacementReviewer && replacementReviewer !== userId) {
      await tx.update(projectDeliverableReviews).set({
        reviewerUserId: replacementReviewer,
        updatedAt: now,
      }).where(and(
        eq(projectDeliverableReviews.projectId, projectId),
        eq(projectDeliverableReviews.reviewerUserId, userId),
        eq(projectDeliverableReviews.status, "pending"),
      ));
    }
    await tx.update(actionItems).set({
      status: "closed",
      handledAt: now,
      closedAt: now,
      updatedAt: now,
    }).where(and(
      eq(actionItems.projectId, projectId),
      eq(actionItems.recipientUserId, userId),
      inArray(actionItems.status, ACTIVE_ACTION_ITEM_STATUSES),
    ));
    if (project?.pmUserId === userId) {
      await tx.update(projects).set({ pmUserId: null, updatedAt: now }).where(eq(projects.id, projectId));
    }
    await tx.delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  });
}

/** Current access check used immediately before automation/action-item delivery. */
export async function canReceiveProjectNotification(projectId: string, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [project] = await db.select({
    createdBy: projects.createdBy,
    pmUserId: projects.pmUserId,
    archived: projects.archived,
    lifecycle: projects.lifecycle,
  }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.archived || project.lifecycle !== "active") return false;
  if (project.createdBy === userId || project.pmUserId === userId) return true;
  const [member] = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(and(
    eq(projectMembers.projectId, projectId),
    eq(projectMembers.userId, userId),
  )).limit(1);
  return Boolean(member);
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
    completedBy?: number | null;
    updatedBy?: number | null;
    dueDate?: string | null;
    startDate?: string | null;
    actualStartedAt?: Date | null;
    completionNote?: string | null;
    requiresApproval?: boolean;
    approverUserId?: number | null;
    approvalStatus?: TaskApprovalStatus;
    approvalNote?: string | null;
    approvalRequestedBy?: number | null;
    approvalRequestedAt?: Date | null;
    approvalDecidedBy?: number | null;
    approvalDecidedAt?: Date | null;
    approvalActedAsRole?: ProjectMemberRole | null;
    approvalViaDelegationId?: number | null;
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
  return phaseId === "evt" || phaseId === "dvt" || phaseId === "verification" || phaseId === "pvt";
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

// ── 项目集 helpers ────────────────────────────────────────────────────────────

export type ProjectCollectionWithCount = ProjectCollection & { projectCount: number };

/** List all collections with their project counts (newest first). */
export async function listProjectCollections(): Promise<ProjectCollectionWithCount[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      collection: projectCollections,
      projectCount: drizzleSql<number>`count(${projectCollectionItems.id})::int`,
    })
    .from(projectCollections)
    .leftJoin(projectCollectionItems, eq(projectCollectionItems.collectionId, projectCollections.id))
    .groupBy(projectCollections.id)
    .orderBy(desc(projectCollections.createdAt));
  return rows.map((r) => ({ ...r.collection, projectCount: r.projectCount }));
}

export async function getProjectCollection(id: string): Promise<ProjectCollection | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(projectCollections).where(eq(projectCollections.id, id)).limit(1);
  return rows[0];
}

/** Create a collection; returns the new id. Name is globally unique (uq_project_collection_name). */
export async function createProjectCollection(input: {
  name: string;
  description?: string | null;
  createdBy: number;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = `col_${nanoid(12)}`;
  await db.insert(projectCollections).values({ id, ...input });
  return id;
}

export async function updateProjectCollection(
  id: string,
  patch: Partial<Pick<ProjectCollection, "name" | "description">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectCollections).set(patch).where(eq(projectCollections.id, id));
}

export async function deleteProjectCollection(id: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectCollections).where(eq(projectCollections.id, id));
}

/** Add projects to a collection (idempotent — existing memberships are skipped). */
export async function addProjectsToCollection(
  collectionId: string,
  projectIds: string[],
  addedBy: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (projectIds.length === 0) return;
  await db
    .insert(projectCollectionItems)
    .values(projectIds.map((projectId) => ({ collectionId, projectId, addedBy })))
    .onConflictDoNothing();
}

export async function removeProjectFromCollection(collectionId: string, projectId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(projectCollectionItems)
    .where(and(eq(projectCollectionItems.collectionId, collectionId), eq(projectCollectionItems.projectId, projectId)));
}

export type CollectionProjectRow = {
  id: string;
  name: string;
  category: string;
  sopTemplateVersion: string | null;
  customFields: unknown;
  currentPhase: string | null;
  progress: number | null;
  pmUserId: number | null;
  archived: boolean;
  lifecycle: string;
  addedAt: Date;
};

/** Projects inside a collection (display fields only), oldest membership first. */
export async function listCollectionProjects(collectionId: string): Promise<CollectionProjectRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: projects.id,
      name: projects.name,
      category: projects.category,
      sopTemplateVersion: projects.sopTemplateVersion,
      customFields: projects.customFields,
      currentPhase: projects.currentPhase,
      progress: projects.progress,
      pmUserId: projects.pmUserId,
      archived: projects.archived,
      lifecycle: projects.lifecycle,
      addedAt: projectCollectionItems.createdAt,
    })
    .from(projectCollectionItems)
    .innerJoin(projects, eq(projects.id, projectCollectionItems.projectId))
    .where(eq(projectCollectionItems.collectionId, collectionId))
    .orderBy(projectCollectionItems.createdAt);
}

/** Collection ids a project belongs to. */
export async function getCollectionIdsForProject(projectId: string): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ collectionId: projectCollectionItems.collectionId })
    .from(projectCollectionItems)
    .where(eq(projectCollectionItems.projectId, projectId));
  return rows.map((r) => r.collectionId);
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
        inArray(projectTestCases.phaseId, [...MANAGEMENT_VALIDATION_PHASES])
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

export async function getOpenProjectGateSignoffRound(
  projectId: string,
  phaseId: string,
): Promise<ProjectGateSignoffRound | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(projectGateSignoffRounds).where(and(
    eq(projectGateSignoffRounds.projectId, projectId),
    eq(projectGateSignoffRounds.phaseId, phaseId),
    eq(projectGateSignoffRounds.status, "open"),
  )).orderBy(desc(projectGateSignoffRounds.roundNumber)).limit(1);
  return row ?? null;
}

export async function listProjectGateSignoffAdditions(
  projectId: string,
  phaseId: string,
): Promise<ProjectGateSignoffAddition[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectGateSignoffAdditions).where(and(
    eq(projectGateSignoffAdditions.projectId, projectId),
    eq(projectGateSignoffAdditions.phaseId, phaseId),
    eq(projectGateSignoffAdditions.active, true),
  )).orderBy(projectGateSignoffAdditions.id);
}

async function buildProjectGateSignoffRequirementPreview(
  projectId: string,
  phaseId: string,
): Promise<Record<GateSignoffSlot, GateSignoffRequirement>> {
  const project = await getProjectById(projectId);
  if (!project) throw new Error("Project not found");
  const phase = getEffectivePhasesForProjectLike(project).find((item) => item.id === phaseId);
  if (!phase) throw new Error("Gate phase not found");
  const additions = await listProjectGateSignoffAdditions(projectId, phaseId);
  const additionMap = Object.fromEntries(additions.map((row) => [row.slot, row.requirement])) as Partial<Record<GateSignoffSlot, GateSignoffRequirement>>;
  return buildGateSignoffRequirements(project.category, phase, project, additionMap);
}

export async function getCurrentGateSignoffRound(projectId: string, phaseId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 1;
  const open = await getOpenProjectGateSignoffRound(projectId, phaseId);
  if (open) return open.roundNumber;
  const [reviewMax, snapshotMax, signatureMax] = await Promise.all([
    db.select({ value: drizzleSql<number>`coalesce(max(${projectGateReviews.roundNumber}), 0)::int` })
      .from(projectGateReviews).where(and(eq(projectGateReviews.projectId, projectId), eq(projectGateReviews.phaseId, phaseId))),
    db.select({ value: drizzleSql<number>`coalesce(max(${projectGateSignoffRounds.roundNumber}), 0)::int` })
      .from(projectGateSignoffRounds).where(and(eq(projectGateSignoffRounds.projectId, projectId), eq(projectGateSignoffRounds.phaseId, phaseId))),
    db.select({ value: drizzleSql<number>`coalesce(max(${projectGateSignoffs.roundNumber}), 0)::int` })
      .from(projectGateSignoffs).where(and(eq(projectGateSignoffs.projectId, projectId), eq(projectGateSignoffs.phaseId, phaseId))),
  ]);
  const maxRound = Math.max(reviewMax[0]?.value ?? 0, snapshotMax[0]?.value ?? 0, signatureMax[0]?.value ?? 0);
  if (maxRound === 0) return 1;
  const [latestSnapshot] = await db.select({ status: projectGateSignoffRounds.status })
    .from(projectGateSignoffRounds)
    .where(and(eq(projectGateSignoffRounds.projectId, projectId), eq(projectGateSignoffRounds.phaseId, phaseId)))
    .orderBy(desc(projectGateSignoffRounds.roundNumber)).limit(1);
  if (latestSnapshot?.status === "superseded") return maxRound + 1;
  const reviews = await getProjectGateReviews(projectId, phaseId);
  const latest = pickLatestReview(reviews);
  return latest?.decision === "rejected" ? maxRound + 1 : maxRound;
}

export async function getProjectGateSignoffRequirements(
  projectId: string,
  phaseId: string,
): Promise<Record<GateSignoffSlot, GateSignoffRequirement>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const roundNumber = await getCurrentGateSignoffRound(projectId, phaseId);
  const [snapshot] = await db.select().from(projectGateSignoffRounds).where(and(
    eq(projectGateSignoffRounds.projectId, projectId),
    eq(projectGateSignoffRounds.phaseId, phaseId),
    eq(projectGateSignoffRounds.roundNumber, roundNumber),
  )).limit(1);
  return snapshot?.requirements ?? buildProjectGateSignoffRequirementPreview(projectId, phaseId);
}

export async function openProjectGateSignoffRound(input: {
  projectId: string;
  phaseId: string;
  openedBy: number;
}): Promise<ProjectGateSignoffRound> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [project, requirements, declaration] = await Promise.all([
    getProjectById(input.projectId),
    buildProjectGateSignoffRequirementPreview(input.projectId, input.phaseId),
    getLatestProjectChangeScopeDeclaration(input.projectId),
  ]);
  if (!project) throw new Error("Project not found");
  return db.transaction(async (tx) => {
    await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${`${input.projectId}:${input.phaseId}:signoff-round`}))`);
    const [existing] = await tx.select().from(projectGateSignoffRounds).where(and(
      eq(projectGateSignoffRounds.projectId, input.projectId),
      eq(projectGateSignoffRounds.phaseId, input.phaseId),
      eq(projectGateSignoffRounds.status, "open"),
    )).orderBy(desc(projectGateSignoffRounds.roundNumber)).limit(1);
    if (existing) return existing;
    const [roundMax] = await tx.select({
      value: drizzleSql<number>`greatest(
        coalesce((select max("roundNumber") from "project_gate_reviews" where "projectId" = ${input.projectId} and "phaseId" = ${input.phaseId}), 0),
        coalesce((select max("roundNumber") from "project_gate_signoff_rounds" where "projectId" = ${input.projectId} and "phaseId" = ${input.phaseId}), 0),
        coalesce((select max("roundNumber") from "project_gate_signoffs" where "projectId" = ${input.projectId} and "phaseId" = ${input.phaseId}), 0)
      )::int`,
    }).from(projects).where(eq(projects.id, input.projectId));
    const existingReviews = await tx.select({ decision: projectGateReviews.decision, roundNumber: projectGateReviews.roundNumber })
      .from(projectGateReviews)
      .where(and(eq(projectGateReviews.projectId, input.projectId), eq(projectGateReviews.phaseId, input.phaseId)))
      .orderBy(desc(projectGateReviews.roundNumber), desc(projectGateReviews.id)).limit(1);
    const existingSnapshots = await tx.select({ id: projectGateSignoffRounds.id })
      .from(projectGateSignoffRounds)
      .where(and(eq(projectGateSignoffRounds.projectId, input.projectId), eq(projectGateSignoffRounds.phaseId, input.phaseId)))
      .limit(1);
    const maxRound = roundMax?.value ?? 0;
    const hasUnsignedLegacyRound = maxRound > 0 && existingReviews.length === 0 && existingSnapshots.length === 0;
    const roundNumber = maxRound === 0 ? 1 : hasUnsignedLegacyRound ? maxRound : maxRound + 1;
    const [row] = await tx.insert(projectGateSignoffRounds).values({
      projectId: input.projectId,
      phaseId: input.phaseId,
      roundNumber,
      status: "open",
      requirements,
      riskSnapshot: {
        safetyRiskLevel: project.safetyRiskLevel,
        regulatoryRiskLevel: project.regulatoryRiskLevel,
        safetyReasons: declaration?.assessment.safetyReasons ?? [],
        regulatoryReasons: declaration?.assessment.regulatoryReasons ?? [],
      },
      sopTemplateVersion: project.sopTemplateVersion,
      openedBy: input.openedBy,
    } as InsertProjectGateSignoffRound).returning();
    return row;
  });
}

export async function supersedeOpenGateSignoffRounds(
  projectId: string,
  actorId: number,
  reason: string,
  phaseId?: string,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const where = phaseId
    ? and(eq(projectGateSignoffRounds.projectId, projectId), eq(projectGateSignoffRounds.phaseId, phaseId), eq(projectGateSignoffRounds.status, "open"))
    : and(eq(projectGateSignoffRounds.projectId, projectId), eq(projectGateSignoffRounds.status, "open"));
  const rows = await db.update(projectGateSignoffRounds).set({
    status: "superseded",
    supersededBy: actorId,
    supersededAt: new Date(),
    supersedeReason: reason,
    updatedAt: new Date(),
  }).where(where).returning({ id: projectGateSignoffRounds.id });
  return rows.length;
}

export async function addProjectGateSignoffRequirement(input: {
  projectId: string;
  phaseId: string;
  slot: GateSignoffSlot;
  requirement: Exclude<GateSignoffRequirement, "not_applicable">;
  reason: string;
  addedBy: number;
}): Promise<ProjectGateSignoffAddition> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const preview = await buildProjectGateSignoffRequirementPreview(input.projectId, input.phaseId);
  const promoted = promoteGateSignoffRequirement(preview[input.slot], input.requirement);
  if (promoted === preview[input.slot]) throw new Error("该槽位已达到相同或更高要求，不能降级或重复加签");
  const [row] = await db.insert(projectGateSignoffAdditions).values({ ...input, active: true } as InsertProjectGateSignoffAddition)
    .onConflictDoUpdate({
      target: [projectGateSignoffAdditions.projectId, projectGateSignoffAdditions.phaseId, projectGateSignoffAdditions.slot],
      set: { requirement: promoted, reason: input.reason, active: true, addedBy: input.addedBy, updatedAt: new Date() },
    }).returning();
  await supersedeOpenGateSignoffRounds(input.projectId, input.addedBy, `项目级加签：${input.slot}`, input.phaseId);
  return row;
}

export async function listProjectGateSignoffs(
  projectId: string,
  phaseId: string,
  roundNumber?: number,
): Promise<ProjectGateSignoff[]> {
  const db = await getDb();
  if (!db) return [];
  const round = roundNumber ?? await getCurrentGateSignoffRound(projectId, phaseId);
  return db.select().from(projectGateSignoffs).where(and(
    eq(projectGateSignoffs.projectId, projectId),
    eq(projectGateSignoffs.phaseId, phaseId),
    eq(projectGateSignoffs.roundNumber, round),
  )).orderBy(projectGateSignoffs.id);
}

export async function upsertProjectGateSignoff(input: {
  projectId: string;
  phaseId: string;
  roundNumber: number;
  slot: GateSignoffSlot;
  requirement: GateSignoffRequirement;
  status: GateSignoffStatus;
  signedBy: number | null;
  note?: string | null;
  viaDelegationId?: number | null;
}): Promise<ProjectGateSignoff> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(projectGateSignoffs).values({
    ...input,
    signedAt: input.status === "pending" || input.status === "not_applicable" ? null : new Date(),
    note: input.note ?? null,
  } as InsertProjectGateSignoff).onConflictDoUpdate({
    target: [
      projectGateSignoffs.projectId,
      projectGateSignoffs.phaseId,
      projectGateSignoffs.roundNumber,
      projectGateSignoffs.slot,
    ],
    set: {
      requirement: input.requirement,
      status: input.status,
      signedBy: input.signedBy,
      signedAt: input.status === "pending" || input.status === "not_applicable" ? null : new Date(),
      note: input.note ?? null,
      viaDelegationId: input.viaDelegationId ?? null,
      updatedAt: new Date(),
    },
  }).returning();
  return row;
}

export async function assertProjectGateSignoffsComplete(projectId: string, phaseId: string, actorId?: number): Promise<void> {
  if (actorId && !(await getOpenProjectGateSignoffRound(projectId, phaseId))) {
    await openProjectGateSignoffRound({ projectId, phaseId, openedBy: actorId });
  }
  const [requirements, roundNumber] = await Promise.all([
    getProjectGateSignoffRequirements(projectId, phaseId),
    getCurrentGateSignoffRound(projectId, phaseId),
  ]);
  const rows = await listProjectGateSignoffs(projectId, phaseId, roundNumber);
  const statuses = Object.fromEntries(rows.map((row) => [row.slot, row.status])) as Partial<Record<GateSignoffSlot, GateSignoffStatus>>;
  const result = gateSignoffsReady(requirements, statuses);
  if (!result.ready) throw new Error(`Gate 会签未完成：${result.blockers.join("；")}`);
}

/** Create a gate review */
export type GateConditionInput = { description: string; ownerUserId: number; dueDate: string };

export async function createProjectGateReview(
  review: InsertProjectGateReview & { conditionItems?: GateConditionInput[] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { conditionItems = [], ...storedReview } = review;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async (tx: any): Promise<number> => {
    await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${`${storedReview.projectId}:${storedReview.phaseId}`}))`);
    const [openRound] = await tx.select().from(projectGateSignoffRounds).where(and(
      eq(projectGateSignoffRounds.projectId, storedReview.projectId),
      eq(projectGateSignoffRounds.phaseId, storedReview.phaseId),
      eq(projectGateSignoffRounds.status, "open"),
    )).orderBy(desc(projectGateSignoffRounds.roundNumber)).limit(1);
    const latest = await tx
      .select({ maxRound: drizzleSql<number>`coalesce(max(${projectGateReviews.roundNumber}), 0)::int` })
      .from(projectGateReviews)
      .where(and(
        eq(projectGateReviews.projectId, storedReview.projectId),
        eq(projectGateReviews.phaseId, storedReview.phaseId),
      ));
    const nextRound = openRound?.roundNumber ?? ((latest[0]?.maxRound ?? 0) + 1);
    const traceSnapshot = await buildGateReviewTraceSnapshot(tx, storedReview);
    const result = await tx
      .insert(projectGateReviews)
      .values({
        ...storedReview,
        roundNumber: nextRound,
        productId: traceSnapshot.product?.id ?? null,
        baseRevisionId: traceSnapshot.baseRevision?.id ?? null,
        resultRevisionId: traceSnapshot.resultRevision?.id ?? null,
        traceSnapshot,
      })
      .returning({ id: projectGateReviews.id });
    if (openRound) {
      await tx.update(projectGateSignoffRounds).set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(projectGateSignoffRounds.id, openRound.id));
    }
    const reviewId = result[0].id;
    if (
      storedReview.decision === "conditional" &&
      conditionItems.length > 0
    ) {
      for (let index = 0; index < conditionItems.length; index += 1) {
        const item = conditionItems[index];
        await createProjectCondition({
          projectId: storedReview.projectId,
          sourceType: "gate",
          sourceId: `${reviewId}:${index + 1}`,
          title: `${storedReview.gateName || storedReview.phaseName || storedReview.phaseId} 条件 ${index + 1}`,
          description: item.description,
          ownerUserId: item.ownerUserId,
          dueDate: item.dueDate,
          linkedEcoProjectId: null,
          resolutionNote: null,
          createdBy: storedReview.createdBy ?? item.ownerUserId,
        }, tx);
      }
    } else if (
      storedReview.decision === "conditional" &&
      storedReview.conditions?.trim() &&
      storedReview.conditionOwnerUserId &&
      storedReview.conditionDueDate
    ) {
      await createProjectCondition({
        projectId: storedReview.projectId,
        sourceType: "gate",
        sourceId: String(reviewId),
        title: `${storedReview.gateName || storedReview.phaseName || storedReview.phaseId} 条件项`,
        description: storedReview.conditions,
        ownerUserId: storedReview.conditionOwnerUserId,
        dueDate: storedReview.conditionDueDate,
        linkedEcoProjectId: null,
        resolutionNote: null,
        createdBy: storedReview.createdBy ?? storedReview.conditionOwnerUserId,
      }, tx);
    }
    return reviewId;
  };
  // exec 传入外层事务则并入之（advisory lock 绑定该事务）；否则自开事务
  if (exec) return run(exec);
  return db.transaction(run);
}

export async function listProjectStabilityReports(projectId: string): Promise<ProjectStabilityReport[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectStabilityReports)
    .where(eq(projectStabilityReports.projectId, projectId))
    .orderBy(projectStabilityReports.periodStart, projectStabilityReports.id);
}

export async function createProjectStabilityReport(
  input: Omit<InsertProjectStabilityReport, "id" | "createdAt" | "updatedAt" | "qaConfirmedBy" | "qaConfirmedAt">,
): Promise<ProjectStabilityReport> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (input.periodEnd < input.periodStart) throw new Error("稳定记录结束日期不能早于开始日期");
  const outputQuantity = input.outputQuantity ?? 0;
  const targetOutputQuantity = input.targetOutputQuantity ?? 0;
  const fpyBasisPoints = input.fpyBasisPoints ?? 0;
  const targetFpyBasisPoints = input.targetFpyBasisPoints ?? 0;
  const capacityAttainmentBasisPoints = input.capacityAttainmentBasisPoints ?? 0;
  if (outputQuantity < 0 || targetOutputQuantity <= 0) {
    throw new Error("稳定记录必须填写大于 0 的目标产量，实际产量不能为负数");
  }
  if (
    fpyBasisPoints < 0 || fpyBasisPoints > 10_000 ||
    targetFpyBasisPoints <= 0 || targetFpyBasisPoints > 10_000
  ) {
    throw new Error("稳定记录必须填写 0–100% 的实际 FPY 和大于 0 的目标 FPY");
  }
  if (capacityAttainmentBasisPoints < 0 || capacityAttainmentBasisPoints > 10_000) {
    throw new Error("产能达成率必须在 0–100% 之间");
  }
  const release = await getMpReleaseByProjectId(input.projectId);
  if (!release) throw new Error("量产版本尚未发布，不能填写稳定期记录");
  const releaseISO = release.releasedAt.toISOString().slice(0, 10);
  if (input.periodStart < releaseISO) throw new Error("稳定记录周期必须从量产发布日之后开始");
  const overlap = await db.select({ id: projectStabilityReports.id }).from(projectStabilityReports).where(and(
    eq(projectStabilityReports.projectId, input.projectId),
    lte(projectStabilityReports.periodStart, input.periodEnd),
    gte(projectStabilityReports.periodEnd, input.periodStart),
  )).limit(1);
  if (overlap.length > 0) throw new Error("稳定记录周期不能重叠");
  const [row] = await db.insert(projectStabilityReports).values(input).returning();
  return row;
}

export async function confirmProjectStabilityReport(reportId: number, projectId: string, qaUserId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectStabilityReports).set({
    qaConfirmedBy: qaUserId,
    qaConfirmedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(projectStabilityReports.id, reportId), eq(projectStabilityReports.projectId, projectId)));
}

function coveredCalendarDays(rows: ProjectStabilityReport[]): number {
  const day = 86_400_000;
  const periods = rows.map((row) => ({
    start: Date.parse(`${row.periodStart}T00:00:00Z`),
    end: Date.parse(`${row.periodEnd}T00:00:00Z`),
  })).filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end)).sort((a, b) => a.start - b.start);
  let total = 0;
  let cursorStart: number | null = null;
  let cursorEnd: number | null = null;
  for (const period of periods) {
    if (cursorStart === null || cursorEnd === null) {
      cursorStart = period.start;
      cursorEnd = period.end;
    } else if (period.start <= cursorEnd + day) {
      cursorEnd = Math.max(cursorEnd, period.end);
    } else {
      total += Math.floor((cursorEnd - cursorStart) / day) + 1;
      cursorStart = period.start;
      cursorEnd = period.end;
    }
  }
  if (cursorStart !== null && cursorEnd !== null) total += Math.floor((cursorEnd - cursorStart) / day) + 1;
  return total;
}

export async function getProjectStabilityReadiness(projectId: string): Promise<{
  ready: boolean;
  confirmedReportCount: number;
  coveredDays: number;
  blockers: string[];
}> {
  const [reports, openP0P1] = await Promise.all([
    listProjectStabilityReports(projectId),
    getOpenP0P1Count(projectId),
  ]);
  const confirmed = reports.filter((report) => !!report.qaConfirmedAt && !!report.qaConfirmedBy);
  const blockers: string[] = [];
  const coveredDays = coveredCalendarDays(confirmed);
  if (confirmed.length < 2) blockers.push(`至少需要 2 期经 QA 确认的稳定记录（当前 ${confirmed.length} 期）`);
  if (coveredDays < 14) blockers.push(`稳定记录累计覆盖不足 14 天（当前 ${coveredDays} 天）`);
  const belowTarget = confirmed.filter((report) =>
    (report.targetOutputQuantity > 0 && report.outputQuantity < report.targetOutputQuantity) ||
    (report.targetFpyBasisPoints > 0 && report.fpyBasisPoints < report.targetFpyBasisPoints) ||
    report.capacityAttainmentBasisPoints < 10_000
  );
  if (belowTarget.length > 0) blockers.push(`${belowTarget.length} 期稳定记录未达到产量、FPY 或目标产能`);
  if (openP0P1 > 0) blockers.push(`仍有 ${openP0P1} 个未关闭 P0/P1 问题`);
  return { ready: blockers.length === 0, confirmedReportCount: confirmed.length, coveredDays, blockers };
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
  conditionOwnerUserId?: number | null;
  conditionDueDate?: string | null;
  conditionItems?: GateConditionInput[];
  notes?: string | null;
  createdBy: number;
}): Promise<{ reviewId: number; roundNumber: number; advancedTo: string | null; closed: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("Project not found");
  if (project.currentPhase !== input.phaseId) {
    throw new Error("只能裁决项目当前阶段的 Gate");
  }
  const projectTemplatePhases = getEffectivePhasesForProjectLike(project);
  const requestedPhase = projectTemplatePhases.find((item) => item.id === input.phaseId);
  if (!requestedPhase) throw new Error("Gate phase not found");
  const gateTaskId = requestedPhase.gateTaskId;
  if (!gateTaskId) throw new Error("Gate task not found in effective phase");
  if (input.gateTaskId && input.gateTaskId !== gateTaskId) {
    throw new Error("Gate task does not match the project's effective phase");
  }
  if (
    requestedPhase.isCloseGate &&
    input.decision === "approved" &&
    project.sopTemplateVersion === SOP_TEMPLATE_VERSION_CURRENT
  ) {
    const [stability, certification, conditions, handoff] = await Promise.all([
      getProjectStabilityReadiness(input.projectId),
      getProjectCertificationCoverage(input.projectId),
      getProjectConditionsReadiness(input.projectId),
      getProjectCloseHandoffReadiness(input.projectId),
    ]);
    const blockers = [
      ...stability.blockers,
      ...certification.missing.map((item) => `缺少有效证书覆盖：${certificationRequirementLabel(item)}`),
      ...conditions.blockers.map((item) => `未闭环条件项：${item}`),
      ...handoff.blockers.map((item) => `量产移交未完成：${item}`),
    ];
    if (blockers.length > 0) throw new Error(`项目关闭条件未满足：${blockers.join("；")}`);
  }

  const { reviewId, advancedTo, closed } = await db.transaction(async (tx) => {
    const phases = projectTemplatePhases;
    const phase = phases.find((item) => item.id === input.phaseId);
    if (!phase) throw new Error("Gate phase not found");
    if (phase.isCloseGate && input.decision === "conditional") {
      throw new Error("项目关闭 Gate 不允许有条件通过；请先关闭遗留条件或选择不通过");
    }
    if (phase.isCloseGate && input.decision === "approved") {
      const released = await tx.select({ id: mpReleases.id })
        .from(mpReleases)
        .where(eq(mpReleases.projectId, input.projectId))
        .limit(1);
      if (released.length === 0) throw new Error("量产版本尚未发布，不能关闭归档项目");
    }
    const gateTaskWhere = and(
      eq(projectTasks.projectId, input.projectId),
      eq(projectTasks.phaseId, input.phaseId),
      eq(projectTasks.taskId, gateTaskId),
    );
    const [gateTask] = await tx.select({ id: projectTasks.id })
      .from(projectTasks)
      .where(gateTaskWhere)
      .limit(1);
    if (!gateTask) throw new Error("Gate task row not found");
    // Gate 评审是唯一审批链；清掉可能由旧入口遗留的普通任务审批配置，
    // 避免 setTaskCompletion 把 Gate 置为 pending_approval 后仍推进阶段。
    await tx.update(projectTasks).set({
      requiresApproval: false,
      approverUserId: null,
      approvalStatus: "none",
      approvalNote: null,
      approvalRequestedBy: null,
      approvalRequestedAt: null,
      approvalDecidedBy: null,
      approvalDecidedAt: null,
    }).where(gateTaskWhere);
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
      conditionOwnerUserId: input.conditionOwnerUserId ?? null,
      conditionDueDate: input.conditionDueDate ?? null,
      conditionItems: input.conditionItems ?? [],
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    }, tx);

    let advancedTo: string | null = null;
    let closed = false;
    if (input.decision !== "rejected") {
      // 2) 标记 gate task 完成
      await setTaskCompletion(input.projectId, input.phaseId, gateTaskId, true, input.createdBy, tx);
      // 3) 仅当复审的是「当前阶段」且存在下一阶段时才推进
      if (project.currentPhase === input.phaseId) {
        const idx = phases.findIndex((p) => p.id === input.phaseId);
        const next = idx >= 0 && idx < phases.length - 1 ? phases[idx + 1] : null;
        if (next) {
          await updateProject(input.projectId, { currentPhase: next.id }, tx);
          advancedTo = next.id;
        } else if (phase.isCloseGate && input.decision === "approved") {
          await updateProject(input.projectId, { archived: true }, tx);
          if (project.productId) {
            const [handoff] = await tx.select().from(projectCloseHandoffs)
              .where(and(
                eq(projectCloseHandoffs.projectId, input.projectId),
                eq(projectCloseHandoffs.status, "accepted"),
              ))
              .limit(1);
            if (handoff) {
              await tx.update(products).set({
                lifecycleState: "maintenance",
                maintenanceOwnerUserId: handoff.maintenanceOwnerUserId,
                afterSalesOwnerUserId: handoff.afterSalesOwnerUserId,
                updatedAt: new Date(),
              }).where(eq(products.id, project.productId));
            }
          }
          closed = true;
        }
      }
    } else {
      // A rejected Gate is an explicit business block. Persist it in the same
      // transaction as the review so task status and the review round cannot
      // diverge. A later approved/conditional round uses setTaskCompletion
      // above and moves the task to done.
      await upsertProjectTask(input.projectId, input.phaseId, gateTaskId, {
        status: "blocked",
        completedAt: null,
        updatedBy: input.createdBy,
      }, tx);
    }
    return { reviewId, advancedTo, closed };
  });

  const reviews = await getProjectGateReviews(input.projectId, input.phaseId);
  const roundNumber = reviews.find((r) => r.id === reviewId)?.roundNumber ?? 1;
  return { reviewId, roundNumber, advancedTo, closed };
}

/** Update a gate review */
export async function updateProjectGateReview(
  id: number,
  patch: Partial<Omit<InsertProjectGateReview, "id" | "projectId" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectGateReviews).set(patch).where(eq(projectGateReviews.id, id));
  const [review] = await db.select().from(projectGateReviews).where(eq(projectGateReviews.id, id)).limit(1);
  if (
    review?.decision === "conditional" &&
    review.conditions?.trim() &&
    review.conditionOwnerUserId &&
    review.conditionDueDate
  ) {
    await createProjectCondition({
      projectId: review.projectId,
      sourceType: "gate",
      sourceId: String(review.id),
      title: `${review.gateName || review.phaseName || review.phaseId} 条件项`,
      description: review.conditions,
      ownerUserId: review.conditionOwnerUserId,
      dueDate: review.conditionDueDate,
      linkedEcoProjectId: null,
      resolutionNote: null,
      createdBy: review.createdBy ?? review.conditionOwnerUserId,
    });
  }
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
  /** 人工开始的实际时刻；计划排期继续使用 projectTasks.startDate。 */
  actualStartedAt?: Date | null;
  completionNote?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  completedAt?: Date | null;
  completedBy?: number | null;
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
  approvalActedAsRole?: ProjectMemberRole | null;
  approvalViaDelegationId?: number | null;
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
    completedBy: isDone ? (patch.completedBy ?? patch.updatedBy ?? null) : null,
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

function getTaskDependencyMap(
  category: string | undefined,
  templateVersion?: string | null,
  projectLike?: ProjectTemplateLike,
  rows: ProjectTask[] = [],
): Map<string, string[]> {
  const tasks = projectLike
    ? buildOperationalProjectSchedTasks(projectLike, rows)
    : buildSchedTasks(getPhasesForCategory(category, templateVersion));
  return new Map(
    tasks.map((task) => [task.id, task.dependsOn ?? []])
  );
}

type AutomaticTaskStatusContext = {
  projectStartDate?: string | null;
  projectLike?: ProjectTemplateLike;
};

function shouldApplyDependencyBlocks(
  rows: ProjectTask[],
  todayISO: string,
  context?: AutomaticTaskStatusContext
): boolean {
  if (!context) return true;
  if (context.projectStartDate && context.projectStartDate <= todayISO) return true;
  return rows.some((row) => {
    if (row.completed || row.status === "done" || row.status === "pending_approval") return true;
    if (row.completedAt) return true;
    if (row.actualStartedAt) return true;
    return false;
  });
}

function automaticTaskStatus(
  task: ProjectTask,
  rowsByTaskId: Map<string, ProjectTask>,
  dependencies: Map<string, string[]>,
  applyDependencyBlocks: boolean
): TaskStatus {
  if (task.status === "skipped") return "skipped";
  // 待审批是显式保留态：勾完成进入待审后不被排期/依赖重算吞掉；completed 仍为 false → 下游依赖视为未完成。
  if (task.status === "pending_approval") return "pending_approval";
  if (task.completed || task.status === "done") return "done";

  if (!applyDependencyBlocks) return "todo";

  // 前置未完成 = 还没轮到 = 待开始（todo），不是阻塞。依赖只闸住"进行中"的推进；
  // "blocked" 不再由依赖图自动派生，留给显式异常场景（当前无自动写入方）。
  const unresolvedDependency = (dependencies.get(task.taskId) ?? []).some((dependencyId) => {
    const dependency = rowsByTaskId.get(dependencyId);
    if (!dependency) return true;
    return dependency.status !== "done" && dependency.status !== "skipped" && !dependency.completed;
  });
  if (unresolvedDependency) return "todo";

  // 计划开始日、负责人和到期日都不是执行承诺；只有人工「开始」会产生进行中。
  if (task.actualStartedAt) return "in_progress";
  return "todo";
}

export function applyAutomaticTaskStatuses(
  rows: ProjectTask[],
  category: string | undefined,
  todayISO = todayInShanghaiISO(),
  context?: AutomaticTaskStatusContext,
  templateVersion?: string | null,
): ProjectTask[] {
  const dependencies = getTaskDependencyMap(category, templateVersion, context?.projectLike, rows);
  const rowsByTaskId = new Map(rows.map((row) => [row.taskId, row]));
  const applyDependencyBlocks = shouldApplyDependencyBlocks(rows, todayISO, context);
  const now = new Date();

  return rows.map((row) => {
    const status = automaticTaskStatus(row, rowsByTaskId, dependencies, applyDependencyBlocks);
    const completed = status === "done";
    const completedAt = completed ? (row.completedAt ?? now) : null;
    if (row.status === status && row.completed === completed && row.completedAt === completedAt) return row;
    return { ...row, status, completed, completedAt };
  });
}

/**
 * Recalculate operational task status from dependencies, explicit human start,
 * and completion. Planned schedule and assignment never imply execution has begun.
 * Manual non-terminal status changes are intentionally not a
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

  const nextRows = applyAutomaticTaskStatuses(rows, project.category, todayISO, {
    projectStartDate: project.startDate ?? null,
    projectLike: project,
  }, project.sopTemplateVersion);
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

  // §5：projects.progress 降级为派生缓存，仅供排序/导出；页面展示一律读服务端摘要。
  // 与存量不同才写（直连 SQL 改状态后 refresh 可能 changed=0，但缓存仍需追上）。
  try {
    // 必须用当前连接（可能是未提交事务）读任务，否则全局连接看到旧状态、写回旧进度
    const summary = await getProjectProgressSummary(projectId, db);
    if (project.progress !== summary.progress) {
      await db.update(projects).set({ progress: summary.progress }).where(eq(projects.id, projectId));
    }
  } catch (error) {
    console.warn("[progress-cache] refresh write failed (non-fatal):", error);
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
      approvalActedAsRole: null,
      approvalViaDelegationId: null,
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
      status: "done", completedAt: new Date(), completedBy: updatedBy ?? null, updatedBy: updatedBy ?? null,
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

  // 取消勾选（含撤回 pending_approval）：清审批待审，status 交 refresh 归位。
  // actualStartedAt 一并清空：否则 refresh 会把任务弹回 in_progress，与
  // task.uncomplete 事件流声称的 todo 相矛盾（重新开始只需再点一次 ▶开始）。
  await upsertProjectTask(projectId, phaseId, taskId, {
    status: "todo", completedAt: null, completedBy: null, actualStartedAt: null,
    approvalStatus: "none", approvalRequestedBy: null, approvalRequestedAt: null,
    approvalActedAsRole: null, approvalViaDelegationId: null,
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
  isProxy: boolean,
  actedAsRole?: ProjectMemberRole | null,
  viaDelegationId?: number | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec?: any,
): Promise<void> {
  if (!exec) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.transaction(async (tx) => {
      await decideTaskApproval(projectId, phaseId, taskId, decision, actor, note, isProxy, actedAsRole, viaDelegationId, tx);
    });
    return;
  }
  const db = exec;
  const [current] = await db
    .select()
    .from(projectTasks)
    .where(and(
      eq(projectTasks.projectId, projectId),
      eq(projectTasks.phaseId, phaseId),
      eq(projectTasks.taskId, taskId),
    ))
    .limit(1);
  if (
    !current ||
    !current.requiresApproval ||
    current.status !== "pending_approval" ||
    current.approvalStatus !== "pending"
  ) {
    throw new Error("任务当前不在待审批状态");
  }
  const requester = current.approvalRequestedBy ?? null;
  const decidedAt = new Date();
  const [updated] = await db.update(projectTasks).set(decision === "approved" ? {
    status: "done",
    completed: true,
    completedAt: decidedAt,
    completedBy: requester,
    approvalStatus: "approved",
    approvalDecidedBy: actor,
    approvalDecidedAt: decidedAt,
    approvalNote: note,
    approvalActedAsRole: actedAsRole ?? null,
    approvalViaDelegationId: viaDelegationId ?? null,
    updatedBy: actor,
  } : {
    status: "todo",
    completed: false,
    completedAt: null,
    completedBy: null,
    approvalStatus: "rejected",
    approvalDecidedBy: actor,
    approvalDecidedAt: decidedAt,
    approvalNote: note,
    approvalActedAsRole: actedAsRole ?? null,
    approvalViaDelegationId: viaDelegationId ?? null,
    updatedBy: actor,
  }).where(and(
    eq(projectTasks.id, current.id),
    eq(projectTasks.requiresApproval, true),
    eq(projectTasks.status, "pending_approval"),
    eq(projectTasks.approvalStatus, "pending"),
  )).returning({ id: projectTasks.id });
  if (!updated) throw new Error("任务审批状态已变化，请刷新后重试");
  await refreshProjectTaskStatuses(projectId, undefined, db);
  await createActivityLog({
    projectId, userId: actor, action: decision === "approved" ? "task.approve" : "task.reject",
    entityType: "task", entityId: taskId,
    meta: { phaseId, note, approver: current?.approverUserId ?? null, requester, actedAsRole, viaDelegationId, proxyBy: isProxy ? actor : undefined },
  }, db);
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
  project: ProjectTemplateLike,
  targets: TailoringTarget[],
): Array<{ phaseId: string; taskId: string }> {
  const phases = getEffectivePhasesForProjectLike(project);
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

function assertNoReleaseGateTailoring(project: ProjectTemplateLike, targets: TailoringTarget[]): void {
  const phases = getEffectivePhasesForProjectLike(project);
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

function assertNoNpdV3RedlineTailoring(project: ProjectTemplateLike, targets: TailoringTarget[]): void {
  const phases = getEffectivePhasesForProjectLike(project);
  const redlineTaskIds = getNpdV3RedlinePolicy(project).taskIds;
  for (const target of normalizeTailoringTargets(targets)) {
    const phase = phases.find((item) => item.id === target.phaseId);
    if (!phase) continue;
    const protectedTarget = target.scope === "phase"
      ? phase.tasks.some((task) => redlineTaskIds.has(task.id))
      : phase.tasks.some((task) => task.id === target.taskId && redlineTaskIds.has(task.id));
    if (protectedTarget) {
      throw new Error("NPD v3 红线任务不可裁剪（安全/认证、量产放行、客户放行）");
    }
  }
}

function assertNoProtectedTailoring(project: ProjectTemplateLike, targets: TailoringTarget[]): void {
  // 保留既有 Release Gate 专用文案，再补项目感知的 v3 永久红线。
  assertNoReleaseGateTailoring(project, targets);
  assertNoNpdV3RedlineTailoring(project, targets);
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
  assertNoProtectedTailoring(project, targets);

  const resolvedTasks = resolveTailoringTargetTasks(project, targets);
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
  project: ProjectTemplateLike,
  targets: TailoringTarget[],
  updatedBy: number,
): Promise<void> {
  assertNoProtectedTailoring(project, targets);
  const tasks = resolveTailoringTargetTasks(project, targets);
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
    assertNoProtectedTailoring(project, tailoring.targets ?? []);
    await applyTailoringTargets(
      tailoring.projectId,
      project,
      tailoring.targets ?? [],
      input.reviewedBy,
    );
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
  const tasks = resolveTailoringTargetTasks(project, tailoring.targets ?? []);
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
  const phases = getEffectivePhasesForProjectLike(project);
  if (!phases.some((phase) => phase.id === input.nodePhaseId)) {
    throw new Error("交付物提交节点不存在");
  }

  if (
    input.action === "remove" &&
    isNpdV3RedlineAuditDeliverable(project, input.deliverableName)
  ) {
    throw new Error("NPD v3 红线审计交付物不可移除");
  }

  if (input.action !== "clear") {
    const library = getDeliverableLibraryForPhases(phases);
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
  const highRisk = isHighSopRisk(project);
  const npdV3RedlinePolicy = getNpdV3RedlinePolicy(project);
  const strategyInput = project.customFields?.derivativeReuseStrategy;
  const basePhases = getEffectivePhasesForProjectLike(project);
  const strategyTailoredTaskIds = project.category === "derivative"
    ? getDerivativeTailoredTaskIds(strategyInput, project.sopTemplateVersion)
    : new Set<string>();
  const derivativePhaseOverride = project.category === "derivative"
    ? getDerivativeEffectivePhases(strategyInput, project.sopTemplateVersion)
    : undefined;
  const phaseOverride = highRisk && derivativePhaseOverride
    ? restoreHighRiskTasks(basePhases, derivativePhaseOverride)
    : derivativePhaseOverride;
  const tailoredTaskIds = new Set<string>(sets.tailoredTaskIds);
  for (const id of Array.from(strategyTailoredTaskIds)) tailoredTaskIds.add(id);
  const protectedTaskIds = highRisk
    ? new Set(basePhases.flatMap((phase) => phase.tasks.filter(isHighRiskProtectedTask).map((task) => task.id)))
    : new Set<string>();
  for (const taskId of Array.from(protectedTaskIds)) tailoredTaskIds.delete(taskId);
  for (const phase of basePhases) {
    for (const task of phase.tasks) {
      if (!npdV3RedlinePolicy.taskIds.has(task.id)) continue;
      tailoredTaskIds.delete(task.id);
      tailoredTaskIds.delete(`${phase.id}:${task.id}`);
    }
  }
  const tailoredPhaseIds = new Set(Array.from(sets.tailoredPhaseIds).filter((phaseId) => {
    const phase = basePhases.find((item) => item.id === phaseId);
    if (!phase) return true;
    if (phase.tasks.some((task) => npdV3RedlinePolicy.taskIds.has(task.id))) return false;
    return !highRisk || !phaseContainsHighRiskControls(phase);
  }));
  return getEffectiveProcess(
    project.category,
    tailoredPhaseIds,
    tailoredTaskIds,
    overrides.map((override) => ({
      nodePhaseId: override.nodePhaseId,
      deliverableName: override.deliverableName,
      action: override.action,
    })).filter((override) => {
      if (override.action !== "remove") return true;
      if (npdV3RedlinePolicy.auditDeliverables.has(override.deliverableName)) return false;
      return !highRisk || !isHighRiskProtectedDeliverable(override.deliverableName);
    }),
    phaseOverride ?? basePhases
  );
}

export async function applyDerivativeReuseStrategyToProject(
  projectId: string,
  strategyInput: unknown,
  updatedBy: number
): Promise<{
  effectiveTasks: number;
  skippedTasks: number;
  insertedTasks: number;
  restoredTasks: number;
  obsoleteSkippedTasks: number;
  completedSkippedTasks: string[];
  autoExemptedDeliverables: string[];
  restoredDeliverables: string[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const project = await getProjectById(projectId);
  if (!project) throw new Error("Project not found");
  if (project.category !== "derivative") {
    throw new Error("流程策略仅适用于产品迭代/衍生开发项目");
  }

  const strategy = normalizeDerivativeReuseStrategy(strategyInput);
  // 重置范围限定在"等级发生变化的模块"影响的任务：同策略重放 = no-op，
  // 只调无关模块不重置其它模块已完成的工作。
  const previousStrategy = normalizeDerivativeReuseStrategy(project.customFields?.derivativeReuseStrategy);
  const changedModuleIds = Object.keys(strategy).filter(
    (moduleId) => previousStrategy[moduleId] !== strategy[moduleId]
  );
  const affectedTaskIds = getDerivativeModuleAffectedTaskIds(changedModuleIds);
  const strategyEffectiveTaskIds = getDerivativeEffectiveTaskIds(strategy, project.sopTemplateVersion);
  const derivativeTemplatePhases = getPhasesForCategory("derivative", project.sopTemplateVersion);
  const approvedTailoring = await getApprovedTailoringSets(projectId);
  const effectiveTaskIds = new Set(
    Array.from(strategyEffectiveTaskIds).filter((taskId) => !approvedTailoring.tailoredTaskIds.has(taskId))
  );
  if (isHighSopRisk(project)) {
    for (const phase of derivativeTemplatePhases) {
      for (const task of phase.tasks) {
        if (isHighRiskProtectedTask(task)) effectiveTaskIds.add(task.id);
      }
    }
  }

  const templateTasks = derivativeTemplatePhases.flatMap((phase) =>
    phase.tasks.map((task) => ({ phase, task }))
  );
  const templateTaskIds = new Set(templateTasks.map(({ task }) => task.id));
  const existingTasks = await getProjectTasks(projectId);
  const existingByKey = new Map(existingTasks.map((task) => [`${task.phaseId}:${task.taskId}`, task]));
  const rebasedTaskIds = new Set([
    "dd1", "dd2", "dd3", "dd4", "dd5",
    "de5",
    "dv1", "dv2", "dv3", "dv4", "dv5",
    "dp3", "dp4", "dp5",
  ]);

  const completedBeingTailored = templateTasks
    .filter(({ task }) => !effectiveTaskIds.has(task.id))
    .map(({ phase, task }) => existingByKey.get(`${phase.id}:${task.id}`))
    .filter((task): task is ProjectTask => !!task && !rebasedTaskIds.has(task.taskId) && (task.completed || task.status === "done" || task.status === "pending_approval"));
  if (completedBeingTailored.length > 0) {
    throw new Error(`已完成或待审批的任务不能通过流程策略裁剪: ${completedBeingTailored.map((task) => task.taskId).join(", ")}`);
  }

  const customFields = project.customFields && typeof project.customFields === "object" && !Array.isArray(project.customFields)
    ? project.customFields as Record<string, unknown>
    : {};

  let insertedTasks = 0;
  let skippedTasks = 0;
  let restoredTasks = 0;
  let obsoleteSkippedTasks = 0;
  const completedSkippedTasks: string[] = [];
  const autoExemptedDeliverables: string[] = [];
  const restoredDeliverables: string[] = [];

  await db.transaction(async (tx) => {
    await updateProject(projectId, {
      customFields: {
        ...customFields,
        derivativeReuseStrategy: strategy as DerivativeReuseStrategy,
      },
    }, tx);

    if (derivativeTemplatePhases.length > 0) {
      await tx
        .insert(projectPhases)
        .values(derivativeTemplatePhases.map((phase) => ({ projectId, phaseId: phase.id })))
        .onConflictDoNothing({
          target: [projectPhases.projectId, projectPhases.phaseId],
        });
    }

    // 先用一次 upsert 同步所有模板任务的稳定字段；状态变更再按旧快照分组批量写。
    // 这样既避免逐任务 select+write，也不会用 INSERT 默认值覆盖既有审批、排期和说明。
    const templateTaskRows = templateTasks.map(({ phase, task }) => {
      const key = `${phase.id}:${task.id}`;
      const existing = existingByKey.get(key);
      const effective = effectiveTaskIds.has(task.id);
      if (!existing) insertedTasks += 1;
      if (!effective) {
        skippedTasks += 1;
        if (existing && (existing.completed || existing.status === "done" || existing.status === "pending_approval")) {
          completedSkippedTasks.push(task.id);
        }
      }
      return {
        projectId,
        phaseId: phase.id,
        taskId: task.id,
        visibleRoles: task.visibleRoles ?? [],
        updatedBy,
      };
    });

    const templateRows = templateTaskRows.length > 0
      ? await tx
        .insert(projectTasks)
        .values(templateTaskRows)
        .onConflictDoUpdate({
          target: [projectTasks.projectId, projectTasks.phaseId, projectTasks.taskId],
          set: {
            visibleRoles: drizzleSql`excluded."visibleRoles"`,
            updatedBy: drizzleSql`excluded."updatedBy"`,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: projectTasks.id,
          phaseId: projectTasks.phaseId,
          taskId: projectTasks.taskId,
        })
      : [];
    const persistedIdByKey = new Map(
      templateRows.map((row) => [`${row.phaseId}:${row.taskId}`, row.id])
    );
    const idsFor = (predicate: (phaseId: string, taskId: string, existing: ProjectTask | undefined) => boolean) =>
      templateTasks.flatMap(({ phase, task }) => {
        const key = `${phase.id}:${task.id}`;
        return predicate(phase.id, task.id, existingByKey.get(key))
          ? [persistedIdByKey.get(key)]
          : [];
      }).filter((id): id is number => id !== undefined);

    const skippedIds = idsFor((_phaseId, taskId) => !effectiveTaskIds.has(taskId));
    if (skippedIds.length > 0) {
      const statusChangedAt = new Date();
      await tx
        .update(projectTasks)
        .set({
          status: "skipped",
          completed: false,
          completedAt: null,
          statusChangedAt: drizzleSql`case when ${projectTasks.status} <> 'skipped'::task_status then ${statusChangedAt} else ${projectTasks.statusChangedAt} end`,
          updatedBy,
        })
        .where(inArray(projectTasks.id, skippedIds));
    }

    const restoredIds = idsFor((_phaseId, taskId, existing) =>
      effectiveTaskIds.has(taskId) && existing?.status === "skipped"
    );
    restoredTasks = restoredIds.length;
    if (restoredIds.length > 0) {
      await tx
        .update(projectTasks)
        .set({
          status: "todo",
          completed: false,
          completedAt: null,
          statusChangedAt: new Date(),
          updatedBy,
        })
        .where(inArray(projectTasks.id, restoredIds));
    }

    const rebasedIds = idsFor((_phaseId, taskId, existing) =>
      effectiveTaskIds.has(taskId) && !!existing && rebasedTaskIds.has(taskId) && affectedTaskIds.has(taskId) &&
      (existing.completed || existing.status === "done" || existing.status === "pending_approval")
    );
    if (rebasedIds.length > 0) {
      await tx
        .update(projectTasks)
        .set({
          status: "todo",
          completed: false,
          completedAt: null,
          statusChangedAt: new Date(),
          approvalStatus: "none",
          approvalRequestedBy: null,
          approvalRequestedAt: null,
          approvalDecidedBy: null,
          approvalDecidedAt: null,
          approvalNote: null,
          updatedBy,
        })
        .where(inArray(projectTasks.id, rebasedIds));
    }

    const obsoleteIds = existingTasks
      .filter((row) => !templateTaskIds.has(row.taskId) && row.status !== "skipped")
      .map((row) => row.id);
    obsoleteSkippedTasks = obsoleteIds.length;
    if (obsoleteIds.length > 0) {
      await tx
        .update(projectTasks)
        .set({
          status: "skipped",
          completed: false,
          completedAt: null,
          statusChangedAt: new Date(),
          updatedBy,
        })
        .where(inArray(projectTasks.id, obsoleteIds));
    }

    // 策略 → Gate 交付物自动豁免（P1-3）：产出任务全被裁的交付物落 remove override（带自动理由），
    // 策略回调后不再命中的自动豁免撤销。只增删带 DERIVATIVE_AUTO_EXEMPT_REASON 的行，
    // PM 手动豁免（其他理由）与手动加回（action=add）一律不碰；安全锚点在推导层已排除。
    const autoTargets = getDerivativeAutoExemptDeliverables(strategy).filter(
      (target) => !(isHighSopRisk(project) && isHighRiskProtectedDeliverable(target.deliverableName))
    );
    const overrideKey = (phaseId: string, name: string) => `${phaseId}\u0000${name}`;
    const targetKeys = new Set(autoTargets.map((t) => overrideKey(t.nodePhaseId, t.deliverableName)));
    const existingOverrides = await tx
      .select()
      .from(projectDeliverableOverrides)
      .where(eq(projectDeliverableOverrides.projectId, projectId));
    const overrideByKey = new Map(
      existingOverrides.map((o) => [overrideKey(o.nodePhaseId, o.deliverableName), o])
    );
    for (const target of autoTargets) {
      if (overrideByKey.has(overrideKey(target.nodePhaseId, target.deliverableName))) continue;
      await tx.insert(projectDeliverableOverrides).values({
        projectId,
        nodePhaseId: target.nodePhaseId,
        deliverableName: target.deliverableName,
        action: "remove",
        reason: DERIVATIVE_AUTO_EXEMPT_REASON,
        createdBy: updatedBy,
      });
      autoExemptedDeliverables.push(`${target.nodePhaseId}:${target.deliverableName}`);
    }
    for (const override of existingOverrides) {
      if (
        override.action === "remove" &&
        override.reason === DERIVATIVE_AUTO_EXEMPT_REASON &&
        !targetKeys.has(overrideKey(override.nodePhaseId, override.deliverableName))
      ) {
        await tx.delete(projectDeliverableOverrides).where(eq(projectDeliverableOverrides.id, override.id));
        restoredDeliverables.push(`${override.nodePhaseId}:${override.deliverableName}`);
      }
    }
  });

  await refreshProjectTaskStatuses(projectId);

  return {
    effectiveTasks: effectiveTaskIds.size,
    skippedTasks,
    insertedTasks,
    restoredTasks,
    obsoleteSkippedTasks,
    completedSkippedTasks,
    autoExemptedDeliverables,
    restoredDeliverables,
  };
}

/**
 * 按角色把未分配的任务自动指派给对应项目成员（responsible role 取自任务 visibleRoles 首个责任角色）。
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
  const project = await getProjectById(projectId);
  const roleToUser = new Map<string, number>();
  for (const m of members) {
    for (const role of [m.role, ...normalizeExtraRoles(m.role, m.extraRoles)]) {
      if (!roleToUser.has(role)) roleToUser.set(role, m.userId);
    }
  }
  if (project?.pmUserId) roleToUser.set("project_manager", project.pmUserId);
  if (project?.createdBy) roleToUser.set("owner", project.createdBy);
  if (roleOverrides) for (const [role, userId] of Object.entries(roleOverrides)) roleToUser.set(role, userId);
  const tasks = await getProjectTasks(projectId);
  const out: Array<{ userId: number; taskId: string; phaseId: string; dueDate: string | null; instructions: string | null }> = [];
  for (const t of tasks) {
    if (t.status === "skipped") continue;
    if (t.assigneeUserId) continue; // 不覆盖已分配
    const roles = (t.visibleRoles as string[] | null) ?? [];
    // 责任角色 = visibleRoles 首个非管理层角色；Gate/无角色任务优先归项目经理/PMO。
    const primary = roles.find((r) => !["manager", "owner"].includes(r))
      ?? (roleToUser.has("project_manager") ? "project_manager" : "pm");
    const formalUserId = roleToUser.get(primary);
    const userId = formalUserId
      ?? roleToUser.get("project_manager")
      ?? roleToUser.get("owner");
    if (!userId) continue;
    await db.update(projectTasks).set({
      assigneeUserId: userId,
      staffingGapRole: formalUserId ? null : primary as ProjectMemberRole,
      updatedBy,
    }).where(eq(projectTasks.id, t.id));
    out.push({ userId, taskId: t.taskId, phaseId: t.phaseId, dueDate: t.dueDate ?? null, instructions: t.instructions ?? null });
  }
  if (out.length > 0) await refreshProjectTaskStatuses(projectId);
  return out;
}

export type ProjectStaffingGap = {
  role: ProjectMemberRole;
  taskCount: number;
  candidateUserId: number | null;
};

export async function listProjectStaffingGaps(projectId: string): Promise<ProjectStaffingGap[]> {
  const [tasks, members] = await Promise.all([
    getProjectTasks(projectId),
    getProjectMembers(projectId),
  ]);
  const candidates = new Map<ProjectMemberRole, number>();
  for (const member of members) {
    for (const role of [member.role, ...normalizeExtraRoles(member.role, member.extraRoles)]) {
      if (!candidates.has(role)) candidates.set(role, member.userId);
    }
  }
  const counts = new Map<ProjectMemberRole, number>();
  for (const task of tasks) {
    if (!task.staffingGapRole || task.completed || task.status === "done" || task.status === "skipped") continue;
    counts.set(task.staffingGapRole, (counts.get(task.staffingGapRole) ?? 0) + 1);
  }
  return Array.from(counts, ([role, taskCount]) => ({
    role,
    taskCount,
    candidateUserId: candidates.get(role) ?? null,
  }));
}

export async function transferProjectStaffingGap(
  projectId: string,
  role: ProjectMemberRole,
  toUserId: number,
  updatedBy: number,
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const member = await getProjectMember(projectId, toUserId);
  const roles = member ? [member.role, ...normalizeExtraRoles(member.role, member.extraRoles)] : [];
  if (!roles.includes(role)) throw new Error("接收人不持有待补岗位");
  const rows = await db.update(projectTasks).set({
    assigneeUserId: toUserId,
    staffingGapRole: null,
    updatedBy,
  }).where(and(
    eq(projectTasks.projectId, projectId),
    eq(projectTasks.staffingGapRole, role),
    eq(projectTasks.completed, false),
    drizzleSql`${projectTasks.status} NOT IN ('done', 'skipped')`,
  )).returning({ id: projectTasks.id });
  return rows.length;
}

export type TaskWithContext = ProjectTask & {
  projectName: string;
  projectNumber: string;
  projectCategory: string;
  sopTemplateVersion?: string | null;
  customFields?: unknown;
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
      sopTemplateVersion: projects.sopTemplateVersion,
      customFields: projects.customFields,
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
    eq(projects.lifecycle, "active"),
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
    eq(projects.lifecycle, "active"),
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
    eq(projects.lifecycle, "active"),
    eq(projectTasks.phaseId, projects.currentPhase),
    or(isNull(projectTasks.startDate), lte(projectTasks.startDate, todayInShanghaiISO())),
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

// ── 项目群周摘要：两次批量查询，不按项目 N+1 ──────────────────────────────

export type GroupWeeklyDigestTask = {
  phaseId: string;
  taskId: string;
  status: ProjectTask["status"];
  dueDate: string | null;
  completedAt: Date | null;
  assigneeName: string | null;
};

export type GroupWeeklyDigestProject = {
  project: Pick<
    ProjectRow,
    "id" | "name" | "projectNumber" | "category" | "sopTemplateVersion" |
    "customFields" | "currentPhase" | "dingtalkChatId"
  >;
  tasks: GroupWeeklyDigestTask[];
};

/**
 * Load all weekly group-digest inputs with a fixed two-query budget:
 * one active-project query and one task/user join for every selected project.
 */
export async function getGroupWeeklyDigestProjects(input: {
  weekStartISO: string;
  todayISO: string;
}): Promise<GroupWeeklyDigestProject[]> {
  const db = await getDb();
  if (!db) return [];
  const projectRows = await db.select({
    id: projects.id,
    name: projects.name,
    projectNumber: projects.projectNumber,
    category: projects.category,
    sopTemplateVersion: projects.sopTemplateVersion,
    customFields: projects.customFields,
    currentPhase: projects.currentPhase,
    dingtalkChatId: projects.dingtalkChatId,
  }).from(projects).where(and(
    eq(projects.archived, false),
    eq(projects.lifecycle, "active"),
    drizzleSql`${projects.dingtalkChatId} IS NOT NULL AND ${projects.dingtalkChatId} <> ''`,
  )).orderBy(projects.id);
  if (projectRows.length === 0) return [];

  const projectIds = projectRows.map((project) => project.id);
  const nextWeekStartISO = addDaysISO(input.weekStartISO, 7);
  const nextWeekEndISO = addDaysISO(input.weekStartISO, 13);
  const weekStartAt = new Date(`${input.weekStartISO}T00:00:00+08:00`);
  const nextWeekStartAt = new Date(`${nextWeekStartISO}T00:00:00+08:00`);
  const openTask = drizzleSql`${projectTasks.status} NOT IN ('done','skipped')`;
  const taskRows = await db.select({
    projectId: projectTasks.projectId,
    phaseId: projectTasks.phaseId,
    taskId: projectTasks.taskId,
    status: projectTasks.status,
    dueDate: projectTasks.dueDate,
    completedAt: projectTasks.completedAt,
    assigneeName: drizzleSql<string | null>`COALESCE(${users.name}, ${users.username}, ${users.email})`,
  }).from(projectTasks)
    .innerJoin(projects, eq(projectTasks.projectId, projects.id))
    .leftJoin(users, eq(projectTasks.assigneeUserId, users.id))
    .where(and(
      inArray(projectTasks.projectId, projectIds),
      or(
        and(gte(projectTasks.completedAt, weekStartAt), lt(projectTasks.completedAt, nextWeekStartAt)),
        and(openTask, drizzleSql`${projectTasks.dueDate} < ${input.todayISO}`),
        and(openTask, gte(projectTasks.dueDate, nextWeekStartISO), lte(projectTasks.dueDate, nextWeekEndISO)),
        eq(projectTasks.phaseId, projects.currentPhase),
      ),
    ))
    .orderBy(projectTasks.projectId, projectTasks.dueDate, projectTasks.taskId);

  const tasksByProject = new Map<string, GroupWeeklyDigestTask[]>();
  for (const task of taskRows) {
    const tasks = tasksByProject.get(task.projectId) ?? [];
    tasks.push({
      phaseId: task.phaseId,
      taskId: task.taskId,
      status: task.status,
      dueDate: task.dueDate,
      completedAt: task.completedAt,
      assigneeName: task.assigneeName,
    });
    tasksByProject.set(task.projectId, tasks);
  }
  return projectRows.map((project) => ({
    project,
    tasks: tasksByProject.get(project.id) ?? [],
  }));
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
      eq(projects.lifecycle, "active"),
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
      eq(projects.lifecycle, "active"),
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
        eq(projects.lifecycle, "active"),
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
        eq(projects.lifecycle, "active"),
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

/**
 * NPD Gate 1 hand-off: make the project/product link and immutable product
 * definition baseline non-optional. Idempotent so a retried Gate does not
 * create duplicate products or snapshots.
 */
export async function ensureNpdProductBaseline(projectId: string, actorId: number): Promise<{
  productId: string;
  snapshotId: number;
}> {
  const project = await getProjectById(projectId);
  if (!project) throw new Error("Project not found");
  if (project.category !== "npd") throw new Error("仅 NPD Gate 1 自动生成产品基线");

  let productId = project.productId;
  if (!productId) {
    productId = `prd_${nanoid(12)}`;
    const productType = typeof project.customFields?.productType === "string"
      ? project.customFields.productType
      : "未分类";
    await createProduct({
      id: productId,
      productNumber: project.projectNumber || `PRD-${project.id}`.slice(0, 64),
      name: project.name,
      type: "finished",
      category: productType,
      lifecycleState: "development",
      productManagerUserId: project.pmUserId ?? null,
      createdBy: actorId,
    });
  }

  let definition = await getProductDefinitionByProductId(productId);
  if (!definition) {
    definition = await upsertProductDefinition(productId, actorId, {
      title: `${project.name} 产品定义基线`,
      opportunityName: project.name,
      opportunitySource: "NPD Gate 1",
      targetCustomers: project.customer ?? null,
      positioning: project.value?.trim() || "Gate 1 已立项，定位待后续 PRD 完善",
      prdSummary: project.description?.trim() || project.background?.trim() || "NPD Gate 1 产品范围基线",
      specs: [{
        key: "gate1_baseline",
        label: "Gate 1 产品定义基线",
        target: "已立项",
        verification: "后续 PRD/PSD Gate 更新",
        ownerRole: "pm",
      }],
    });
  }
  if (definition.status !== "confirmed") await confirmProductDefinition(productId, actorId);
  let snapshot = await getLatestProductDefinitionSnapshot(productId);
  if (!snapshot) {
    await confirmProductDefinition(productId, actorId);
    snapshot = await getLatestProductDefinitionSnapshot(productId);
  }
  if (!snapshot) throw new Error("无法生成产品定义快照");

  await updateProject(projectId, {
    productId,
    productDefinitionSnapshotId: snapshot.id,
    baseRevisionId: null,
  });
  return { productId, snapshotId: snapshot.id };
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
  const [product, project] = await Promise.all([getProductById(productId), getProjectById(projectId)]);
  if (!product) throw new Error("关联产品不存在");
  if (!project) throw new Error("项目不存在");
  if (["eco", "derivative", "idr"].includes(project.category) && !product.currentRevisionId) {
    throw new Error("ECO/DRV/IDR 必须关联已有产品和已发布基线 Revision");
  }
  await db.update(projects)
    .set({ productId, baseRevisionId: product.currentRevisionId ?? null })
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
  const phase = getEffectivePhasesForProjectLike(project).find((item) => item.isReleaseGate) ?? null;
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

export async function getMpReleaseByProjectId(projectId: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(mpReleases).where(eq(mpReleases.projectId, projectId)).limit(1);
  return row ?? null;
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
  const projs = await db.select({
    id: projects.id,
    category: projects.category,
    sopTemplateVersion: projects.sopTemplateVersion,
    customFields: projects.customFields,
  })
    .from(projects)
    .where(and(eq(projects.archived, false), eq(projects.lifecycle, "active")));
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
    const phases = getEffectivePhasesForProjectLike(p);
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
  const phase = getEffectivePhasesForProjectLike(project).find((p) => p.id === phaseId);
  if (!phase) return null;

  // 裁剪集成：被裁阶段的 Gate 视为 N/A（不阻塞）；非裁剪阶段的应交付物用"有效提交集"（含归集+override）。
  const effPhase = effective?.phases.find((p) => p.id === phaseId);
  if (effPhase?.tailored) {
    return { phaseId, gateName: phase.gate, ready: true, dimensions: [], blockerCount: 0 };
  }

  const required = effPhase?.submittedDeliverables ?? phase.gateStandard.requiredDeliverables;
  // 9 组只读查询彼此独立，并行拉取（此前串行 10 次往返是 portfolio N+1 的主放大器）
  const [tasks, uploadedSet, critical, testReports, npiReadiness, sampleSignoffs, gateBlockers, reviews, openRound] = await Promise.all([
    getProjectTasks(projectId, phaseId),
    loadDeliverableReviewService().then(({ getReviewSatisfiedSet }) => getReviewSatisfiedSet(projectId, phaseId, required)),
    getPhaseOpenP0P1(projectId, phaseId),
    getPhaseTestReadiness(projectId, phaseId, phaseId.toUpperCase()),
    getPhaseNpiReadiness(projectId, phaseId, phaseId.toUpperCase()),
    getPhaseSampleSignoffReadiness(projectId, phaseId, phaseId.toUpperCase()),
    getProjectGateBlockers(projectId, phaseId),
    getProjectGateReviews(projectId, phaseId),
    getOpenProjectGateSignoffRound(projectId, phaseId),
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
    hasNewerOpenRound: !!latest && !!openRound && openRound.roundNumber > latest.roundNumber,
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
 * 量产发布：前置校验 → 事务内生成 Revision + 发布记录 + 产品转量产态。
 * 项目保持活跃进入 2-8 周稳定期，只有最终 Close Gate 才归档。
 * 抛错表示校验未过（绕不过去的硬闸）。
 */
/**
 * 项目生命周期变更（盲点3「项目杀不掉」）：
 * - terminated 终止 = 终局：理由必填、连带 archived 从活跃视图消失、不可恢复、不可发布
 * - paused 暂停 = 可恢复：保持可见但退出自动化到期扫描（getAutomationDue 系列与 getOverdueTasks）
 * - active 恢复：清空理由
 * 权限同量产发布（创建人/PM/项目 owner|manager/系统 admin）。
 */
export async function setProjectLifecycle(input: {
  projectId: string;
  lifecycle: "active" | "paused" | "terminated";
  reason?: string | null;
  actor: { id: number; role: string };
}): Promise<{ from: string; to: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("项目不存在");
  const authorized = await isReleaseOverrideAuthorized(project, input.actor);
  if (!authorized) throw new Error("无权限变更项目生命周期（需项目创建人/PM/manager 或系统管理员）");
  if (project.lifecycle === "terminated") throw new Error("项目已终止，生命周期不可再变更");
  const from = project.lifecycle;
  if (from === input.lifecycle) return { from, to: input.lifecycle };

  const reason = (input.reason ?? "").trim();
  if (input.lifecycle !== "active" && !reason) {
    throw new Error(input.lifecycle === "terminated" ? "终止项目必须填写理由" : "暂停项目必须填写理由");
  }
  if (input.lifecycle === "terminated") {
    const [review] = await db.select().from(projectTerminationReviews)
      .where(and(eq(projectTerminationReviews.projectId, input.projectId), eq(projectTerminationReviews.status, "approved")))
      .limit(1);
    if (!review) throw new Error("项目终止前必须完成结构化终止评审并获得独立批准");
    const items = await db.select().from(projectTerminationItems).where(eq(projectTerminationItems.reviewId, review.id));
    const incomplete = items.filter((item) => !item.completed || !item.evidenceReference?.trim());
    if (incomplete.length > 0) throw new Error(`终止善后仍有 ${incomplete.length} 项未完成或缺少证据`);
  }
  await db
    .update(projects)
    .set({
      lifecycle: input.lifecycle,
      lifecycleReason: input.lifecycle === "active" ? null : reason,
      lifecycleChangedAt: new Date(),
      lifecycleChangedBy: input.actor.id,
      ...(input.lifecycle === "terminated" ? { archived: true } : {}),
    })
    .where(eq(projects.id, input.projectId));
  return { from, to: input.lifecycle };
}

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
  if (project.lifecycle === "terminated") throw new Error("项目已终止，不能量产发布");
  if (project.lifecycle === "paused") throw new Error("项目已暂停，恢复后才能量产发布");

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

    const [releaseRow] = await tx.insert(mpReleases).values({
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
    } as InsertMpRelease).returning({ id: mpReleases.id });

    if (overridden) {
      const condition = await createProjectCondition({
        projectId: input.projectId,
        sourceType: "release",
        sourceId: String(releaseRow.id),
        title: "量产发布条件跟进",
        description: gate.conditions?.trim() || input.override!.overrideReason,
        ownerUserId: input.override!.followUpOwner,
        dueDate: input.override!.dueDate,
        linkedEcoProjectId: null,
        resolutionNote: null,
        createdBy: input.actor.id,
      }, tx);
      await tx.update(mpReleases).set({ followUpConditionId: condition.id })
        .where(eq(mpReleases.id, releaseRow.id));
    }

    await tx.update(products)
      .set({ currentRevisionId: rev.id, lifecycleState: "mass_production" })
      .where(eq(products.id, productId));

    const releasePhases = getEffectivePhasesForProjectLike(project);
    const releasePhaseIndex = releasePhases.findIndex((phase) => phase.isReleaseGate);
    const stabilizationPhase = releasePhaseIndex >= 0 ? releasePhases[releasePhaseIndex + 1] : null;
    await tx.update(projects)
      .set({
        resultRevisionId: rev.id,
        ...(stabilizationPhase ? { currentPhase: stabilizationPhase.id } : {}),
      })
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

export async function listActiveActionItemsForProjectKind(
  projectId: string,
  kind: InsertActionItem["kind"],
): Promise<ActionItem[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return db.select().from(actionItems).where(and(
      eq(actionItems.projectId, projectId),
      eq(actionItems.kind, kind),
      inArray(actionItems.status, ACTIVE_ACTION_ITEM_STATUSES),
    ));
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

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
    return await db.transaction(async (tx) => {
      await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${`action:${input.dedupeKey}`}))`);
      const [existing] = await tx
        .select()
        .from(actionItems)
        .where(eq(actionItems.dedupeKey, input.dedupeKey))
        .limit(1);
      const now = new Date();
      const existingMetadata = existing?.metadata ?? {};
      const dispatch = existingMetadata.automationDispatch;
      const dispatchRecord = dispatch && typeof dispatch === "object" && !Array.isArray(dispatch)
        ? dispatch as Record<string, unknown>
        : {};
      const claimedAt = typeof dispatchRecord.claimedAt === "string" ? Date.parse(dispatchRecord.claimedAt) : NaN;
      const activelySending = dispatchRecord.status === "sending"
        && Number.isFinite(claimedAt)
        && claimedAt > now.getTime() - 5 * 60_000;
      const shouldNotify = !existing
        || existing.status === "done"
        || existing.status === "closed"
        || (!existing.firstSentAt && !activelySending);
      const snoozedUntil = input.snoozedUntil !== undefined
        ? input.snoozedUntil
        : shouldNotify
          ? null
          : existing?.snoozedUntil ?? null;
      const metadata = {
        ...existingMetadata,
        ...(input.metadata ?? {}),
        ...(shouldNotify ? {
          automationDispatch: { status: "sending", claimedAt: now.toISOString(), error: null },
        } : {}),
      };

      if (existing) {
        const [row] = await tx
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
            snoozedUntil,
            sourceActivityLogId: input.sourceActivityLogId ?? existing.sourceActivityLogId,
            metadata,
            handledAt: shouldNotify ? null : existing.handledAt,
            closedAt: shouldNotify ? null : existing.closedAt,
            updatedAt: now,
          })
          .where(eq(actionItems.id, existing.id))
          .returning();
        return { actionItem: row ?? existing, shouldNotify };
      }

      const [row] = await tx
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
          snoozedUntil,
          sourceActivityLogId: input.sourceActivityLogId ?? null,
          metadata,
        })
        .returning();
      return { actionItem: row ?? null, shouldNotify: Boolean(row) };
    });
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
        metadata: drizzleSql`${actionItems.metadata} || ${JSON.stringify({
          automationDispatch: { status: "sent", sentAt: new Date().toISOString(), error: null },
        })}::jsonb`,
        firstSentAt: drizzleSql`coalesce(${actionItems.firstSentAt}, now())`,
        lastSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(actionItems.id, id));
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
  }
}

export async function markActionItemDispatchFailed(id: number, error: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(actionItems).set({
      status: "open",
      metadata: drizzleSql`${actionItems.metadata} || ${JSON.stringify({
        automationDispatch: { status: "failed", failedAt: new Date().toISOString(), error: error.slice(0, 1000) },
      })}::jsonb`,
      updatedAt: new Date(),
    }).where(eq(actionItems.id, id));
  } catch (dispatchError) {
    if (!isMissingRelationError(dispatchError)) throw dispatchError;
  }
}

export async function closeActionItems(input: {
  dedupeKey?: string;
  kind?: InsertActionItem["kind"];
  entityType?: string;
  entityId?: string;
  recipientUserId?: number;
}): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (input.dedupeKey) conditions.push(eq(actionItems.dedupeKey, input.dedupeKey));
  if (input.kind) conditions.push(eq(actionItems.kind, input.kind));
  if (input.entityType) conditions.push(eq(actionItems.entityType, input.entityType));
  if (input.entityId) conditions.push(eq(actionItems.entityId, input.entityId));
  if (input.recipientUserId) conditions.push(eq(actionItems.recipientUserId, input.recipientUserId));
  if (conditions.length === 0) return [];
  try {
    const rows = await db
      .update(actionItems)
      .set({
        status: "closed",
        handledAt: new Date(),
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning({ id: actionItems.id });
    return rows.map((row) => row.id);
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
    return [];
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
        eq(projects.lifecycle, "active"),
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

/** Persist tailer progress after each fully handled activity row. */
export async function advanceAutomationHeartbeatCursor(
  schedulerKey: string,
  lastCursorId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(automationHeartbeats).set({
      lastCursorId: drizzleSql`greatest(${automationHeartbeats.lastCursorId}, ${lastCursorId})`,
      updatedAt: new Date(),
    }).where(eq(automationHeartbeats.schedulerKey, schedulerKey));
  } catch (error) {
    if (isMissingColumnError(error, "lastCursorId")) {
      await ensureAutomationHeartbeatCursorColumn(db);
      return advanceAutomationHeartbeatCursor(schedulerKey, lastCursorId);
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

export type AutomationRuleDefaultChange = {
  ruleKey: string;
  legacyEnabled: boolean;
  nextEnabled: boolean;
  legacyConfig: Record<string, unknown>;
  nextConfig: Record<string, unknown>;
  onlyWhenSystemManaged: true;
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

/**
 * Idempotently update old system-seeded defaults without touching an admin's
 * choice. Both updatedBy=null and full old-value equality are required, so a
 * customized row (including one changed directly in SQL) is preserved unless
 * it is byte-for-byte JSON-equivalent to the published legacy default.
 */
export async function syncAutomationRuleDefaultChanges(
  changes: readonly AutomationRuleDefaultChange[],
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  let updated = 0;
  for (const change of changes) {
    if (!change.onlyWhenSystemManaged) continue;
    const rows = await db.update(automationRules).set({
      enabled: change.nextEnabled,
      config: change.nextConfig,
      updatedAt: new Date(),
    }).where(and(
      eq(automationRules.ruleKey, change.ruleKey),
      isNull(automationRules.updatedBy),
      eq(automationRules.enabled, change.legacyEnabled),
      drizzleSql`${automationRules.config} = ${JSON.stringify(change.legacyConfig)}::jsonb`,
    )).returning({ id: automationRules.id });
    updated += rows.length;
  }
  return updated;
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

export type AutomationClaimInput = {
  claimKey: string;
  ruleKey: string;
  projectId?: string | null;
  entityId?: string | null;
  sourceActivityLogId?: number | null;
  /** Rolling cadence lower bound. Omit for a permanent source-event claim. */
  since?: Date;
  leaseMs?: number;
};

/**
 * Acquire a database-backed lease before any external side effect. The single
 * INSERT .. ON CONFLICT statement closes the check-then-send race across app
 * instances. Error claims are immediately retryable; abandoned running claims
 * become retryable after the lease expires.
 */
export async function tryClaimAutomation(input: AutomationClaimInput): Promise<{ token: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const token = nanoid();
  const staleBefore = new Date(Date.now() - Math.max(input.leaseMs ?? 5 * 60_000, 10_000));
  const cadencePredicate = input.since
    ? drizzleSql`("automation_claims"."lastFiredAt" IS NULL OR "automation_claims"."lastFiredAt" < ${input.since})`
    : drizzleSql`"automation_claims"."lastFiredAt" IS NULL`;
  const result = await db.execute(drizzleSql`
    INSERT INTO "automation_claims" (
      "claimKey", "ruleKey", "projectId", "entityId", "sourceActivityLogId",
      "token", "status", "claimedAt", "lastError", "updatedAt"
    ) VALUES (
      ${input.claimKey}, ${input.ruleKey}, ${input.projectId ?? null}, ${input.entityId ?? null},
      ${input.sourceActivityLogId ?? null}, ${token}, 'running', now(), NULL, now()
    )
    ON CONFLICT ("claimKey") DO UPDATE SET
      "token" = EXCLUDED."token",
      "status" = 'running',
      "claimedAt" = now(),
      "sourceActivityLogId" = COALESCE(EXCLUDED."sourceActivityLogId", "automation_claims"."sourceActivityLogId"),
      "lastError" = NULL,
      "updatedAt" = now()
    WHERE
      ("automation_claims"."status" <> 'running' OR "automation_claims"."claimedAt" < ${staleBefore})
      AND ${cadencePredicate}
    RETURNING "token"
  `);
  return result.rows.length > 0 ? { token } : null;
}

export async function finishAutomationClaim(input: {
  claimKey: string;
  token: string;
  status: "fired" | "skipped" | "error";
  error?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(automationClaims).set({
    status: input.status,
    lastFiredAt: input.status === "error" ? undefined : new Date(),
    lastError: input.error?.slice(0, 1000) ?? null,
    updatedAt: new Date(),
  }).where(and(
    eq(automationClaims.claimKey, input.claimKey),
    eq(automationClaims.token, input.token),
  ));
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
  const scanEndISO = addDaysISO(todayInShanghaiISO(), 14);
  return db
    .select({
      ...getTableColumns(projectTasks),
      projectCategory: projects.category,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projectTasks.projectId, projects.id))
    .where(and(
      eq(projects.archived, false),
      eq(projects.lifecycle, "active"),
      drizzleSql`${projectTasks.dueDate} IS NOT NULL`,
      lte(projectTasks.dueDate, scanEndISO),
      drizzleSql`${projectTasks.status} NOT IN ('done','skipped')`
    ));
}

/** 逾期或 14 天内到期的未关闭问题 */
export async function getAutomationDueIssues(): Promise<ProjectIssue[]> {
  const db = await getDb();
  if (!db) return [];
  const scanEndISO = addDaysISO(todayInShanghaiISO(), 14);
  return db
    .select(getTableColumns(projectIssues))
    .from(projectIssues)
    .innerJoin(projects, eq(projectIssues.projectId, projects.id))
    .where(and(
      eq(projects.archived, false),
      eq(projects.lifecycle, "active"),
      drizzleSql`${projectIssues.targetDate} IS NOT NULL`,
      drizzleSql`${projectIssues.targetDate} <> ''`,
      lte(projectIssues.targetDate, scanEndISO),
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
      eq(projects.lifecycle, "active"),
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
      eq(projects.lifecycle, "active"),
      eq(projectDeliverableReviews.status, "pending"),
    ));
}

/** Gate 前置未完扫描：跨活跃项目，找"未完成且 dueDate 已设"的 gate 任务 + 其阶段内未完成前置数。 */
export async function getAutomationGatePrereqs(): Promise<Array<{
  projectId: string; taskId: string; phaseId: string; dueDate: string | null; status: string; incompletePrereqCount: number; title: string;
}>> {
  const db = await getDb();
  if (!db) return [];
  const projs = await db
    .select({
      id: projects.id,
      category: projects.category,
      sopTemplateVersion: projects.sopTemplateVersion,
      customFields: projects.customFields,
    })
    .from(projects)
    .where(and(eq(projects.archived, false), eq(projects.lifecycle, "active")));
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
    const phases = getEffectivePhasesForProjectLike(p);
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
    const phase = p
      ? getEffectivePhasesForProjectLike(p).find((item) => item.id === r.phaseId)
      : null;
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
    const phase = getEffectivePhasesForProjectLike(p).find((item) => item.id === r.phaseId);
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
