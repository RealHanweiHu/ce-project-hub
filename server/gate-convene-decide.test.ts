import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { projectGateReviews, projectIssues, projectMembers, projects } from "../drizzle/schema";
import { gateReviewsRouter } from "./routers/gateReviews";
import { issuesRouter } from "./routers/issues";

/**
 * Gate 召集权/决策权拆分：现实工厂里项目经理召集 Gate 评审会、记录会议与
 * 未通过结论，管理层签「通过/有条件通过」并推进阶段。
 * - canConveneGateReview（owner/manager/project_manager）：可创建 decision=
 *   rejected 的评审记录（会开了、没过），可编辑既有评审的参会人/纪要等
 *   非决策字段；不能给出 approved/conditional，不能 confirmAndAdvance。
 * - canGateReview（owner/manager）：决策与推进不变。
 * 同时封堵旧洞：update 把 decision 改成 approved/conditional 时必须过
 * readiness 校验（旧代码 update 不查就绪度，可先建 rejected 再改 approved 绕过）。
 */
const PROJ = `gate-conv-${Date.now()}`;
const OWNER = 974001;
const PM = 974002;   // project_manager
const HW = 974003;   // rd_hw

const makeCtx = (id: number, role = "user") => ({
  user: {
    id, role, name: `u${id}`, email: null, canCreateProject: false,
    mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null,
    passwordHash: null, username: null,
  },
});
const gates = (id: number, role = "user") => gateReviewsRouter.createCaller(makeCtx(id, role) as any);
const issues = (id: number) => issuesRouter.createCaller(makeCtx(id) as any);

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({
    id: PROJ, name: "Gate 召集拆分", projectNumber: PROJ, category: "npd",
    risk: "low", currentPhase: "evt", createdBy: OWNER, pmUserId: OWNER,
  });
  await db!.insert(projectMembers).values([
    { projectId: PROJ, userId: PM, role: "project_manager", invitedBy: OWNER },
    { projectId: PROJ, userId: HW, role: "rd_hw", invitedBy: OWNER },
  ]);
  // 开一个 P0 保证 evt Gate 必然「未就绪」——用于验证 readiness 在 update 路径也生效
  await issues(OWNER).create({
    projectId: PROJ, phaseId: "evt", title: "样机漏气 P0", severity: "P0",
    status: "open", category: "hardware",
  });
});

afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectGateReviews).where(eq(projectGateReviews.projectId, PROJ));
  await db!.delete(projectIssues).where(eq(projectIssues.projectId, PROJ));
  await db!.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

describe("Gate 召集/决策权拆分", () => {
  it("project_manager 可记录 rejected 评审（召集并记录未通过）", async () => {
    const r = await gates(PM).create({
      projectId: PROJ, phaseId: "evt", phaseName: "EVT", gateName: "EVT Gate",
      reviewDate: "2026-07-06", participants: "PM, QA, HW", decision: "rejected",
      notes: "漏气问题未关闭，评审未通过",
    });
    expect(r.success).toBe(true);
  });

  it("project_manager 不能给出 approved 决策", async () => {
    await expect(gates(PM).create({
      projectId: PROJ, phaseId: "evt", phaseName: "EVT", gateName: "EVT Gate",
      reviewDate: "2026-07-06", decision: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("管理层也不能经 create 旁路写通过，必须走原子裁决", async () => {
    await expect(gates(OWNER).create({
      projectId: PROJ, phaseId: "evt", phaseName: "EVT", gateName: "EVT Gate",
      reviewDate: "2026-07-06", decision: "approved",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("project_manager 不能 confirmAndAdvance", async () => {
    await expect(gates(PM).confirmAndAdvance({
      projectId: PROJ, phaseId: "evt", phaseName: "EVT", gateName: "EVT Gate",
      reviewDate: "2026-07-06", decision: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("工程师连 rejected 记录也不能建", async () => {
    await expect(gates(HW).create({
      projectId: PROJ, phaseId: "evt", phaseName: "EVT", gateName: "EVT Gate",
      reviewDate: "2026-07-06", decision: "rejected",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("project_manager 可补记参会人/纪要（非决策字段）", async () => {
    const db = await getDb();
    const [row] = await db!.select().from(projectGateReviews).where(eq(projectGateReviews.projectId, PROJ));
    await expect(gates(PM).update({
      id: row.id, projectId: PROJ, participants: "PM, QA, HW, PE", notes: "补充：PE 到会",
    })).resolves.toEqual({ success: true });
  });

  it("project_manager 不能改 decision 字段", async () => {
    const db = await getDb();
    const [row] = await db!.select().from(projectGateReviews).where(eq(projectGateReviews.projectId, PROJ));
    await expect(gates(PM).update({
      id: row.id, projectId: PROJ, decision: "approved",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("管理层也不能覆盖历史 decision；正式更正必须开新一轮", async () => {
    const db = await getDb();
    const [row] = await db!.select().from(projectGateReviews).where(eq(projectGateReviews.projectId, PROJ));
    await expect(gates(OWNER).update({
      id: row.id, projectId: PROJ, decision: "approved",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
