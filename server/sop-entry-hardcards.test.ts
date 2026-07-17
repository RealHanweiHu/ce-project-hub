import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, createProduct, createProductRevision, getProjectById } from "./db";
import { projectsRouter } from "./routers/projects";
import {
  activityLogs,
  productRevisions,
  products,
  projectChangeScopeDeclarations,
  projectMembers,
  projectPhases,
  projectTasks,
  projects,
  productTechnicalBaselines,
  users,
} from "../drizzle/schema";

const OWNER = 991001;
const PRODUCT = `hardcard-product-${Date.now()}`;
const LEGACY_PRODUCT = `hc-legacy-p-${Date.now()}`;
const ECO = `hardcard-eco-${Date.now()}`;
const LEGACY_ECO = `hc-legacy-e-${Date.now()}`;
const LEGACY_BASE_PROJECT = `hc-legacy-base-${Date.now()}`;
const LEGACY_BASELINE = `hc-legacy-tb-${Date.now()}`;
const RETIRED_IDR = `hc-idr-${Date.now()}`;
const JDM = `hardcard-jdm-${Date.now()}`;
const OBT = `hardcard-obt-${Date.now()}`;
const NPD = `hardcard-npd-${Date.now()}`;
const NPD_ATTRIBUTES = {
  hasBattery: false,
  needsCert: false,
  hasFirmware: false,
  needsNewMold: false,
  isNewPlatform: false,
} as const;
const caller = projectsRouter.createCaller({
  user: { id: OWNER, role: "member", name: "Hardcard Owner", canCreateProject: true },
} as any);

const baseInput = (id: string, category: "eco" | "idr" | "jdm" | "obt") => ({
  id,
  name: id,
  projectNumber: id,
  category,
  risk: "low" as const,
  currentPhase: category === "jdm"
    ? "input"
    : category === "obt"
      ? "intake"
      : category === "idr"
        ? "design"
        : "planning",
  progress: 0,
});

