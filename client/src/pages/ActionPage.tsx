import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Bug,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  ListChecks,
  Loader2,
  UserCheck,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { isSystemAdminRole } from "@shared/system-roles";
import { buildProjectActionPath } from "@shared/action-links";
import { getTaskEvidenceLevel, type ProjectTemplateLike } from "@shared/npd-v3";
import { resolvePhaseName, resolveProjectTask } from "@shared/sop-template-resolution";
import type { ProjectMemberRole } from "@shared/project-roles";

type ActionKind = "task-approval" | "deliverable-review" | "task-complete" | "issue-validation" | "task-assign";
type Decision = "approved" | "rejected";

type ActionPageProps = {
  kind?: string;
};

type MemberLite = {
  userId: number;
  userName?: string | null;
  userEmail?: string | null;
  mentionName?: string | null;
};

const DECISION_LABEL: Record<Decision, string> = {
  approved: "通过",
  rejected: "驳回",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  none: "border-border bg-secondary text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  approved: "已通过",
  rejected: "已驳回",
  none: "未提交",
};

function currentReturnPath() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

function useActionSearch() {
  const [location] = useLocation();
  return useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, [location]);
}

function memberName(members: MemberLite[], userId?: number | null) {
  if (userId == null) return "未指定";
  const member = members.find((item) => item.userId === userId);
  return member?.userName || member?.mentionName || member?.userEmail || `用户 #${userId}`;
}

function localDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function phaseName(
  project: ProjectTemplateLike,
  phaseId: string,
) {
  return resolvePhaseName(project, phaseId);
}

function taskName(
  project: ProjectTemplateLike,
  phaseId: string,
  taskId: string,
  instructions?: string | null,
) {
  const task = resolveProjectTask(project, taskId, phaseId);
  if (task?.name) return task.name;
  const heading = instructions?.split(/\r?\n/).map((line) => line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1]?.trim()).find(Boolean);
  return heading || taskId;
}

function statusClass(status: string) {
  return STATUS_CLASS[status] ?? STATUS_CLASS.none;
}

