import { describe, expect, it } from "vitest";
import {
  getProjectPhases,
  normalizeProject,
  type Project,
} from "../client/src/lib/data";

const liteBatteryProject = (): Project => ({
  id: "client-v3-lite",
  code: "CLIENT-V3-LITE",
  name: "Client v3 lite",
  type: "NPD",
  pm: "",
  startDate: "",
  targetDate: "",
  currentPhase: "concept",
  risk: "low",
  category: "npd",
  sopTemplateVersion: "2026-07-v3",
  customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
  phases: {},
});

describe("client NPD v3 effective phases", () => {
  it("项目读路径按 customFields 返回 lite + battery 的 17 项", () => {
    const phases = getProjectPhases(liteBatteryProject());
    expect(phases).toHaveLength(6);
    expect(phases.flatMap((phase) => phase.tasks)).toHaveLength(17);
    expect(phases.flatMap((phase) => phase.tasks.map((task) => task.id))).toEqual(
      expect.arrayContaining(["nlc1", "nle1", "pb1", "pb2", "npv2", "npv5", "nm1"]),
    );
  });

  it("normalizeProject 只初始化生效任务，不复活被合并的旧任务", () => {
    const project = normalizeProject(liteBatteryProject());
    const ids = Object.values(project.phases).flatMap((phase) => Object.keys(phase.tasks));
    expect(ids).toEqual(expect.arrayContaining(["nle1", "pb1", "pb2"]));
    expect(ids).not.toEqual(expect.arrayContaining(["ne1", "ne2", "ne3", "nv1"]));
  });
});
