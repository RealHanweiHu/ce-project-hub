import { describe, it, expect } from "vitest";
import { classifyMyWork } from "./my-work";

const base = { userId: 7, today: "2026-07-13" };

describe("classifyMyWork 三桶分类", () => {
  it("前置未清的 todo 进'等待别人'，前置已清的进'现在处理'", () => {
    const out = classifyMyWork({
      ...base,
      tasks: [
        { projectId: "p1", phaseId: "design", taskId: "nd4", status: "todo", depsResolved: false, title: "PCB Layout" },
        { projectId: "p1", phaseId: "design", taskId: "nd3", status: "todo", depsResolved: true, title: "EE 原理设计" },
        { projectId: "p1", phaseId: "design", taskId: "nd1", status: "todo", title: "ID 设计" }, // 无依赖信息=按已清
      ],
      reviews: [], actionItems: [], snoozedActionItems: [],
    });
    expect(out.waiting.map((i) => i.kind)).toContain("task_waiting_deps");
    expect(out.waiting.find((i) => i.taskId === "nd4")?.title).toContain("等前置");
    expect(out.now.map((i) => i.taskId)).toEqual(expect.arrayContaining(["nd3", "nd1"]));
    expect(out.now.map((i) => i.taskId)).not.toContain("nd4");
  });

  it("排序：逾期 > 今日到期 > 可开始 > 进行中", () => {
    const out = classifyMyWork({
      ...base,
      tasks: [
        { projectId: "p1", phaseId: "a", taskId: "t-prog", status: "in_progress" },
        { projectId: "p1", phaseId: "a", taskId: "t-ready", status: "todo", depsResolved: true },
        { projectId: "p1", phaseId: "a", taskId: "t-today", status: "todo", dueDate: "2026-07-13" },
        { projectId: "p1", phaseId: "a", taskId: "t-over", status: "in_progress", dueDate: "2026-07-01" },
      ],
      reviews: [], actionItems: [], snoozedActionItems: [],
    });
    expect(out.now.map((i) => i.taskId)).toEqual(["t-over", "t-today", "t-ready", "t-prog"]);
  });

  it("我提交待别人审的交付物进'等待别人'；待我审的进'现在处理'", () => {
    const out = classifyMyWork({
      ...base,
      tasks: [],
      reviews: [
        { projectId: "p1", phaseId: "design", deliverableName: "BOM v1.0", status: "pending", reviewerUserId: 7, submittedBy: 3 },
        { projectId: "p1", phaseId: "design", deliverableName: "结构 3D 设计", status: "pending", reviewerUserId: 3, submittedBy: 7 },
      ],
      actionItems: [], snoozedActionItems: [],
    });
    expect(out.now.some((i) => i.title.includes("BOM v1.0"))).toBe(true);
    expect(out.waiting.some((i) => i.title.includes("结构 3D 设计"))).toBe(true);
  });

  it("待审批任务进'等待别人'，snoozed 进'仅关注'", () => {
    const out = classifyMyWork({
      ...base,
      tasks: [{ projectId: "p1", phaseId: "a", taskId: "t1", status: "pending_approval", title: "任务一" }],
      reviews: [],
      actionItems: [],
      snoozedActionItems: [{ id: 9, projectId: "p1", kind: "task_ready", title: "稍后处理" }],
    });
    expect(out.waiting.some((i) => i.kind === "task_pending_approval")).toBe(true);
    expect(out.watching).toHaveLength(1);
  });
});
