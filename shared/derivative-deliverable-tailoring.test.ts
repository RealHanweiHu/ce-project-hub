/**
 * DRV 策略 → 交付物自动豁免（P1-3）：
 * 交付物的全部产出任务（排除 Gate 评审任务）都被策略裁掉时自动豁免；
 * 安全/认证锚点永不自动豁免；默认策略（全量任务）不产生任何豁免。
 */
import { describe, it, expect } from "vitest";
import {
  DERIVATIVE_AUTO_EXEMPT_REASON,
  DERIVATIVE_NEVER_AUTO_EXEMPT,
  getDerivativeAutoExemptDeliverables,
} from "./derivative-deliverable-tailoring";

const key = (phaseId: string, name: string) => `${phaseId}:${name}`;

describe("getDerivativeAutoExemptDeliverables", () => {
  it("结构/模具直接复用：投模、模具开发、T1/T2 试模、限度样本自动豁免", () => {
    const out = getDerivativeAutoExemptDeliverables({ structure_mold: "direct_reuse" });
    const keys = new Set(out.map((o) => key(o.nodePhaseId, o.deliverableName)));
    expect(keys).toContain(key("design", "结构设计包"));
    expect(keys).toContain(key("design", "投模评审/开模批准记录"));
    expect(keys).toContain(key("design", "模具开发计划"));
    expect(keys).toContain(key("dvt", "T1试模报告"));
    expect(keys).toContain(key("dvt", "模具问题清单"));
    expect(keys).toContain(key("dvt", "T2/修模验证报告"));
    expect(keys).toContain(key("dvt", "限度样本"));
    // 整机级交付物不受单模块复用影响
    expect(keys).not.toContain(key("design", "BOM v2.0"));
    expect(keys).not.toContain(key("evt", "整机功能与兼容回归报告"));
  });

  it("全模块直接复用：安全/认证锚点与恒留任务产物永不豁免", () => {
    const all = {
      battery: "direct_reuse", mechanism: "direct_reuse", pcba_power: "direct_reuse",
      firmware: "direct_reuse", structure_mold: "direct_reuse", packaging_cert: "direct_reuse",
    };
    const names = new Set(getDerivativeAutoExemptDeliverables(all).map((o) => o.deliverableName));
    for (const anchor of Array.from(DERIVATIVE_NEVER_AUTO_EXEMPT)) {
      expect(names, anchor).not.toContain(anchor);
    }
    // dp3（恒留）产出的试产报告不豁免
    expect(names).not.toContain("升级试产报告");
    // 电池模块交付物此时应被豁免
    expect(names).toContain("电池/电源升级设计包");
  });

  it("默认策略（全量任务）不产生任何豁免", () => {
    expect(getDerivativeAutoExemptDeliverables(undefined)).toEqual([]);
  });

  it("豁免理由常量非空（作为自动/手动 override 的区分标记）", () => {
    expect(DERIVATIVE_AUTO_EXEMPT_REASON.length).toBeGreaterThan(3);
  });
});
