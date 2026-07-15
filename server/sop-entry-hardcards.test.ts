import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, createProduct, createProductRevision, getProjectById } from "./db";
import { projectsRouter } from "./routers/projects";
import {
  activityLogs,
  productRevisions,
  products,
  projectMembers,
  projectPhases,
  projectTasks,
  projects,
} from "../drizzle/schema";

const OWNER = 991001;
const PRODUCT = `hardcard-product-${Date.now()}`;
const LEGACY_PRODUCT = `hc-legacy-p-${Date.now()}`;
const ECO = `hardcard-eco-${Date.now()}`;
const LEGACY_ECO = `hc-legacy-e-${Date.now()}`;
const RETIRED_IDR = `hc-idr-${Date.now()}`;
const JDM = `hardcard-jdm-${Date.now()}`;
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

const baseInput = (id: string, category: "eco" | "idr" | "jdm") => ({
  id,
  name: id,
  projectNumber: id,
  category,
  risk: "low" as const,
  currentPhase: category === "jdm" ? "input" : category === "idr" ? "design" : "planning",
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
  await db!.update(products).set({ currentRevisionId: revisionId }).where(eq(products.id, PRODUCT));
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  for (const id of [ECO, LEGACY_ECO, RETIRED_IDR, JDM, NPD]) {
    await db.delete(activityLogs).where(eq(activityLogs.projectId, id));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, id));
    await db.delete(projectTasks).where(eq(projectTasks.projectId, id));
    await db.delete(projectPhases).where(eq(projectPhases.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
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

  it("creates ECO/DRV independently from Product and Revision", async () => {
    await expect(caller.create(baseInput(ECO, "eco"))).resolves.toEqual({ success: true });
    const project = await getProjectById(ECO);
    expect(project?.productId).toBeNull();
    expect(project?.baseRevisionId).toBeNull();

    await expect(caller.create({
      ...baseInput(LEGACY_ECO, "eco"),
      productId: LEGACY_PRODUCT,
    })).resolves.toEqual({ success: true });
    const legacyProject = await getProjectById(LEGACY_ECO);
    expect(legacyProject?.productId).toBe(LEGACY_PRODUCT);
    expect(legacyProject?.baseRevisionId).toBeNull();
  });

  it("freezes customer input fields for JDM/OBT at project entry", async () => {
    await expect(caller.create(baseInput(JDM, "jdm"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.create({
      ...baseInput(JDM, "jdm"),
      customerInputVersion: "BOM V1.3",
      customerPartNumber: "CUS-001",
      commercialBoundary: "NRE and certification owned by customer",
      customerSignoffOwnerUserId: OWNER,
    })).resolves.toEqual({ success: true });
    const project = await getProjectById(JDM);
    expect(project?.customerInputVersion).toBe("BOM V1.3");
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
