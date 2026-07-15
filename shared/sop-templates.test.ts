import { describe, expect, it } from "vitest";
import {
  CATEGORY_MAP,
  DERIVATIVE_PHASES,
  ECO_PHASES,
  IDR_PHASES,
  JDM_PHASES,
  NPD_PHASES,
  OBT_PHASES,
  PROJECT_CATEGORIES,
  SOP_TEMPLATE_VERSION_CURRENT,
  SOP_TEMPLATE_VERSION_LEGACY,
  SOP_TEMPLATE_VERSION_NPD_V3,
  getDefaultTemplateVersionForCategory,
  getPhasesForCategory,
  getReleaseGatePhase,
  normalizeSopTemplateVersion,
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
  it("versions Close tasks so template changes never rewrite project history", () => {
    const legacyClose = getPhasesForCategory("npd", SOP_TEMPLATE_VERSION_LEGACY).find((p) => p.isCloseGate)!;
    const currentClose = getPhasesForCategory("npd", SOP_TEMPLATE_VERSION_CURRENT).find((p) => p.isCloseGate)!;

    expect(legacyClose.gateTaskId).toBe("mp6");
    expect(legacyClose.tasks.some((item) => item.id === "mp6")).toBe(true);
    expect(currentClose.gateTaskId).toBe("project_close_review");
    expect(currentClose.tasks.map((item) => item.id)).toEqual([
      "stability_ramp",
      "stability_metrics",
      "stability_issues",
      "project_close_review",
    ]);
  });

  it("keeps category metadata and release gates consistent", () => {
    expect(PROJECT_CATEGORIES.map((category) => category.id)).not.toContain("idr");
    expect(CATEGORY_MAP.idr.badge).toBe("IDR"); // historical projects remain renderable
    for (const category of PROJECT_CATEGORIES) {
      expect(category.phaseCount).toBe(category.phases.length);
      expect(getReleaseGatePhase(category.id)?.isReleaseGate).toBe(true);
      expect(category.phases.filter((p) => p.isReleaseGate)).toHaveLength(1);

      for (const p of category.phases) {
        expect(p.gateTaskId).toBeTruthy();
        expect(p.tasks.some((t) => t.id === p.gateTaskId)).toBe(true);
        if (!p.isCloseGate) expect(p.gateStandard.requiredDeliverables.length).toBeGreaterThan(0);
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

  it("keeps ECO as a small-scope engineering change flow", () => {
    expect(CATEGORY_MAP.eco.name).toBe("工程变更");
    expect(CATEGORY_MAP.eco.nameEn).toBe("Engineering Change");
    expect(CATEGORY_MAP.eco.badge).toBe("ECO");
    expect(CATEGORY_MAP.eco.desc).toContain("换料");

    const planning = phase(ECO_PHASES, "planning");
    expect(planning.name).toBe("变更规划");
    expect(planning.deliverables).toEqual(expect.arrayContaining(["ECR变更申请书", "影响分析报告", "BOM差异对比"]));
    expect(task(ECO_PHASES, "planning", "ep1").name).toBe("变更需求分析 (ECR)");
    expect(task(ECO_PHASES, "planning", "ep2").guide).toContain("电池安全");

    const design = phase(ECO_PHASES, "design");
    expect(design.name).toBe("变更设计");
    expect(design.gate).toBe("设计变更冻结");
    expect(design.deliverables).toEqual(expect.arrayContaining(["ECN草案/变更设计包", "更新后的BOM"]));
    expect(task(ECO_PHASES, "design", "ed4").visibleRoles).toContain("pe");
    expect(task(ECO_PHASES, "design", "ed5").visibleRoles).toContain("battery_safety");

    const evt = phase(ECO_PHASES, "evt");
    expect(evt.name).toBe("EVT 变更验证");
    expect(task(ECO_PHASES, "evt", "ev2").name).toBe("变更点专项验证");

    const pvt = phase(ECO_PHASES, "pvt");
    expect(pvt.gate).toBe("变更量产切换评审");
    expect(pvt.gateStandard.requiredDeliverables).toEqual(expect.arrayContaining(["变更试产报告", "更新后的SOP/WI", "产线切换计划", "库存处理方案"]));
    expect(task(ECO_PHASES, "pvt", "epv4").name).toBe("ECN 正式发布");
  });

  it("keeps each DRV task accountable to a single DRI", () => {
    const multiOwnerPattern = /[\/／、&]|跨部门/;
    const ownerRoleMap: Record<string, string> = {
      产品经理: "pm",
      项目经理: "project_manager",
      硬件研发: "rd_hw",
      软件研发: "rd_sw",
      结构研发: "rd_mech",
      QA: "qa",
      SCM: "scm",
      PE: "pe",
      认证: "cert",
      工厂: "mfg",
      销售: "sales",
    };

    for (const phase of DERIVATIVE_PHASES) {
      for (const item of phase.tasks) {
        expect(item.owner.trim(), `${phase.id}/${item.id} 缺 owner`).not.toBe("");
        expect(item.owner, `${phase.id}/${item.id} owner 应为单一责任人`).not.toMatch(multiOwnerPattern);
        expect(ownerRoleMap[item.owner], `${phase.id}/${item.id} owner 应映射到项目内角色`).toBeTruthy();
        if (item.id !== phase.gateTaskId) {
          expect(item.visibleRoles?.[0], `${phase.id}/${item.id} 首个可见角色应为 DRI`).toBe(ownerRoleMap[item.owner]);
        }
      }
      expect(task(DERIVATIVE_PHASES, phase.id, phase.gateTaskId).owner).toBe("项目经理");
    }
  });

  it("keeps the retired IDR template only for historical project compatibility", () => {
    expect(task(IDR_PHASES, "design", "ir1").owner).toBe("产品经理/ID");
    expect(task(IDR_PHASES, "design", "ir2").owner).toBe("项目经理/CM");
    expect(task(IDR_PHASES, "mp", "im5").owner).toBe("产品经理/市场/销售");

    const exceptionText = phase(IDR_PHASES, "design").gateStandard.exceptionStrategy.join(" ");
    expect(exceptionText).toContain("升级为 产品迭代/衍生开发或 NPD");
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

describe("NPD v3 版本路由", () => {
  it("v3 常量与 normalize", () => {
    expect(SOP_TEMPLATE_VERSION_NPD_V3).toBe("2026-07-v3");
    expect(normalizeSopTemplateVersion("2026-07-v3")).toBe("2026-07-v3");
  });

  it("新建默认版本：npd 用 v3，其余用 current", () => {
    expect(getDefaultTemplateVersionForCategory("npd")).toBe("2026-07-v3");
    expect(getDefaultTemplateVersionForCategory("eco")).toBe(SOP_TEMPLATE_VERSION_CURRENT);
    expect(getDefaultTemplateVersionForCategory("derivative")).toBe(SOP_TEMPLATE_VERSION_CURRENT);
  });
});
