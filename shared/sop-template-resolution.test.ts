import { describe, expect, it } from "vitest";
import { SOP_TEMPLATE_VERSION_NPD_V3 } from "./sop-templates";
import {
  resolvePhaseName,
  resolveProjectPhase,
  resolveTaskName,
} from "./sop-template-resolution";

const liteBatteryProject = {
  category: "npd",
  sopTemplateVersion: SOP_TEMPLATE_VERSION_NPD_V3,
  customFields: {
    npdTemplate: { tier: "lite", packs: ["battery"] },
  },
};

describe("project-aware SOP name resolution", () => {
  it("resolves a lite-only phase instead of returning its raw id", () => {
    expect(resolvePhaseName(liteBatteryProject, "verification")).toBe("样机验证");
    expect(resolveProjectPhase(liteBatteryProject, "verification")?.code).toBe("P4");
  });

  it("resolves a locked add-on task after its phase is remapped for lite", () => {
    expect(resolveTaskName(liteBatteryProject, "pb2", "design")).toBe("安全 FMEA 与保护链路评审");
  });

  it("keeps stable ids as fallbacks for historical rows", () => {
    expect(resolveTaskName(liteBatteryProject, "legacy-task", "verification")).toBe("legacy-task");
    expect(resolvePhaseName(liteBatteryProject, "legacy-phase")).toBe("legacy-phase");
  });
});
