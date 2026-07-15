import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  getDb, getProjectById, createProduct,
  upsertProductDefinition, confirmProductDefinition, listProductDefinitionSnapshots,
  getProjectMember, getProjectTasks,
} from "./db";
import { appRouter } from "./routers";
import { getEffectiveProjectRole } from "./project-access";
import {
  activityLogs,
  productDefinitionSnapshots,
  productDefinitions,
  products,
  projectGateReviews,
  projectMembers,
  projectPhases,
  projectTasks,
  projects,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const MANAGER_PROJECT = `role-rank-m-${Date.now()}`;
const VIEWER_PROJECT = `role-rank-v-${Date.now()}`;
const HANDOFF_PROJECT = `handoff-${Date.now()}`;
const HANDOFF_PRODUCT = `handoff-product-${Date.now()}`;
const OPTIONAL_PROJECT = `optional-product-${Date.now()}`;
const DRAFT_PRODUCT_PROJECT = `draft-product-${Date.now()}`;
const DRAFT_PRODUCT = `draft-product-${Date.now()}`;
const DEFAULT_PRODUCT_OWNER_PROJECT = `po-default-${Date.now()}`;
const EXPLICIT_PRODUCT_OWNER_PROJECT = `po-explicit-${Date.now()}`;
const OWNER = 980001;
const MANAGER_PM = 980002;
const VIEWER_PM = 980003;
const EXPLICIT_PRODUCT_OWNER = 980004;
const NPD_ATTRIBUTES = {
  hasBattery: false,
  needsCert: false,
  hasFirmware: false,
  needsNewMold: false,
  isNewPlatform: false,
} as const;
const BATTERY_CERT_ATTRIBUTES = {
  ...NPD_ATTRIBUTES,
  hasBattery: true,
  needsCert: true,
} as const;

function makeCtx(userId: number, canCreateProject = false): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-user-${userId}`,
      username: null,
      passwordHash: null,
      name: `TestUser${userId}`,
      email: null,
      loginMethod: null,
      role: "user",
      canCreateProject,
      mobile: null,
      dingtalkUserId: null,
      dingtalkCorpUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");

  await db.insert(projects).values([
    {
      id: MANAGER_PROJECT,
      name: "角色不降权测试",
      projectNumber: MANAGER_PROJECT,
      category: "npd",
      risk: "low",
      currentPhase: "design",
      createdBy: OWNER,
      pmUserId: MANAGER_PM,
    },
    {
      id: VIEWER_PROJECT,
      name: "PM 兜底测试",
      projectNumber: VIEWER_PROJECT,
      category: "npd",
      risk: "low",
      currentPhase: "design",
      createdBy: OWNER,
      pmUserId: VIEWER_PM,
    },
  ]);

  await db.insert(projectMembers).values([
    { projectId: MANAGER_PROJECT, userId: MANAGER_PM, role: "manager", invitedBy: OWNER },
    { projectId: VIEWER_PROJECT, userId: VIEWER_PM, role: "viewer", invitedBy: OWNER },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;

  for (const projectId of [MANAGER_PROJECT, VIEWER_PROJECT]) {
    await db.delete(activityLogs).where(eq(activityLogs.projectId, projectId));
    await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, projectId));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
  await db.delete(activityLogs).where(eq(activityLogs.projectId, HANDOFF_PROJECT));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, HANDOFF_PROJECT));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, HANDOFF_PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, HANDOFF_PROJECT));
  await db.delete(projects).where(eq(projects.id, HANDOFF_PROJECT));
  await db.delete(productDefinitionSnapshots).where(eq(productDefinitionSnapshots.productId, HANDOFF_PRODUCT));
  await db.delete(productDefinitions).where(eq(productDefinitions.productId, HANDOFF_PRODUCT));
  await db.delete(products).where(eq(products.id, HANDOFF_PRODUCT));
  for (const projectId of [
    OPTIONAL_PROJECT,
    DRAFT_PRODUCT_PROJECT,
    DEFAULT_PRODUCT_OWNER_PROJECT,
    EXPLICIT_PRODUCT_OWNER_PROJECT,
  ]) {
    await db.delete(activityLogs).where(eq(activityLogs.projectId, projectId));
    await db.delete(projectTasks).where(eq(projectTasks.projectId, projectId));
    await db.delete(projectPhases).where(eq(projectPhases.projectId, projectId));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
  await db.delete(productDefinitions).where(eq(productDefinitions.productId, DRAFT_PRODUCT));
  await db.delete(products).where(eq(products.id, DRAFT_PRODUCT));
});

describe("project access role resolution", () => {
  it("pmUserId 不会把已有 manager 降成 project_manager", async () => {
    const project = await getProjectById(MANAGER_PROJECT);
    expect(project).not.toBeNull();

    await expect(getEffectiveProjectRole(project!, MANAGER_PM)).resolves.toBe("manager");
  });

  it("pmUserId 只在成员角色更低时补成 project_manager", async () => {
    const project = await getProjectById(VIEWER_PROJECT);
    expect(project).not.toBeNull();

    await expect(getEffectiveProjectRole(project!, VIEWER_PM)).resolves.toBe("project_manager");
  });

  it("同时是 pmUserId 的 manager 仍可创建 Gate 评审", async () => {
    const caller = appRouter.createCaller(makeCtx(MANAGER_PM));

    await expect(
      caller.gateReviews.create({
        projectId: MANAGER_PROJECT,
        phaseId: "design",
        phaseName: "Design",
        gateName: "Design Gate",
        reviewDate: "2026-06-18",
        decision: "rejected",
      }),
    ).resolves.toMatchObject({ success: true });
  });
});

describe("project create validation", () => {
  it("未指定产品负责人时默认创建人，且指定的项目经理仍保持独立角色", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER, true));

    await caller.projects.create({
      id: DEFAULT_PRODUCT_OWNER_PROJECT,
      name: "产品负责人与项目经理分工",
      projectNumber: "NPD-OWNER-PM",
      category: "npd",
      pmUserId: VIEWER_PM,
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: NPD_ATTRIBUTES,
    });

    const project = await getProjectById(DEFAULT_PRODUCT_OWNER_PROJECT);
    expect(project?.productOwnerUserId).toBe(OWNER);
    expect(project?.pmUserId).toBe(VIEWER_PM);
    await expect(getProjectMember(DEFAULT_PRODUCT_OWNER_PROJECT, VIEWER_PM))
      .resolves.toMatchObject({ role: "project_manager" });
  });

  it("显式指定的产品负责人不会被创建人或项目经理覆盖", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER, true));

    await caller.projects.create({
      id: EXPLICIT_PRODUCT_OWNER_PROJECT,
      name: "显式产品负责人",
      projectNumber: "NPD-EXPLICIT-OWNER",
      category: "npd",
      productOwnerUserId: EXPLICIT_PRODUCT_OWNER,
      pmUserId: MANAGER_PM,
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: NPD_ATTRIBUTES,
    });

    const project = await getProjectById(EXPLICIT_PRODUCT_OWNER_PROJECT);
    expect(project?.productOwnerUserId).toBe(EXPLICIT_PRODUCT_OWNER);
    expect(project?.createdBy).toBe(OWNER);
    expect(project?.pmUserId).toBe(MANAGER_PM);
  });

  it("创建 NPD 项目不要求先关联产品库产品", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER, true));

    await caller.projects.create({
      id: OPTIONAL_PROJECT,
      name: "无产品库前置 NPD",
      projectNumber: "NPD-NO-PRODUCT",
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: NPD_ATTRIBUTES,
    });

    const project = await getProjectById(OPTIONAL_PROJECT);
    expect(project?.productId).toBeNull();
    expect(project?.productDefinitionSnapshotId).toBeNull();
  });

  it("关联未确认定义的产品型号也不阻断立项,仅不锁定快照", async () => {
    await createProduct({
      id: DRAFT_PRODUCT,
      productNumber: "DG01",
      name: "高端车载泵 DG01",
      type: "finished",
      category: "充气泵",
      targetMarkets: ["OEM"],
      createdBy: OWNER,
    });
    const caller = appRouter.createCaller(makeCtx(OWNER, true));

    await caller.projects.create({
      id: DRAFT_PRODUCT_PROJECT,
      name: "高端车载泵 DG01 开发项目",
      projectNumber: "NPD-DG01",
      category: "npd",
      productId: DRAFT_PRODUCT,
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: NPD_ATTRIBUTES,
    });

    const project = await getProjectById(DRAFT_PRODUCT_PROJECT);
    expect(project?.productId).toBe(DRAFT_PRODUCT);
    expect(project?.productDefinitionSnapshotId).toBeNull();
  });

  it("创建项目时拒绝非法开始日期,避免坏日期落库后重排 500", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER, true));

    await expect(caller.projects.create({
      id: `bad-date-${Date.now()}`,
      name: "bad date",
      projectNumber: "BAD-DATE",
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: NPD_ATTRIBUTES,
      startDate: "2026-13-99",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("创建 NPD 项目时锁定已确认产品定义快照,并可读取交接输入", async () => {
    await createProduct({
      id: HANDOFF_PRODUCT,
      productNumber: "DG01",
      name: "DG01 锂电车载充气泵",
      type: "finished",
      category: "充气泵",
      targetMarkets: ["US", "EU"],
      createdBy: OWNER,
    });
    await upsertProductDefinition(HANDOFF_PRODUCT, OWNER, {
      title: "DG01 产品定义",
      positioning: "高端精致型便携车载泵",
      prdSummary: "锁定电池容量、充气速度、压力范围和目标成本。",
      specs: [{ key: "pressure", label: "压力范围", target: "3-150psi", ownerRole: "结构" }],
      targetCost: "USD 22",
      targetPrice: "USD 69",
      targetGrossMargin: ">=35%",
      skuPlan: [{ name: "标准版", code: "STD" }],
    });
    await confirmProductDefinition(HANDOFF_PRODUCT, OWNER);
    const [snapshot] = await listProductDefinitionSnapshots(HANDOFF_PRODUCT);

    const caller = appRouter.createCaller(makeCtx(OWNER, true));
    await caller.projects.create({
      id: HANDOFF_PROJECT,
      name: "DG01 NPD",
      projectNumber: "NPD-DG01",
      category: "npd",
      productId: HANDOFF_PRODUCT,
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: BATTERY_CERT_ATTRIBUTES,
      npdTemplate: { tier: "full", packs: ["battery", "cert"] },
    });

    const project = await getProjectById(HANDOFF_PROJECT);
    expect(project?.productDefinitionSnapshotId).toBe(snapshot.id);

    const handoff = await caller.projects.productHandoff({ projectId: HANDOFF_PROJECT });
    expect(handoff.snapshotSource).toBe("locked");
    expect(handoff.product?.id).toBe(HANDOFF_PRODUCT);
    expect(handoff.snapshot?.versionNumber).toBe(1);
    expect(handoff.snapshot?.snapshot.specs[0].label).toBe("压力范围");
    expect(handoff.roleBuckets.some((bucket) =>
      bucket.role === "rd_mech" && bucket.specs.some((spec) => spec.label === "压力范围")
    )).toBe(true);

    const generated = await caller.projects.generateHandoffTasks({ projectId: HANDOFF_PROJECT });
    expect(generated.created).toBeGreaterThan(0);
    const tasks = await getProjectTasks(HANDOFF_PROJECT, "design");
    const handoffTask = tasks.find((task) => task.taskId === "pd_rd_mech");
    expect(handoffTask?.instructions).toContain("产品定义交接 - 结构 / ID");
    expect(handoffTask?.visibleRoles).toContain("rd_mech");
  });
});
