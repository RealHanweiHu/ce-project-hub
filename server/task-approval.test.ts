import { describe, it, expect } from "vitest";
import {
  applyAutomaticTaskStatuses, setTaskCompletion, setTaskApprovalConfig, decideTaskApproval,
  upsertProjectTask, getProjectTasks, getActivityLogs, getTaskActivityLogs,
} from "./db";
import type { ProjectTask } from "../drizzle/schema";

let pidSeq = 0;
const uniquePid = () => `tst-appr-${Date.now()}-${pidSeq++}`;

// 最小 ProjectTask（仅填 applyAutomaticTaskStatuses 用到的字段；其余以 any 占位）
function makeTask(over: Partial<ProjectTask>): ProjectTask {
  return {
    id: 1, projectId: "p1", phaseId: "ph1", taskId: "c1",
    completed: false, instructions: "", deliverables: {}, visibleRoles: [],
    assigneeUserId: null, dueDate: null, startDate: null,
    status: "todo", statusChangedAt: new Date(), priority: "medium",
    completedAt: null, updatedBy: null,
    requiresApproval: false, approverUserId: null, approvalStatus: "none",
    approvalNote: null, approvalRequestedBy: null, approvalRequestedAt: null,
    approvalDecidedBy: null, approvalDecidedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
  } as ProjectTask;
}

describe("automaticTaskStatus 保留 pending_approval", () => {
  it("pending_approval 不被重算覆盖，且 completed 为 false", () => {
    const rows = [makeTask({ taskId: "c1", status: "pending_approval" })];
    const out = applyAutomaticTaskStatuses(rows, "npd", "2026-06-25");
    expect(out[0].status).toBe("pending_approval");
    expect(out[0].completed).toBe(false);
  });

  it("普通 todo 任务仍按规则重算（指派 → in_progress）", () => {
    const rows = [makeTask({ taskId: "c1", status: "todo", assigneeUserId: 5 })];
    const out = applyAutomaticTaskStatuses(rows, "npd", "2026-06-25");
    expect(out[0].status).toBe("in_progress");
  });
});

describe("setTaskCompletion 需审批分支 + 单写日志", () => {
  it("需审批任务勾完成 → pending_approval/completed=false/approvalStatus=pending/outcome=submitted，且只记 task.submit_approval", async () => {
    const pid = uniquePid();
    await upsertProjectTask(pid, "ph1", "c1", { requiresApproval: true, approverUserId: 2 });
    const r = await setTaskCompletion(pid, "ph1", "c1", true, 3);
    expect(r.outcome).toBe("submitted");
    const row = (await getProjectTasks(pid, "ph1"))[0];
    expect(row.status).toBe("pending_approval");
    expect(row.completed).toBe(false);
    expect(row.approvalStatus).toBe("pending");
    expect(row.approvalRequestedBy).toBe(3);
    const acts = await getActivityLogs(pid);
    const actions = acts.filter((a) => a.entityId === "c1").map((a) => a.action);
    expect(actions).toContain("task.submit_approval");
    expect(actions).not.toContain("task.complete");
  });

  it("普通任务勾完成 → done/completed=true/outcome=completed", async () => {
    const pid = uniquePid();
    await upsertProjectTask(pid, "ph1", "c1", { instructions: "x" });
    const r = await setTaskCompletion(pid, "ph1", "c1", true, 3);
    expect(r.outcome).toBe("completed");
    const row = (await getProjectTasks(pid, "ph1"))[0];
    expect(row.status).toBe("done");
    expect(row.completed).toBe(true);
  });
});

describe("setTaskApprovalConfig", () => {
  it("写入 requiresApproval/approverUserId", async () => {
    const pid = uniquePid();
    await upsertProjectTask(pid, "ph1", "c1", { instructions: "x" });
    await setTaskApprovalConfig(pid, "ph1", "c1", { requiresApproval: true, approverUserId: 2 }, 9);
    const row = (await getProjectTasks(pid, "ph1"))[0];
    expect(row.requiresApproval).toBe(true);
    expect(row.approverUserId).toBe(2);
  });

  it("待审时关开关 → approvalStatus=none、completed=false、status 非 done/pending_approval", async () => {
    const pid = uniquePid();
    await upsertProjectTask(pid, "ph1", "c1", { requiresApproval: true, approverUserId: 2 });
    await setTaskCompletion(pid, "ph1", "c1", true, 3); // → pending_approval
    await setTaskApprovalConfig(pid, "ph1", "c1", { requiresApproval: false, approverUserId: null }, 9);
    const row = (await getProjectTasks(pid, "ph1"))[0];
    expect(row.approvalStatus).toBe("none");
    expect(row.completed).toBe(false);
    expect(row.status).not.toBe("done");
    expect(row.status).not.toBe("pending_approval");
  });
});

describe("decideTaskApproval", () => {
  async function intoPending(pid: string) {
    await upsertProjectTask(pid, "ph1", "c1", { requiresApproval: true, approverUserId: 2 });
    await setTaskCompletion(pid, "ph1", "c1", true, 3); // requester=3 → pending
  }

  it("通过 → done/completed=true/approved，记 task.approve", async () => {
    const pid = uniquePid();
    await intoPending(pid);
    await decideTaskApproval(pid, "ph1", "c1", "approved", 2, "可以", false);
    const row = (await getProjectTasks(pid, "ph1"))[0];
    expect(row.status).toBe("done");
    expect(row.completed).toBe(true);
    expect(row.approvalStatus).toBe("approved");
    const actions = (await getActivityLogs(pid)).filter((a) => a.entityId === "c1").map((a) => a.action);
    expect(actions).toContain("task.approve");
  });

  it("驳回 → completed=false/approvalStatus=rejected，status 非 done/pending", async () => {
    const pid = uniquePid();
    await intoPending(pid);
    await decideTaskApproval(pid, "ph1", "c1", "rejected", 2, "不行", false);
    const row = (await getProjectTasks(pid, "ph1"))[0];
    expect(row.completed).toBe(false);
    expect(row.approvalStatus).toBe("rejected");
    expect(row.status).not.toBe("done");
    expect(row.status).not.toBe("pending_approval");
  });

  it("admin 代审 → 日志 meta.proxyBy 记录", async () => {
    const pid = uniquePid();
    await intoPending(pid);
    await decideTaskApproval(pid, "ph1", "c1", "approved", 99, null, true); // actor 99 ≠ approver 2
    const approve = (await getActivityLogs(pid)).find((a) => a.entityId === "c1" && a.action === "task.approve");
    expect((approve?.meta as { proxyBy?: number } | null)?.proxyBy).toBe(99);
  });
});

describe("getTaskActivityLogs 带 phaseId", () => {
  it("只返回该 phaseId 的任务活动，不串其他阶段同名 taskId", async () => {
    const pid = uniquePid();
    await upsertProjectTask(pid, "ph1", "c1", { instructions: "x" });
    await upsertProjectTask(pid, "ph2", "c1", { instructions: "y" });
    await setTaskCompletion(pid, "ph1", "c1", true, 3); // 日志写在 ph1
    await setTaskCompletion(pid, "ph2", "c1", true, 3); // 日志写在 ph2
    const ph1 = await getTaskActivityLogs(pid, "ph1", "c1");
    expect(ph1.length).toBeGreaterThan(0);
    expect(ph1.every((a) => (a.meta as { phaseId?: string }).phaseId === "ph1")).toBe(true);
  });
});
