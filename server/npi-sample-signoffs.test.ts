import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { appRouter } from "./routers";
import { createProjectFile, getDb, getGateReadiness } from "./db";
import {
  activityLogs,
  projectFiles,
  projectIssues,
  projectMembers,
  projectNpiReadinessChecks,
  projectSampleSignoffs,
  projects,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const suffix = Date.now();
const PROJECT = `phase3de-${suffix}`;
const OWNER = 9_940_001 + (suffix % 10_000);
const PE = OWNER + 1;
const SALES = OWNER + 2;
const CUSTOMER = OWNER + 3;
const SUPPLIER = OWNER + 4;

let npiFileId = 0;
let customerFileId = 0;
let supplierFileId = 0;
let internalFileId = 0;

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `phase3de-${userId}`,
      username: null,
      passwordHash: null,
      name: `Phase3DE${userId}`,
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

  await db.insert(projects).values({
    id: PROJECT,
    name: "Pocket E-Pump R1",
    projectNumber: PROJECT,
    category: "npd",
    customer: "Decathlon",
    risk: "low",
    currentPhase: "pvt",
    createdBy: OWNER,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT, userId: PE, role: "pe", invitedBy: OWNER },
    { projectId: PROJECT, userId: SALES, role: "sales", invitedBy: OWNER },
    { projectId: PROJECT, userId: CUSTOMER, role: "external_customer", invitedBy: OWNER },
    { projectId: PROJECT, userId: SUPPLIER, role: "supplier", invitedBy: OWNER },
  ]);

  npiFileId = await createProjectFile({
    projectId: PROJECT,
    phaseId: "pvt",
    taskId: null,
    deliverableName: "PVT NPI readiness evidence",
    name: "pvt-npi-readiness.pdf",
    mimeType: "application/pdf",
    size: 1,
    storageKey: `${PROJECT}/pvt-npi-readiness`,
    storageUrl: `/storage/${PROJECT}/pvt-npi-readiness`,
    uploadedBy: PE,
    visibility: "internal",
  });
  customerFileId = await createProjectFile({
    projectId: PROJECT,
    phaseId: "pvt",
    taskId: null,
    deliverableName: "客户 golden sample 签样记录",
    name: "golden-sample-customer.pdf",
    mimeType: "application/pdf",
    size: 1,
    storageKey: `${PROJECT}/golden-sample-customer`,
    storageUrl: `/storage/${PROJECT}/golden-sample-customer`,
    uploadedBy: SALES,
    visibility: "customer",
  });
  supplierFileId = await createProjectFile({
    projectId: PROJECT,
    phaseId: "pvt",
    taskId: null,
    deliverableName: "供应商样件确认",
    name: "supplier-sample.pdf",
    mimeType: "application/pdf",
    size: 1,
    storageKey: `${PROJECT}/supplier-sample`,
    storageUrl: `/storage/${PROJECT}/supplier-sample`,
    uploadedBy: OWNER,
    visibility: "supplier",
  });
  internalFileId = await createProjectFile({
    projectId: PROJECT,
    phaseId: "pvt",
    taskId: null,
    deliverableName: "内部成本资料",
    name: "internal-cost.pdf",
    mimeType: "application/pdf",
    size: 1,
    storageKey: `${PROJECT}/internal-cost`,
    storageUrl: `/storage/${PROJECT}/internal-cost`,
    uploadedBy: OWNER,
    visibility: "internal",
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectSampleSignoffs).where(eq(projectSampleSignoffs.projectId, PROJECT));
  await db.delete(projectNpiReadinessChecks).where(eq(projectNpiReadinessChecks.projectId, PROJECT));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, PROJECT));
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("NPI readiness and sample signoff workflow", () => {
  it("PE owns PVT/MP readiness and Gate readiness blocks until NPI evidence is ready", async () => {
    const peCaller = appRouter.createCaller(makeCtx(PE));
    const salesCaller = appRouter.createCaller(makeCtx(SALES));

    const initial = await getGateReadiness(PROJECT, "pvt");
    const initialNpi = initial?.dimensions.find((dimension) => dimension.dimension === "npi_readiness");
    expect(initialNpi?.ok).toBe(false);
    expect(initialNpi?.blockers).toContain("PVT 缺少 PE/NPI readiness 检查");

    await expect(salesCaller.npiReadiness.create({
      projectId: PROJECT,
      phaseId: "pvt",
      title: "Sales 不应维护 NPI readiness",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const check = await peCaller.npiReadiness.create({
      projectId: PROJECT,
      phaseId: "pvt",
      title: "PVT 治具与测试程序验收",
      category: "fixture",
      status: "blocked",
      notes: "治具定位销未完成 CTQ 验收",
    });
    let readiness = await getGateReadiness(PROJECT, "pvt");
    let npiDim = readiness?.dimensions.find((dimension) => dimension.dimension === "npi_readiness");
    expect(npiDim?.ok).toBe(false);
    expect(npiDim?.blockers).toContain("NPI 阻断: PVT 治具与测试程序验收");

    const issue = await peCaller.npiReadiness.createIssueFromCheck({ id: check.id });
    expect(issue.existed).toBe(false);
    const db = await getDb();
    const [canonical] = await db!.select().from(activityLogs).where(and(
      eq(activityLogs.projectId, PROJECT),
      eq(activityLogs.action, "issue.create"),
      eq(activityLogs.entityId, String(issue.id)),
    ));
    expect(canonical.meta).toMatchObject({
      after: { creatorId: PE, status: "open", severity: "P1" },
    });

    await peCaller.npiReadiness.update({ id: check.id, projectId: PROJECT, status: "ready" });
    readiness = await getGateReadiness(PROJECT, "pvt");
    npiDim = readiness?.dimensions.find((dimension) => dimension.dimension === "npi_readiness");
    expect(npiDim?.ok).toBe(false);
    expect(npiDim?.blockers).toContain("NPI 缺少证据文件: PVT 治具与测试程序验收");

    await peCaller.npiReadiness.update({
      id: check.id,
      projectId: PROJECT,
      evidenceFileId: npiFileId,
      status: "ready",
    });
    readiness = await getGateReadiness(PROJECT, "pvt");
    npiDim = readiness?.dimensions.find((dimension) => dimension.dimension === "npi_readiness");
    expect(npiDim?.ok).toBe(true);
  });

  it("customer/supplier sample signoffs are audience-scoped and block Gate until confirmed", async () => {
    const ownerCaller = appRouter.createCaller(makeCtx(OWNER));
    const salesCaller = appRouter.createCaller(makeCtx(SALES));
    const customerCaller = appRouter.createCaller(makeCtx(CUSTOMER));
    const supplierCaller = appRouter.createCaller(makeCtx(SUPPLIER));

    const initial = await getGateReadiness(PROJECT, "pvt");
    const initialSignoff = initial?.dimensions.find((dimension) => dimension.dimension === "sample_signoffs");
    expect(initialSignoff?.ok).toBe(false);
    expect(initialSignoff?.blockers).toContain("PVT 缺少客户样品 / Golden Sample 签样项");

    await expect(salesCaller.sampleSignoffs.create({
      projectId: PROJECT,
      phaseId: "pvt",
      title: "Sales 不应把内部文件发给客户签样",
      signoffType: "golden_sample",
      audience: "customer",
      fileId: internalFileId,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const customerSignoff = await salesCaller.sampleSignoffs.create({
      projectId: PROJECT,
      phaseId: "pvt",
      title: "Decathlon Golden Sample 签样",
      signoffType: "golden_sample",
      audience: "customer",
      sampleSerials: ["PVT-001", "PVT-002"],
      fileId: customerFileId,
      dueDate: "2026-08-20",
      notes: "确认外观、标签、包装和充气性能。",
    });

    let customerRows = await customerCaller.sampleSignoffs.list({ projectId: PROJECT, phaseId: "pvt" });
    expect(customerRows.map((row) => row.title)).toEqual(["Decathlon Golden Sample 签样"]);
    await expect(supplierCaller.sampleSignoffs.respond({
      id: customerSignoff.id,
      status: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    let readiness = await getGateReadiness(PROJECT, "pvt");
    let signoffDim = readiness?.dimensions.find((dimension) => dimension.dimension === "sample_signoffs");
    expect(signoffDim?.ok).toBe(false);
    expect(signoffDim?.blockers).toContain("签样待确认: Decathlon Golden Sample 签样");

    await customerCaller.sampleSignoffs.respond({ id: customerSignoff.id, status: "approved" });
    readiness = await getGateReadiness(PROJECT, "pvt");
    signoffDim = readiness?.dimensions.find((dimension) => dimension.dimension === "sample_signoffs");
    expect(signoffDim?.ok).toBe(true);

    const supplierSignoff = await ownerCaller.sampleSignoffs.create({
      projectId: PROJECT,
      phaseId: "pvt",
      title: "电芯供应商样件确认",
      signoffType: "first_article",
      audience: "supplier",
      sampleSerials: ["CELL-PVT-01"],
      fileId: supplierFileId,
    });
    customerRows = await customerCaller.sampleSignoffs.list({ projectId: PROJECT, phaseId: "pvt" });
    const supplierRows = await supplierCaller.sampleSignoffs.list({ projectId: PROJECT, phaseId: "pvt" });
    expect(customerRows.map((row) => row.title)).toEqual(["Decathlon Golden Sample 签样"]);
    expect(supplierRows.map((row) => row.title)).toEqual(["电芯供应商样件确认"]);

    await supplierCaller.sampleSignoffs.respond({ id: supplierSignoff.id, status: "rejected" });
    readiness = await getGateReadiness(PROJECT, "pvt");
    signoffDim = readiness?.dimensions.find((dimension) => dimension.dimension === "sample_signoffs");
    expect(signoffDim?.ok).toBe(false);
    expect(signoffDim?.blockers).toContain("签样被拒绝: 电芯供应商样件确认");

    await supplierCaller.sampleSignoffs.respond({ id: supplierSignoff.id, status: "approved" });
    readiness = await getGateReadiness(PROJECT, "pvt");
    signoffDim = readiness?.dimensions.find((dimension) => dimension.dimension === "sample_signoffs");
    expect(signoffDim?.ok).toBe(true);
  });
});
