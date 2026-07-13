// 设计4 §6："我的工作"三桶分类器。
// 下沉到 shared 层：网页"我的工作"与钉钉每日摘要消费同一份分桶结果（单一事实源），
// 判定标准一句话——现在处理=下一步动作在我；等待别人=我已出手球在别人那；仅关注=无需动作的知会。

export type MyWorkBucket = "now" | "waiting" | "watching";

export interface MyWorkTaskLike {
  projectId: string;
  projectName?: string | null;
  /** 展示名（服务端按项目模板解析）；缺省回退 taskId。 */
  title?: string | null;
  phaseId: string;
  taskId: string;
  status: string;
  dueDate?: string | null;
  priority?: string | null;
  assigneeUserId?: number | null;
}

export interface MyWorkReviewLike {
  projectId: string;
  phaseId: string;
  deliverableName: string;
  status: string;
  reviewerUserId?: number | null;
  submittedBy?: number | null;
}

export interface MyWorkActionItemLike {
  id: number;
  projectId?: string | null;
  kind?: string | null;
  title?: string | null;
  status?: string | null;
  snoozedUntil?: string | Date | null;
}

export interface MyWorkItem {
  key: string;
  bucket: MyWorkBucket;
  kind: string;
  title: string;
  projectId: string | null;
  phaseId?: string | null;
  taskId?: string | null;
  dueDate?: string | null;
  /** 排序权重：逾期 > 今日到期 > 可开始 > 进行中（设计 §6）。 */
  rank: number;
}

const ACTIVE_TASK_STATUSES = new Set(["todo", "in_progress"]);

function taskRank(task: MyWorkTaskLike, today: string): number {
  if (task.dueDate && task.dueDate < today) return 40;            // 逾期
  if (task.dueDate && task.dueDate === today) return 30;          // 今日到期
  if (task.status === "todo") return 20;                          // 可开始
  if (task.status === "in_progress") return 10;                   // 进行中
  return 0;
}

export function classifyMyWork(input: {
  userId: number;
  today: string; // YYYY-MM-DD（Asia/Shanghai）
  tasks: MyWorkTaskLike[];
  reviews: MyWorkReviewLike[];
  actionItems: MyWorkActionItemLike[];
  snoozedActionItems: MyWorkActionItemLike[];
}): { now: MyWorkItem[]; waiting: MyWorkItem[]; watching: MyWorkItem[] } {
  const now: MyWorkItem[] = [];
  const waiting: MyWorkItem[] = [];
  const watching: MyWorkItem[] = [];

  for (const item of input.actionItems) {
    now.push({
      key: `ai:${item.id}`,
      bucket: "now",
      kind: item.kind ?? "action_item",
      title: item.title ?? "待处理事项",
      projectId: item.projectId ?? null,
      rank: 25,
    });
  }
  for (const review of input.reviews) {
    if (review.status !== "pending") continue;
    if (review.reviewerUserId === input.userId) {
      now.push({
        key: `rv:${review.projectId}:${review.phaseId}:${review.deliverableName}`,
        bucket: "now",
        kind: "deliverable_review",
        title: `待你审核：${review.deliverableName}`,
        projectId: review.projectId,
        phaseId: review.phaseId,
        rank: 28,
      });
    } else if (review.submittedBy === input.userId) {
      waiting.push({
        key: `rv-wait:${review.projectId}:${review.phaseId}:${review.deliverableName}`,
        bucket: "waiting",
        kind: "deliverable_review_waiting",
        title: `等审核：${review.deliverableName}`,
        projectId: review.projectId,
        phaseId: review.phaseId,
        rank: 5,
      });
    }
  }
  for (const task of input.tasks) {
    const base = {
      projectId: task.projectId,
      phaseId: task.phaseId,
      taskId: task.taskId,
      dueDate: task.dueDate ?? null,
    };
    if (task.status === "pending_approval") {
      waiting.push({
        key: `task-wait:${task.projectId}:${task.phaseId}:${task.taskId}`,
        bucket: "waiting", kind: "task_pending_approval",
        title: `等审批：${task.title ?? task.taskId}`, rank: 6, ...base,
      });
      continue;
    }
    if (!ACTIVE_TASK_STATUSES.has(task.status)) continue;
    now.push({
      key: `task:${task.projectId}:${task.phaseId}:${task.taskId}`,
      bucket: "now", kind: "task",
      title: task.title ?? task.taskId, rank: taskRank(task, input.today), ...base,
    });
  }
  for (const item of input.snoozedActionItems) {
    watching.push({
      key: `snooze:${item.id}`,
      bucket: "watching",
      kind: item.kind ?? "action_item",
      title: `${item.title ?? "已暂缓事项"}（暂缓中）`,
      projectId: item.projectId ?? null,
      rank: 1,
    });
  }
  const byRank = (a: MyWorkItem, b: MyWorkItem) => b.rank - a.rank;
  now.sort(byRank); waiting.sort(byRank); watching.sort(byRank);
  return { now, waiting, watching };
}
