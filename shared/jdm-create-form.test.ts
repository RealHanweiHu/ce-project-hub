import { describe, expect, it } from "vitest";
import {
  buildJdmCreateExecutionBaseline,
  getJdmCreatePhasePreview,
  validateJdmCreateInput,
  validateObtCreateInput,
} from "../client/src/lib/jdm-create";

describe("JDM create form model", () => {
  it("JDM 只要求客户概念、商务边界和客户签核责任人", () => {
    expect(validateJdmCreateInput({
      customerConceptRef: " 客户 ID 草图 2026-07-15 ",
      commercialBoundary: " NRE 与模具由我方承担 ",
      customerSignoffOwnerUserId: 18,
    })).toEqual({ ok: true, issues: [] });

    expect(validateJdmCreateInput({
      customerConceptRef: "",
      commercialBoundary: "",
      customerSignoffOwnerUserId: null,
    })).toEqual({
      ok: false,
      issues: ["客户概念/ID 原始输入", "商务边界", "客户签核责任人"],
    });
  });

  it("创建 payload 只冻结原始概念，不提前写规格、模块或审计字段", () => {
    expect(buildJdmCreateExecutionBaseline("  客户概念图链接 /ID-001  "))
      .toEqual({
        modelVersion: "project-track-v1",
        status: "draft",
        customerConceptRef: "客户概念图链接 /ID-001",
      });
  });

  it("JDM 创建预览只显示 P1 产品定义阶段", () => {
    const preview = getJdmCreatePhasePreview("客户概念图 ID-001");

    expect(preview.phases.map(phase => phase.id)).toEqual(["input"]);
    expect(preview.phases[0]?.gateTaskId).toBe("jdm_product_definition_gate");
    expect(preview.totalTaskCount).toBe(preview.phases[0]?.tasks.length);
  });

  it("OBT 仍要求完整客户设计版本、料号、商务边界和签核责任人", () => {
    expect(validateObtCreateInput({
      customerInputVersion: "BOM V1.3",
      customerPartNumber: "CUS-001",
      commercialBoundary: "客户负责设计",
      customerSignoffOwnerUserId: 18,
    })).toEqual({ ok: true, issues: [] });

    expect(validateObtCreateInput({
      customerInputVersion: "",
      customerPartNumber: "",
      commercialBoundary: "",
      customerSignoffOwnerUserId: null,
    }).issues).toEqual([
      "客户输入版本",
      "客户料号",
      "商务边界",
      "客户签核责任人",
    ]);
  });
});