beforeAll(async () => {
  await createProduct({ id: PRODUCT, name: "Baseline Product", type: "finished", category: "test", createdBy: OWNER });
  await createProduct({ id: LEGACY_PRODUCT, name: "Legacy Product", type: "finished", category: "test", createdBy: OWNER });
  const revisionId = await createProductRevision({
    productId: PRODUCT,
    revisionLabel: "Rev A",
    status: "released",
    releasedBy: OWNER,
    releasedAt: new Date(),
  });
  const db = await getDb();
  const [releaseUser] = await db!.select({ id: users.id }).from(users).limit(1);
  if (!releaseUser) throw new Error("test database requires one user");
  await db!.insert(projects).values({
    id: LEGACY_BASE_PROJECT,
    name: "Legacy baseline source",
    projectNumber: LEGACY_BASE_PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "mp",
    progress: 100,
    createdBy: OWNER,
  });
  await db!.insert(productTechnicalBaselines).values({
    id: LEGACY_BASELINE,
    productId: LEGACY_PRODUCT,
    baselineLabel: "TB-001",
    sourceProjectId: LEGACY_BASE_PROJECT,
    keyModulesSnapshot: {},
    bomSnapshot: [{ partNumber: "BASE-001", name: "Legacy baseline part", quantity: 1 }],
    specSnapshot: { productDefinitionSnapshot: { productName: "Legacy Product" } },
    releasedBy: releaseUser.id,
    releasedAt: new Date(),
  });
  await db!.update(products).set({ currentTechnicalBaselineId: LEGACY_BASELINE })
    .where(eq(products.id, LEGACY_PRODUCT));
  await db!.update(products).set({ currentRevisionId: revisionId }).where(eq(products.id, PRODUCT));
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  for (const id of [ECO, LEGACY_ECO, RETIRED_IDR, JDM, OBT, NPD]) {
    await db.delete(activityLogs).where(eq(activityLogs.projectId, id));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, id));
    await db.delete(projectTasks).where(eq(projectTasks.projectId, id));
    await db.delete(projectPhases).where(eq(projectPhases.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
  await db.update(products).set({ currentTechnicalBaselineId: null })
    .where(eq(products.id, LEGACY_PRODUCT));
  await db.delete(productTechnicalBaselines).where(eq(productTechnicalBaselines.id, LEGACY_BASELINE));
  await db.delete(projects).where(eq(projects.id, LEGACY_BASE_PROJECT));
  await db.delete(productRevisions).where(eq(productRevisions.productId, PRODUCT));
  await db.delete(products).where(eq(products.id, LEGACY_PRODUCT));
  await db.delete(products).where(eq(products.id, PRODUCT));
});

describe("SOP entry hard cards", () => {
  it("retires IDR creation and routes work by collaboration complexity", async () => {
    await expect(caller.create({
      ...baseInput(RETIRED_IDR, "idr"),
      productId: PRODUCT,
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("IDR 已停止新建"),
    });
  });

  it("requires ECO to target an existing product without requiring a Revision", async () => {
    await expect(caller.create(baseInput(ECO, "eco"))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("ECO 必须关联"),
    });
    await expect(caller.create({
      ...baseInput(LEGACY_ECO, "eco"),
      productId: LEGACY_PRODUCT,
    })).resolves.toEqual({ success: true });
    const legacyProject = await getProjectById(LEGACY_ECO);
    expect(legacyProject?.productId).toBe(LEGACY_PRODUCT);
    expect(legacyProject?.baseRevisionId).toBeNull();
  });

  it("JDM 只冻结客户概念、商务边界和确认责任人，不提前要求客户规格或模块基线", async () => {
    await expect(caller.create({
      ...baseInput(JDM, "jdm"),
      commercialBoundary: "NRE and certification owned by customer",
      customerSignoffOwnerUserId: OWNER,
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("客户概念"),
    });
    await expect(caller.create({
      ...baseInput(JDM, "jdm"),
      commercialBoundary: "NRE and certification owned by customer",
      customerSignoffOwnerUserId: OWNER,
      customFields: {
        projectExecutionBaseline: {
          modelVersion: "project-track-v1",
          status: "draft",
          customerConceptRef: "customer://concept/ID-001",
        },
      },
    })).resolves.toEqual({ success: true });
    const db = await getDb();
    const project = await getProjectById(JDM);
    const riskDeclarations = await db!.select()
      .from(projectChangeScopeDeclarations)
      .where(eq(projectChangeScopeDeclarations.projectId, JDM));
    expect(project?.customerInputVersion).toBeNull();
    expect(project?.customerPartNumber).toBeNull();
    expect(project?.inputBaselineFrozenAt).toBeTruthy();
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({
      modelVersion: "project-track-v1",
      status: "draft",
      customerConceptRef: "customer://concept/ID-001",
    });
    expect(riskDeclarations).toHaveLength(0);
  });

  it("OBT 仍要求并冻结四项客户设计输入", async () => {
    await expect(caller.create(baseInput(OBT, "obt"))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("OBT"),
    });
    await expect(caller.create({
      ...baseInput(OBT, "obt"),
      customerInputVersion: "BOM V1.3",
      customerPartNumber: "CUS-001",
      commercialBoundary: "NRE and certification owned by customer",
      customerSignoffOwnerUserId: OWNER,
    })).resolves.toEqual({ success: true });
    const project = await getProjectById(OBT);
    expect(project?.customerInputVersion).toBe("BOM V1.3");
    expect(project?.customerPartNumber).toBe("CUS-001");
    expect(project?.inputBaselineFrozenAt).toBeTruthy();
  });

  it("keeps NPD independent until project completion generates a product", async () => {
    await caller.create({
      id: NPD,
      name: "NPD Gate 1 baseline",
      projectNumber: "NPD-G1",
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: NPD_ATTRIBUTES,
    });
    const project = await getProjectById(NPD);
    expect(project?.productId).toBeNull();
    expect(project?.productDefinitionSnapshotId).toBeNull();
  });
});
