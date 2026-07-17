import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { Client } from "pg";
import {
  activityLogs,
  projectChangeScopeDeclarations,
  projectDeliverableReviews,
  projectFiles,
  projectGateReviews,
  projectGateSignoffAdditions,
  projectGateSignoffRounds,
  projectGateSignoffs,
  projectPhases,
  projectTasks,
  projects,
} from "../drizzle/schema";
import {
  confirmGateReview,
  createProjectWithSeed,
  getDb,
  getGateReadiness,
  getProjectById,
  openProjectGateSignoffRound,
  upsertProjectGateSignoff,
} from "./db";
import { projectsRouter } from "./routers/projects";
import { gateReviewsRouter } from "./routers/gateReviews";
import {
  getJdmPhasesForExecutionBaseline,
  SOP_TEMPLATE_VERSION_CURRENT,
} from "../shared/sop-templates";
import {
  type ModuleReuseState,
  type ProductModuleId,
  type ProjectExecutionBaseline,
} from "../shared/project-track-tailoring";
import {
  deriveSopRiskAssessment,
  EMPTY_CHANGE_SCOPE_DECLARATION,
} from "../shared/sop-risk";

const OWNER = 996701;
const SUFFIX = Date.now().toString(36);
const MINIMAL = `jdm-min-${SUFFIX}`;
const EMPTY_EVIDENCE = `jdm-empty-${SUFFIX}`;
const BASELINE_GUARD = `jdm-base-${SUFFIX}`;
const MISSING_RISK = `jdm-risk-${SUFFIX}`;
const UNCONFIRMED_RISK = `jdm-risk-unconfirmed-${SUFFIX}`;
const SUCCESS = `jdm-ok-${SUFFIX}`;
const CONCURRENT = `jdm-race-${SUFFIX}`;
const SEED_CONFLICT = `jdm-conf-${SUFFIX}`;
const POST_COMMIT_QUERY_FAILURE = `jdm-post-commit-${SUFFIX}`;
const SIGNOFF_RACE = `jdm-signoff-race-${SUFFIX}`;
const ALL_PROJECTS = [
  MINIMAL,
  EMPTY_EVIDENCE,
  BASELINE_GUARD,
  MISSING_RISK,
  UNCONFIRMED_RISK,
  SUCCESS,
  CONCURRENT,
  SEED_CONFLICT,
  POST_COMMIT_QUERY_FAILURE,
  SIGNOFF_RACE,
];

const creator = projectsRouter.createCaller({
  user: {
    id: OWNER,
    role: "member",
    name: "JDM Creator",
    canCreateProject: true,
  },
} as any);

const gateReviewer = gateReviewsRouter.createCaller({
  user: {
    id: OWNER,
    role: "member",
    name: "JDM Gate Reviewer",
    canCreateProject: true,
  },
} as any);

const allNotReused: Record<ProductModuleId, ModuleReuseState> = {
  battery: "not_reused",
  core_function: "not_reused",
  electronics: "not_reused",
  software_connectivity: "not_reused",
  structure_mold: "not_reused",
  id_cmf: "not_reused",
};

function draftBaseline(projectId: string): ProjectExecutionBaseline {
  return {
    modelVersion: "project-track-v1",
    status: "draft",
    customerConceptRef: `customer-concept://${projectId}`,
  };
}

