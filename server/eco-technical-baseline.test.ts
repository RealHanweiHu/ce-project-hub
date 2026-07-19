import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  activityLogs,
  bomItems,
  keyModuleItems,
  keyModules,
  mpReleases,
  productModuleAssignments,
  products,
  productTechnicalBaselines,
  projectProductModuleBindings,
  projects,
  users,
} from "../drizzle/schema";
import {
  createProduct,
  createProjectFile,
  createProjectGateReview,
  createProjectNpiReadinessCheck,
  createProjectTestPlan,
  createProjectTestReport,
  getCurrentProductTechnicalBaseline,
  getDb,
  getProjectById,
  listWorkingBom,
  releaseProject,
  reviewProjectTestReport,
  upsertProjectTask,
} from "./db";
import { projectsRouter } from "./routers/projects";
import { submitDeliverableReview, reviewDeliverable } from "./deliverable-review-service";
import {
  bindProjectDeliveryModule,
  listProjectDeliveryModuleBindings,
} from "./services/project-delivery-module-service";
import { getReleaseGatePhase } from "../shared/sop-templates";
import type { KeyModuleType } from "../shared/key-modules";

// 后缀必须含随机成分：多个测试文件用同一 `BAT-${SUFFIX}` 格式生成模块号，
// 并行 worker 同毫秒加载时纯时间戳后缀会撞 uniq_key_modules_number（偶发 flake）。
const SUFFIX = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// Use a per-process high integer range so an interrupted prior run cannot make
// the next run collide with a user still referenced by its abandoned fixtures.
const OWNER = 1_500_000_000 + (Date.now() % 100_000_000);
const NON_OWNER = OWNER + 1;
const PRODUCT_ID = `eco-tb-prod-${SUFFIX}`;
const NO_BASELINE_PRODUCT_ID = `eco-no-tb-${SUFFIX}`;
const BASE_SOURCE_PROJECT_ID = `eco-tb-src-${SUFFIX}`;
const BASELINE_ID = `eco-tb-base-${SUFFIX}`;
const MAIN_ECO_ID = `eco-tb-main-${SUFFIX}`;
const STALE_ECO_ID = `eco-tb-stale-${SUFFIX}`;
const NO_BASELINE_ECO_ID = `eco-no-base-${SUFFIX}`;
const FORBIDDEN_ECO_ID = `eco-forbid-${SUFFIX}`;
const PROJECT_IDS = [
  BASE_SOURCE_PROJECT_ID,
  MAIN_ECO_ID,
  STALE_ECO_ID,
  NO_BASELINE_ECO_ID,
  FORBIDDEN_ECO_ID,
] as const;

const MODULES = {
  battery: {
    id: `eco-bat-${SUFFIX}`,
    type: "battery_energy" as const,
    moduleNumber: `BAT-${SUFFIX}`,
    name: "基线电池包",
    partNumber: `CELL-${SUFFIX}`,
  },
  core: {
    id: `eco-core-${SUFFIX}`,
    type: "core_function" as const,
    moduleNumber: `CORE-${SUFFIX}`,
    name: "基线机芯",
    partNumber: `MOTOR-${SUFFIX}`,
  },
  electronics: {
    id: `eco-pcba-${SUFFIX}`,
    type: "electronics_hardware" as const,
    moduleNumber: `PCBA-${SUFFIX}`,
    name: "基线 PCBA",
    partNumber: `PCB-${SUFFIX}`,
  },
  replacementCore: {
    id: `eco-core2-${SUFFIX}`,
    type: "core_function" as const,
    moduleNumber: `CORE2-${SUFFIX}`,
    name: "ECO 新机芯",
    partNumber: `MOTOR2-${SUFFIX}`,
  },
} as const;

const ownerCaller = projectsRouter.createCaller({
  user: {
    id: OWNER,
    role: "member",
    name: "ECO Product Owner",
    canCreateProject: true,
  },
} as never);

const nonOwnerCaller = projectsRouter.createCaller({
  user: {
    id: NON_OWNER,
    role: "member",
    name: "Other Product Manager",
    canCreateProject: true,
  },
} as never);

const deps = { notifyDingtalk: async () => {} };

function ecoCreateInput(id: string, productId: string) {
  return {
    id,
    name: `ECO ${id}`,
    projectNumber: id,
    category: "eco" as const,
    productId,
    risk: "low" as const,
    currentPhase: "planning",
    progress: 0,
  };
}

