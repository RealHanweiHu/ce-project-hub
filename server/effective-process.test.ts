import { describe, expect, it } from "vitest";
import { getDeliverableLibrary, getEffectiveProcess } from "../shared/effective-process";

function phase(process: ReturnType<typeof getEffectiveProcess>, phaseId: string) {
  const found = process.phases.find((p) => p.id === phaseId);
  if (!found) throw new Error(`Missing phase ${phaseId}`);
  return found;
}

describe("effective process deliverables", () => {
  it("builds a template-derived deliverable library", () => {
    const library = getDeliverableLibrary("npd");

    expect(library).toContain("产品概念书");
    expect(library).toContain("立项申请书");
    expect(library).toContain("BOM v1.0");
    expect(new Set(library).size).toBe(library.length);
  });

  it("carries a tailored phase submission set to the next effective gate", () => {
    const process = getEffectiveProcess("npd", ["concept"]);
    const planning = phase(process, "planning");

    expect(phase(process, "concept").tailored).toBe(true);
    expect(planning.submittedDeliverables).toContain("市场调研报告");
    expect(planning.submittedDeliverables).toContain("立项申请书");
    expect(planning.carriedDeliverables).toContainEqual({
      name: "立项申请书",
      fromPhaseId: "concept",
    });
  });

  it("cascades across consecutive tailored phases", () => {
    const process = getEffectiveProcess("npd", ["concept", "planning"]);
    const design = phase(process, "design");

    expect(design.submittedDeliverables).toContain("立项申请书");
    expect(design.submittedDeliverables).toContain("PRD产品需求文档");
    expect(design.carriedDeliverables).toContainEqual({
      name: "PRD产品需求文档",
      fromPhaseId: "planning",
    });
  });

  it("falls back trailing tailored phase deliverables to the last effective gate", () => {
    const process = getEffectiveProcess("npd", ["mp"]);
    const pvt = phase(process, "pvt");

    expect(pvt.submittedDeliverables).toContain("量产产品");
    expect(pvt.submittedDeliverables).toContain("售后数据分析");
    expect(pvt.carriedDeliverables).toContainEqual({
      name: "量产产品",
      fromPhaseId: "mp",
    });
  });

  it("applies add and remove overrides per node", () => {
    const process = getEffectiveProcess("npd", ["concept"], [], [
      { nodePhaseId: "planning", deliverableName: "立项申请书", action: "remove" },
      { nodePhaseId: "planning", deliverableName: "客户确认邮件", action: "add" },
    ]);
    const planning = phase(process, "planning");

    expect(planning.submittedDeliverables).not.toContain("立项申请书");
    expect(planning.submittedDeliverables).toContain("客户确认邮件");
    expect(planning.carriedDeliverables).not.toContainEqual({
      name: "立项申请书",
      fromPhaseId: "concept",
    });
  });
});
