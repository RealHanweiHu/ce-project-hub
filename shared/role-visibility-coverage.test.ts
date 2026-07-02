import { describe, it, expect } from "vitest";
import { PROJECT_CATEGORIES } from "./sop-templates";

/**
 * P1-7：pe/mfg/sales 在全部 5 类模板里 visibleRoles 曾全为空——这三个角色进项目
 * 只看得到 Gate 任务；cert/battery_safety 在 ECO/IDR/JDM/OBT 也曾为空（换电芯二供的
 * ECO 反而没有电池安全参与）。这些都是跨轨都存在的职能，每类模板至少要有其可见任务
 * （具体产品无该职能时由裁剪移除，而不是模板里根本看不到）。
 */
const REQUIRED = ["pe", "mfg", "sales", "cert", "battery_safety"] as const;

describe("角色任务可见性覆盖", () => {
  for (const cat of PROJECT_CATEGORIES) {
    it(`${cat.id}：pe/mfg/sales/cert/battery_safety 各至少有一个可见任务`, () => {
      const present = new Set<string>();
      for (const p of cat.phases) for (const t of p.tasks) for (const r of t.visibleRoles ?? []) present.add(r);
      const missing = REQUIRED.filter((r) => !present.has(r));
      expect(missing, `${cat.id} 缺角色可见任务: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
