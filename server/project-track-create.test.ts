import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  activityLogs,
  bomItems,
  keyModules,
  projectChangeScopeDeclarations,
  projectDeliverableOverrides,
  projectModuleBaselines,
  projectPhases,
  projectTailoring,
  projectTasks,
  projects,
  users,
} from "../drizzle/schema";
import {
  createProjectTailoringRequest,
  getDb,
  getGateReadiness,
  getProjectById,
  getProjectEffectiveProcess,
  setDeliverableOverride,
} from "./db";
import { projectsRouter } from "./routers/projects";
import {
  DERIVATIVE_MODULE_TASK_IDS,
  getDerivativePhasesForExecutionBaseline,
} from "../shared/sop-templates";
import {
  PRODUCT_MODULE_IDS,
  type ModuleReuseEvidence,
  type ModuleReuseState,
  type ProductModuleId,
  type ProjectExecutionBaseline,
} from "../shared/project-track-tailoring";

const OWNER = 996401;
const SUFFIX = Date.now().toString(36);
const VALID_PROJECT = `drv-create-${SUFFIX}`;
const ALL_REUSED_PROJECT = `drv-all-reused-${SUFFIX}`;
const ATOMIC_REJECT_PROJECT = `drv-atomic-reject-${SUFFIX}`;
const INVALID_PROJECTS = Array.from(
  { length: 6 },
  (_, index) => `drv-bad${index}-${SUFFIX}`,
);
const ALL_PROJECTS = [VALID_PROJECT, ALL_REUSED_PROJECT, ATOMIC_REJECT_PROJECT, ...INVALID_PROJECTS];
const MODULE_IDS = {
  battery: `drv-battery-${SUFFIX}`,
  core_function: `drv-core-${SUFFIX}`,
  electronics: `drv-electronics-${SUFFIX}`,
} as const;
const USER_OPEN_ID = `drv-project-track-${SUFFIX}`;

