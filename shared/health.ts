/** 项目健康度等级。绿=正常，黄=需关注，红=需介入。 */
export type RagLevel = "green" | "amber" | "red";

/** computeRag 的输入：均来自上层聚合，避免依赖具体数据层类型。 */
export type RagInput = {
  risk: "low" | "medium" | "high";
  /** = max(task.dueDate)，当前计划结束日（非预测算法）。 */
  projectedEnd: string | null;
  targetDate: string | null;
  overdueTasks: number;
  blockedTasks: number;
  openIssues: number;
  /** P0/P1 未关闭问题数 */
  criticalIssues: number;
  /** 进度落后百分点；无计划项→null（不参与判定）。 */
  progressBehindPct?: number | null;
  /** Gate 临近未就绪等级；无→null。 */
  gateNotReady?: "red" | "amber" | null;
};

// 阈值（先写死，后续如需再做后台可配）
const SLIP_RED = 7; // 目标日偏差 > 7 天 → 红
const SLIP_AMBER = 1; // 1..7 天 → 黄
const PROGRESS_RED = 20; // 进度落后 > 20pt → 红
const PROGRESS_AMBER = 10; // 10..20pt → 黄

/** 两个 YYYY-MM-DD 相减得天数（toISO - fromISO，正=晚）；任一为空/非法→null。与时区无关。 */
export function daysBetween(fromISO: string | null, toISO: string | null): number | null {
  if (!fromISO || !toISO) return null;
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** 预计完成晚于目标日 → 视为超期。保留为工具函数供他处复用。 */
export function isProjectedOverdue(projectedEnd: string | null, targetDate: string | null): boolean {
  const d = daysBetween(targetDate, projectedEnd);
  return d !== null && d > 0;
}

/**
 * 计算项目 RAG。优先级从高到低短路：先判红，再判黄，否则绿。
 * 目标日偏差由 projectedEnd/targetDate 内部推导（targetSlipDays = projectedEnd - targetDate）。
 */
export function computeRag(input: RagInput): RagLevel {
  const slip = daysBetween(input.targetDate, input.projectedEnd);
  const behind = input.progressBehindPct;
  if (
    input.risk === "high" ||
    input.overdueTasks > 0 ||
    input.criticalIssues > 0 ||
    (slip !== null && slip > SLIP_RED) ||
    (behind != null && behind > PROGRESS_RED) ||
    input.gateNotReady === "red"
  ) {
    return "red";
  }
  if (
    input.risk === "medium" ||
    input.blockedTasks > 0 ||
    input.openIssues > 0 ||
    (slip !== null && slip >= SLIP_AMBER) ||
    (behind != null && behind >= PROGRESS_AMBER) ||
    input.gateNotReady === "amber"
  ) {
    return "amber";
  }
  return "green";
}

/**
 * 收集所有触发原因（不短路），供摘要解释「为什么红/黄」。绿项目返回空数组。
 * 与 computeRag 共用同一组阈值，避免漂移。
 */
export function ragReasons(input: RagInput): string[] {
  const reasons: string[] = [];
  if (input.risk === "high") reasons.push("风险:高");
  else if (input.risk === "medium") reasons.push("风险:中");
  if (input.overdueTasks > 0) reasons.push(`逾期×${input.overdueTasks}`);
  if (input.criticalIssues > 0) reasons.push(`P0/P1×${input.criticalIssues}`);
  if (input.blockedTasks > 0) reasons.push(`阻塞×${input.blockedTasks}`);
  if (input.openIssues > 0) reasons.push(`开放问题×${input.openIssues}`);
  const slip = daysBetween(input.targetDate, input.projectedEnd);
  if (slip !== null && slip >= SLIP_AMBER) reasons.push(`预计晚${slip}天`);
  if (input.progressBehindPct != null && input.progressBehindPct >= PROGRESS_AMBER) {
    reasons.push(`进度落后${Math.round(input.progressBehindPct)}pt`);
  }
  if (input.gateNotReady === "red") reasons.push("Gate未就绪(临近)");
  else if (input.gateNotReady === "amber") reasons.push("Gate未就绪");
  return reasons;
}
