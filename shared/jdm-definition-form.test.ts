import { describe, expect, it } from "vitest";
import { DERIVATIVE_MODULE_TASK_IDS } from "./sop-templates";
import {
  PRODUCT_MODULE_IDS,
  type ProjectExecutionBaseline,
} from "./project-track-tailoring";
import {
  buildJdmDefinitionDraftBaseline,
  buildJdmDefinitionFreezeCandidate,
  createJdmDefinitionFormState,
  getJdmDefinitionTaskPreview,
  getJdmDefinitionGateFreezePayload,
  validateJdmDefinitionFreeze,
} from "../client/src/lib/jdm-definition";

const initialDraft: ProjectExecutionBaseline = {
  modelVersion: "project-track-v1",
  status: "draft",
  customerConceptRef: "客户 ID 图 ID-001",
};

describe("JDM product-definition form model", () => {
  it("从创建草稿进入定义阶段时，六模块默认均为不复用", () => {
    const state = createJdmDefinitionFormState(initialDraft);

    expect(state.productDefinitionRef).toBe("");
    expect(Object.values(state.moduleReuse)).toEqual(
      PRODUCT_MODULE_IDS.map(() => "not_reused"),
    );
    expect(state.customerConceptRef).toBe("客户 ID 图 ID-001");
  });

  it("草稿保存保留创建时客户概念，并清理不复用模块的无效证据", () => {
    const state = createJdmDefinitionFormState(initialDraft);
    state.productDefinitionRef = " PSD-JDM-001 ";
    state.moduleReuse.battery = "reused";
    state.reuseEvidence.battery = {
      sourceRef: " 现有 A 产品 ",
      modelOrVersion: " BAT-V2 ",
      evidenceRef: " EV-BAT-002 ",
      boundaryConfirmed: true,
    };
    state.reuseEvidence.electronics = {
      sourceRef: "不应保存",
      modelOrVersion: "PCBA-V1",
      evidenceRef: "EV-PCBA",
      boundaryConfirmed: true,
    };

    expect(buildJdmDefinitionDraftBaseline(state)).toEqual({
      modelVersion: "project-track-v1",
      status: "draft",
      customerConceptRef: "客户 ID 图 ID-001",
      productDefinitionRef: "PSD-JDM-001",
      moduleReuse: {
        battery: "reused",
        core_function: "not_reused",
        electronics: "not_reused",
        software_connectivity: "not_reused",
        structure_mold: "not_reused",
        id_cmf: "not_reused",
      },
      reuseEvidence: {
        battery: {
          sourceRef: "现有 A 产品",
          modelOrVersion: "BAT-V2",
          evidenceRef: "EV-BAT-002",
          boundaryConfirmed: true,
        },
      },
    });
  });

  it("冻结校验要求产品规格和复用证据完整，并拒绝非法 ID/CMF 组合", () => {
    const state = createJdmDefinitionFormState(initialDraft);
    state.moduleReuse.battery = "reused";
    expect(validateJdmDefinitionFreeze(state).ok).toBe(false);

    state.productDefinitionRef = "PSD-JDM-001";
    state.reuseEvidence.battery = {
      sourceRef: "现有 A 产品",
      modelOrVersion: "BAT-V2",
      evidenceRef: "EV-BAT-002",
      boundaryConfirmed: true,
    };
    expect(validateJdmDefinitionFreeze(state)).toEqual({ ok: true, issues: [] });

    state.moduleReuse.id_cmf = "not_reused";
    state.moduleReuse.structure_mold = "reused";
    expect(validateJdmDefinitionFreeze(state).issues)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_id_cmf_structure_combination",
        }),
      ]));
  });

  it("Gate 冻结候选不携带客户概念和客户端伪造的冻结审计字段", () => {
    const state = createJdmDefinitionFormState(initialDraft);
    state.productDefinitionRef = "PSD-JDM-001";
    const candidate = buildJdmDefinitionFreezeCandidate(state);

    expect(candidate).toMatchObject({
      modelVersion: "project-track-v1",
      status: "frozen",
      productDefinitionRef: "PSD-JDM-001",
    });
    expect(candidate).not.toHaveProperty("customerConceptRef");
    expect(candidate).not.toHaveProperty("frozenAt");
    expect(candidate).not.toHaveProperty("frozenBy");
  });

  it("任务预览使用 JDM 组合器，复用只减少对应模块任务包", () => {
    const state = createJdmDefinitionFormState(initialDraft);
    const full = getJdmDefinitionTaskPreview(state.moduleReuse);
    state.moduleReuse.battery = "reused";
    const tailored = getJdmDefinitionTaskPreview(state.moduleReuse);

    expect(full.phases.map(phase => phase.id)).toEqual([
      "input", "design", "evt", "dvt", "pvt", "mp",
    ]);
    expect(full.totalTaskCount - tailored.totalTaskCount)
      .toBe(DERIVATIVE_MODULE_TASK_IDS.battery.length);
    expect(tailored.reusedModuleCount).toBe(1);
  });

  it("只有 JDM P1 的通过或有条件通过才携带冻结 payload", () => {
    const state = createJdmDefinitionFormState(initialDraft);
    state.productDefinitionRef = "PSD-JDM-001";

    expect(getJdmDefinitionGateFreezePayload({
      category: "jdm",
      phaseId: "input",
      decision: "approved",
      state,
    })).toEqual({
      executionBaseline: buildJdmDefinitionFreezeCandidate(state),
    });
    expect(getJdmDefinitionGateFreezePayload({
      category: "jdm",
      phaseId: "input",
      decision: "conditional",
      state,
    })).toBeDefined();
    expect(getJdmDefinitionGateFreezePayload({
      category: "jdm",
      phaseId: "input",
      decision: "rejected",
      state,
    })).toBeUndefined();
    expect(getJdmDefinitionGateFreezePayload({
      category: "obt",
      phaseId: "input",
      decision: "approved",
      state,
    })).toBeUndefined();
  });
});