function frozenBaseline(
  projectId: string,
  moduleReuse: Record<ProductModuleId, ModuleReuseState> = allNotReused,
): ProjectExecutionBaseline {
  return {
    modelVersion: "project-track-v1",
    status: "frozen",
    productDefinitionRef: `PSD-${projectId}`,
    moduleReuse,
    reuseEvidence: {},
    customerConceptRef: `customer-concept://${projectId}`,
    frozenAt: "2026-07-15T16:00:00.000Z",
    frozenBy: OWNER,
  };
}

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(inArray(activityLogs.projectId, ALL_PROJECTS));
  await db.delete(projectDeliverableReviews).where(inArray(projectDeliverableReviews.projectId, ALL_PROJECTS));
  await db.delete(projectFiles).where(inArray(projectFiles.projectId, ALL_PROJECTS));
  await db.delete(projectGateReviews).where(inArray(projectGateReviews.projectId, ALL_PROJECTS));
  await db.delete(projectGateSignoffs).where(inArray(projectGateSignoffs.projectId, ALL_PROJECTS));
  await db.delete(projectGateSignoffRounds).where(inArray(projectGateSignoffRounds.projectId, ALL_PROJECTS));
  await db.delete(projectGateSignoffAdditions).where(inArray(projectGateSignoffAdditions.projectId, ALL_PROJECTS));
  await db.delete(projectChangeScopeDeclarations).where(inArray(projectChangeScopeDeclarations.projectId, ALL_PROJECTS));
  await db.delete(projectTasks).where(inArray(projectTasks.projectId, ALL_PROJECTS));
  await db.delete(projectPhases).where(inArray(projectPhases.projectId, ALL_PROJECTS));
  await db.delete(projects).where(inArray(projects.id, ALL_PROJECTS));
}

async function seedDraftProject(projectId: string) {
  await createProjectWithSeed({
    id: projectId,
    name: projectId,
    projectNumber: projectId,
    category: "jdm",
    sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
    risk: "low",
    currentPhase: "input",
    progress: 0,
    createdBy: OWNER,
    productOwnerUserId: OWNER,
    commercialBoundary: "我方负责产品定义和设计，客户负责书面确认",
    customerSignoffOwnerUserId: OWNER,
    customFields: {
      projectExecutionBaseline: draftBaseline(projectId),
    },
  }, "jdm", OWNER);
}

