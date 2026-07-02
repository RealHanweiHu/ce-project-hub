import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectFile } from "./db";
import { projects, projectFiles, projectDeliverableReviews, projectMembers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { deliverableReviewsRouter } from "./routers/deliverableReviews";
import { canMutateFileForProject } from "./deliverable-access";
import { ROLE_PERMISSIONS } from "./routers/members";

const PROJ = `drr-${Date.now()}`;
const PM = 930001, REVIEWER = 930002, OUTSIDER = 930003, BATTERY = 930004, PE = 930005, SCM = 930006, SALES = 930007, VIEWER = 930008;
const makeCtx = (id: number, role: string) => ({ user: { id, role, name: "x", email: "x", canCreateProject: true, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null, passwordHash: null, username: null } });
const caller = (id: number, role: string) => deliverableReviewsRouter.createCaller(makeCtx(id, role) as any);

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({ id: PROJ, name: "审核路由", projectNumber: "DRR-1", category: "npd", risk: "low", currentPhase: "design", createdBy: PM, pmUserId: PM });
  await db!.insert(projectMembers).values({ projectId: PROJ, userId: PM, role: "pm", invitedBy: PM });
  await db!.insert(projectMembers).values({ projectId: PROJ, userId: REVIEWER, role: "qa", invitedBy: PM });
  await db!.insert(projectMembers).values({ projectId: PROJ, userId: BATTERY, role: "battery_safety", invitedBy: PM });
  await db!.insert(projectMembers).values({ projectId: PROJ, userId: PE, role: "pe", invitedBy: PM });
  await db!.insert(projectMembers).values({ projectId: PROJ, userId: SCM, role: "scm", invitedBy: PM });
  await db!.insert(projectMembers).values({ projectId: PROJ, userId: SALES, role: "sales", invitedBy: PM });
  await db!.insert(projectMembers).values({ projectId: PROJ, userId: VIEWER, role: "viewer", invitedBy: PM });
  await createProjectFile({ projectId: PROJ, phaseId: "concept", taskId: "c6", deliverableName: "市场调研报告", name: "market.pdf", mimeType: "application/pdf", size: 1, storageKey: "k/market", storageUrl: "/storage/k/market", uploadedBy: SALES });
  await createProjectFile({ projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: "ID外观图", name: "id.pdf", mimeType: "application/pdf", size: 1, storageKey: "k/id", storageUrl: "/storage/k/id", uploadedBy: PM });
  await createProjectFile({ projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: "BOM v1.0", name: "bom.pdf", mimeType: "application/pdf", size: 1, storageKey: "k/bom", storageUrl: "/storage/k/bom", uploadedBy: SCM });
  await createProjectFile({ projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: "安全FMEA与危害分析", name: "fmea.pdf", mimeType: "application/pdf", size: 1, storageKey: "k/fmea", storageUrl: "/storage/k/fmea", uploadedBy: PM });
  await createProjectFile({ projectId: PROJ, phaseId: "pvt", taskId: "pv8", deliverableName: "EOL 100%测试能力验收记录", name: "eol.pdf", mimeType: "application/pdf", size: 1, storageKey: "k/eol", storageUrl: "/storage/k/eol", uploadedBy: PM });
  await createProjectFile({ projectId: PROJ, phaseId: "pvt", taskId: "pv8", deliverableName: "电芯/电池包安全认证报告或复用确认", name: "battery.pdf", mimeType: "application/pdf", size: 1, storageKey: "k/battery", storageUrl: "/storage/k/battery", uploadedBy: PM });
});
afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
  await db!.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db!.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

