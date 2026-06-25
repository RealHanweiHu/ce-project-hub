import { describe, it, expect } from "vitest";
import { applyAutomaticTaskStatuses } from "./db";
import type { ProjectTask } from "../drizzle/schema";

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
