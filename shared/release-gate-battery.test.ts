import { describe, it, expect } from "vitest";
import {
  CATEGORY_MAP,
  getPhasesForCategory,
  getReleaseGatePhase,
} from "./sop-templates";
import { canRoleContributeToDeliverable } from "./deliverable-permissions";

/**
 * P0：锂电产品出货的运输/安全认证义务在制造商，与谁做的设计无关。
 * JDM 在 DVT 对 UN38.3 / MSDS / 电芯电池包安全认证做实证验证，
 * 发布门再确认 EOL 能力和认证证据仍覆盖量产版本；客户签字不能替代。
 * OBT（客供设计）发布门至少要有 UN38.3 / MSDS 复用或有效性确认。
 */
const JDM_DVT_BATTERY_EVIDENCE = [
  "UN38.3运输测试报告或复用确认",
  "MSDS",
  "电芯/电池包安全认证报告或复用确认",
];
const JDM_RELEASE_BATTERY_EVIDENCE = [
  "EOL 100%测试能力验收记录",
  "认证与运输证据覆盖复核记录",
];
const OBT_BATTERY_EVIDENCE = ["UN38.3运输测试报告或复用确认", "MSDS"];

describe("JDM/OBT 发布门电池安全证据", () => {
  it("JDM DVT 完成电池安全实证，发布门复核量产版本覆盖", () => {
    const dvt = getPhasesForCategory("jdm").find((phase) => phase.id === "dvt")!;
    const release = getReleaseGatePhase("jdm");
    expect(release).not.toBeNull();
    for (const name of JDM_DVT_BATTERY_EVIDENCE) {
      expect(dvt.gateStandard.requiredDeliverables, `DVT 缺 ${name}`).toContain(name);
      expect(dvt.deliverables, `DVT 阶段交付物缺 ${name}`).toContain(name);
    }
    for (const name of JDM_RELEASE_BATTERY_EVIDENCE) {
      expect(release!.gateStandard.requiredDeliverables, `发布门缺 ${name}`).toContain(name);
      expect(release!.deliverables, `发布阶段交付物缺 ${name}`).toContain(name);
    }
  });

  it("OBT 发布门 requiredDeliverables 含 UN38.3 与 MSDS", () => {
    const gate = getReleaseGatePhase("obt");
    expect(gate).not.toBeNull();
    for (const name of OBT_BATTERY_EVIDENCE) {
      expect(gate!.gateStandard.requiredDeliverables, `缺 ${name}`).toContain(name);
      expect(gate!.deliverables, `阶段交付物缺 ${name}`).toContain(name);
    }
  });

  it("JDM 赛道有 cert/battery_safety 参与的任务（安规认证任务可见）", () => {
    const jdm = CATEGORY_MAP.jdm;
    const rolesInTemplates = new Set(
      jdm.phases.flatMap((p) => p.tasks.flatMap((t) => t.visibleRoles ?? []))
    );
    expect(rolesInTemplates.has("cert")).toBe(true);
    expect(rolesInTemplates.has("battery_safety")).toBe(true);
  });

  it("电池证据交付物路由到 battery_safety/cert 可提交", () => {
    for (const name of ["UN38.3运输测试报告或复用确认", "MSDS", "电芯/电池包安全认证报告或复用确认"]) {
      expect(
        canRoleContributeToDeliverable("battery_safety", name) || canRoleContributeToDeliverable("cert", name),
        `${name} 无 battery_safety/cert 提交通道`,
      ).toBe(true);
    }
  });
});
