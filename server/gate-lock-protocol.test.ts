import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { Client } from "pg";
import {
  activityLogs,
  projectChangeScopeDeclarations,
  projectGateReviews,
  projectGateSignoffAdditions,
  projectGateSignoffRounds,
  projectGateSignoffs,
  projectTasks,
  projects,
} from "../drizzle/schema";
import {
  addProjectGateSignoffRequirement,
  assertProjectGateSignoffsComplete,
  confirmGateReview,
  createProjectChangeScopeDeclarationVersion,
  getDb,
  getProjectById,
  openProjectGateSignoffRound,
  upsertProjectGateSignoff,
} from "./db";
import { projectsRouter } from "./routers/projects";
import {
  deriveSopRiskAssessment,
  EMPTY_CHANGE_SCOPE_DECLARATION,
} from "../shared/sop-risk";

const OWNER = 996901;
const SUFFIX = Date.now().toString(36);
const SIGNOFF_RECHECK = `gate-signoff-recheck-${SUFFIX}`;
const ADD_REQUIREMENT_RACE = `gate-add-race-${SUFFIX}`;
const RISK_ROUND_RACE = `gate-risk-round-${SUFFIX}`;
const UPDATE_RISK_BOUNDARY = `gate-risk-update-${SUFFIX}`;
const RISK_RATCHET_RACE = `gate-risk-ratchet-${SUFFIX}`;
const ALL_PROJECTS = [
  SIGNOFF_RECHECK,
  ADD_REQUIREMENT_RACE,
  RISK_ROUND_RACE,
  UPDATE_RISK_BOUNDARY,
  RISK_RATCHET_RACE,
];

const projectOwner = projectsRouter.createCaller({
  user: {
    id: OWNER,
    role: "member",
    name: "Gate Lock Protocol Owner",
    canCreateProject: true,
  },
} as any);

async function seedProject(projectId: string, currentPhase: "concept" | "design") {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: projectId,
    name: projectId,
    projectNumber: projectId,
    category: "npd",
    risk: "low",
    safetyRiskLevel: "standard",
    regulatoryRiskLevel: "standard",
    currentPhase,
    createdBy: OWNER,
  });
  if (currentPhase === "design") {
    await db.insert(projectTasks).values({
      projectId,
      phaseId: "design",
      taskId: "d8",
      updatedBy: OWNER,
    });
  }
}

async function approveCurrentDesignRound(projectId: string) {
  const round = await openProjectGateSignoffRound({
    projectId,
    phaseId: "design",
    openedBy: OWNER,
  });
  for (const [slot, requirement] of Object.entries(round.requirements)) {
    if (requirement === "not_applicable") continue;
    await upsertProjectGateSignoff({
      projectId,
      phaseId: "design",
      roundNumber: round.roundNumber,
      slot: slot as keyof typeof round.requirements,
      requirement,
      status: "approved",
      signedBy: OWNER,
    });
  }
  return round;
}

async function waitForAdvisoryLockWaiters(client: Client, minimum: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await client.query<{ waiting: number }>(`
      select count(distinct waiting.pid)::int as waiting
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
    if (Number(result.rows[0]?.waiting ?? 0) >= minimum) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Expected at least ${minimum} advisory-lock waiter(s)`);
}

async function lockProjectPhase(client: Client, projectId: string, phaseId: string) {
  await client.query("select pg_advisory_lock(hashtext($1))", [`${projectId}:${phaseId}`]);
}

async function unlockProjectPhase(client: Client, projectId: string, phaseId: string) {
  await client.query("select pg_advisory_unlock(hashtext($1))", [`${projectId}:${phaseId}`]);
}

