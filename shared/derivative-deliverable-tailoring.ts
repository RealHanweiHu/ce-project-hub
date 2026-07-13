// DRV 复用策略 → Gate 交付物自动豁免（瘦身计划批次三 / 审核报告 P1-3）。
// 推导规则：交付物的全部产出任务（TASK_DELIVERABLES 反查，排除 Gate 评审任务本身）
// 都被策略裁掉 → 该交付物自动豁免；无产出任务的交付物（整机级/评审级证据）不豁免。
// 复用任务级映射推导，避免再维护一份"模块→交付物"表漂移。
import { DERIVATIVE_PHASES, getDerivativeEffectiveTaskIds } from "./sop-templates";
import { TASK_DELIVERABLES } from "./task-deliverables";
import { phaseSubmissionTemplate } from "./effective-process";

/** 安全/认证锚点：量产发布硬闸口引用的证据名，永不自动豁免（自带"或复用确认"快速路径）。 */
export const DERIVATIVE_NEVER_AUTO_EXEMPT: Set<string> = new Set([
  "UN38.3运输测试报告或复用确认",
  "MSDS",
  "电芯/电池包安全认证报告或复用确认",
  "EOL 100%测试能力验收记录",
  "认证补测/复用确认",
]);

/** 自动豁免 override 的 reason 标记：撤销时只清带此理由的行，绝不碰 PM 手动豁免。 */
export const DERIVATIVE_AUTO_EXEMPT_REASON = "模块直接复用—流程策略自动豁免";

export interface AutoExemptDeliverable {
  nodePhaseId: string;
  deliverableName: string;
}

export function getDerivativeAutoExemptDeliverables(strategyInput?: unknown): AutoExemptDeliverable[] {
  const effective = getDerivativeEffectiveTaskIds(strategyInput);
  const out: AutoExemptDeliverable[] = [];
  for (const phase of DERIVATIVE_PHASES) {
    const submission = new Set<string>(phaseSubmissionTemplate(phase));
    for (const name of Array.from(submission)) {
      if (DERIVATIVE_NEVER_AUTO_EXEMPT.has(name)) continue;
      const producers = phase.tasks.filter(
        (task) => task.id !== phase.gateTaskId && (TASK_DELIVERABLES[task.id] ?? []).includes(name)
      );
      if (producers.length === 0) continue;
      if (producers.every((task) => !effective.has(task.id))) {
        out.push({ nodePhaseId: phase.id, deliverableName: name });
      }
    }
  }
  return out;
}