function snapshotFor(module: (typeof MODULES)[keyof typeof MODULES]) {
  return {
    id: module.id,
    moduleNumber: module.moduleNumber,
    moduleType: module.type,
    name: module.name,
    category: "充气泵",
    model: "V1",
    attributes: {},
    evidenceRefs: [],
    items: [{
      partNumber: module.partNumber,
      name: `${module.name}内部物料`,
      spec: "受控规格",
      quantity: 1,
      refDesignator: "",
      componentProductId: null,
      sortOrder: 10,
    }],
  };
}

const BASE_SPEC_SNAPSHOT = {
  productDefinitionSnapshot: {
    title: "量产产品规格 V1",
    positioning: "基线规格必须由 ECO 完整继承",
    specs: [{ name: "额定电压", value: "12V" }],
  },
  projectExecutionBaseline: { modelVersion: "released-product-v1" },
  specificationFiles: [{
    sourceFileId: 900_001,
    phaseId: "concept",
    taskId: "np1",
    deliverableName: "产品需求文档 PRD",
    fileType: "规格书",
    fileVersion: "V1.0",
    name: "base-product-spec-v1.pdf",
    size: 1024,
    visibility: "internal",
    approvedBy: OWNER,
    approvedAt: "2026-07-01T00:00:00.000Z",
  }],
} as const;

const BASE_BOM = [
  {
    partNumber: `HOUSING-${SUFFIX}`,
    name: "外壳组件",
    spec: "黑色",
    quantity: 2,
    refDesignator: "",
    componentProductId: null,
    componentRevisionId: null,
    keyModuleId: null,
    keyModuleSnapshot: null,
    supplierName: "",
    unitCost: "",
    sortOrder: 10,
  },
  ...([MODULES.battery, MODULES.core, MODULES.electronics] as const).map((module, index) => ({
    partNumber: module.moduleNumber,
    name: module.name,
    spec: "V1",
    quantity: 1,
    refDesignator: "",
    componentProductId: null,
    componentRevisionId: null,
    keyModuleId: module.id,
    keyModuleSnapshot: snapshotFor(module),
    supplierName: "",
    unitCost: "",
    sortOrder: 20 + index * 10,
  })),
];

