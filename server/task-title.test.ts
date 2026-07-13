import { describe, expect, it } from "vitest";
import { SOP_TEMPLATE_VERSION_NPD_V3 } from "../shared/sop-templates";
import { taskDisplayTitle } from "./task-title";

describe("taskDisplayTitle", () => {
  it("uses the project's effective lite/add-on process", () => {
    expect(taskDisplayTitle({
      taskId: "pb2",
      phaseId: "design",
      projectLike: {
        category: "npd",
        sopTemplateVersion: SOP_TEMPLATE_VERSION_NPD_V3,
        customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
      },
    })).toBe("安全 FMEA 与保护链路评审");
  });

  it("falls back to the first markdown heading for an unknown historical task", () => {
    expect(taskDisplayTitle({
      taskId: "legacy-task",
      projectLike: { category: "npd" },
      instructions: "## 历史任务名称\n补充说明",
    })).toBe("历史任务名称");
  });
});
