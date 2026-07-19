import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  getDb, confirmGateReview, getGateReadiness, getProjectGateReviews, getProjectById,
  getProjectTasks, openProjectGateSignoffRound, setTaskApprovalConfig,
  upsertProjectGateSignoff,
} from "./db";
import { activityLogs, projects, projectTasks } from "../drizzle/schema";

/**
 * confirmGateReview 原子性：评审记录、gate task 完成、阶段推进三笔写入
 * 必须同一事务——任一步失败全部回滚，不允许留下「评审已通过但阶段没动」的中间态
 * （否则用户重试会产生第二轮评审记录，追溯历史失真）。
 */

const PROJECT = `gate-atomic-${Date.now()}`;
const RECOVERY_PROJECT = `gate-recovery-${Date.now()}`;
const OWNER = 985001;

async function approveSignoffRound(projectId: string) {
  const round = await openProjectGateSignoffRound({
    projectId,
    phaseId: "design",
    openedBy: OWNER,
  });
  for (const [slot, requirement] of Object.entries(round.requirements)) {
    if (requirement === "not_applicable") continue;
    await upsertProjectGateSignoff({
      projectId,
      phaseId: "design",
      roundNumber: round.roundNumber,
      slot: slot as keyof typeof round.requirements,
      requirement,
      status: "approved",
      signedBy: OWNER,
    });
  }
  return round;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT, name: "GateAtomic", projectNumber: PROJECT, category: "npd",
    risk: "low", currentPhase: "design", createdBy: OWNER,
  });
  await db.insert(projects).values({
    id: RECOVERY_PROJECT, name: "GateRecovery", projectNumber: RECOVERY_PROJECT, category: "npd",
    risk: "low", currentPhase: "design", createdBy: OWNER,
  });
  await db.insert(projectTasks).values([
    { projectId: PROJECT, phaseId: "design", taskId: "d8" },
    { projectId: RECOVERY_PROJECT, phaseId: "design", taskId: "d8" },
  ]);
  await approveSignoffRound(PROJECT);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  await db.delete(activityLogs).where(eq(activityLogs.projectId, RECOVERY_PROJECT));
  // 外键 cascade 清掉 tasks / gate reviews
  await db.delete(projects).where(eq(projects.id, PROJECT));
  await db.delete(projects).where(eq(projects.id, RECOVERY_PROJECT));
});

describe("confirmGateReview atomicity", () => {
  it("客户端传入错误 gateTaskId → 评审与阶段均不写入", async () => {
    await expect(
      confirmGateReview({
        projectId: PROJECT, phaseId: "design", gateTaskId: "d1",
        phaseName: "设计", gateName: "设计冻结", reviewDate: "2026-07-07",
        decision: "approved", createdBy: OWNER,
      })
    ).rejects.toThrow();

    const reviews = await getProjectGateReviews(PROJECT, "design");
    expect(reviews.length).toBe(0); // 评审记录不得残留

    const project = await getProjectById(PROJECT);
    expect(project?.currentPhase).toBe("design"); // 阶段未推进
  });

  it("正常通过 → 评审、gate task 完成、阶段推进一次全部生效", async () => {
    // 模拟存量异常：Gate 曾被配置普通任务审批。正式评审必须覆盖该配置并直接 done。
    await setTaskApprovalConfig(PROJECT, "design", "d8", {
      requiresApproval: true,
      approverUserId: OWNER,
    }, OWNER);
    const r = await confirmGateReview({
      projectId: PROJECT, phaseId: "design", gateTaskId: "d8",
      phaseName: "设计", gateName: "设计冻结", reviewDate: "2026-07-07",
      decision: "approved", createdBy: OWNER,
    });
    expect(r.roundNumber).toBe(1);
    expect(r.advancedTo).toBe("evt");

    const reviews = await getProjectGateReviews(PROJECT, "design");
    expect(reviews.length).toBe(1);
    expect(reviews[0].decision).toBe("approved");

    const task = (await getProjectTasks(PROJECT, "design")).find((t) => t.taskId === "d8");
    expect(task?.completed).toBe(true);
    expect(task).toMatchObject({ status: "done", requiresApproval: false, approvalStatus: "none" });

    const project = await getProjectById(PROJECT);
    expect(project?.currentPhase).toBe("evt");
  });

  it("未来或历史阶段不能通过正式裁决改写 Gate 状态", async () => {
    await expect(confirmGateReview({
      projectId: RECOVERY_PROJECT,
      phaseId: "evt",
      gateTaskId: "e7",
      reviewDate: "2026-07-07",
      decision: "rejected",
      createdBy: OWNER,
    })).rejects.toThrow(/当前阶段/);
    await expect(confirmGateReview({
      projectId: PROJECT,
      phaseId: "design",
      gateTaskId: "d8",
      reviewDate: "2026-07-08",
      decision: "rejected",
      createdBy: OWNER,
    })).rejects.toThrow(/当前阶段/);
    const task = (await getProjectTasks(PROJECT, "design")).find((row) => row.taskId === "d8");
    expect(task).toMatchObject({ status: "done", completed: true });
  });

  it("驳回 → gate task blocked；round+1 通过后解除并推进", async () => {
    const rejected = await confirmGateReview({
      projectId: RECOVERY_PROJECT, phaseId: "design", gateTaskId: null,
      phaseName: "设计", gateName: "设计冻结", reviewDate: "2026-07-07",
      decision: "rejected", notes: "整改结构强度", createdBy: OWNER,
    });
    expect(rejected.roundNumber).toBe(1);
    expect(rejected.advancedTo).toBeNull();

    let task = (await getProjectTasks(RECOVERY_PROJECT, "design")).find((row) => row.taskId === "d8");
    expect(task).toMatchObject({ status: "blocked", completed: false });
    expect((await getProjectById(RECOVERY_PROJECT))?.currentPhase).toBe("design");

    let readiness = await getGateReadiness(RECOVERY_PROJECT, "design");
    expect(readiness?.dimensions.find((dimension) => dimension.dimension === "review_conditions"))
      .toMatchObject({ ok: false });

    await approveSignoffRound(RECOVERY_PROJECT);
    readiness = await getGateReadiness(RECOVERY_PROJECT, "design");
    expect(readiness?.dimensions.find((dimension) => dimension.dimension === "review_conditions"))
      .toMatchObject({ ok: true });

    const approved = await confirmGateReview({
      projectId: RECOVERY_PROJECT, phaseId: "design", gateTaskId: "d8",
      phaseName: "设计", gateName: "设计冻结", reviewDate: "2026-07-08",
      decision: "approved", createdBy: OWNER,
    });
    expect(approved.roundNumber).toBe(2);
    expect(approved.advancedTo).toBe("evt");

    task = (await getProjectTasks(RECOVERY_PROJECT, "design")).find((row) => row.taskId === "d8");
    expect(task).toMatchObject({ status: "done", completed: true });
  });
});