beforeAll(async () => {
  await seedProject(SIGNOFF_RECHECK, "design");
  await seedProject(ADD_REQUIREMENT_RACE, "design");
  await seedProject(RISK_ROUND_RACE, "concept");
  await seedProject(UPDATE_RISK_BOUNDARY, "concept");
  await seedProject(RISK_RATCHET_RACE, "concept");
  await approveCurrentDesignRound(SIGNOFF_RECHECK);
  await approveCurrentDesignRound(ADD_REQUIREMENT_RACE);
  await openProjectGateSignoffRound({
    projectId: UPDATE_RISK_BOUNDARY,
    phaseId: "concept",
    openedBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(inArray(activityLogs.projectId, ALL_PROJECTS));
  await db.delete(projectGateReviews).where(inArray(projectGateReviews.projectId, ALL_PROJECTS));
  await db.delete(projectGateSignoffs).where(inArray(projectGateSignoffs.projectId, ALL_PROJECTS));
  await db.delete(projectGateSignoffRounds).where(inArray(projectGateSignoffRounds.projectId, ALL_PROJECTS));
  await db.delete(projectGateSignoffAdditions).where(inArray(projectGateSignoffAdditions.projectId, ALL_PROJECTS));
  await db.delete(projectChangeScopeDeclarations).where(inArray(projectChangeScopeDeclarations.projectId, ALL_PROJECTS));
  await db.delete(projectTasks).where(inArray(projectTasks.projectId, ALL_PROJECTS));
  await db.delete(projects).where(inArray(projects.id, ALL_PROJECTS));
});

describe("Gate phase-lock protocol", () => {
  it("非 JDM Gate 在预检通过后签核变为 rejected，事务内最终重验必须阻止推进", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await expect(assertProjectGateSignoffsComplete(SIGNOFF_RECHECK, "design"))
      .resolves.toBeUndefined();

    const db = await getDb();
    if (!db) throw new Error("no db");
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    await lockProjectPhase(blocker, SIGNOFF_RECHECK, "design");

    const confirmation = confirmGateReview({
      projectId: SIGNOFF_RECHECK,
      phaseId: "design",
      gateTaskId: "d8",
      phaseName: "设计",
      gateName: "设计冻结",
      reviewDate: "2026-07-15",
      decision: "approved",
      createdBy: OWNER,
    });
    const confirmationAssertion = expect(confirmation).rejects.toThrow(/会签|拒绝|必签/);
    try {
      await waitForAdvisoryLockWaiters(blocker, 1);
      await db.update(projectGateSignoffs).set({
        status: "rejected",
        note: "预检后撤回批准",
        updatedAt: new Date(),
      }).where(and(
        eq(projectGateSignoffs.projectId, SIGNOFF_RECHECK),
        eq(projectGateSignoffs.phaseId, "design"),
        eq(projectGateSignoffs.slot, "product"),
      ));
    } finally {
      await unlockProjectPhase(blocker, SIGNOFF_RECHECK, "design");
      await blocker.end();
    }

    await confirmationAssertion;
    expect((await getProjectById(SIGNOFF_RECHECK))?.currentPhase).toBe("design");
    const reviews = await db.select().from(projectGateReviews)
      .where(eq(projectGateReviews.projectId, SIGNOFF_RECHECK));
    expect(reviews).toHaveLength(0);
  });

  it("项目级加签先取得 phase lock 时废止旧轮次，排队中的旧轮次确认不能绕过新要求", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    await lockProjectPhase(blocker, ADD_REQUIREMENT_RACE, "design");

    const addition = addProjectGateSignoffRequirement({
      projectId: ADD_REQUIREMENT_RACE,
      phaseId: "design",
      slot: "customer",
      requirement: "required",
      reason: "客户书面确认升级为本轮必签",
      addedBy: OWNER,
    });
    let confirmation: ReturnType<typeof confirmGateReview> | undefined;
    try {
      // 先确认加签事务已经排在 phase lock 队首，再排入旧轮次确认，避免依赖调度时序。
      await waitForAdvisoryLockWaiters(blocker, 1);
      confirmation = confirmGateReview({
        projectId: ADD_REQUIREMENT_RACE,
        phaseId: "design",
        gateTaskId: "d8",
        phaseName: "设计",
        gateName: "设计冻结",
        reviewDate: "2026-07-15",
        decision: "approved",
        createdBy: OWNER,
      });
      await waitForAdvisoryLockWaiters(blocker, 2);
    } finally {
      await unlockProjectPhase(blocker, ADD_REQUIREMENT_RACE, "design");
      await blocker.end();
    }

    await expect(addition).resolves.toMatchObject({ slot: "customer", requirement: "required" });
    await expect(confirmation).rejects.toThrow(/会签|轮次|开启|关闭/);
    expect((await getProjectById(ADD_REQUIREMENT_RACE))?.currentPhase).toBe("design");
    const db = await getDb();
    const reviews = await db!.select().from(projectGateReviews)
      .where(eq(projectGateReviews.projectId, ADD_REQUIREMENT_RACE));
    expect(reviews).toHaveLength(0);
  });

  it("开启轮次等待 phase lock 时发生风险升级，锁内快照必须包含最新高风险硬卡", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const declaration = {
      ...EMPTY_CHANGE_SCOPE_DECLARATION,
      batteryCellChange: true,
      notes: "等待开启 Gate 轮次期间升级为电芯变更",
    };
    const assessment = deriveSopRiskAssessment({ declaration });
    expect(assessment.safetyRiskLevel).toBe("high");

    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    await lockProjectPhase(blocker, RISK_ROUND_RACE, "concept");

    const riskUpgrade = createProjectChangeScopeDeclarationVersion({
      projectId: RISK_ROUND_RACE,
      declaration,
      assessment,
      declaredBy: OWNER,
    });
    let roundPromise: ReturnType<typeof openProjectGateSignoffRound> | undefined;
    try {
      // 风险升级先排队；轮次开启后排队，取得锁时必须重新读取风险与要求矩阵。
      await waitForAdvisoryLockWaiters(blocker, 1);
      roundPromise = openProjectGateSignoffRound({
        projectId: RISK_ROUND_RACE,
        phaseId: "concept",
        openedBy: OWNER,
      });
      await waitForAdvisoryLockWaiters(blocker, 2);
    } finally {
      await unlockProjectPhase(blocker, RISK_ROUND_RACE, "concept");
      await blocker.end();
    }

    await expect(riskUpgrade).resolves.toMatchObject({ version: 1 });
    const round = await roundPromise!;
    expect(round.riskSnapshot).toMatchObject({ safetyRiskLevel: "high" });
    expect(round.requirements).toMatchObject({
      engineering: "required",
      qa: "required",
      certification: "required",
    });
  });

  it("通用 projects.update 不能把已开启的 standard 轮次当作风险升级入口", async () => {
    await expect(projectOwner.update({
      id: UPDATE_RISK_BOUNDARY,
      name: UPDATE_RISK_BOUNDARY,
      projectNumber: UPDATE_RISK_BOUNDARY,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      safetyRiskLevel: "high",
      regulatoryRiskLevel: "standard",
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/风险|结构化风险声明/),
    });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const project = await getProjectById(UPDATE_RISK_BOUNDARY);
    const rounds = await db.select().from(projectGateSignoffRounds)
      .where(eq(projectGateSignoffRounds.projectId, UPDATE_RISK_BOUNDARY));
    const declarations = await db.select().from(projectChangeScopeDeclarations)
      .where(eq(projectChangeScopeDeclarations.projectId, UPDATE_RISK_BOUNDARY));
    expect(project).toMatchObject({
      safetyRiskLevel: "standard",
      regulatoryRiskLevel: "standard",
    });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      status: "open",
      riskSnapshot: { safetyRiskLevel: "standard", regulatoryRiskLevel: "standard" },
      requirements: { qa: "conditional" },
    });
    expect(declarations).toHaveLength(0);
  });

  it("并发风险声明先 high 后 stale standard 时，项目与第二版 assessment 都保持 high", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const highDeclaration = {
      ...EMPTY_CHANGE_SCOPE_DECLARATION,
      batteryCellChange: true,
      notes: "第一请求：升级为高风险",
    };
    const staleStandardDeclaration = {
      ...EMPTY_CHANGE_SCOPE_DECLARATION,
      notes: "第二请求：基于升级前快照计算出的 standard",
    };

    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    await lockProjectPhase(blocker, RISK_RATCHET_RACE, "concept");

    const highRequest = projectOwner.setRiskScope({
      projectId: RISK_RATCHET_RACE,
      declaration: highDeclaration,
    });
    let staleStandardRequest: ReturnType<typeof projectOwner.setRiskScope> | undefined;
    try {
      // 高风险请求先排入 phase lock；第二请求仍在旧 standard 项目快照上计算 assessment。
      await waitForAdvisoryLockWaiters(blocker, 1);
      staleStandardRequest = projectOwner.setRiskScope({
        projectId: RISK_RATCHET_RACE,
        declaration: staleStandardDeclaration,
      });
      await waitForAdvisoryLockWaiters(blocker, 2);
    } finally {
      await unlockProjectPhase(blocker, RISK_RATCHET_RACE, "concept");
      await blocker.end();
    }

    await expect(highRequest).resolves.toMatchObject({ version: 1 });
    await expect(staleStandardRequest).resolves.toMatchObject({ version: 2 });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const project = await getProjectById(RISK_RATCHET_RACE);
    const declarations = await db.select().from(projectChangeScopeDeclarations)
      .where(eq(projectChangeScopeDeclarations.projectId, RISK_RATCHET_RACE))
      .orderBy(projectChangeScopeDeclarations.version);
    expect(project).toMatchObject({
      safetyRiskLevel: "high",
      regulatoryRiskLevel: "high",
    });
    expect(declarations).toHaveLength(2);
    expect(declarations[0]).toMatchObject({
      version: 1,
      assessment: { safetyRiskLevel: "high", regulatoryRiskLevel: "high" },
    });
    expect(declarations[1]).toMatchObject({
      version: 2,
      declaration: { batteryCellChange: false },
      assessment: { safetyRiskLevel: "high", regulatoryRiskLevel: "high" },
    });
  });
});
