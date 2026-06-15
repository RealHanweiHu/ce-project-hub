/** 项目健康度等级。绿=正常，黄=需关注，红=需介入。 */
export type RagLevel = "green" | "amber" | "red";

/** computeRag 的输入：均来自 PortfolioRow，避免依赖具体数据层类型。 */
export type RagInput = {
  risk: string;
  projectedEnd: string | null;
  targetDate: string | null;
  overdueTasks: number;
  blockedTasks: number;
  openIssues: number;
  /** P0/P1 未关闭问题数 */
  criticalIssues: number;
};

/** 预计完成晚于目标日 → 视为超期。两者均为 YYYY-MM-DD，字符串比较即可。 */
function isProjectedOverdue(projectedEnd: string | null, targetDate: string | null): boolean {
  return !!(projectedEnd && targetDate && projectedEnd > targetDate);
}

/**
 * 计算项目 RAG。优先级从高到低短路：先判红，再判黄，否则绿。
 */
export function computeRag(input: RagInput): RagLevel {
  if (
    input.risk === "high" ||
    isProjectedOverdue(input.projectedEnd, input.targetDate) ||
    input.overdueTasks > 0 ||
    input.criticalIssues > 0
  ) {
    return "red";
  }
  if (input.risk === "medium" || input.blockedTasks > 0 || input.openIssues > 0) {
    return "amber";
  }
  return "green";
}