async function cleanup() {
  const db = await getDb();
  if (!db) return;

  await db.execute(sql`DELETE FROM action_items WHERE "projectId" IN (${sql.join(PROJECT_IDS.map(id => sql`${id}`), sql`, `)})`);
  await db.delete(activityLogs).where(inArray(activityLogs.projectId, [...PROJECT_IDS]));
  await db.delete(mpReleases).where(inArray(mpReleases.projectId, [MAIN_ECO_ID, STALE_ECO_ID]));
  await db.update(products).set({ currentTechnicalBaselineId: null })
    .where(inArray(products.id, [PRODUCT_ID, NO_BASELINE_PRODUCT_ID]));
  await db.update(projects).set({ baseTechnicalBaselineId: null })
    .where(inArray(projects.id, [...PROJECT_IDS]));
  await db.execute(sql`
    DELETE FROM product_module_assignments
    WHERE "technicalBaselineId" IN (
      SELECT id FROM product_technical_baselines WHERE "productId" = ${PRODUCT_ID}
    )
  `);
  await db.delete(productTechnicalBaselines).where(eq(productTechnicalBaselines.productId, PRODUCT_ID));
  await db.execute(sql`DELETE FROM project_test_reports WHERE "projectId" IN (${sql.join([MAIN_ECO_ID, STALE_ECO_ID].map(id => sql`${id}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM project_test_cases WHERE "projectId" IN (${sql.join([MAIN_ECO_ID, STALE_ECO_ID].map(id => sql`${id}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM project_test_plans WHERE "projectId" IN (${sql.join([MAIN_ECO_ID, STALE_ECO_ID].map(id => sql`${id}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM project_npi_readiness_checks WHERE "projectId" IN (${sql.join([MAIN_ECO_ID, STALE_ECO_ID].map(id => sql`${id}`), sql`, `)})`);
  await db.delete(projectProductModuleBindings).where(inArray(projectProductModuleBindings.projectId, [...PROJECT_IDS]));
  await db.delete(bomItems).where(inArray(bomItems.projectId, [...PROJECT_IDS]));
  await db.delete(projects).where(inArray(projects.id, [...PROJECT_IDS]));
  await db.delete(keyModuleItems).where(inArray(keyModuleItems.moduleId, Object.values(MODULES).map(module => module.id)));
  await db.delete(keyModules).where(inArray(keyModules.id, Object.values(MODULES).map(module => module.id)));
  await db.delete(products).where(inArray(products.id, [PRODUCT_ID, NO_BASELINE_PRODUCT_ID]));
  await db.delete(users).where(inArray(users.id, [OWNER, NON_OWNER]));
}

async function seedControlledProduct() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(users).values([
    {
      id: OWNER,
      openId: `eco-tb-owner-${SUFFIX}`,
      name: "ECO Product Owner",
      role: "member",
      canCreateProject: true,
    },
    {
      id: NON_OWNER,
      openId: `eco-tb-other-${SUFFIX}`,
      name: "Other Product Manager",
      role: "member",
      canCreateProject: true,
    },
  ]);
  await createProduct({
    id: PRODUCT_ID,
    name: "ECO 受控产品",
    type: "finished",
    category: "充气泵",
    lifecycleState: "mass_production",
    createdBy: OWNER,
    productManagerUserId: OWNER,
  });
  await createProduct({
    id: NO_BASELINE_PRODUCT_ID,
    name: "尚未首次发布的产品",
    type: "finished",
    category: "充气泵",
    createdBy: OWNER,
    productManagerUserId: OWNER,
  });
  await db.insert(projects).values({
    id: BASE_SOURCE_PROJECT_ID,
    name: "初始产品发布项目",
    projectNumber: BASE_SOURCE_PROJECT_ID,
    category: "npd",
    risk: "low",
    currentPhase: "mp",
    progress: 100,
    createdBy: OWNER,
    productOwnerUserId: OWNER,
  });
  await db.insert(keyModules).values(Object.values(MODULES).map(module => ({
    id: module.id,
    moduleNumber: module.moduleNumber,
    moduleType: module.type,
    name: module.name,
    category: "充气泵",
    model: "V1",
    status: "approved" as const,
    createdBy: OWNER,
    technicalConfirmedBy: OWNER,
    technicalConfirmedAt: new Date("2026-06-29T00:00:00.000Z"),
    approvedBy: OWNER,
    approvedAt: new Date("2026-06-30T00:00:00.000Z"),
  })));
  await db.insert(keyModuleItems).values(Object.values(MODULES).map(module => ({
    moduleId: module.id,
    partNumber: module.partNumber,
    name: `${module.name}内部物料`,
    spec: "受控规格",
    quantity: 1,
    refDesignator: "",
    sortOrder: 10,
  })));
  await db.insert(productTechnicalBaselines).values({
    id: BASELINE_ID,
    productId: PRODUCT_ID,
    baselineLabel: "TB-001",
    sourceProjectId: BASE_SOURCE_PROJECT_ID,
    keyModulesSnapshot: {
      battery: { keyModuleId: MODULES.battery.id, moduleSnapshot: snapshotFor(MODULES.battery) },
      core_function: { keyModuleId: MODULES.core.id, moduleSnapshot: snapshotFor(MODULES.core) },
      electronics: { keyModuleId: MODULES.electronics.id, moduleSnapshot: snapshotFor(MODULES.electronics) },
    },
    bomSnapshot: BASE_BOM,
    specSnapshot: BASE_SPEC_SNAPSHOT,
    releasedBy: OWNER,
    releasedAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  await db.insert(productModuleAssignments).values([
    [MODULES.battery, "battery_energy"],
    [MODULES.core, "core_function"],
    [MODULES.electronics, "electronics_hardware"],
  ].map(([module, moduleType]) => ({
    technicalBaselineId: BASELINE_ID,
    moduleType: moduleType as KeyModuleType,
    moduleId: module.id,
    moduleSnapshot: snapshotFor(module),
  })));
  await db.update(products).set({ currentTechnicalBaselineId: BASELINE_ID })
    .where(eq(products.id, PRODUCT_ID));
}

async function completeEcoReleaseGate(projectId: string) {
  const phase = getReleaseGatePhase("eco");
  if (!phase) throw new Error("ECO release Gate missing");

  for (const task of phase.tasks) {
    if (task.id === phase.gateTaskId) continue;
    await upsertProjectTask(projectId, phase.id, task.id, {
      status: "done",
      completed: true,
      completedAt: new Date(),
      updatedBy: OWNER,
    });
  }
  const deliverables = Array.from(new Set([
    ...(phase.deliverables ?? []),
    ...(phase.gateStandard?.requiredDeliverables ?? []),
  ]));
  for (const [index, deliverableName] of deliverables.entries()) {
    await createProjectFile({
      projectId,
      phaseId: phase.id,
      taskId: phase.gateTaskId,
      deliverableName,
      name: `${deliverableName}.pdf`,
      mimeType: "application/pdf",
      size: 10 + index,
      storageKey: `${projectId}/gate/${index}`,
      storageUrl: `/storage/${projectId}/gate/${index}`,
      uploadedBy: OWNER,
    });
    await submitDeliverableReview({
      projectId,
      phaseId: phase.id,
      deliverableName,
      reviewerUserId: NON_OWNER,
      submittedBy: OWNER,
    }, deps);
    await reviewDeliverable({
      projectId,
      phaseId: phase.id,
      deliverableName,
      decision: "approved",
      reviewedBy: NON_OWNER,
      note: null,
    }, deps);
  }

  const reportFileId = await createProjectFile({
    projectId,
    phaseId: phase.id,
    taskId: phase.gateTaskId,
    deliverableName: "ECO PVT 测试报告",
    name: `${projectId}-pvt-test.pdf`,
    mimeType: "application/pdf",
    size: 64,
    storageKey: `${projectId}/pvt-test`,
    storageUrl: `/storage/${projectId}/pvt-test`,
    uploadedBy: OWNER,
  });
  const planId = await createProjectTestPlan({
    projectId,
    phaseId: phase.id,
    title: "ECO 变更试产验证计划",
    scope: "变更点验证与整机回归",
    sampleSize: "20 台",
    status: "active",
    createdBy: OWNER,
  });
  const reportId = await createProjectTestReport({
    projectId,
    phaseId: phase.id,
    planId,
    title: "ECO 变更试产验证报告",
    reportNo: `${projectId}-PVT-RPT`,
    result: "pass",
    reviewStatus: "pending",
    summary: "变更验证通过",
    fileId: reportFileId,
    submittedBy: OWNER,
  });
  await reviewProjectTestReport(reportId, NON_OWNER, "approved");

  const npiEvidenceFileId = await createProjectFile({
    projectId,
    phaseId: phase.id,
    taskId: phase.gateTaskId,
    deliverableName: "ECO NPI readiness evidence",
    name: `${projectId}-npi.pdf`,
    mimeType: "application/pdf",
    size: 32,
    storageKey: `${projectId}/npi`,
    storageUrl: `/storage/${projectId}/npi`,
    uploadedBy: OWNER,
  });
  await createProjectNpiReadinessCheck({
    projectId,
    phaseId: phase.id,
    title: "ECO 产线切换 readiness",
    category: "process_flow",
    status: "ready",
    evidenceFileId: npiEvidenceFileId,
    createdBy: OWNER,
    updatedBy: OWNER,
  });

  await createProjectGateReview({
    projectId,
    phaseId: phase.id,
    phaseName: phase.name,
    gateName: phase.gate,
    reviewDate: "2026-07-15",
    decision: "approved",
    roundNumber: 1,
    createdBy: OWNER,
  } as never);
}

beforeAll(async () => {
  await cleanup();
  await seedControlledProduct();
});

afterAll(cleanup);

describe.sequential("ECO technical baseline inheritance", () => {
  it("rejects a product without a current TB and rejects a non-product-owner", async () => {
    await expect(ownerCaller.create(ecoCreateInput(
      NO_BASELINE_ECO_ID,
      NO_BASELINE_PRODUCT_ID,
    ))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("尚无受控技术基线"),
    });

    await expect(nonOwnerCaller.create(ecoCreateInput(
      FORBIDDEN_ECO_ID,
      PRODUCT_ID,
    ))).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("产品负责人"),
    });
  });

  it("freezes the current TB and copies its complete working BOM and three delivery bindings", async () => {
    await expect(ownerCaller.create(ecoCreateInput(MAIN_ECO_ID, PRODUCT_ID)))
      .resolves.toEqual({ success: true });
    await expect(ownerCaller.create(ecoCreateInput(STALE_ECO_ID, PRODUCT_ID)))
      .resolves.toEqual({ success: true });

    for (const projectId of [MAIN_ECO_ID, STALE_ECO_ID]) {
      const project = await getProjectById(projectId);
      expect(project?.productId).toBe(PRODUCT_ID);
      expect(project?.baseTechnicalBaselineId).toBe(BASELINE_ID);
      expect(project?.baseRevisionId).toBeNull();

      const workingBom = await listWorkingBom(projectId);
      expect(workingBom.map(row => ({
        partNumber: row.partNumber,
        name: row.name,
        spec: row.spec,
        quantity: row.quantity,
        keyModuleId: row.keyModuleId,
        keyModuleSnapshot: row.keyModuleSnapshot,
        sortOrder: row.sortOrder,
      }))).toEqual(BASE_BOM.map(row => ({
        partNumber: row.partNumber,
        name: row.name,
        spec: row.spec,
        quantity: row.quantity,
        keyModuleId: row.keyModuleId,
        keyModuleSnapshot: row.keyModuleSnapshot,
        sortOrder: row.sortOrder,
      })));

      const delivery = await listProjectDeliveryModuleBindings(projectId);
      expect(delivery.bindings).toHaveLength(3);
      expect(new Map(delivery.bindings.map(binding => [binding.moduleType, binding.moduleId])))
        .toEqual(new Map<KeyModuleType, string>([
          ["battery_energy", MODULES.battery.id],
          ["core_function", MODULES.core.id],
          ["electronics_hardware", MODULES.electronics.id],
        ]));
    }
  });

  it("publishes TB-002 while preserving unchanged BOM/modules/spec and rejects the stale sibling ECO", async () => {
    await bindProjectDeliveryModule({
      projectId: MAIN_ECO_ID,
      moduleType: "core_function",
      moduleId: MODULES.replacementCore.id,
      actorId: OWNER,
    });
    await completeEcoReleaseGate(MAIN_ECO_ID);
    await completeEcoReleaseGate(STALE_ECO_ID);

    const result = await releaseProject({
      projectId: MAIN_ECO_ID,
      actor: { id: OWNER, role: "member" },
    });
    expect(result).toMatchObject({
      productId: PRODUCT_ID,
      createdProduct: false,
      technicalBaselineLabel: "TB-002",
      revisionId: null,
      revisionLabel: null,
    });

    const current = await getCurrentProductTechnicalBaseline(PRODUCT_ID);
    expect(current?.id).toBe(result.technicalBaselineId);
    expect(current?.baselineLabel).toBe("TB-002");
    expect(current?.sourceProjectId).toBe(MAIN_ECO_ID);
    expect(current?.specSnapshot).toEqual({
      ...BASE_SPEC_SNAPSHOT,
      inheritedFromTechnicalBaselineId: BASELINE_ID,
    });

    const assignments = new Map(
      current?.assignments.map(assignment => [assignment.moduleType, assignment]) ?? [],
    );
    expect(assignments.get("battery_energy")).toMatchObject({
      moduleId: MODULES.battery.id,
      moduleSnapshot: snapshotFor(MODULES.battery),
    });
    expect(assignments.get("core_function")).toMatchObject({
      moduleId: MODULES.replacementCore.id,
      moduleSnapshot: expect.objectContaining({
        moduleNumber: MODULES.replacementCore.moduleNumber,
        items: [expect.objectContaining({ partNumber: MODULES.replacementCore.partNumber })],
      }),
    });
    expect(assignments.get("electronics_hardware")).toMatchObject({
      moduleId: MODULES.electronics.id,
      moduleSnapshot: snapshotFor(MODULES.electronics),
    });

    const frozenBom = current?.bomSnapshot ?? [];
    expect(frozenBom).toHaveLength(BASE_BOM.length);
    expect(frozenBom).toEqual(expect.arrayContaining([
      expect.objectContaining({
        partNumber: `HOUSING-${SUFFIX}`,
        name: "外壳组件",
        quantity: 2,
        keyModuleId: null,
      }),
      expect.objectContaining({
        partNumber: MODULES.battery.moduleNumber,
        keyModuleId: MODULES.battery.id,
        keyModuleSnapshot: snapshotFor(MODULES.battery),
      }),
      expect.objectContaining({
        partNumber: MODULES.replacementCore.moduleNumber,
        keyModuleId: MODULES.replacementCore.id,
      }),
      expect.objectContaining({
        partNumber: MODULES.electronics.moduleNumber,
        keyModuleId: MODULES.electronics.id,
        keyModuleSnapshot: snapshotFor(MODULES.electronics),
      }),
    ]));

    await expect(releaseProject({
      projectId: STALE_ECO_ID,
      actor: { id: OWNER, role: "member" },
    })).rejects.toThrow(/当前技术基线已变化|最新基线|rebase/);
    expect((await getCurrentProductTechnicalBaseline(PRODUCT_ID))?.id)
      .toBe(result.technicalBaselineId);
  });
});
