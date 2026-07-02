import { describe, expect, it } from "vitest";
import {
  CATEGORY_MAP,
  ECO_PHASES,
  IDR_PHASES,
  JDM_PHASES,
  NPD_PHASES,
  OBT_PHASES,
  PROJECT_CATEGORIES,
  getReleaseGatePhase,
  type SOPPhase,
} from "./sop-templates";

function phase(phases: SOPPhase[], id: string): SOPPhase {
  const found = phases.find((p) => p.id === id);
  expect(found).toBeTruthy();
  return found!;
}

function task(phases: SOPPhase[], phaseId: string, taskId: string) {
  const found = phase(phases, phaseId).tasks.find((t) => t.id === taskId);
  expect(found).toBeTruthy();
  return found!;
}

describe("SOP templates", () => {
  it("keeps category metadata and release gates consistent", () => {
    for (const category of PROJECT_CATEGORIES) {
      expect(category.phaseCount).toBe(category.phases.length);
      expect(getReleaseGatePhase(category.id)?.isReleaseGate).toBe(true);
      expect(category.phases.filter((p) => p.isReleaseGate)).toHaveLength(1);

      for (const p of category.phases) {
        expect(p.gateTaskId).toBeTruthy();
        expect(p.tasks.some((t) => t.id === p.gateTaskId)).toBe(true);
        expect(p.gateStandard.requiredDeliverables.length).toBeGreaterThan(0);
        expect(p.gateStandard.responsibleRoles.length).toBeGreaterThan(0);
        expect(p.gateStandard.evidenceRequirements.length).toBeGreaterThan(0);
      }
    }
  });

  it("splits product definition from project execution in NPD", () => {
    expect(CATEGORY_MAP.npd.typicalDuration).toBe("约 5-8 个月");
    expect(phase(NPD_PHASES, "planning").duration).toBe("3-4周");

    expect(task(NPD_PHASES, "concept", "c3").owner).toBe("产品经理");
    expect(task(NPD_PHASES, "planning", "p1").owner).toBe("产品经理");
    expect(task(NPD_PHASES, "planning", "p3").owner).toBe("项目经理/PMO");

    const planningRoles = phase(NPD_PHASES, "planning").gateStandard.responsibleRoles.join(" ");
    expect(planningRoles).toContain("产品经理负责需求");
    expect(planningRoles).toContain("项目经理/PMO 负责里程碑");
  });

  it("front-loads battery safety, certification, FMEA, and PVT EOL gates in NPD", () => {
    expect(phase(NPD_PHASES, "concept").deliverables).toContain("认证路线图初判");
    expect(phase(NPD_PHASES, "planning").deliverables).toContain("认证路线图");
    expect(phase(NPD_PHASES, "planning").deliverables).toContain("电芯复用/定点与二供策略");

    expect(task(NPD_PHASES, "planning", "p5a").name).toBe("电芯复用/定点与二供策略");
    expect(task(NPD_PHASES, "planning", "p6a").name).toBe("认证路线图");
    expect(task(NPD_PHASES, "design", "d6a").name).toBe("安全 FMEA 与危害分析");
    expect(task(NPD_PHASES, "design", "d7a").name).toBe("电芯厂质量审核/复用资质确认");
    expect(task(NPD_PHASES, "design", "d7b").name).toBe("保护电路设计评审/复用确认");

    const designRequired = phase(NPD_PHASES, "design").gateStandard.requiredDeliverables;
    expect(designRequired).toEqual(expect.arrayContaining(["安全FMEA与危害分析", "电芯厂质量审核或复用资质确认", "保护电路设计评审或复用确认"]));

    const pvtRequired = phase(NPD_PHASES, "pvt").gateStandard.requiredDeliverables;
    expect(pvtRequired).toEqual(expect.arrayContaining(["EOL 100%测试能力验收记录", "UN38.3运输测试报告或复用确认", "MSDS", "电芯/电池包安全认证报告或复用确认"]));
  });

  it("keeps formal ECN release after ECO validation and trial run readiness", () => {
    const design = phase(ECO_PHASES, "design");
    expect(design.deliverables).toContain("ECN草案/变更设计包");
    expect(design.deliverables).not.toContain("ECN工程变更通知");
    expect(design.gateStandard.exitCriteria.join(" ")).toContain("ECN 草案/变更设计包");

    const releaseTask = task(ECO_PHASES, "pvt", "epv4");
    expect(releaseTask.name).toBe("ECN 正式发布");
    expect(releaseTask.owner).toBe("项目经理/CM");
  });

  it("keeps IDR as appearance-led refresh with an upgrade guard", () => {
    expect(task(IDR_PHASES, "design", "ir1").owner).toBe("产品经理/ID");
    expect(task(IDR_PHASES, "design", "ir2").owner).toBe("项目经理/CM");
    expect(task(IDR_PHASES, "mp", "im5").owner).toBe("产品经理/市场/销售");

    const exceptionText = phase(IDR_PHASES, "design").gateStandard.exceptionStrategy.join(" ");
    expect(exceptionText).toContain("升级为 ECO/NPD");
  });

  it("keeps customer-led gates explicit in JDM and OBT", () => {
    expect(phase(JDM_PHASES, "input").deliverables).toContain("规格确认书（客户签字）");
    expect(phase(JDM_PHASES, "pvt").deliverables).toContain("客户 golden sample 签样记录");
    expect(task(JDM_PHASES, "input", "jin1").owner).toBe("项目经理");

    expect(phase(OBT_PHASES, "intake").deliverables).toContain("设计输入冻结确认（客户）");
    expect(phase(OBT_PHASES, "sample").deliverables).toContain("客户签样记录");
    expect(phase(OBT_PHASES, "pvt").deliverables).toContain("客户放行记录");
    expect(task(OBT_PHASES, "sample", "os4").owner).toBe("项目经理");
  });
});
