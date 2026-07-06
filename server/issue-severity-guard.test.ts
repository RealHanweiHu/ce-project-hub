import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { projectIssues, projectMembers, projects } from "../drizzle/schema";
import { issuesRouter } from "./routers/issues";

/**
 * P0/P1 严重度降级守卫：降级会使问题退出 Gate 的 critical_issues 阻塞集，
 * 等价于绕过 QA 关闭确认——工程师（创建者或 canEditIssues 角色）不得自行把
 * P0/P1 降到 P2/P3，只有 canCloseIssues（QA/管理层）可以降级。
 * 升级（P2→P1、P1→P0）不受限：发现更严重是安全方向。
 */
const PROJ = `sev-guard-${Date.now()}`;
const OWNER = 971001;
const HW = 971002; // rd_hw：canEditIssues=true, canCloseIssues=false
const QA = 971003; // qa：canCloseIssues=true
const HW2 = 971004; // 另一个 rd_hw（非创建者）

const makeCtx = (id: number, role = "user") => ({
  user: {
    id, role, name: `u${id}`, email: null, canCreateProject: false,
    mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null,
    passwordHash: null, username: null,
  },
});
const caller = (id: number, role = "user") => issuesRouter.createCaller(makeCtx(id, role) as any);

async function createIssue(byUserId: number, severity: "P0" | "P1" | "P2" | "P3") {
  const r = await caller(byUserId).create({
    projectId: PROJ, phaseId: "evt", title: `振动超标 ${severity}`, severity,
    status: "open", category: "hardware",
  });
  return r.id;
}

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({
    id: PROJ, name: "严重度守卫", projectNumber: PROJ, category: "npd",
    risk: "low", currentPhase: "evt", createdBy: OWNER, pmUserId: OWNER,
  });
  await db!.insert(projectMembers).values([
    { projectId: PROJ, userId: HW, role: "rd_hw", invitedBy: OWNER },
    { projectId: PROJ, userId: HW2, role: "rd_hw", invitedBy: OWNER },
    { projectId: PROJ, userId: QA, role: "qa", invitedBy: OWNER },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectIssues).where(eq(projectIssues.projectId, PROJ));
  await db!.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

describe("P0/P1 严重度降级守卫", () => {
  it("创建者(rd_hw)不能把自己的 P1 降到 P2", async () => {
    const id = await createIssue(HW, "P1");
    await expect(
      caller(HW).update({ id, projectId: PROJ, severity: "P2" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("非创建者但有 canEditIssues 的工程师也不能降级 P0", async () => {
    const id = await createIssue(HW, "P0");
    await expect(
      caller(HW2).update({ id, projectId: PROJ, severity: "P3" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("QA 可以降级 P1 → P2", async () => {
    const id = await createIssue(HW, "P1");
    await expect(
      caller(QA).update({ id, projectId: PROJ, severity: "P2" })
    ).resolves.toEqual({ success: true });
  });

  it("管理层(owner)可以降级 P0 → P2", async () => {
    const id = await createIssue(HW, "P0");
    await expect(
      caller(OWNER).update({ id, projectId: PROJ, severity: "P2" })
    ).resolves.toEqual({ success: true });
  });

  it("工程师升级 P2 → P0 不受限", async () => {
    const id = await createIssue(HW, "P2");
    await expect(
      caller(HW).update({ id, projectId: PROJ, severity: "P0" })
    ).resolves.toEqual({ success: true });
  });

  it("工程师不带 severity 的普通编辑不受影响", async () => {
    const id = await createIssue(HW, "P1");
    await expect(
      caller(HW).update({ id, projectId: PROJ, title: "振动超标（复测）", solution: "调整叶轮" })
    ).resolves.toEqual({ success: true });
  });

  it("P2/P3 之间的调整不受限", async () => {
    const id = await createIssue(HW, "P2");
    await expect(
      caller(HW).update({ id, projectId: PROJ, severity: "P3" })
    ).resolves.toEqual({ success: true });
  });
});