const caller = projectsRouter.createCaller({
  user: {
    id: OWNER,
    role: "member",
    name: "DRV Creator",
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

function evidence(moduleId: ProductModuleId): ModuleReuseEvidence {
  return {
    sourceRef: `source-${moduleId}`,
    modelOrVersion: "V1",
    evidenceRef: `EV-${moduleId}`,
    boundaryConfirmed: true,
  };
}

function frozenBaseline(
  moduleReuse: Record<ProductModuleId, ModuleReuseState> = allNotReused,
  overrides: Partial<ProjectExecutionBaseline> = {},
): ProjectExecutionBaseline {
  return {
    modelVersion: "project-track-v1",
    status: "frozen",
    moduleReuse,
    reuseEvidence: Object.fromEntries(
      PRODUCT_MODULE_IDS
        .filter((moduleId) => moduleReuse[moduleId] === "reused")
        .map((moduleId) => [moduleId, evidence(moduleId)]),
    ),
    frozenAt: "2026-07-15T12:00:00.000Z",
    frozenBy: OWNER,
    ...overrides,
  };
}

const validBaseline = frozenBaseline({
  ...allNotReused,
  battery: "reused",
});

function createInput(
  id: string,
  baseline: unknown,
) {
  const reuse = baseline && typeof baseline === "object" && !Array.isArray(baseline)
    ? (baseline as { moduleReuse?: Partial<Record<ProductModuleId, ModuleReuseState>> }).moduleReuse
    : undefined;
  const drvKeyModuleRefs = reuse ? Object.fromEntries(
    (["battery", "core_function", "electronics"] as const)
      .filter(moduleId => reuse[moduleId] === "reused")
      .map(moduleId => [moduleId, { keyModuleId: MODULE_IDS[moduleId] }]),
  ) : undefined;
  return {
    id,
    name: id,
    projectNumber: id,
    category: "derivative" as const,
    risk: "low" as const,
    currentPhase: "iteration",
    progress: 0,
    customFields: {
      source: "project-track-create-test",
      ...(baseline === undefined ? {} : { projectExecutionBaseline: baseline }),
    },
    drvKeyModuleRefs,
    changeScopeDeclaration: {
      batteryPackOrBmsChange: true,
      notes: "验证结构化风险声明仍独立生效",
    },
  };
}

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(inArray(activityLogs.projectId, ALL_PROJECTS));
  await db.delete(bomItems).where(inArray(bomItems.projectId, ALL_PROJECTS));
  await db.delete(projectModuleBaselines).where(inArray(projectModuleBaselines.projectId, ALL_PROJECTS));
  await db.delete(projectDeliverableOverrides).where(inArray(projectDeliverableOverrides.projectId, ALL_PROJECTS));
  await db.delete(projectTailoring).where(inArray(projectTailoring.projectId, ALL_PROJECTS));
  await db.delete(projectChangeScopeDeclarations).where(inArray(projectChangeScopeDeclarations.projectId, ALL_PROJECTS));
  await db.delete(projectTasks).where(inArray(projectTasks.projectId, ALL_PROJECTS));
  await db.delete(projectPhases).where(inArray(projectPhases.projectId, ALL_PROJECTS));
  await db.delete(projects).where(inArray(projects.id, ALL_PROJECTS));
  await db.delete(keyModules).where(inArray(keyModules.id, Object.values(MODULE_IDS)));
  await db.delete(users).where(eq(users.openId, USER_OPEN_ID));
}

beforeAll(async () => {
  await cleanup();
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(users).values({ id: OWNER, openId: USER_OPEN_ID, username: USER_OPEN_ID, name: "DRV Creator" });
  await db.insert(keyModules).values([
    { id: MODULE_IDS.battery, moduleNumber: `BAT-${SUFFIX}`, moduleType: "battery_energy", name: "DRV battery", category: "test", status: "approved", createdBy: OWNER, technicalConfirmedBy: OWNER, technicalConfirmedAt: new Date(), approvedBy: OWNER, approvedAt: new Date() },
    { id: MODULE_IDS.core_function, moduleNumber: `CORE-${SUFFIX}`, moduleType: "core_function", name: "DRV core", category: "test", status: "approved", createdBy: OWNER, technicalConfirmedBy: OWNER, technicalConfirmedAt: new Date(), approvedBy: OWNER, approvedAt: new Date() },
    { id: MODULE_IDS.electronics, moduleNumber: `ELE-${SUFFIX}`, moduleType: "electronics_hardware", name: "DRV electronics", category: "test", status: "approved", createdBy: OWNER, technicalConfirmedBy: OWNER, technicalConfirmedAt: new Date(), approvedBy: OWNER, approvedAt: new Date() },
  ]);
  await caller.create(createInput(VALID_PROJECT, validBaseline));
});

afterAll(cleanup);

describe("DRV project-track-v1 creation", () => {
  it.each([
    ["缺少执行基线", undefined, "已冻结"],
    [
      "草稿基线",
      { ...validBaseline, status: "draft" },
      "已冻结",
    ],
    [
      "错误模型版本",
      { ...validBaseline, modelVersion: "project-track-v0" },
      "已冻结",
    ],
    [
      "模块状态不完整",
      frozenBaseline({
        battery: "reused",
      } as Record<ProductModuleId, ModuleReuseState>),
      "缺少复用状态",
    ],
    [
      "ID/CMF 与结构非法组合",
      frozenBaseline({
        ...allNotReused,
        structure_mold: "reused",
        id_cmf: "not_reused",
      }),
      "ID/CMF",
    ],
    [
      "六模块全部不复用",
      frozenBaseline(allNotReused),
      "至少需要复用一个",
    ],
  ])("拒绝%s", async (_label, baseline, message) => {
    const id = INVALID_PROJECTS.shift()!;
    await expect(caller.create(createInput(id, baseline))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(message),
    });
  });

  it("允许六模块全部复用", async () => {
    const allReused = Object.fromEntries(
      PRODUCT_MODULE_IDS.map((moduleId) => [moduleId, "reused"]),
    ) as Record<ProductModuleId, ModuleReuseState>;

    await expect(caller.create(createInput(
      ALL_REUSED_PROJECT,
      frozenBaseline(allReused),
    ))).resolves.toEqual({ success: true });
  });

  it("直接种入共享组合器的最终任务，并保留风险声明", async () => {
    const db = await getDb();
    const project = await getProjectById(VALID_PROJECT);
    expect(project).toBeDefined();

    const expectedPhases = getDerivativePhasesForExecutionBaseline(
      validBaseline,
      project!.sopTemplateVersion,
    );
    const expectedKeys = expectedPhases
      .flatMap((phase) => phase.tasks.map((task) => `${phase.id}:${task.id}`))
      .sort();
    const tasks = await db!.select().from(projectTasks)
      .where(eq(projectTasks.projectId, VALID_PROJECT));
    const actualKeys = tasks
      .map((task) => `${task.phaseId}:${task.taskId}`)
      .sort();

    expect(actualKeys).toEqual(expectedKeys);
    expect(tasks.some((task) => task.status === "skipped")).toBe(false);
    expect(tasks.map((task) => task.taskId)).toEqual(
      expect.arrayContaining([
        "drv_common_product_baseline",
        "drv_common_safety_cert_test",
        "drv_common_packaging_validation",
      ]),
    );
    for (const taskId of DERIVATIVE_MODULE_TASK_IDS.battery) {
      expect(tasks.map((task) => task.taskId)).not.toContain(taskId);
    }
    expect(project!.customFields).toMatchObject({
      source: "project-track-create-test",
      projectExecutionBaseline: {
        ...validBaseline,
        frozenAt: expect.any(String),
        frozenBy: OWNER,
      },
    });

    const moduleBaselines = await db!.select().from(projectModuleBaselines)
      .where(eq(projectModuleBaselines.projectId, VALID_PROJECT));
    expect(moduleBaselines).toHaveLength(6);
    expect(moduleBaselines.find(row => row.drvModuleKey === "battery")).toMatchObject({
      reuseState: "reused",
      keyModuleId: MODULE_IDS.battery,
      confirmedBy: OWNER,
      moduleSnapshot: {
        moduleNumber: `BAT-${SUFFIX}`,
        moduleType: "battery_energy",
        internalBomHash: expect.any(String),
      },
    });
    const workingBom = await db!.select().from(bomItems)
      .where(eq(bomItems.projectId, VALID_PROJECT));
    expect(workingBom).toHaveLength(1);
    expect(workingBom[0]).toMatchObject({
      partNumber: `BAT-${SUFFIX}`,
      keyModuleId: MODULE_IDS.battery,
      keyModuleSnapshot: { internalBomHash: expect.any(String) },
    });

    const [riskScope] = await db!.select()
      .from(projectChangeScopeDeclarations)
      .where(eq(projectChangeScopeDeclarations.projectId, VALID_PROJECT));
    expect(riskScope).toMatchObject({
      version: 1,
      declaredBy: OWNER,
      declaration: {
        batteryPackOrBmsChange: true,
      },
      assessment: {
        safetyRiskLevel: "high",
        regulatoryRiskLevel: "high",
      },
    });
  });

  it("模块引用无效时，项目、任务与模块基线全部不落库", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const invalidInput = createInput(ATOMIC_REJECT_PROJECT, validBaseline);
    invalidInput.drvKeyModuleRefs = { battery: { keyModuleId: MODULE_IDS.core_function } };

    await expect(caller.create(invalidInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("类型"),
    });
    expect(await db.select().from(projects).where(eq(projects.id, ATOMIC_REJECT_PROJECT))).toEqual([]);
    expect(await db.select().from(projectTasks).where(eq(projectTasks.projectId, ATOMIC_REJECT_PROJECT))).toEqual([]);
    expect(await db.select().from(projectModuleBaselines).where(eq(projectModuleBaselines.projectId, ATOMIC_REJECT_PROJECT))).toEqual([]);
  });

  it("冻结基线是唯一减负入口，旧裁剪和交付物豁免不能绕过公共 Gate", async () => {
    const db = await getDb();

    await expect(createProjectTailoringRequest({
      projectId: VALID_PROJECT,
      reasonType: "reuse_mature",
      reasonNote: "不应再允许的旧裁剪入口",
      targets: [{ scope: "phase", phaseId: "iteration" }],
      proposedBy: OWNER,
    })).rejects.toThrow(/DRV.*六模块执行基线/);
    await expect(setDeliverableOverride({
      projectId: VALID_PROJECT,
      nodePhaseId: "iteration",
      deliverableName: "产品规格基线确认记录",
      action: "remove",
      createdBy: OWNER,
      reason: "不应再允许的旧豁免入口",
    })).rejects.toThrow(/DRV.*六模块执行基线/);

    // 模拟第一增量上线前已存在或绕过 API 直写的旧记录：读取路径仍必须 fail closed。
    await db!.insert(projectTailoring).values({
      projectId: VALID_PROJECT,
      reasonType: "reuse_mature",
      reasonNote: "legacy attack row",
      targets: [{ scope: "phase", phaseId: "iteration" }],
      status: "approved",
      proposedBy: OWNER,
      reviewedBy: OWNER,
      reviewedAt: new Date(),
    });
    await db!.insert(projectDeliverableOverrides).values({
      projectId: VALID_PROJECT,
      nodePhaseId: "iteration",
      deliverableName: "产品规格基线确认记录",
      action: "remove",
      reason: "legacy attack row",
      createdBy: OWNER,
    });

    const effective = await getProjectEffectiveProcess(VALID_PROJECT);
    const iteration = effective!.phases.find((phase) => phase.id === "iteration")!;
    const design = effective!.phases.find((phase) => phase.id === "design")!;
    expect(iteration.tailored).toBe(false);
    expect(iteration.tasks.map((task) => task.id)).toContain("drv_common_product_baseline");
    expect(iteration.submittedDeliverables).toContain("产品规格基线确认记录");
    expect(design.tasks.map((task) => task.id)).not.toContain("drv_battery_design");
    expect(design.tasks.map((task) => task.id)).toContain("drv_common_dfm_validation_plan");

    const readiness = await getGateReadiness(VALID_PROJECT, "iteration");
    expect(readiness?.ready).toBe(false);
    expect(readiness?.dimensions.find((dimension) => dimension.dimension === "prereq")?.blockers)
      .toContain("drv_common_product_baseline");
  });

  it("通用项目编辑既不能替换也不能删除冻结基线", async () => {
    const db = await getDb();
    const beforeProject = await getProjectById(VALID_PROJECT);
    const storedBaseline = (beforeProject!.customFields as Record<string, unknown>)
      .projectExecutionBaseline;
    const beforeTasks = await db!.select().from(projectTasks)
      .where(eq(projectTasks.projectId, VALID_PROJECT));

    await caller.update({
      id: VALID_PROJECT,
      name: "DRV baseline lock - replace attempt",
      projectNumber: VALID_PROJECT,
      category: "derivative",
      risk: "low",
      currentPhase: "iteration",
      progress: 0,
      customFields: {
        source: "replace-attempt",
        projectExecutionBaseline: frozenBaseline(),
      },
    });
    let project = await getProjectById(VALID_PROJECT);
    expect((project!.customFields as Record<string, unknown>).projectExecutionBaseline)
      .toEqual(storedBaseline);

    await caller.update({
      id: VALID_PROJECT,
      name: "DRV baseline lock - delete attempt",
      projectNumber: VALID_PROJECT,
      category: "derivative",
      risk: "low",
      currentPhase: "iteration",
      progress: 0,
      customFields: { source: "delete-attempt" },
    });
    project = await getProjectById(VALID_PROJECT);
    expect(project!.customFields).toMatchObject({
      source: "delete-attempt",
      projectExecutionBaseline: storedBaseline,
    });

    const afterTasks = await db!.select().from(projectTasks)
      .where(eq(projectTasks.projectId, VALID_PROJECT));
    expect(afterTasks.map((task) => `${task.phaseId}:${task.taskId}`).sort())
      .toEqual(beforeTasks.map((task) => `${task.phaseId}:${task.taskId}`).sort());
  });
});
