import { describe, it, expect } from "vitest";
import { PROJECT_CATEGORIES } from "./sop-templates";
import { TASK_DELIVERABLES } from "./task-deliverables";
import { getEffectiveProcess } from "./effective-process";

/**
 * P1-8 守卫：任务级交付物词表（TASK_DELIVERABLES，逐任务勾选/追踪）与阶段级提交集
 * （phase.deliverables ∪ gateStandard.requiredDeliverables，喂给 Gate 就绪+可上传证据）
 * 是两套「有意分层」的词表：
 *   - 阶段级 = Gate 硬证据（可上传、进就绪度）；
 *   - 任务级 = 更细的过程追踪；Gate 任务上额外的「X× 评审记录」由评审流程产生，不走上传。
 * 本守卫锁定「真正喂 Gate 的那一半」的一致性，防止未来漂移：
 *   每个 category 的发布门(isReleaseGate) requiredDeliverables 必须都落在有效提交集里，
 *   即一定能被上传为证据、被就绪度检查到。
 */
describe("交付物词表分层守卫", () => {
  for (const cat of PROJECT_CATEGORIES) {
    it(`${cat.id}：发布门必备交付物都在有效提交集内（可上传+进就绪度）`, () => {
      const eff = getEffectiveProcess(cat.id);
      const releasePhase = cat.phases.find((p) => p.isReleaseGate);
      expect(releasePhase, `${cat.id} 无发布门`).toBeTruthy();
      const effPhase = eff.phases.find((p) => p.id === releasePhase!.id)!;
      const submitted = new Set(effPhase.submittedDeliverables);
      const required = releasePhase!.gateStandard.requiredDeliverables;
      const missing = required.filter((n) => !submitted.has(n));
      expect(missing, `发布门必备项不在提交集: ${missing.join(", ")}`).toEqual([]);
    });

    it(`${cat.id}：Gate 任务的非「评审记录」交付物若与阶段提交集重名，命名保持一致`, () => {
      // 任务级里凡是"评审记录/确认记录/签样/签核"这类由评审流程产生的元交付物豁免；
      // 其余若在阶段提交集里存在同义项，则名称必须完全一致（防"功能测试报告 (FT)" vs "功能测试报告"式漂移）。
      const submissionAll = new Set<string>();
      for (const p of cat.phases) {
        for (const n of [...(p.deliverables ?? []), ...(p.gateStandard?.requiredDeliverables ?? [])]) submissionAll.add(n);
      }
      for (const p of cat.phases) {
        const td = TASK_DELIVERABLES[p.gateTaskId] ?? [];
        for (const name of td) {
          if (/评审记录|确认记录|签样|签核|确认（客户）|放行记录|golden sample/.test(name)) continue;
          // 非豁免项：要么就在提交集里（已对齐），要么是更细的任务追踪项（不在集里也可）——
          // 这里只断言「不会出现仅差括号/后缀的近重名」这类明显漂移。
          const nearDup = Array.from(submissionAll).find(
            (s) => s !== name && (s.replace(/\s*[（(].*?[)）]\s*/g, "") === name.replace(/\s*[（(].*?[)）]\s*/g, "")),
          );
          expect(nearDup, `${p.gateTaskId} 的「${name}」与阶段级「${nearDup}」近重名，请统一`).toBeFalsy();
        }
      }
    });
  }
});
