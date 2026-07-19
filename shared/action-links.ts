export type ProjectActionTarget = {
  projectId: string;
  tab?: string;
  phaseId?: string | null;
  taskId?: string | null;
  taskTab?: string | null;
  /** Optional originating action item, used to close/refresh the notification after handling. */
  actionItemId?: number | null;
};

export type TaskApprovalActionTarget = {
  projectId: string;
  phaseId: string;
  taskId: string;
};

export type DeliverableReviewActionTarget = {
  projectId: string;
  phaseId: string;
  deliverableName: string;
};

export type TaskCompletionActionTarget = {
  projectId: string;
  phaseId: string;
  taskId: string;
  /** Optional originating action item; omitted links remain backward-compatible. */
  actionItemId?: number | null;
};

export type IssueValidationActionTarget = {
  projectId: string;
  phaseId: string;
  issueId: number | string;
};

export type TaskAssignmentActionTarget = {
  projectId: string;
  phaseId: string;
  taskId: string;
  assigneeUserId?: number | null;
};

export function buildActionCardExecutePath(token: string): string {
  const params = new URLSearchParams();
  params.set("token", token);
  return `/api/action-card/execute?${params.toString()}`;
}

export function buildProjectActionPath(target: ProjectActionTarget): string {
  const params = new URLSearchParams();
  params.set("view", "projects");
  params.set("projectId", target.projectId);
  if (target.tab) params.set("tab", target.tab);
  if (target.phaseId) params.set("phaseId", target.phaseId);
  if (target.taskId) params.set("taskId", target.taskId);
  if (target.taskTab) params.set("taskTab", target.taskTab);
  if (target.actionItemId != null && Number.isInteger(target.actionItemId) && target.actionItemId > 0) {
    params.set("actionItemId", String(target.actionItemId));
  }
  return `/?${params.toString()}`;
}

export function buildTaskApprovalActionPath(target: TaskApprovalActionTarget): string {
  const params = new URLSearchParams();
  params.set("projectId", target.projectId);
  params.set("phaseId", target.phaseId);
  params.set("taskId", target.taskId);
  return `/actions/task-approval?${params.toString()}`;
}

export function buildDeliverableReviewActionPath(target: DeliverableReviewActionTarget): string {
  const params = new URLSearchParams();
  params.set("projectId", target.projectId);
  params.set("phaseId", target.phaseId);
  params.set("deliverableName", target.deliverableName);
  return `/actions/deliverable-review?${params.toString()}`;
}

export function buildTaskCompletionActionPath(target: TaskCompletionActionTarget): string {
  const params = new URLSearchParams();
  params.set("projectId", target.projectId);
  params.set("phaseId", target.phaseId);
  params.set("taskId", target.taskId);
  if (target.actionItemId != null && Number.isInteger(target.actionItemId) && target.actionItemId > 0) {
    params.set("actionItemId", String(target.actionItemId));
  }
  return `/actions/task-complete?${params.toString()}`;
}

export function buildIssueValidationActionPath(target: IssueValidationActionTarget): string {
  const params = new URLSearchParams();
  params.set("projectId", target.projectId);
  params.set("phaseId", target.phaseId);
  params.set("issueId", String(target.issueId));
  return `/actions/issue-validation?${params.toString()}`;
}

export function buildTaskAssignmentActionPath(target: TaskAssignmentActionTarget): string {
  const params = new URLSearchParams();
  params.set("projectId", target.projectId);
  params.set("phaseId", target.phaseId);
  params.set("taskId", target.taskId);
  if (target.assigneeUserId != null) params.set("assigneeUserId", String(target.assigneeUserId));
  return `/actions/task-assign?${params.toString()}`;
}

export function toAbsoluteAppUrl(path: string, appBaseUrl?: string | null): string {
  if (!appBaseUrl) return path;
  try {
    return new URL(path, appBaseUrl).toString();
  } catch {
    return path;
  }
}
