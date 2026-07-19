import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectListView = readFileSync(
  new URL(
    "../client/src/components/views/ProjectListView.tsx",
    import.meta.url
  ),
  "utf8"
);

describe("DRV create form", () => {
  it("只显示决定任务组合的必要输入", () => {
    expect(projectListView).toContain("六模块执行基线");
    expect(projectListView).toContain("KeyModulePicker");
    expect(projectListView).toContain("产品规格书在创建后的");

    expect(projectListView).not.toContain("产品定义 / 规格书引用 *");
    expect(projectListView).not.toContain("productDefinitionRef: form.");
    expect(projectListView).not.toContain("DRV 项目目标");
    expect(projectListView).not.toContain("DRV 改进目标");
    expect(projectListView).not.toContain("DRV 新增功能或能力");
    expect(projectListView).not.toContain("安全 / 法规影响确认");
    expect(projectListView).not.toContain("DRV 安全法规影响补充说明");
    expect(projectListView).not.toContain("projectIntent:");
    expect(projectListView).not.toContain("placeholder=\"来源产品或模块 *\"");
    expect(projectListView).not.toContain("placeholder=\"证据编号 / 链接 *\"");
  });

  it("零复用只在提交时弹窗，并只允许返回修改或切换 NPD", () => {
    expect(projectListView).toContain("当前没有复用任何模块");
    expect(projectListView).toContain("DRV 至少需要复用一个现有模块；如果全部模块重新开发，更符合 NPD。");
    expect(projectListView).toContain("返回修改");
    expect(projectListView).toContain("切换为 NPD");
    expect(projectListView).toMatch(/issue\.code !== ["']drv_no_modules_reused["']/);
  });

  it("DRV 不再提交安全法规声明，风险升级控件仅归 ECO", () => {
    expect(projectListView).not.toContain(
      "buildDerivativeChangeScopeDeclaration"
    );
    expect(projectListView).toMatch(
      /changeScopeDeclaration:\s*capturesEcoChangeScope[\s\S]*?:\s*\{\s*\.\.\.EMPTY_CHANGE_SCOPE_DECLARATION\s*\}/
    );
    expect(projectListView).toMatch(
      /\{capturesEcoChangeScope && \([\s\S]*?安全风险（仅可主动升级）[\s\S]*?法规风险（仅可主动升级）[\s\S]*?\)\}/
    );
  });
});