async function prepareDefinitionEvidence(
  projectId: string,
  withRisk: boolean,
  riskConfirmed = true,
) {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const project = await getProjectById(projectId);
  if (!project) throw new Error("project not found");
  const [input] = getJdmPhasesForExecutionBaseline(
    project.customFields?.projectExecutionBaseline,
    project.sopTemplateVersion,
  );
  const now = new Date();
  await db.update(projectTasks).set({
    completed: true,
    status: "done",
    completedAt: now,
    completedBy: OWNER,
    updatedBy: OWNER,
  }).where(and(
    eq(projectTasks.projectId, projectId),
    inArray(
      projectTasks.taskId,
      input.tasks
        .filter((task) => task.id !== input.gateTaskId)
        .map((task) => task.id),
    ),
  ));

  const requiredDeliverables = Array.from(new Set(input.gateStandard.requiredDeliverables));
  await db.insert(projectFiles).values(requiredDeliverables.map((deliverableName, index) => ({
    projectId,
    phaseId: "input",
    deliverableName,
    name: `${deliverableName}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    storageKey: `tests/${projectId}/${index}`,
    storageUrl: `/storage/tests/${projectId}/${index}`,
    uploadedBy: OWNER,
    createdAt: now,
  })));
  const reviewedAt = new Date(now.getTime() + 1_000);
  await db.insert(projectDeliverableReviews).values(requiredDeliverables.map((deliverableName) => ({
    projectId,
    phaseId: "input",
    deliverableName,
    status: "approved" as const,
    reviewerUserId: OWNER,
    submittedBy: OWNER,
    submittedAt: now,
    reviewedBy: OWNER,
    reviewedAt,
  })));

  if (withRisk) {
    const declaration = {
      ...EMPTY_CHANGE_SCOPE_DECLARATION,
      notes: "JDM 产品定义阶段正式风险声明",
    };
    const assessment = deriveSopRiskAssessment({ declaration });
    await db.insert(projectChangeScopeDeclarations).values({
      projectId,
      version: 1,
      declaration,
      assessment,
      ruleVersion: assessment.ruleVersion,
      declaredBy: OWNER,
      engineeringConfirmedBy: riskConfirmed ? OWNER : null,
      engineeringConfirmedAt: riskConfirmed ? now : null,
      qaOrCertConfirmedBy: riskConfirmed ? OWNER : null,
      qaOrCertConfirmedAt: riskConfirmed ? now : null,
    });
  }
}

function confirmDefinitionGate(
  projectId: string,
  executionBaseline?: ProjectExecutionBaseline,
) {
  return confirmGateReview({
    projectId,
    phaseId: "input",
    gateTaskId: "jdm_product_definition_gate",
    phaseName: "产品定义",
    gateName: "产品定义冻结",
    reviewDate: "2026-07-15",
    decision: "approved",
    createdBy: OWNER,
    ...(executionBaseline
      ? { jdmDefinitionFreeze: { executionBaseline } }
      : {}),
  } as any);
}

function confirmDefinitionGateThroughRouter(
  projectId: string,
  executionBaseline: ProjectExecutionBaseline,
) {
  return gateReviewer.confirmAndAdvance({
    projectId,
    phaseId: "input",
    gateTaskId: "jdm_product_definition_gate",
    phaseName: "产品定义",
    gateName: "产品定义冻结",
    reviewDate: "2026-07-15",
    decision: "approved",
    jdmDefinitionFreeze: { executionBaseline },
  });
}

async function approveCurrentSignoffRound(projectId: string) {
  const round = await openProjectGateSignoffRound({
    projectId,
    phaseId: "input",
    openedBy: OWNER,
  });
  for (const [slot, requirement] of Object.entries(round.requirements)) {
    if (requirement === "not_applicable") continue;
    await upsertProjectGateSignoff({
      projectId,
      phaseId: "input",
      roundNumber: round.roundNumber,
      slot: slot as keyof typeof round.requirements,
      requirement,
      status: "approved",
      signedBy: OWNER,
    });
  }
  return round;
}

async function waitForAdvisoryLockWaiter(client: Client) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ waiting: number }>(`
      select count(*)::int as waiting
      from pg_locks held
      join pg_locks waiting
        on waiting.locktype = held.locktype
       and waiting.database is not distinct from held.database
       and waiting.classid is not distinct from held.classid
       and waiting.objid is not distinct from held.objid
       and waiting.objsubid is not distinct from held.objsubid
      where held.pid = pg_backend_pid()
        and held.locktype = 'advisory'
        and held.granted
        and not waiting.granted
    `);
    if (Number(result.rows[0]?.waiting ?? 0) > 0) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Gate confirmation did not reach the advisory-lock boundary");
}

async function rowsForProject(projectId: string) {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const [phases, tasks, reviews] = await Promise.all([
    db.select().from(projectPhases).where(eq(projectPhases.projectId, projectId)),
    db.select().from(projectTasks).where(eq(projectTasks.projectId, projectId)),
    db.select().from(projectGateReviews).where(eq(projectGateReviews.projectId, projectId)),
  ]);
  return { phases, tasks, reviews };
}

beforeAll(async () => {
  await cleanup();
  for (const projectId of [
    EMPTY_EVIDENCE,
    BASELINE_GUARD,
    MISSING_RISK,
    UNCONFIRMED_RISK,
    SUCCESS,
    CONCURRENT,
    SEED_CONFLICT,
    POST_COMMIT_QUERY_FAILURE,
    SIGNOFF_RACE,
  ]) {
    await seedDraftProject(projectId);
  }
  await prepareDefinitionEvidence(BASELINE_GUARD, true);
  await prepareDefinitionEvidence(MISSING_RISK, false);
  await prepareDefinitionEvidence(UNCONFIRMED_RISK, true, false);
  await prepareDefinitionEvidence(SUCCESS, true);
  await prepareDefinitionEvidence(CONCURRENT, true);
  await prepareDefinitionEvidence(SEED_CONFLICT, true);
  await prepareDefinitionEvidence(POST_COMMIT_QUERY_FAILURE, true);
  await prepareDefinitionEvidence(SIGNOFF_RACE, true);
  await approveCurrentSignoffRound(SUCCESS);
  await approveCurrentSignoffRound(CONCURRENT);
  await approveCurrentSignoffRound(SEED_CONFLICT);
  await approveCurrentSignoffRound(POST_COMMIT_QUERY_FAILURE);
  await approveCurrentSignoffRound(SIGNOFF_RACE);
});

afterAll(cleanup);

describe("JDM two-stage project persistence", () => {
  it("创建只要求客户概念、商务边界和确认责任人，不要求客户规格/版本/料号/模块状态", async () => {
    await expect(creator.create({
      id: MINIMAL,
      name: MINIMAL,
      projectNumber: MINIMAL,
      category: "jdm",
      risk: "low",
      currentPhase: "input",
      progress: 0,
      commercialBoundary: "我方负责设计，客户负责确认",
      customerSignoffOwnerUserId: OWNER,
      customFields: {
        projectExecutionBaseline: draftBaseline(MINIMAL),
      },
    })).resolves.toEqual({ success: true });

    const db = await getDb();
    const project = await getProjectById(MINIMAL);
    const rows = await rowsForProject(MINIMAL);
    const declarations = await db!.select()
      .from(projectChangeScopeDeclarations)
      .where(eq(projectChangeScopeDeclarations.projectId, MINIMAL));
    expect(project).toMatchObject({
      currentPhase: "input",
      customerInputVersion: null,
      customerPartNumber: null,
      customFields: {
        projectExecutionBaseline: {
          modelVersion: "project-track-v1",
          status: "draft",
          customerConceptRef: expect.any(String),
        },
      },
    });
    expect(project?.customFields?.projectExecutionBaseline).not.toHaveProperty("productDefinitionRef");
    expect(project?.customFields?.projectExecutionBaseline).not.toHaveProperty("moduleReuse");
    expect(rows.phases.map((phase) => phase.phaseId)).toEqual(["input"]);
    expect(rows.tasks.every((task) => task.phaseId === "input")).toBe(true);
    expect(declarations).toHaveLength(0);
  });

  it("P1 Gate 缺规格、CSR、风险声明或客户确认时阻断且不留评审", async () => {
    await expect(
      confirmDefinitionGate(EMPTY_EVIDENCE, frozenBaseline(EMPTY_EVIDENCE)),
    ).rejects.toThrow(/产品规格|CSR|风险|客户确认/);

    const project = await getProjectById(EMPTY_EVIDENCE);
    const rows = await rowsForProject(EMPTY_EVIDENCE);
    expect(project?.currentPhase).toBe("input");
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({ status: "draft" });
    expect(rows.reviews).toHaveLength(0);
    expect(rows.phases.map((phase) => phase.phaseId)).toEqual(["input"]);
  });

  it("P1 Gate 拒绝缺失或非法的六模块冻结基线", async () => {
    await expect(confirmDefinitionGate(BASELINE_GUARD)).rejects.toThrow(/执行基线|六模块/);
    await expect(confirmDefinitionGate(
      BASELINE_GUARD,
      frozenBaseline(BASELINE_GUARD, {
        ...allNotReused,
        structure_mold: "reused",
        id_cmf: "not_reused",
      }),
    )).rejects.toThrow(/ID\/CMF|结构\/模具/);

    const project = await getProjectById(BASELINE_GUARD);
    const rows = await rowsForProject(BASELINE_GUARD);
    expect(project?.currentPhase).toBe("input");
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({ status: "draft" });
    expect(rows.reviews).toHaveLength(0);
  });

  it("P1 Gate 即使其余证据齐全，缺正式风险声明仍不得冻结", async () => {
    await expect(
      confirmDefinitionGate(MISSING_RISK, frozenBaseline(MISSING_RISK)),
    ).rejects.toThrow(/风险声明/);

    const project = await getProjectById(MISSING_RISK);
    const rows = await rowsForProject(MISSING_RISK);
    expect(project?.currentPhase).toBe("input");
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({ status: "draft" });
    expect(rows.reviews).toHaveLength(0);
  });

  it("最新风险声明未完成研发与 QA/认证确认时不得冻结", async () => {
    await expect(
      confirmDefinitionGate(UNCONFIRMED_RISK, frozenBaseline(UNCONFIRMED_RISK)),
    ).rejects.toThrow(/研发与 QA\/认证确认/);

    const project = await getProjectById(UNCONFIRMED_RISK);
    const rows = await rowsForProject(UNCONFIRMED_RISK);
    expect(project?.currentPhase).toBe("input");
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({ status: "draft" });
    expect(rows.reviews).toHaveLength(0);
  });

  it("P1 Gate 在同一事务冻结基线、记录评审并按共享组合器一次性种 P2-P6", async () => {
    const baseline = frozenBaseline(SUCCESS);
    const readinessBefore = await getGateReadiness(SUCCESS, "input");
    expect(readinessBefore?.ready).toBe(true);
    const result = await confirmDefinitionGate(SUCCESS, baseline);
    expect(result).toMatchObject({ roundNumber: 1, advancedTo: "design", closed: false });

    const project = await getProjectById(SUCCESS);
    const rows = await rowsForProject(SUCCESS);
    const expected = getJdmPhasesForExecutionBaseline(
      baseline,
      SOP_TEMPLATE_VERSION_CURRENT,
    );
    expect(project?.currentPhase).toBe("design");
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({
      ...baseline,
      status: "frozen",
      frozenAt: expect.any(String),
      frozenBy: OWNER,
      riskScopeVersion: 1,
    });
    expect(rows.phases.map((phase) => phase.phaseId).sort()).toEqual(
      expected.map((phase) => phase.id).sort(),
    );
    expect(rows.tasks.map((task) => `${task.phaseId}:${task.taskId}`).sort()).toEqual(
      expected
        .flatMap((phase) => phase.tasks.map((task) => `${phase.id}:${task.id}`))
        .sort(),
    );
    expect(rows.reviews).toHaveLength(1);
    expect(rows.reviews[0].traceSnapshot?.projectExecutionBaseline).toMatchObject({
      status: "frozen",
      riskScopeVersion: 1,
      frozenBy: OWNER,
    });

    await expect(creator.setRiskScope({
      projectId: SUCCESS,
      declaration: {
        ...EMPTY_CHANGE_SCOPE_DECLARATION,
        notes: "冻结后不允许无审计覆盖风险基线",
      },
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("已在 Gate 冻结"),
    });

    const countsBeforeRetry = {
      phases: rows.phases.length,
      tasks: rows.tasks.length,
      reviews: rows.reviews.length,
    };
    await expect(confirmDefinitionGate(SUCCESS, baseline)).rejects.toThrow(/当前阶段/);
    const afterRetry = await rowsForProject(SUCCESS);
    expect({
      phases: afterRetry.phases.length,
      tasks: afterRetry.tasks.length,
      reviews: afterRetry.reviews.length,
    }).toEqual(countsBeforeRetry);
  });

  it("两个并发 Gate 确认只有一个成功，且不会重复生成阶段、任务或评审", async () => {
    const baseline = frozenBaseline(CONCURRENT);
    const results = await Promise.allSettled([
      confirmDefinitionGate(CONCURRENT, baseline),
      confirmDefinitionGate(CONCURRENT, baseline),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);

    const project = await getProjectById(CONCURRENT);
    const rows = await rowsForProject(CONCURRENT);
    const expected = getJdmPhasesForExecutionBaseline(baseline, SOP_TEMPLATE_VERSION_CURRENT);
    expect(project?.currentPhase).toBe("design");
    expect(rows.reviews).toHaveLength(1);
    expect(rows.phases).toHaveLength(expected.length);
    expect(rows.tasks).toHaveLength(
      expected.reduce((total, phase) => total + phase.tasks.length, 0),
    );
  });

  it("后续阶段 seed 冲突时基线、评审、Gate 完成和阶段推进整体回滚", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    // 模拟数据库中已有一条不完整的未来阶段残片。实现不能用 conflict-ignore
    // 把它伪装成成功；应拒绝并回滚本次 Gate 的其余全部写入。
    await db.insert(projectPhases).values({
      projectId: SEED_CONFLICT,
      phaseId: "design",
      notes: "incomplete pre-existing row",
    });

    await expect(
      confirmDefinitionGate(SEED_CONFLICT, frozenBaseline(SEED_CONFLICT)),
    ).rejects.toThrow();

    const project = await getProjectById(SEED_CONFLICT);
    const rows = await rowsForProject(SEED_CONFLICT);
    const [gateTask] = rows.tasks.filter(
      (task) => task.taskId === "jdm_product_definition_gate",
    );
    expect(project?.currentPhase).toBe("input");
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({ status: "draft" });
    expect(rows.reviews).toHaveLength(0);
    expect(gateTask?.completed).toBe(false);
    expect(gateTask?.status).not.toBe("done");
    expect(rows.phases.map((phase) => phase.phaseId).sort()).toEqual(["design", "input"]);
    expect(rows.tasks.filter((task) => task.phaseId !== "input")).toHaveLength(0);
  });

  it("Gate 事务提交后读取评审轮次失败也必须返回已提交的成功结果", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const pool = (db as any).$client;
    const originalQuery = pool.query;
    let injectedFailureCount = 0;
    pool.query = function injectedPostCommitFailure(...args: any[]) {
      const query = typeof args[0] === "string" ? args[0] : args[0]?.text ?? "";
      const values = Array.isArray(args[1]) ? args[1] : args[0]?.values ?? [];
      if (
        injectedFailureCount === 0 &&
        query.includes('from "project_gate_reviews"') &&
        values.includes(POST_COMMIT_QUERY_FAILURE)
      ) {
        injectedFailureCount += 1;
        return Promise.reject(new Error("simulated post-commit review query failure"));
      }
      return originalQuery.apply(this, args);
    };

    let result: Awaited<ReturnType<typeof confirmDefinitionGate>> | undefined;
    let failure: unknown;
    try {
      result = await confirmDefinitionGate(
        POST_COMMIT_QUERY_FAILURE,
        frozenBaseline(POST_COMMIT_QUERY_FAILURE),
      );
    } catch (error) {
      failure = error;
    } finally {
      pool.query = originalQuery;
    }

    expect(injectedFailureCount).toBe(0);
    expect(failure).toBeUndefined();
    expect(result).toMatchObject({ roundNumber: 1, advancedTo: "design" });
    const project = await getProjectById(POST_COMMIT_QUERY_FAILURE);
    const rows = await rowsForProject(POST_COMMIT_QUERY_FAILURE);
    expect(project?.currentPhase).toBe("design");
    expect(rows.reviews).toHaveLength(1);
  });

  it("产品负责人会签在预检后变为拒绝时，冻结事务必须最终重验并整体拒绝", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const db = await getDb();
    if (!db) throw new Error("no db");
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    await blocker.query("begin");
    // Mirror the production lock order: release-state first, then the narrow Gate
    // lock. The router precheck can still observe the approved row; its freezing
    // transaction then waits here and must revalidate after this transaction commits.
    await blocker.query("select pg_advisory_xact_lock(hashtext($1))", [`release-state:${SIGNOFF_RACE}`]);
    await blocker.query("select pg_advisory_xact_lock(hashtext($1))", [`${SIGNOFF_RACE}:input`]);

    const confirmation = confirmDefinitionGateThroughRouter(
      SIGNOFF_RACE,
      frozenBaseline(SIGNOFF_RACE),
    );
    try {
      await waitForAdvisoryLockWaiter(blocker);
      await blocker.query(`
        update project_gate_signoffs
        set status = 'rejected',
            note = '在 Gate 冻结事务前撤回批准',
            "updatedAt" = now()
        where "projectId" = $1
          and "phaseId" = 'input'
          and slot = 'product'
      `, [SIGNOFF_RACE]);
      await blocker.query("commit");
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      await blocker.end();
    }

    await expect(confirmation).rejects.toThrow(/会签|产品负责人|批准/);
    const project = await getProjectById(SIGNOFF_RACE);
    const rows = await rowsForProject(SIGNOFF_RACE);
    expect(project?.currentPhase).toBe("input");
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({ status: "draft" });
    expect(rows.reviews).toHaveLength(0);
  });
});
