import { describe, it, expect } from "vitest";
import {
  computeGrandfatherExemptions,
  passedPhaseIds,
  GATE_TIGHTENING_2026_07_02,
} from "./gate-tightening";
import { getPhasesForCategory } from "./sop-templates";
import { getEffectiveProcess } from "./effective-process";

const npdOrder = getPhasesForCategory("npd").map((p) => p.id);

describe("Gate 收紧 grandfather", () => {
  it("已过会阶段的新增交付物才被豁免；未过会的不豁免", () => {
    // 项目在 mp 阶段：design/pvt 都已过会 → 全部新增豁免
    const atMp = computeGrandfatherExemptions({
      projectId: "P1", category: "npd",
      passedPhaseIds: passedPhaseIds(npdOrder, "mp"),
    });
    const names = new Set(atMp.map((e) => `${e.nodePhaseId}:${e.deliverableName}`));
    expect(names.has("design:安全FMEA与危害分析")).toBe(true);
    expect(names.has("pvt:UN38.3运输测试报告或复用确认")).toBe(true);
  });

  it("项目停在 design 阶段：design 未过会 → 不豁免 design 新增（往前按新标准做）", () => {
    const atDesign = computeGrandfatherExemptions({
      projectId: "P2", category: "npd",
      passedPhaseIds: passedPhaseIds(npdOrder, "design"),
    });
    const phases = new Set(atDesign.map((e) => e.nodePhaseId));
    expect(phases.has("design")).toBe(false); // 当前阶段不豁免
    expect(phases.has("pvt")).toBe(false);     // 未来阶段更不豁免
    // 但 concept/planning 已过会 → 其新增被豁免
    expect(phases.has("concept")).toBe(true);
    expect(phases.has("planning")).toBe(true);
  });

  it("项目停在 pvt 阶段：design 已过会豁免，pvt(当前发布门) 不豁免——本轮硬门要真正满足", () => {
    const atPvt = computeGrandfatherExemptions({
      projectId: "P3", category: "npd",
      passedPhaseIds: passedPhaseIds(npdOrder, "pvt"),
    });
    const phases = new Set(atPvt.map((e) => e.nodePhaseId));
    expect(phases.has("design")).toBe(true);
    expect(phases.has("pvt")).toBe(false);
  });

  it("gateReviewedPhaseIds 并集：pvt 已评审通过但 currentPhase 仍是 pvt → pvt 视为已过会", () => {
    const passed = passedPhaseIds(npdOrder, "pvt", ["pvt"]);
    const ex = computeGrandfatherExemptions({ projectId: "P4", category: "npd", passedPhaseIds: passed });
    expect(new Set(ex.map((e) => e.nodePhaseId)).has("pvt")).toBe(true);
  });

  it("不同 category 互不串：obt 项目只拿 obt 的豁免", () => {
    const obtOrder = getPhasesForCategory("obt").map((p) => p.id);
    const ex = computeGrandfatherExemptions({
      projectId: "P5", category: "obt",
      passedPhaseIds: passedPhaseIds(obtOrder, "mp"),
    });
    expect(ex.every((e) => GATE_TIGHTENING_2026_07_02.some((m) => m.category === "obt" && m.phaseId === e.nodePhaseId && m.deliverableName === e.deliverableName))).toBe(true);
    expect(ex.length).toBeGreaterThan(0);
  });

  it("豁免(remove override)后，已过会阶段的有效提交集不再含被豁免项", () => {
    // 模拟：npd 项目在 mp，pvt 的 UN38.3 被豁免 → pvt 提交集里不应再有它
    const ex = computeGrandfatherExemptions({
      projectId: "P6", category: "npd",
      passedPhaseIds: passedPhaseIds(npdOrder, "mp"),
    });
    const overrides = ex.map((e) => ({ nodePhaseId: e.nodePhaseId, deliverableName: e.deliverableName, action: "remove" as const }));
    const eff = getEffectiveProcess("npd", [], [], overrides);
    const pvt = eff.phases.find((p) => p.id === "pvt")!;
    expect(pvt.submittedDeliverables).not.toContain("UN38.3运输测试报告或复用确认");
    expect(pvt.submittedDeliverables).not.toContain("MSDS");
  });

  it("manifest 的每个交付物确实存在于对应 category/phase 的有效提交集（防清单写错名）", () => {
    for (const entry of GATE_TIGHTENING_2026_07_02) {
      const eff = getEffectiveProcess(entry.category);
      const phase = eff.phases.find((p) => p.id === entry.phaseId);
      expect(phase, `${entry.category}/${entry.phaseId} 不存在`).toBeTruthy();
      expect(phase!.submittedDeliverables, `${entry.category}/${entry.phaseId} 提交集缺 ${entry.deliverableName}`).toContain(entry.deliverableName);
    }
  });
});
