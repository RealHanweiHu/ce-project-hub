import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isAutomationRuleMatch, type AutomationEvent } from "./automation/rules";

const mocks = vi.hoisted(() => ({
  runAutomation: vi.fn(async (_event: AutomationEvent) => ({
    matched: 0,
    fired: 0,
    partial: 0,
    skipped: 0,
    errors: 0,
  })),
  confirmGateReview: vi.fn(async () => ({
    reviewId: 91,
    roundNumber: 2,
    advancedTo: "evt",
    closed: false,
  })),
  createActivityLog: vi.fn(async () => undefined),
  getProjectTasks: vi.fn(async () => [{
    id: 33,
    projectId: "inline-gate-ready",
    phaseId: "design",
    taskId: "nd6",
    status: "in_progress",
    completed: false,
    instructions: null,
  }]),
}));

vi.mock("./automation/engine", () => ({ runAutomation: mocks.runAutomation }));
vi.mock("./project-access", () => ({
  getEffectiveProjectRoleById: vi.fn(async () => "owner"),
}));
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getProjectById: vi.fn(async () => ({
      id: "inline-gate-ready",
      name: "Inline Gate Ready",
      category: "npd",
      sopTemplateVersion: "2026-07-v3",
      customFields: { npdTemplate: { tier: "standard", packs: [] } },
      currentPhase: "design",
      lifecycle: "active",
      archived: false,
    })),
    getProjectConditionsReadiness: vi.fn(async () => ({ ready: true, blockers: [] })),
    getGateReadiness: vi.fn(async () => ({ ready: true, dimensions: [] })),
    assertProjectGateSignoffsComplete: vi.fn(async () => undefined),
    confirmGateReview: mocks.confirmGateReview,
    createActivityLog: mocks.createActivityLog,
    getProjectTasks: mocks.getProjectTasks,
  };
});

import { gateReviewsRouter } from "./routers/gateReviews";

const originalMode = process.env.AUTOMATION_EVENT_MODE;

beforeEach(() => {
  process.env.AUTOMATION_EVENT_MODE = "inline";
  mocks.runAutomation.mockClear();
  mocks.confirmGateReview.mockClear();
  mocks.createActivityLog.mockClear();
  mocks.getProjectTasks.mockClear();
});

afterAll(() => {
  if (originalMode === undefined) delete process.env.AUTOMATION_EVENT_MODE;
  else process.env.AUTOMATION_EVENT_MODE = originalMode;
});

describe("Gate 完成 task_ready inline 事件", () => {
  it("confirmAndAdvance 事务返回后显式发送 Gate task 的 done 事件", async () => {
    const caller = gateReviewsRouter.createCaller({
      user: {
        id: 7_992_201,
        role: "member",
        name: "Gate Owner",
      },
    } as never);

    await caller.confirmAndAdvance({
      projectId: "inline-gate-ready",
      phaseId: "design",
      gateTaskId: "nd6",
      phaseName: "设计",
      gateName: "设计 Gate",
      reviewDate: "2026-07-12",
      decision: "approved",
    });

    const doneEvents = mocks.runAutomation.mock.calls
      .map(([event]) => event)
      .filter((event) => isAutomationRuleMatch("task_ready_notify", event));
    expect(mocks.confirmGateReview).toHaveBeenCalledTimes(1);
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]).toMatchObject({
      action: "task.update_meta",
      projectId: "inline-gate-ready",
      before: { taskId: "nd6", status: "in_progress" },
      after: { taskId: "nd6", status: "done" },
    });
  });
});
