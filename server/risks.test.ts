import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activityLogs, projects, projectRisks } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";

const OWNER = 881001;
const OUTSIDER = 881002;
const PROJECT = `risk-life-${Date.now()}`;

const makeCtx = (id: number) => ({
  user: {
    id,
    role: "user",
    name: `Risk Tester ${id}`,
    email: null,
    username: null,
    passwordHash: null,
    canCreateProject: false,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
  },
});

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "风险生命周期",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(projectRisks).where(eq(projectRisks.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("risksRouter", () => {
  it("支持风险识别、缓解、关闭和删除", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER) as any);
    const created = await caller.risks.create({
      projectId: PROJECT,
      title: "关键物料认证存在延期风险",
      severity: "high",
      status: "open",
      owner: "SCM",
      targetDate: "2026-07-15",
      mitigationPlan: "提前锁定备选供应商",
    });

    let rows = await caller.risks.list({ projectId: PROJECT });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].severity).toBe("high");
    expect(rows[0].status).toBe("open");

    await caller.risks.update({
      id: created.id,
      patch: { status: "mitigating", mitigationPlan: "备选供应商已启动打样" },
    });
    rows = await caller.risks.list({ projectId: PROJECT });
    expect(rows[0].status).toBe("mitigating");
    expect(rows[0].closedAt).toBeNull();

    await caller.risks.update({ id: created.id, patch: { status: "closed" } });
    rows = await caller.risks.list({ projectId: PROJECT });
    expect(rows[0].status).toBe("closed");
    expect(rows[0].closedAt).toBeInstanceOf(Date);

    await caller.risks.update({ id: created.id, patch: { status: "watching" } });
    rows = await caller.risks.list({ projectId: PROJECT });
    expect(rows[0].status).toBe("watching");
    expect(rows[0].closedAt).toBeNull();

    await caller.risks.delete({ id: created.id });
    rows = await caller.risks.list({ projectId: PROJECT });
    expect(rows).toHaveLength(0);
  });

  it("非项目成员不能维护风险项", async () => {
    const caller = appRouter.createCaller(makeCtx(OUTSIDER) as any);
    await expect(
      caller.risks.create({
        projectId: PROJECT,
        title: "无权限创建",
        severity: "medium",
        status: "open",
      }),
    ).rejects.toThrow(/无访问权限|没有维护风险生命周期的权限/);
  });
});
