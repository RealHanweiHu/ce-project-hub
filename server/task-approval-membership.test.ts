import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, upsertProjectTask, setTaskApprovalConfig, setTaskCompletion } from "./db";
import { projectMembers, projects, projectTasks } from "../drizzle/schema";
import { tasksRouter } from "./routers/tasks";

/**
 * 审批裁决的成员校验：decideApproval 过去只比对 approverUserId——被移出项目
 * （或从未入项）的“孤儿审批人”仍保留否决权。裁决时审批人必须仍是项目在册
 * 成员（任意有 canView 的角色）或系统管理员。
 */
const PROJ = `appr-member-${Date.now()}`;
const OWNER = 972001;
const APPROVER_MEMBER = 972002; // rd_hw 在册成员
const APPROVER_GONE = 972003;   // 被指定为审批人但不是项目成员
const SUBMITTER = 972004;

const makeCtx = (id: number, role = "user") => ({
  user: {
    id, role, name: `u${id}`, email: null, canCreateProject: false,
    mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null,
    passwordHash: null, username: null,
  },
});
const caller = (id: number, role = "user") => tasksRouter.createCaller(makeCtx(id, role) as any);

async function makePendingApprovalTask(taskId: string, approverUserId: number) {
  await upsertProjectTask(PROJ, "design", taskId, { instructions: "x" });
  await setTaskApprovalConfig(PROJ, "design", taskId, { requiresApproval: true, approverUserId }, OWNER);
  const r = await setTaskCompletion(PROJ, "design", taskId, true, SUBMITTER);
  expect(r.outcome).toBe("submitted");
}

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({
    id: PROJ, name: "审批成员校验", projectNumber: PROJ, category: "npd",
    risk: "low", currentPhase: "design", createdBy: OWNER, pmUserId: OWNER,
  });
  await db!.insert(projectMembers).values([
    { projectId: PROJ, userId: APPROVER_MEMBER, role: "rd_hw", invitedBy: OWNER },
    { projectId: PROJ, userId: SUBMITTER, role: "rd_mech", invitedBy: OWNER },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db!.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

describe("decideApproval 成员校验", () => {
  it("被指定但不是项目成员的审批人不能裁决", async () => {
    await makePendingApprovalTask("c1", APPROVER_GONE);
    await expect(
      caller(APPROVER_GONE).decideApproval({
        projectId: PROJ, phaseId: "design", taskId: "c1", decision: "approved", note: null,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("在册成员审批人可以正常裁决", async () => {
    await makePendingApprovalTask("c2", APPROVER_MEMBER);
    await expect(
      caller(APPROVER_MEMBER).decideApproval({
        projectId: PROJ, phaseId: "design", taskId: "c2", decision: "approved", note: null,
      })
    ).resolves.toEqual({ success: true });
  });

  it("非审批人的在册成员仍不能裁决", async () => {
    await makePendingApprovalTask("c3", APPROVER_MEMBER);
    await expect(
      caller(SUBMITTER).decideApproval({
        projectId: PROJ, phaseId: "design", taskId: "c3", decision: "approved", note: null,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("系统管理员（非成员）代为裁决仍可用", async () => {
    await makePendingApprovalTask("c4", APPROVER_GONE);
    await expect(
      caller(999999, "admin").decideApproval({
        projectId: PROJ, phaseId: "design", taskId: "c4", decision: "rejected", note: "代裁",
      })
    ).resolves.toEqual({ success: true });
  });
});