function ActionShell({
  children,
  detailPath,
  eyebrow = "行动卡片",
  isLoading = false,
}: {
  children?: React.ReactNode;
  detailPath?: string | null;
  eyebrow?: string;
  isLoading?: boolean;
}) {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center justify-between px-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="返回工作台"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 text-center">
            <div className="text-sm font-medium leading-tight">CE Project Hub</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{eyebrow}</div>
          </div>
          {detailPath ? (
            <button
              type="button"
              onClick={() => navigate(detailPath)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="打开详情"
            >
              <ExternalLink size={17} />
            </button>
          ) : (
            <span className="h-9 w-9" />
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 py-5">
        {isLoading ? (
          <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中...
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  detailPath,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  detailPath?: string | null;
}) {
  const [, navigate] = useLocation();
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        {icon}
      </div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
      {detailPath && (
        <Button type="button" variant="outline" className="mt-5 w-full" onClick={() => navigate(detailPath)}>
          <ExternalLink className="h-4 w-4" />
          打开项目详情
        </Button>
      )}
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-3 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 text-foreground">{value}</div>
    </div>
  );
}

function ActionButtons({
  isPending,
  onApprove,
  onReject,
}: {
  isPending: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Button
        type="button"
        disabled={isPending}
        onClick={onApprove}
        className="h-11 bg-emerald-600 text-white hover:bg-emerald-700"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        通过
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={onReject}
        className="h-11 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
        驳回
      </Button>
    </div>
  );
}

function TaskApprovalAction({
  projectId,
  phaseId,
  taskId,
}: {
  projectId: string;
  phaseId: string;
  taskId: string;
}) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [note, setNote] = useState("");
  const [actedAsRole, setActedAsRole] = useState<ProjectMemberRole | "">("");
  const [completedDecision, setCompletedDecision] = useState<Decision | null>(null);
  const detailPath = buildProjectActionPath({ projectId, tab: "tasks", phaseId, taskId, taskTab: "approval" });

  const projectQuery = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId, staleTime: 5_000 });
  const membersQuery = trpc.members.list.useQuery({ projectId }, { enabled: !!projectId, staleTime: 10_000 });
  const tasksQuery = trpc.tasks.list.useQuery({ projectId, phaseId }, { enabled: !!projectId && !!phaseId, staleTime: 5_000 });
  const myRoleQuery = trpc.members.myRole.useQuery({ projectId }, { enabled: !!projectId, staleTime: 5_000 });

  const project = projectQuery.data;
  const members = membersQuery.data ?? [];
  const task = tasksQuery.data?.find((item) => item.phaseId === phaseId && item.taskId === taskId);
  const status = completedDecision ?? task?.approvalStatus ?? "none";
  const canDecide = status === "pending" && !!user && (task?.approverUserId === user.id || isSystemAdminRole(user.role));

  const decide = trpc.tasks.decideApproval.useMutation({
    onSuccess: async (_result, variables) => {
      setCompletedDecision(variables.decision);
      setNote("");
      toast.success(`审批已${DECISION_LABEL[variables.decision]}`);
      await Promise.all([
        utils.tasks.list.invalidate({ projectId }),
        utils.projects.get.invalidate({ id: projectId }),
        utils.tasks.activity.invalidate({ projectId, phaseId, taskId }),
        utils.workbench.mine.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  if (projectQuery.isLoading || membersQuery.isLoading || tasksQuery.isLoading) {
    return <ActionShell detailPath={detailPath} isLoading />;
  }

  if (!project || !task) {
    return (
      <ActionShell detailPath={detailPath}>
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="没有找到这条审批"
          body="可能是任务已被调整、你没有访问权限，或通知链接已经过期。"
          detailPath={detailPath}
        />
      </ActionShell>
    );
  }

  return (
    <ActionShell detailPath={detailPath} eyebrow="任务审批">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 size={14} />
              明确指派给你的行动项
            </div>
            <h1 className="text-lg font-semibold leading-7">{taskName(project, phaseId, taskId, task.instructions)}</h1>
          </div>
          <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${statusClass(status)}`}>
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>

        <div className="space-y-3 rounded-md border border-border bg-secondary/40 p-3">
          <ContextRow label="项目" value={project.name} />
          <ContextRow label="阶段" value={phaseName(project, phaseId)} />
          <ContextRow label="审批人" value={memberName(members, task.approverUserId)} />
          {task.approvalRequestedBy && (
            <ContextRow label="提交人" value={memberName(members, task.approvalRequestedBy)} />
          )}
          {task.approvalNote && (
            <ContextRow label="批注" value={<span className="text-muted-foreground">「{task.approvalNote}」</span>} />
          )}
        </div>

        {status === "pending" && canDecide && (
          <div className="mt-5 space-y-3">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="审批意见（可选）"
              className="resize-none"
            />
            {(myRoleQuery.data?.roles.length ?? 0) > 1 && (
              <select value={actedAsRole} onChange={(event) => setActedAsRole(event.target.value as ProjectMemberRole | "")} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm">
                <option value="">选择本次签字角色</option>
                {myRoleQuery.data?.roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            )}
            <ActionButtons
              isPending={decide.isPending}
              onApprove={() => decide.mutate({ projectId, phaseId, taskId, decision: "approved", note: note || null, actedAsRole: actedAsRole || undefined })}
              onReject={() => decide.mutate({ projectId, phaseId, taskId, decision: "rejected", note: note || null, actedAsRole: actedAsRole || undefined })}
            />
          </div>
        )}

        {status === "pending" && !canDecide && (
          <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            这条审批正在等待 {memberName(members, task.approverUserId)} 处理。
          </div>
        )}

        {status !== "pending" && (
          <div className="mt-5 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
            这条动作已经闭环，无需重复处理。
          </div>
        )}
      </section>
    </ActionShell>
  );
}

function DeliverableReviewAction({
  projectId,
  phaseId,
  deliverableName,
}: {
  projectId: string;
  phaseId: string;
  deliverableName: string;
}) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [note, setNote] = useState("");
  const [actedAsRole, setActedAsRole] = useState<ProjectMemberRole | "">("");
  const [completedDecision, setCompletedDecision] = useState<Decision | null>(null);
  const detailPath = buildProjectActionPath({ projectId, tab: "reviews", phaseId });

  const projectQuery = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId, staleTime: 5_000 });
  const membersQuery = trpc.members.list.useQuery({ projectId }, { enabled: !!projectId, staleTime: 10_000 });
  const reviewsQuery = trpc.deliverableReviews.list.useQuery({ projectId }, { enabled: !!projectId, staleTime: 5_000 });
  const myRoleQuery = trpc.members.myRole.useQuery({ projectId }, { enabled: !!projectId, staleTime: 5_000 });

  const project = projectQuery.data;
  const members = membersQuery.data ?? [];
  const review = reviewsQuery.data?.find((item) =>
    item.phaseId === phaseId && item.deliverableName === deliverableName
  );
  const status = completedDecision ?? review?.status ?? "none";
  const canDecide = status === "pending" && !!user && (review?.reviewerUserId === user.id || isSystemAdminRole(user.role));

  const decide = trpc.deliverableReviews.review.useMutation({
    onSuccess: async (_result, variables) => {
      setCompletedDecision(variables.decision);
      setNote("");
      toast.success(`审核已${DECISION_LABEL[variables.decision]}`);
      await Promise.all([
        utils.deliverableReviews.list.invalidate({ projectId }),
        utils.deliverableReviews.myPending.invalidate(),
        utils.workbench.mine.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  if (projectQuery.isLoading || membersQuery.isLoading || reviewsQuery.isLoading) {
    return <ActionShell detailPath={detailPath} isLoading />;
  }

  if (!project || !review) {
    return (
      <ActionShell detailPath={detailPath}>
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="没有找到这条审核"
          body="可能是交付物审核已被重置、你没有访问权限，或通知链接已经过期。"
          detailPath={detailPath}
        />
      </ActionShell>
    );
  }

  return (
    <ActionShell detailPath={detailPath} eyebrow="交付物审核">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileCheck2 size={14} />
              明确指派给你的行动项
            </div>
            <h1 className="break-words text-lg font-semibold leading-7">{deliverableName}</h1>
          </div>
          <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${statusClass(status)}`}>
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>

        <div className="space-y-3 rounded-md border border-border bg-secondary/40 p-3">
          <ContextRow label="项目" value={project.name} />
          <ContextRow label="阶段" value={phaseName(project, phaseId)} />
          <ContextRow label="审核人" value={memberName(members, review.reviewerUserId)} />
          <ContextRow label="提交人" value={memberName(members, review.submittedBy)} />
          {review.reviewNote && (
            <ContextRow label="批注" value={<span className="text-muted-foreground">「{review.reviewNote}」</span>} />
          )}
        </div>

        {status === "pending" && canDecide && (
          <div className="mt-5 space-y-3">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="审核意见（可选）"
              className="resize-none"
            />
            {(myRoleQuery.data?.roles.length ?? 0) > 1 && (
              <select value={actedAsRole} onChange={(event) => setActedAsRole(event.target.value as ProjectMemberRole | "")} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm">
                <option value="">选择本次签字角色</option>
                {myRoleQuery.data?.roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            )}
            <ActionButtons
              isPending={decide.isPending}
              onApprove={() => decide.mutate({ projectId, phaseId, deliverableName, decision: "approved", note: note || null, actedAsRole: actedAsRole || undefined })}
              onReject={() => decide.mutate({ projectId, phaseId, deliverableName, decision: "rejected", note: note || null, actedAsRole: actedAsRole || undefined })}
            />
          </div>
        )}

        {status === "pending" && !canDecide && (
          <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            这条审核正在等待 {memberName(members, review.reviewerUserId)} 处理。
          </div>
        )}

        {status !== "pending" && (
          <div className="mt-5 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
            这条动作已经闭环，无需重复处理。
          </div>
        )}
      </section>
    </ActionShell>
  );
}

function TaskCompletionAction({
  projectId,
  phaseId,
  taskId,
}: {
  projectId: string;
  phaseId: string;
  taskId: string;
}) {
  const utils = trpc.useUtils();
  const [submitted, setSubmitted] = useState(false);
  const [note, setNote] = useState("");
  const detailPath = buildProjectActionPath({ projectId, tab: "tasks", phaseId, taskId });

  const projectQuery = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId, staleTime: 5_000 });
  const membersQuery = trpc.members.list.useQuery({ projectId }, { enabled: !!projectId, staleTime: 10_000 });
  const tasksQuery = trpc.tasks.list.useQuery({ projectId, phaseId }, { enabled: !!projectId && !!phaseId, staleTime: 5_000 });

  const project = projectQuery.data;
  const members = membersQuery.data ?? [];
  const task = tasksQuery.data?.find((item) => item.phaseId === phaseId && item.taskId === taskId);
  const status = submitted
    ? task?.requiresApproval ? "pending_approval" : "done"
    : task?.status ?? "todo";
  const alreadyClosed = status === "done" || status === "skipped" || task?.approvalStatus === "pending";
  const evidenceLevel = project ? getTaskEvidenceLevel(project, phaseId, taskId) : "light";

  const complete = trpc.tasks.setCompleted.useMutation({
    onSuccess: async () => {
      setSubmitted(true);
      toast.success(task?.requiresApproval ? "已提交审批" : "任务已完成");
      await Promise.all([
        utils.tasks.list.invalidate({ projectId }),
        utils.projects.get.invalidate({ id: projectId }),
        utils.workbench.mine.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  if (projectQuery.isLoading || membersQuery.isLoading || tasksQuery.isLoading) {
    return <ActionShell detailPath={detailPath} isLoading />;
  }

  if (!project || !task) {
    return (
      <ActionShell detailPath={detailPath}>
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="没有找到这条任务"
          body="可能是任务已被调整、你没有访问权限，或通知链接已经过期。"
          detailPath={detailPath}
        />
      </ActionShell>
    );
  }

  return (
    <ActionShell detailPath={detailPath} eyebrow="任务完成">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <ListChecks size={14} />
              明确指派给你的行动项
            </div>
            <h1 className="text-lg font-semibold leading-7">{taskName(project, phaseId, taskId, task.instructions)}</h1>
          </div>
          <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${
            status === "done" ? STATUS_CLASS.approved :
              status === "pending_approval" || task.approvalStatus === "pending" ? STATUS_CLASS.pending :
                STATUS_CLASS.none
          }`}>
            {status === "done" ? "已完成" : status === "pending_approval" || task.approvalStatus === "pending" ? "待审批" : "待完成"}
          </span>
        </div>

        <div className="space-y-3 rounded-md border border-border bg-secondary/40 p-3">
          <ContextRow label="项目" value={project.name} />
          <ContextRow label="阶段" value={phaseName(project, phaseId)} />
          <ContextRow label="负责人" value={memberName(members, task.assigneeUserId)} />
          {task.dueDate && <ContextRow label="截止" value={task.dueDate} />}
          {task.requiresApproval && <ContextRow label="审批" value={`完成后由 ${memberName(members, task.approverUserId)} 审批`} />}
        </div>

        {!alreadyClosed && evidenceLevel === "light" ? (
          <div className="mt-5 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="completion-note" className="text-xs font-medium text-foreground">
                一句话结论
              </label>
              <Textarea
                id="completion-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="例如：测试通过，关键结论和数据已记录在任务附件中"
                className="resize-none"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>随完成动作一起保存，不需要再写单独日报。</span>
                <span>{note.length}/500</span>
              </div>
            </div>
            <Button
              type="button"
              disabled={complete.isPending}
              onClick={() => complete.mutate({
                projectId,
                phaseId,
                taskId,
                completed: true,
                completionNote: note.trim() || undefined,
              })}
              className="h-11 w-full"
            >
              {complete.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {task.requiresApproval ? "提交完成并发起审批" : "标记完成"}
            </Button>
          </div>
        ) : !alreadyClosed ? (
          <div className="mt-5 space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="text-sm font-medium text-amber-900">这是一项重证据任务</div>
            <p className="text-xs leading-5 text-amber-800">
              请由任务负责人先上传测试报告、设计包或证书，再从任务页顺手标记完成。
            </p>
            <Button asChild className="h-11 w-full">
              <a href={detailPath}>
                <ExternalLink className="h-4 w-4" />
                去任务页上传
              </a>
            </Button>
          </div>
        ) : (
          <div className="mt-5 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
            这条任务已经进入下一状态，无需重复处理。
          </div>
        )}
      </section>
    </ActionShell>
  );
}

function IssueValidationAction({
  projectId,
  phaseId,
  issueId,
}: {
  projectId: string;
  phaseId: string;
  issueId: string;
}) {
  const utils = trpc.useUtils();
  const [localStatus, setLocalStatus] = useState<"closed" | "open" | null>(null);
  const detailPath = buildProjectActionPath({ projectId, tab: "issues", phaseId });

  const projectQuery = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId, staleTime: 5_000 });
  const issuesQuery = trpc.issues.list.useQuery({ projectId, phaseId }, { enabled: !!projectId && !!phaseId, staleTime: 5_000 });
  const issue = issuesQuery.data?.find((item) => String(item.id) === issueId);
  const status = localStatus ?? issue?.status ?? "open";

  const update = trpc.issues.update.useMutation({
    onSuccess: async (_result, variables) => {
      const nextStatus = variables.status === "closed" ? "closed" : "open";
      setLocalStatus(nextStatus);
      toast.success(nextStatus === "closed" ? "复测已通过" : "已重开问题");
      await Promise.all([
        utils.issues.list.invalidate({ projectId }),
        utils.projects.get.invalidate({ id: projectId }),
        utils.workbench.mine.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  if (projectQuery.isLoading || issuesQuery.isLoading) {
    return <ActionShell detailPath={detailPath} isLoading />;
  }

  if (!projectQuery.data || !issue) {
    return (
      <ActionShell detailPath={detailPath}>
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="没有找到这条问题"
          body="可能是问题已被删除、你没有访问权限，或通知链接已经过期。"
          detailPath={detailPath}
        />
      </ActionShell>
    );
  }

  return (
    <ActionShell detailPath={detailPath} eyebrow="问题复测">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bug size={14} />
              明确指派给你的行动项
            </div>
            <h1 className="break-words text-lg font-semibold leading-7">{issue.title}</h1>
          </div>
          <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${
            status === "resolved" ? STATUS_CLASS.pending :
              status === "closed" ? STATUS_CLASS.approved :
                STATUS_CLASS.rejected
          }`}>
            {status === "resolved" ? "待复测" : status === "closed" ? "复测通过" : "未闭环"}
          </span>
        </div>

        <div className="space-y-3 rounded-md border border-border bg-secondary/40 p-3">
          <ContextRow label="项目" value={projectQuery.data.name} />
          <ContextRow label="阶段" value={phaseName(projectQuery.data, phaseId)} />
          <ContextRow label="等级" value={issue.severity} />
          {issue.owner && <ContextRow label="责任人" value={issue.owner} />}
          {issue.solution && <ContextRow label="方案" value={<span className="text-muted-foreground">{issue.solution}</span>} />}
        </div>

        {status === "resolved" ? (
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: Number(issueId), projectId, status: "closed", closedDate: localDateISO() })}
              className="h-11 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              复测通过
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: Number(issueId), projectId, status: "open", closedDate: null })}
              className="h-11 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
            >
              {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              复测失败
            </Button>
          </div>
        ) : (
          <div className="mt-5 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
            这条问题当前不是待复测状态，无需在这里处理。
          </div>
        )}
      </section>
    </ActionShell>
  );
}

function TaskAssignmentAction({
  projectId,
  phaseId,
  taskId,
  suggestedAssigneeUserId,
}: {
  projectId: string;
  phaseId: string;
  taskId: string;
  suggestedAssigneeUserId?: number | null;
}) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [selectedAssigneeId, setSelectedAssigneeId] = useState(suggestedAssigneeUserId ? String(suggestedAssigneeUserId) : "");
  const [assignedTo, setAssignedTo] = useState<number | null>(null);
  const detailPath = buildProjectActionPath({ projectId, tab: "tasks", phaseId, taskId });

  const projectQuery = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId, staleTime: 5_000 });
  const membersQuery = trpc.members.list.useQuery({ projectId }, { enabled: !!projectId, staleTime: 10_000 });
  const tasksQuery = trpc.tasks.list.useQuery({ projectId, phaseId }, { enabled: !!projectId && !!phaseId, staleTime: 5_000 });

  const project = projectQuery.data;
  const members = membersQuery.data ?? [];
  const task = tasksQuery.data?.find((item) => item.phaseId === phaseId && item.taskId === taskId);
  const effectiveAssignee = selectedAssigneeId || (suggestedAssigneeUserId ? String(suggestedAssigneeUserId) : user?.id ? String(user.id) : "");
  const assignedUserId = assignedTo ?? task?.assigneeUserId ?? null;

  const assign = trpc.tasks.setMeta.useMutation({
    onSuccess: async (_result, variables) => {
      setAssignedTo(variables.assigneeUserId ?? null);
      toast.success(`已分派给 ${memberName(members, variables.assigneeUserId)}`);
      await Promise.all([
        utils.tasks.list.invalidate({ projectId }),
        utils.projects.get.invalidate({ id: projectId }),
        utils.workbench.mine.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  if (projectQuery.isLoading || membersQuery.isLoading || tasksQuery.isLoading) {
    return <ActionShell detailPath={detailPath} isLoading />;
  }

  if (!project || !task) {
    return (
      <ActionShell detailPath={detailPath}>
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="没有找到这条任务"
          body="可能是任务已被调整、你没有访问权限，或通知链接已经过期。"
          detailPath={detailPath}
        />
      </ActionShell>
    );
  }

  return (
    <ActionShell detailPath={detailPath} eyebrow="一键分派">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserCheck size={14} />
              明确指派给你的行动项
            </div>
            <h1 className="text-lg font-semibold leading-7">{taskName(project, phaseId, taskId, task.instructions)}</h1>
          </div>
          <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${assignedUserId ? STATUS_CLASS.approved : STATUS_CLASS.pending}`}>
            {assignedUserId ? "已分派" : "待分派"}
          </span>
        </div>

        <div className="space-y-3 rounded-md border border-border bg-secondary/40 p-3">
          <ContextRow label="项目" value={project.name} />
          <ContextRow label="阶段" value={phaseName(project, phaseId)} />
          <ContextRow label="当前" value={memberName(members, assignedUserId)} />
          {task.dueDate && <ContextRow label="截止" value={task.dueDate} />}
        </div>

        <div className="mt-5 space-y-3">
          <select
            value={effectiveAssignee}
            onChange={(event) => setSelectedAssigneeId(event.target.value)}
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
          >
            <option value="">选择负责人</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {memberName(members, member.userId)}
              </option>
            ))}
          </select>
          <Button
            type="button"
            disabled={assign.isPending || !effectiveAssignee}
            onClick={() => assign.mutate({ projectId, phaseId, taskId, assigneeUserId: Number(effectiveAssignee) })}
            className="h-11 w-full"
          >
            {assign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
            分派给 {effectiveAssignee ? memberName(members, Number(effectiveAssignee)) : "负责人"}
          </Button>
        </div>
      </section>
    </ActionShell>
  );
}

function DingtalkAutoLogin({ redirectPath }: { redirectPath: string }) {
  const requestedRef = useRef(false);
  const utils = trpc.useUtils();
  const configQuery = trpc.auth.dingtalkConfig.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const login = trpc.auth.dingtalkLogin.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      if (typeof window !== "undefined") window.location.replace(currentReturnPath());
    },
    onError: () => {
      if (typeof window !== "undefined") window.location.href = redirectPath;
    },
  });

  useEffect(() => {
    if (requestedRef.current || configQuery.isLoading || login.isPending) return;
    if (typeof window === "undefined") return;
    const config = configQuery.data;
    if (!config?.enabled || !config.corpId) {
      window.location.href = redirectPath;
      return;
    }

    requestedRef.current = true;
    void (async () => {
      try {
        await import("dingtalk-jsapi/entry/union");
        const mod = await import("dingtalk-jsapi/api/runtime/permission/requestAuthCode");
        const result = await mod.default({ corpId: config.corpId! });
        if (result.code) login.mutate({ code: result.code });
        else window.location.href = redirectPath;
      } catch {
        window.location.href = redirectPath;
      }
    })();
  }, [configQuery.data, configQuery.isLoading, login, redirectPath]);

  return (
    <ActionShell eyebrow="钉钉免登" isLoading>
      <span />
    </ActionShell>
  );
}

export default function ActionPage({ kind }: ActionPageProps) {
  const redirectPath = useMemo(() => getLoginUrl(currentReturnPath()), []);
  const { loading, isAuthenticated } = useAuth();
  const search = useActionSearch();

  if (loading) {
    return <ActionShell isLoading />;
  }
  if (!isAuthenticated) return <DingtalkAutoLogin redirectPath={redirectPath} />;

  const actionKind = kind as ActionKind;
  const projectId = search.get("projectId") ?? "";
  const phaseId = search.get("phaseId") ?? "";

  if (actionKind === "task-approval") {
    const taskId = search.get("taskId") ?? "";
    const detailPath = projectId && phaseId && taskId
      ? buildProjectActionPath({ projectId, tab: "tasks", phaseId, taskId, taskTab: "approval" })
      : null;
    if (!projectId || !phaseId || !taskId) {
      return (
        <ActionShell detailPath={detailPath}>
          <EmptyState icon={<AlertTriangle size={20} />} title="入口缺少信息" body="这条任务审批链接不完整，无法定位到具体动作。" />
        </ActionShell>
      );
    }
    return <TaskApprovalAction projectId={projectId} phaseId={phaseId} taskId={taskId} />;
  }

  if (actionKind === "deliverable-review") {
    const deliverableName = search.get("deliverableName") ?? "";
    const detailPath = projectId && phaseId
      ? buildProjectActionPath({ projectId, tab: "reviews", phaseId })
      : null;
    if (!projectId || !phaseId || !deliverableName) {
      return (
        <ActionShell detailPath={detailPath}>
          <EmptyState icon={<AlertTriangle size={20} />} title="入口缺少信息" body="这条交付物审核链接不完整，无法定位到具体动作。" />
        </ActionShell>
      );
    }
    return <DeliverableReviewAction projectId={projectId} phaseId={phaseId} deliverableName={deliverableName} />;
  }

  if (actionKind === "task-complete") {
    const taskId = search.get("taskId") ?? "";
    const detailPath = projectId && phaseId && taskId
      ? buildProjectActionPath({ projectId, tab: "tasks", phaseId, taskId })
      : null;
    if (!projectId || !phaseId || !taskId) {
      return (
        <ActionShell detailPath={detailPath}>
          <EmptyState icon={<AlertTriangle size={20} />} title="入口缺少信息" body="这条任务完成链接不完整，无法定位到具体动作。" />
        </ActionShell>
      );
    }
    return <TaskCompletionAction projectId={projectId} phaseId={phaseId} taskId={taskId} />;
  }

  if (actionKind === "issue-validation") {
    const issueId = search.get("issueId") ?? "";
    const detailPath = projectId && phaseId
      ? buildProjectActionPath({ projectId, tab: "issues", phaseId })
      : null;
    if (!projectId || !phaseId || !issueId || Number.isNaN(Number(issueId))) {
      return (
        <ActionShell detailPath={detailPath}>
          <EmptyState icon={<AlertTriangle size={20} />} title="入口缺少信息" body="这条问题复测链接不完整，无法定位到具体动作。" />
        </ActionShell>
      );
    }
    return <IssueValidationAction projectId={projectId} phaseId={phaseId} issueId={issueId} />;
  }

  if (actionKind === "task-assign") {
    const taskId = search.get("taskId") ?? "";
    const rawAssignee = search.get("assigneeUserId");
    const assigneeUserId = rawAssignee && !Number.isNaN(Number(rawAssignee)) ? Number(rawAssignee) : null;
    const detailPath = projectId && phaseId && taskId
      ? buildProjectActionPath({ projectId, tab: "tasks", phaseId, taskId })
      : null;
    if (!projectId || !phaseId || !taskId) {
      return (
        <ActionShell detailPath={detailPath}>
          <EmptyState icon={<AlertTriangle size={20} />} title="入口缺少信息" body="这条任务分派链接不完整，无法定位到具体动作。" />
        </ActionShell>
      );
    }
    return (
      <TaskAssignmentAction
        projectId={projectId}
        phaseId={phaseId}
        taskId={taskId}
        suggestedAssigneeUserId={assigneeUserId}
      />
    );
  }

  return (
    <ActionShell>
      <EmptyState
        icon={<AlertTriangle size={20} />}
        title="暂不支持的动作"
        body="这类卡片动作还没有接入移动闭环，请先从项目详情处理。"
      />
    </ActionShell>
  );
}
