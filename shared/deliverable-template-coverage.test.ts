/**
 * 交付物模板覆盖守卫：SOP 词表（阶段级 ∪ Gate必交 ∪ 任务级）中的每个交付物名称
 * 都必须映射到一份模板文件，且文件真实存在于 docs/templates/deliverables/。
 * 词表新增交付物而未重新生成模板时，本守卫失败——跑：
 *   python3 scripts/generate-deliverable-templates.py
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_CATEGORIES } from "./sop-templates";
import { TASK_DELIVERABLES } from "./task-deliverables";
import { DELIVERABLE_TEMPLATE_FILES, getDeliverableTemplatePath } from "./deliverable-templates";

const TEMPLATE_ROOT = path.resolve(__dirname, "..", "docs", "templates", "deliverables");

function vocab(): Set<string> {
  const names = new Set<string>();
  for (const cat of PROJECT_CATEGORIES) {
    for (const p of cat.phases) {
      (p.deliverables ?? []).forEach((d) => d.trim() && names.add(d));
      (p.gateStandard?.requiredDeliverables ?? []).forEach((d) => d.trim() && names.add(d));
      for (const t of p.tasks) (TASK_DELIVERABLES[t.id] ?? []).forEach((d) => d.trim() && names.add(d));
    }
  }
  return names;
}

describe("交付物模板覆盖", () => {
  it("词表中每个交付物名称都有模板映射", () => {
    const missing = Array.from(vocab()).filter((name) => !getDeliverableTemplatePath(name));
    expect(missing, `缺模板映射: ${missing.join("、")}`).toEqual([]);
  });

  it("映射路径安全且文件真实存在", () => {
    const bad: string[] = [];
    for (const [name, rel] of Object.entries(DELIVERABLE_TEMPLATE_FILES)) {
      if (rel.includes("..") || path.isAbsolute(rel)) bad.push(`${name} → 非法路径 ${rel}`);
      else if (!fs.existsSync(path.join(TEMPLATE_ROOT, rel))) bad.push(`${name} → 文件不存在 ${rel}`);
    }
    expect(bad, bad.slice(0, 5).join("\n")).toEqual([]);
  });

  it("未知名称返回 null", () => {
    expect(getDeliverableTemplatePath("不存在的交付物名")).toBeNull();
  });
});
