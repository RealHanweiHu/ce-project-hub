/**
 * 项目生命周期（盲点3：项目杀不掉）：
 * - 终止 = 终局：理由必填、连带 archived、不可恢复、不可发布
 * - 暂停 = 可恢复：保持可见但退出自动化到期扫描
 * - 权限同量产发布（创建人/PM/项目 owner|manager/系统 admin）
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, setProjectLifecycle, getProjectById, releaseProject,
  getAutomationDueTasks, upsertProjectTask,
} from "./db";
import {
  projects,
  projectTasks,
  projectTerminationItems,
  projectTerminationReviews,
  PROJECT_TERMINATION_ITEM_KEYS,
} from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

const P_KILL = `lifecycle-kill-${Date.now()}`;
const P_PAUSE = `lifecycle-pause-${Date.now()}`;
const OWNER = 810001;
const OUTSIDER = 810002;
const owner = { id: OWNER, role: "member" };

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values([
    { id: P_KILL, name: "终止测试", projectNumber: P_KILL, category: "npd", risk: "low", currentPhase: "concept", createdBy: OWNER },
    { id: P_PAUSE, name: "暂停测试", projectNumber: P_PAUSE, category: "npd", risk: "low", currentPhase: "concept", createdBy: OWNER },
  ]);
  const [review] = await db.insert(projectTerminationReviews).values({
    projectId: P_KILL,
    status: "approved",
    reason: "商业不成立，管理层决议终止",
    sunkCostSummary: "沉没成本已核销",
    customerCommunication: "客户已书面确认",
    ownerUserId: OWNER,
    approverUserId: OUTSIDER,
    createdBy: OWNER,
    submittedBy: OWNER,
    approvedBy: OUTSIDER,
    approvedAt: new Date(),
  }).returning();
  await db.insert(projectTerminationItems).values(PROJECT_TERMINATION_ITEM_KEYS.map((itemKey) => ({
    reviewId: review.id,
    itemKey,
    disposition: `${itemKey} 已完成处置`,
    completed: true,
    evidenceReference: `EVIDENCE-${itemKey}`,
    completedBy: OWNER,
    completedAt: new Date(),
  })));
});

afterAll(async () => {
  const db = await getDb();
  if (db) {
    await db.delete(projectTasks).where(inArray(projectTasks.projectId, [P_KILL, P_PAUSE]));
    await db.delete(projects).where(inArray(projects.id, [P_KILL, P_PAUSE]));
  }
});

describe("setProjectLifecycle", () => {
  it("终止必须填写理由", async () => {
    await expect(
      setProjectLifecycle({ projectId: P_KILL, lifecycle: "terminated", reason: "  ", actor: owner })
    ).rejects.toThrow(/理由/);
  });

  it("无权限者不能变更生命周期", async () => {
    await expect(
      setProjectLifecycle({ projectId: P_KILL, lifecycle: "paused", reason: "试试", actor: { id: OUTSIDER, role: "member" } })
    ).rejects.toThrow(/无权限/);
  });

  it("终止：写入终局状态并连带归档", async () => {
    await setProjectLifecycle({ projectId: P_KILL, lifecycle: "terminated", reason: "商业不成立，管理层决议终止", actor: owner });
    const p = await getProjectById(P_KILL);
    expect(p?.lifecycle).toBe("terminated");
    expect(p?.archived).toBe(true);
    expect(p?.lifecycleReason).toContain("商业不成立");
    expect(p?.lifecycleChangedBy).toBe(OWNER);
  });

  it("终止是终局：不可恢复也不可再变更", async () => {
    await expect(
      setProjectLifecycle({ projectId: P_KILL, lifecycle: "active", reason: "想恢复", actor: owner })
    ).rejects.toThrow(/已终止/);
  });

  it("终止后不能量产发布", async () => {
    await expect(
      releaseProject({ projectId: P_KILL, actor: owner })
    ).rejects.toThrow(/已终止/);
  });

  it("暂停：保持可见但退出自动化到期扫描；恢复后回到扫描", async () => {
    // 给暂停项目埋一个已逾期任务
    await upsertProjectTask(P_PAUSE, "concept", "c1", { dueDate: "2026-01-01", updatedBy: OWNER });

    let due = await getAutomationDueTasks();
    expect(due.some((t) => t.projectId === P_PAUSE)).toBe(true);

    await setProjectLifecycle({ projectId: P_PAUSE, lifecycle: "paused", reason: "等客户回复暂停两周", actor: owner });
    const p = await getProjectById(P_PAUSE);
    expect(p?.lifecycle).toBe("paused");
    expect(p?.archived).toBe(false);

    due = await getAutomationDueTasks();
    expect(due.some((t) => t.projectId === P_PAUSE)).toBe(false);

    await setProjectLifecycle({ projectId: P_PAUSE, lifecycle: "active", actor: owner });
    const p2 = await getProjectById(P_PAUSE);
    expect(p2?.lifecycle).toBe("active");
    expect(p2?.lifecycleReason).toBeNull();

    due = await getAutomationDueTasks();
    expect(due.some((t) => t.projectId === P_PAUSE)).toBe(true);
  });
});
