import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  getDb, confirmGateReview, getProjectGateReviews, getProjectById, getProjectTasks,
} from "./db";
import { activityLogs, projects } from "../drizzle/schema";

/**
 * confirmGateReview 原子性：评审记录、gate task 完成、阶段推进三笔写入
 * 必须同一事务——任一步失败全部回滚，不允许留下「评审已通过但阶段没动」的中间态
 * （否则用户重试会产生第二轮评审记录，追溯历史失真）。
 */

const PROJECT = `gate-atomic-${Date.now()}`;
const OWNER = 985001;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT, name: "GateAtomic", projectNumber: PROJECT, category: "npd",
    risk: "low", currentPhase: "design", createdBy: OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(eq(activityLogs.projectId, PROJECT));
  // 外键 cascade 清掉 tasks / gate reviews
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("confirmGateReview atomicity", () => {
  it("gate task 写入失败 → 评审记录与阶段推进一并回滚，不留中间态", async () => {
    // project_tasks.taskId 是 varchar(32)，超长必然让第 2 步（标记 gate task）失败
    const overflowTaskId = "x".repeat(64);
    await expect(
      confirmGateReview({
        projectId: PROJECT, phaseId: "design", gateTaskId: overflowTaskId,
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

    const project = await getProjectById(PROJECT);
    expect(project?.currentPhase).toBe("evt");
  });
});
