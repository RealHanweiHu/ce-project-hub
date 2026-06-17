import { describe, it, expect } from "vitest";
import {
  selectMyProjects, buildTodayItems, buildCoordinationQueue, projectHeadlineMetric,
  type PmProjectRow, type PmTask, type PmReview,
} from "./pm-workbench";

function row(over: Partial<PmProjectRow>): PmProjectRow {
  return {
    id: "p1", name: "项目A", currentPhase: "design", ragLevel: "green",
    pmUserId: 1, gateDone: false, gateName: null, gateDueDate: null,
    projectedEnd: null, targetDate: null, overdueTasks: 0, blockedTasks: 0,
    criticalIssues: 0, openIssues: 0, unassignedTasks: 0, deliverableGap: 0,
    gateBlockers: 0, ...over,
  };
}

function task(over: Partial<PmTask>): PmTask {
  return { id: 1, projectId: "p1", taskId: "原理图修改", projectName: "项目A", dueDate: null, priority: "medium", status: "todo", ...over };
}

function review(over: Partial<PmReview>): PmReview {
  return { id: 1, projectId: "p1", deliverableName: "BOM", projectName: "项目A", ...over };
}

describe("selectMyProjects", () => {
  it("只保留 pmUserId 等于当前用户的项目", () => {
    const rows = [row({ id: "a", pmUserId: 1 }), row({ id: "b", pmUserId: 2 }), row({ id: "c", pmUserId: 1 })];
    expect(selectMyProjects(rows, 1).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("userId 为 undefined 时返回空数组", () => {
    expect(selectMyProjects([row({ pmUserId: 1 })], undefined)).toEqual([]);
  });
});

describe("buildTodayItems", () => {
  const today = "2026-06-18";

  it("纳入逾期与今日到期的个人任务，排除未来任务", () => {
    const tasks = [
      task({ id: 1, dueDate: "2026-06-10" }),
      task({ id: 2, dueDate: "2026-06-18" }),
      task({ id: 3, dueDate: "2026-06-25" }),
    ];
    const items = buildTodayItems(tasks, [], today);
    expect(items.map((i) => i.key)).toEqual(["task-1", "task-2"]);
  });

  it("逾期任务排在今日到期之前", () => {
    const tasks = [task({ id: 2, dueDate: "2026-06-18" }), task({ id: 1, dueDate: "2026-06-10" })];
    const items = buildTodayItems(tasks, [], today);
    expect(items[0].key).toBe("task-1");
  });

  it("纳入今天起 7 天内未完成的 Gate，排除已完成或超窗的", () => {
    const rows = [
      row({ id: "a", gateName: "EVT Gate", gateDueDate: "2026-06-20", gateDone: false }),
      row({ id: "b", gateName: "DVT Gate", gateDueDate: "2026-06-20", gateDone: true }),
      row({ id: "c", gateName: "PVT Gate", gateDueDate: "2026-06-30", gateDone: false }),
    ];
    const items = buildTodayItems([], rows, today);
    expect(items.map((i) => i.key)).toEqual(["gate-a"]);
  });

  it("纳入 red 或预计晚于目标的风险项目", () => {
    const rows = [
      row({ id: "a", ragLevel: "red" }),
      row({ id: "b", projectedEnd: "2026-09-01", targetDate: "2026-08-01" }),
      row({ id: "c", ragLevel: "green", projectedEnd: "2026-07-01", targetDate: "2026-08-01" }),
    ];
    const items = buildTodayItems([], rows, today);
    expect(items.map((i) => i.key).sort()).toEqual(["risk-a", "risk-b"]);
  });

  it("空输入返回空数组", () => {
    expect(buildTodayItems([], [], today)).toEqual([]);
  });
});

describe("buildCoordinationQueue", () => {
  it("待审交付物排在最前", () => {
    const items = buildCoordinationQueue([review({ id: 9 })], [row({ criticalIssues: 3 })]);
    expect(items[0].key).toBe("review-9");
    expect(items[0].kind).toBe("review");
  });

  it("按 重大问题>未分配>交付物缺口>Gate未就绪>阻塞 排序", () => {
    const r = row({ id: "a", criticalIssues: 1, unassignedTasks: 1, deliverableGap: 1, gateBlockers: 1, blockedTasks: 1 });
    const kinds = buildCoordinationQueue([], [r]).map((i) => i.kind);
    expect(kinds).toEqual(["issue", "unassigned", "deliverable", "gateBlocker", "blocked"]);
  });

  it("计数为 0 的卡点不产出条目", () => {
    expect(buildCoordinationQueue([], [row({})])).toEqual([]);
  });
});

describe("projectHeadlineMetric", () => {
  it("有重大问题时优先展示 P0/P1", () => {
    expect(projectHeadlineMetric(row({ criticalIssues: 2, overdueTasks: 5, blockedTasks: 1 })))
      .toEqual({ label: "P0/P1 2", tone: "rose" });
  });
  it("无重大问题但有逾期时展示逾期", () => {
    expect(projectHeadlineMetric(row({ overdueTasks: 3, blockedTasks: 1 })))
      .toEqual({ label: "逾期 3", tone: "rose" });
  });
  it("仅有阻塞时展示阻塞", () => {
    expect(projectHeadlineMetric(row({ blockedTasks: 4 })))
      .toEqual({ label: "阻塞 4", tone: "amber" });
  });
  it("均为 0 时返回 null", () => {
    expect(projectHeadlineMetric(row({}))).toBeNull();
  });
});
