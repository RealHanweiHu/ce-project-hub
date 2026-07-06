import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, createProjectFile } from "./db";
import { appRouter } from "./routers";
import {
  comments,
  projectFiles,
  projectIssues,
  projectMembers,
  projectRisks,
  projectTasks,
  projects,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const suffix = Date.now();
const PROJECT = `ext-vis-${suffix}`;
const OTHER_PROJECT = `ext-other-${suffix}`;
const OWNER = 9_910_001 + (suffix % 10_000);
const EXTERNAL_CUSTOMER = OWNER + 1;
const SUPPLIER = OWNER + 2;

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `ext-vis-${userId}`,
      username: null,
      passwordHash: null,
      name: `External${userId}`,
      email: null,
      loginMethod: null,
      role: "user",
      canCreateProject: false,
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
      id: PROJECT,
      name: "外部可见边界",
      projectNumber: PROJECT,
      category: "npd",
      customer: "Decathlon",
      background: "Internal launch strategy",
      value: "Internal margin target",
      risk: "high",
      riskOverrideRisk: "high",
      riskOverrideReason: "internal blocker",
      riskOverrideUpdatedBy: OWNER,
      riskOverrideUpdatedAt: new Date(),
      currentPhase: "evt",
      customFields: { targetCost: "secret" },
      createdBy: OWNER,
    },
    {
      id: OTHER_PROJECT,
      name: "不可见项目",
      projectNumber: OTHER_PROJECT,
      category: "npd",
      risk: "low",
      currentPhase: "evt",
      createdBy: OWNER,
    },
  ]);
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: EXTERNAL_CUSTOMER, role: "external_customer", invitedBy: OWNER },
    { projectId: PROJECT, userId: SUPPLIER, role: "supplier", invitedBy: OWNER },
  ]);
  await db.insert(projectTasks).values({
    projectId: PROJECT,
    phaseId: "evt",
    taskId: "e1",
    instructions: "Internal EVT work",
    visibleRoles: ["qa", "pm", "project_manager"],
  });
  await db.insert(projectIssues).values({
    projectId: PROJECT,
    phaseId: "evt",
    title: "Internal P0 issue",
    severity: "P0",
    status: "open",
    category: "hardware",
    creatorId: OWNER,
  });
  await db.insert(projectRisks).values({
    projectId: PROJECT,
    title: "Internal supplier risk",
    severity: "high",
    status: "open",
    creatorId: OWNER,
  });
  await createProjectFile({
    projectId: PROJECT,
    phaseId: "evt",
    taskId: null,
    deliverableName: null,
    name: "internal.pdf",
    mimeType: "application/pdf",
    size: 1,
    storageKey: `k/${PROJECT}/internal`,
    storageUrl: `/storage/k/${PROJECT}/internal`,
    uploadedBy: OWNER,
    visibility: "internal",
  });
  await createProjectFile({
    projectId: PROJECT,
    phaseId: "evt",
    taskId: null,
    deliverableName: null,
    name: "customer.pdf",
    mimeType: "application/pdf",
    size: 1,
    storageKey: `k/${PROJECT}/customer`,
    storageUrl: `/storage/k/${PROJECT}/customer`,
    uploadedBy: OWNER,
    visibility: "customer",
  });
  await createProjectFile({
    projectId: PROJECT,
    phaseId: "evt",
    taskId: null,
    deliverableName: null,
    name: "supplier.pdf",
    mimeType: "application/pdf",
    size: 1,
    storageKey: `k/${PROJECT}/supplier`,
    storageUrl: `/storage/k/${PROJECT}/supplier`,
    uploadedBy: OWNER,
    visibility: "supplier",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJECT));
  await db.delete(comments).where(eq(comments.projectId, PROJECT));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, PROJECT));
  await db.delete(projectRisks).where(eq(projectRisks.projectId, PROJECT));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  await db.delete(projects).where(eq(projects.id, OTHER_PROJECT));
});

describe("external customer / supplier visibility boundary", () => {
  it("external customer sees only redacted authorized project data and customer files", async () => {
    const caller = appRouter.createCaller(makeCtx(EXTERNAL_CUSTOMER));

    const list = await caller.projects.list();
    const row = list.find((project) => project.id === PROJECT);
    expect(row).toBeTruthy();
    expect(list.some((project) => project.id === OTHER_PROJECT)).toBe(false);
    expect(row?.background).toBeNull();
    expect(row?.value).toBeNull();
    expect(row?.riskOverrideReason).toBeNull();
    expect(row?.customFields).toEqual({});

    const detail = await caller.projects.get({ id: PROJECT });
    expect(detail.background).toBeNull();
    expect(detail.value).toBeNull();
    expect(detail.customFields).toEqual({});

    const portfolio = await caller.projects.portfolio();
    const portfolioRow = portfolio.find((project) => project.id === PROJECT);
    expect(portfolioRow?.openIssues).toBe(0);
    expect(portfolioRow?.highRisks).toBe(0);
    expect(portfolioRow?.gateReady).toBeNull();
    expect(portfolioRow?.releaseConditions).toBeNull();

    const files = await caller.files.list({ projectId: PROJECT });
    expect(files.map((file) => file.name)).toEqual(["customer.pdf"]);
    expect(await caller.tasks.list({ projectId: PROJECT })).toEqual([]);
    expect(await caller.issues.list({ projectId: PROJECT })).toEqual([]);
    expect(await caller.risks.list({ projectId: PROJECT })).toEqual([]);
    expect(await caller.gateReviews.readiness({ projectId: PROJECT, phaseId: "evt" })).toBeNull();
    await expect(caller.comments.list({ entityType: "project", entityId: PROJECT })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.products.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("supplier sees only supplier-facing files and no internal workspace", async () => {
    const caller = appRouter.createCaller(makeCtx(SUPPLIER));

    const files = await caller.files.list({ projectId: PROJECT });
    expect(files.map((file) => file.name)).toEqual(["supplier.pdf"]);
    expect(await caller.tasks.list({ projectId: PROJECT })).toEqual([]);
    expect(await caller.issues.list({ projectId: PROJECT })).toEqual([]);
    expect(await caller.risks.list({ projectId: PROJECT })).toEqual([]);
    await expect(caller.products.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("external comment channels are audience-scoped", async () => {
    const customerCaller = appRouter.createCaller(makeCtx(EXTERNAL_CUSTOMER));
    const supplierCaller = appRouter.createCaller(makeCtx(SUPPLIER));

    await customerCaller.comments.externalAdd({
      projectId: PROJECT,
      audience: "customer",
      body: "Customer confirms EVT sample color.",
    });
    await supplierCaller.comments.externalAdd({
      projectId: PROJECT,
      audience: "supplier",
      body: "Supplier confirms motor sample ETA.",
    });

    const customerComments = await customerCaller.comments.externalList({ projectId: PROJECT, audience: "customer" });
    expect(customerComments.map((comment) => comment.body)).toEqual(["Customer confirms EVT sample color."]);

    const supplierComments = await supplierCaller.comments.externalList({ projectId: PROJECT, audience: "supplier" });
    expect(supplierComments.map((comment) => comment.body)).toEqual(["Supplier confirms motor sample ETA."]);

    await expect(customerCaller.comments.externalList({ projectId: PROJECT, audience: "supplier" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(supplierCaller.comments.externalList({ projectId: PROJECT, audience: "customer" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(customerCaller.comments.externalAdd({ projectId: PROJECT, audience: "supplier", body: "Wrong side" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
