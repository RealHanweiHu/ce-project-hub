import { describe, expect, it } from "vitest";
import {
  buildActionCardExecutePath,
  buildDeliverableReviewActionPath,
  buildIssueValidationActionPath,
  buildProjectActionPath,
  buildTaskAssignmentActionPath,
  buildTaskApprovalActionPath,
  buildTaskCompletionActionPath,
} from "./action-links";

describe("action links", () => {
  it("builds signed action-card execute links", () => {
    expect(buildActionCardExecutePath("abc.def/ghi")).toBe("/api/action-card/execute?token=abc.def%2Fghi");
  });

  it("builds project detail deep links", () => {
    expect(
      buildProjectActionPath({
        projectId: "p1",
        tab: "tasks",
        phaseId: "design",
        taskId: "d1",
        taskTab: "approval",
      }),
    ).toBe("/?view=projects&projectId=p1&tab=tasks&phaseId=design&taskId=d1&taskTab=approval");
    expect(
      buildProjectActionPath({
        projectId: "p1",
        tab: "tasks",
        phaseId: "design",
        taskId: "d1",
        actionItemId: 17,
      }),
    ).toBe("/?view=projects&projectId=p1&tab=tasks&phaseId=design&taskId=d1&actionItemId=17");
  });

  it("builds task approval action links", () => {
    expect(
      buildTaskApprovalActionPath({
        projectId: "p1",
        phaseId: "design",
        taskId: "d1",
      }),
    ).toBe("/actions/task-approval?projectId=p1&phaseId=design&taskId=d1");
  });

  it("builds deliverable review action links with encoded names", () => {
    expect(
      buildDeliverableReviewActionPath({
        projectId: "p1",
        phaseId: "design",
        deliverableName: "PCB原理图&Layout",
      }),
    ).toBe("/actions/deliverable-review?projectId=p1&phaseId=design&deliverableName=PCB%E5%8E%9F%E7%90%86%E5%9B%BE%26Layout");
  });

  it("builds remaining Phase A action links", () => {
    expect(
      buildTaskCompletionActionPath({ projectId: "p1", phaseId: "evt", taskId: "e2", actionItemId: 18 }),
    ).toBe("/actions/task-complete?projectId=p1&phaseId=evt&taskId=e2&actionItemId=18");

    expect(
      buildIssueValidationActionPath({ projectId: "p1", phaseId: "evt", issueId: 42 }),
    ).toBe("/actions/issue-validation?projectId=p1&phaseId=evt&issueId=42");

    expect(
      buildTaskAssignmentActionPath({ projectId: "p1", phaseId: "evt", taskId: "e2", assigneeUserId: 7 }),
    ).toBe("/actions/task-assign?projectId=p1&phaseId=evt&taskId=e2&assigneeUserId=7");
  });
});
