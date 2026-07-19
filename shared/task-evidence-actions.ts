export type TaskEvidenceLevel = "light" | "heavy";

const COMPLETION_CLOSED_STATUSES = new Set(["done", "skipped", "pending_approval"]);

/**
 * 上传证据后的“顺手完成”只属于普通重证据任务。
 * Gate 必须继续走正式评审；已完成/跳过/待审批任务也不能重复提交。
 */
export function shouldOfferCompletionAfterEvidenceUpload(input: {
  evidenceLevel: TaskEvidenceLevel;
  isGateTask: boolean;
  completed: boolean;
  status: string;
}): boolean {
  return input.evidenceLevel === "heavy"
    && !input.isGateTask
    && !input.completed
    && !COMPLETION_CLOSED_STATUSES.has(input.status);
}