describe("deliverableReviews 权限", () => {
  it("非成员 list → FORBIDDEN", async () => {
    await expect(caller(OUTSIDER, "user").list({ projectId: PROJ })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("PM list → ok", async () => {
    await expect(caller(PM, "user").list({ projectId: PROJ })).resolves.toBeDefined();
  });
  it("非成员 submit → FORBIDDEN", async () => {
    await expect(caller(OUTSIDER, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", reviewerUserId: REVIEWER })).rejects.toThrow();
  });
  it("PM submit 无文件 → BAD_REQUEST", async () => {
    // "MD结构图" is in design's effective submission set but has no uploaded file
    await expect(caller(PM, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "MD结构图", reviewerUserId: REVIEWER })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("PM submit 非项目审核人 → BAD_REQUEST", async () => {
    await expect(caller(PM, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", reviewerUserId: OUTSIDER })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("PM submit → ok", async () => {
    await expect(caller(PM, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", reviewerUserId: REVIEWER })).resolves.toBeTruthy();
  });
  it("专业角色无任务编辑权也可提交匹配交付物", async () => {
    await expect(caller(SCM, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "BOM v1.0", reviewerUserId: PM })).resolves.toBeTruthy();
    await expect(caller(SALES, "user").submit({ projectId: PROJ, phaseId: "concept", deliverableName: "市场调研报告", reviewerUserId: PM })).resolves.toBeTruthy();
    await expect(caller(BATTERY, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "安全FMEA与危害分析", reviewerUserId: PM })).resolves.toBeTruthy();
  });
  it("专业角色可上传匹配交付物证据，viewer 不可上传", async () => {
    await expect(canMutateFileForProject({
      projectId: PROJ,
      actorId: SCM,
      role: "scm",
      permissions: ROLE_PERMISSIONS.scm,
      phaseId: "design",
      taskId: "d8",
      deliverableName: "BOM v1.0",
    })).resolves.toBe(true);
    await expect(canMutateFileForProject({
      projectId: PROJ,
      actorId: VIEWER,
      role: "viewer",
      permissions: ROLE_PERMISSIONS.viewer,
      phaseId: "design",
      taskId: "d8",
      deliverableName: "BOM v1.0",
    })).resolves.toBe(false);
  });
  it("viewer 不能提交交付物审核", async () => {
    await expect(caller(VIEWER, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "BOM v1.0", reviewerUserId: PM })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("安全/电池/EOL 交付物默认匹配专业审核人", async () => {
    const db = await getDb();
    await expect(caller(PM, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "安全FMEA与危害分析" })).resolves.toBeTruthy();
    await expect(caller(PM, "user").submit({ projectId: PROJ, phaseId: "pvt", deliverableName: "EOL 100%测试能力验收记录" })).resolves.toBeTruthy();
    await expect(caller(PM, "user").submit({ projectId: PROJ, phaseId: "pvt", deliverableName: "电芯/电池包安全认证报告或复用确认" })).resolves.toBeTruthy();
    const rows = await db!.select().from(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
    const byName = new Map(rows.map((row) => [row.deliverableName, row.reviewerUserId]));
    expect(byName.get("安全FMEA与危害分析")).toBe(BATTERY);
    expect(byName.get("EOL 100%测试能力验收记录")).toBe(PE);
    expect(byName.get("电芯/电池包安全认证报告或复用确认")).toBe(BATTERY);
  });
  it("不能指定自己为审核人（禁止自审自批）", async () => {
    // PM 上传并提交 ID外观图，却把自己设为审核人 → 拒绝
    await expect(
      caller(PM, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", reviewerUserId: PM })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("自动分派审核人时也不会落到提交人自己", async () => {
    // battery_safety 成员亲自提交安全FMEA，默认审核人本应是 battery_safety（=自己）→ 必须回避
    // 项目里有 qa/pm 等其他非只读成员可兜底
    await caller(BATTERY, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "安全FMEA与危害分析" });
    const db = await getDb();
    const [row] = await db!.select().from(projectDeliverableReviews)
      .where(eq(projectDeliverableReviews.projectId, PROJ));
    // 具体谁不重要，关键是不等于提交人 BATTERY
    const rows = await db!.select().from(projectDeliverableReviews)
      .where(eq(projectDeliverableReviews.projectId, PROJ));
    const fmea = rows.find((r) => r.deliverableName === "安全FMEA与危害分析");
    expect(fmea?.reviewerUserId).not.toBe(BATTERY);
    void row;
  });
  it("非审核人 review → FORBIDDEN", async () => {
    await expect(caller(OUTSIDER, "user").review({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", note: null })).rejects.toThrow();
  });
  it("审核人 review → ok", async () => {
    await expect(caller(REVIEWER, "user").review({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", note: null })).resolves.toBeTruthy();
  });
});
