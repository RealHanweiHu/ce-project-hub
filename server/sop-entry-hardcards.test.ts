import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, createProduct, createProductRevision, getProjectById, ensureNpdProductBaseline } from "./db";
import { projectsRouter } from "./routers/projects";
import {
  activityLogs,
  productDefinitionSnapshots,
  productDefinitions,
  productRevisions,
  products,
  projectMembers,
  projectPhases,
  projectTasks,
  projects,
} from "../drizzle/schema";

const OWNER = 991001;
const PRODUCT = `hardcard-product-${Date.now()}`;
const ECO = `hardcard-eco-${Date.now()}`;
const JDM = `hardcard-jdm-${Date.now()}`;
const NPD = `hardcard-npd-${Date.now()}`;
let generatedNpdProductId: string | null = null;
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

const baseInput = (id: string, category: "eco" | "jdm") => ({
  id,
  name: id,
  projectNumber: id,
  category,
  risk: "low" as const,
  currentPhase: category === "jdm" ? "input" : "planning",
  progress: 0,
});

beforeAll(async () => {
  await createProduct({ id: PRODUCT, name: "Baseline Product", type: "finished", category: "test", createdBy: OWNER });
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
  for (const id of [ECO, JDM, NPD]) {
    await db.delete(activityLogs).where(eq(activityLogs.projectId, id));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, id));
    await db.delete(projectTasks).where(eq(projectTasks.projectId, id));
    await db.delete(projectPhases).where(eq(projectPhases.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
  if (generatedNpdProductId) {
    await db.delete(productDefinitionSnapshots).where(eq(productDefinitionSnapshots.productId, generatedNpdProductId));
    await db.delete(productDefinitions).where(eq(productDefinitions.productId, generatedNpdProductId));
    await db.delete(products).where(eq(products.id, generatedNpdProductId));
  }
  await db.delete(productRevisions).where(eq(productRevisions.productId, PRODUCT));
  await db.delete(products).where(eq(products.id, PRODUCT));
});

describe("SOP entry hard cards", () => {
  it("rejects ECO/DRV/IDR without an existing released baseline", async () => {
    await expect(caller.create(baseInput(ECO, "eco"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.create({ ...baseInput(ECO, "eco"), productId: PRODUCT })).resolves.toEqual({ success: true });
    const project = await getProjectById(ECO);
    expect(project?.productId).toBe(PRODUCT);
    expect(project?.baseRevisionId).toBeTruthy();
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

  it("creates a product draft link and immutable definition snapshot at NPD Gate 1", async () => {
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
    const baseline = await ensureNpdProductBaseline(NPD, OWNER);
    generatedNpdProductId = baseline.productId;
    const project = await getProjectById(NPD);
    expect(project?.productId).toBe(baseline.productId);
    expect(project?.productDefinitionSnapshotId).toBe(baseline.snapshotId);
  });
});
