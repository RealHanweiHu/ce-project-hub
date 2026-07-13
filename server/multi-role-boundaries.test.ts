import { describe, expect, it } from "vitest";
import type { ProjectTask } from "../drizzle/schema";
import { taskAllowsEvidence } from "./deliverable-access";

function task(input: Partial<ProjectTask>): ProjectTask {
  return {
    assigneeUserId: null,
    visibleRoles: [],
    ...input,
  } as ProjectTask;
}

describe("multi-role task boundaries", () => {
  it("allows an unassigned task through a matching secondary role", () => {
    expect(taskAllowsEvidence(
      task({ visibleRoles: ["battery_safety"] }),
      91,
      new Set(["qa", "battery_safety"]),
    )).toBe(true);
  });

  it("keeps an explicit assignee as a natural-person boundary", () => {
    const assigned = task({ assigneeUserId: 92, visibleRoles: ["battery_safety"] });
    expect(taskAllowsEvidence(assigned, 91, new Set(["qa", "battery_safety"]))).toBe(false);
    expect(taskAllowsEvidence(assigned, 92, new Set(["qa"]))).toBe(true);
  });
});
