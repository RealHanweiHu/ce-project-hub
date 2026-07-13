// 千人千面面板：管理层看决策，PM 看异常，我的视角看待办。
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toLocalISODate, localISODatePlus } from "@/lib/utils";
import { TaskListView, taskProjectLike, type TaskRow, type TaskFocus } from "../TaskListView";
import { resolvePhaseName, resolveTaskName } from "@shared/sop-template-resolution";
import { MANAGEMENT_VALIDATION_PHASES } from "@shared/management-kpis";
import type { TaskStatus, TaskPriority } from "@shared/const";
import { isProjectedOverdue, type RagLevel } from "@shared/health";
import {
  buildTodayItems, buildCoordinationQueue, projectHeadlineMetric,
  type TodayItem, type CoordItem,
} from "@shared/pm-workbench";
import {
  AlertTriangle, Ban, Bug, CalendarClock, CheckCircle2, ChevronRight,
  ClipboardCheck, Clock, Cpu, FileCheck, Flag, Handshake, Inbox, ListChecks,
  PackageCheck, Rocket, ShieldCheck, UserMinus, Wrench,
} from "lucide-react";
import type { PortfolioTableRow } from "./PortfolioTable";
import type { RoleDashboardLens } from "@shared/role-dashboard";

export type Lens = RoleDashboardLens;

type ScoredRow = { row: PortfolioTableRow; level: RagLevel; reasons: string[] };
const MANAGEMENT_VALIDATION_PHASE_SET = new Set<string>(MANAGEMENT_VALIDATION_PHASES);

const overdue = (r: PortfolioTableRow) => isProjectedOverdue(r.projectedEnd, r.targetDate);
const byDue = (a: PortfolioTableRow, b: PortfolioTableRow) => (a.gateDueDate ?? "9999").localeCompare(b.gateDueDate ?? "9999");

function scoreRow(row: PortfolioTableRow): ScoredRow {
  return { row, level: row.ragLevel, reasons: row.ragReasons };
}

export function PerspectivePanel({ lens, rows, onSelectProject }: { lens: Lens; rows: PortfolioTableRow[]; onSelectProject: (id: string, focus?: TaskFocus) => void }) {
  const { user } = useAuth();
  const { data: workbench, isLoading: workbenchLoading, refetch: refetchWorkbench } = trpc.workbench.mine.useQuery();
  const scored = useMemo(() => rows.map(scoreRow), [rows]);

  if (lens === "exec") {
    return <ExecutiveDecisionBoard rows={rows} scored={scored} onSelectProject={onSelectProject} />;
  }

  if (lens === "project_manager") {
    return (
      <ProjectManagerCockpit
        myRows={rows.filter((r) => r.pmUserId === user?.id || r.myRole === "project_manager")}
        tasks={workbench?.tasks ?? []}
        roleTasks={workbench?.roleTasks ?? []}
        reviews={workbench?.reviews ?? []}
        onSelectProject={onSelectProject}
      />
    );
  }

  if (lens === "product_manager") {
    return (
      <ProductManagerWorkbench
        rows={rows.filter((r) => r.myRole === "pm")}
        tasks={workbench?.tasks ?? []}
        roleTasks={workbench?.roleTasks ?? []}
        issues={workbench?.issues ?? []}
        onSelectProject={onSelectProject}
      />
    );
  }

  return <RoleWorkbench lens={lens} workbench={workbench} isLoading={workbenchLoading} onRefetch={() => refetchWorkbench()} onSelectProject={onSelectProject} />;
}

function ExecutiveDecisionBoard({
  rows,
  scored,
  onSelectProject,
}: {
  rows: PortfolioTableRow[];
  scored: ScoredRow[];
  onSelectProject: (id: string) => void;
}) {
  const redYellow = scored
    .filter((s) => s.level !== "green")
    .sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  const pendingGates = rows
    .filter((r) => !r.gateDone && (r.gateReady || r.gateBlockers > 0 || r.gateDueDate))
    .sort(byDue);
  const forceRelease = rows
    .filter((r) => r.releaseDecision === "conditional")
    .sort((a, b) => b.releaseHardBlockers - a.releaseHardBlockers);
  const majorIssues = rows
    .filter((r) => r.criticalIssues > 0)
    .sort((a, b) => b.criticalIssues - a.criticalIssues);
  const delayRisk = rows
    .filter(overdue)
    .sort((a, b) => (a.projectedEnd ?? "").localeCompare(b.projectedEnd ?? ""));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="Gate 评审入口" icon={<ClipboardCheck size={15} />}>
          <DecisionRows
            rows={pendingGates.slice(0, 6)}
            empty="暂无待评审 Gate"
            onSelectProject={onSelectProject}
            renderMeta={(r) => (
              <>
                <Tag tone={r.gateReady ? "emerald" : r.gateNotReady === "red" ? "rose" : "amber"}>
                  {r.gateReady ? "材料就绪" : `${r.gateBlockers} 项缺口`}
                </Tag>
                {r.deliverableGap > 0 && <Tag tone="amber">交付物缺 {r.deliverableGap}</Tag>}
                {r.gateDueDate && <Tag tone="stone">{r.gateDueDate}</Tag>}
              </>
            )}
            renderDetail={(r) => r.gateReady ? "评审材料已齐，可以进入结论页" : "先看缺项、风险与补齐责任人"}
          />
        </Panel>

        <Panel title="强制发布判断" icon={<Rocket size={15} />}>
          <DecisionRows
            rows={forceRelease.slice(0, 6)}
            empty="暂无有条件发布项目"
            onSelectProject={onSelectProject}
            renderMeta={(r) => (
              <>
                <Tag tone={r.releaseHardBlockers > 0 ? "rose" : "amber"}>
                  硬卡 {r.releaseHardBlockers > 0 ? `缺 ${r.releaseHardBlockers}` : "满足"}
                </Tag>
                <Tag tone="stone">交付物 {r.releaseDeliverableDone}/{r.releaseDeliverableTotal}</Tag>
              </>
            )}
            renderDetail={(r) => r.releaseConditions ? `条件：${r.releaseConditions}` : "需明确例外风险、跟进责任人与截止日"}
          />
        </Panel>

        <Panel title="红黄项目" icon={<AlertTriangle size={15} />}>
          <ScoredRows rows={redYellow.slice(0, 6)} onSelectProject={onSelectProject} />
        </Panel>

        <Panel title="重大问题与延期" icon={<Bug size={15} />}>
          <DecisionRows
            rows={[...majorIssues, ...delayRisk.filter((r) => !majorIssues.some((m) => m.id === r.id))].slice(0, 6)}
            empty="暂无重大问题或延期项目"
            onSelectProject={onSelectProject}
            renderMeta={(r) => (
              <>
                {r.criticalIssues > 0 && <Tag tone="rose">P0/P1 {r.criticalIssues}</Tag>}
                {overdue(r) && <Tag tone="rose">预计晚于目标</Tag>}
                {r.pmName && <Tag tone="stone">PM {r.pmName}</Tag>}
              </>
            )}
            renderDetail={(r) => r.criticalIssues > 0 ? "只展示摘要和责任人，进入项目后再看细节" : `预计完成 ${r.projectedEnd || "未排期"}`}
          />
        </Panel>
      </div>
    </div>
  );
}

const TODAY_ICON: Record<TodayItem["kind"], React.ReactNode> = {
  task: <ListChecks size={14} />,
  gate: <Flag size={14} />,
  risk: <AlertTriangle size={14} />,
};
const COORD_ICON: Record<CoordItem["kind"], React.ReactNode> = {
  review: <FileCheck size={14} />,
  issue: <Bug size={14} />,
  unassigned: <UserMinus size={14} />,
  deliverable: <ClipboardCheck size={14} />,
  gateBlocker: <Flag size={14} />,
  blocked: <Ban size={14} />,
};

function ProjectManagerCockpit({ myRows, tasks, roleTasks, reviews, onSelectProject }: {
  myRows: PortfolioTableRow[];
  tasks: MyTaskApiRow[];
  roleTasks: MyTaskApiRow[];
  reviews: WorkbenchReview[];
  onSelectProject: (id: string, focus?: TaskFocus) => void;
}) {
  const today = toLocalISODate();
  const todayItems = useMemo(() => buildTodayItems([...tasks, ...roleTasks], myRows, today), [tasks, roleTasks, myRows, today]);
  const coordItems = useMemo(() => buildCoordinationQueue(reviews, myRows), [reviews, myRows]);

  if (myRows.length === 0) {
    return (
      <Panel title="项目经理驾驶舱" icon={<ListChecks size={15} />}>
        <div className="text-sm text-muted-foreground">你当前不是任何项目的项目经理。</div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel title="TODAY · 项目推进" icon={<CalendarClock size={15} />}>
        {todayItems.length === 0 ? (
          <div className="text-sm text-muted-foreground">今天没有紧急事项。</div>
        ) : (
          <div className="divide-y divide-border">
              {todayItems.slice(0, 10).map((item) => (
                <ActionRow key={item.key} icon={TODAY_ICON[item.kind]} title={item.title} detail={item.detail}
                tag={item.tag} tone={item.tone} onClick={() => onSelectProject(item.projectId, item.kind === 'risk' ? { tab: 'issues' } : undefined)} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="待我协调 / 推动" icon={<Inbox size={15} />}>
          {coordItems.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无待你协调或拍板的事项。</div>
          ) : (
            <div className="divide-y divide-border">
              {coordItems.slice(0, 10).map((item) => (
                <ActionRow key={item.key} icon={COORD_ICON[item.kind]} title={item.title} detail={item.detail}
                  tag={item.tag} tone={item.tone} onClick={() => onSelectProject(item.projectId, item.kind === 'issue' ? { tab: 'issues' } : undefined)} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="我负责的项目" icon={<ListChecks size={15} />}>
          <div className="divide-y divide-border">
            {myRows.map((r) => {
              const metric = projectHeadlineMetric(r);
              return (
                <button key={r.id} onClick={() => onSelectProject(r.id)}
                  className="-mx-2 w-full px-2 py-2.5 text-left transition-colors hover:bg-secondary">
                  <div className="flex items-center gap-3">
                    <HealthDot row={r} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{r.name}</div>
                      <div className="num truncate text-[10px] text-muted-foreground">
                        {resolvePhaseName(r, r.currentPhase)}
                      </div>
                    </div>
                    {metric && <Tag tone={metric.tone}>{metric.label}</Tag>}
                    <ChevronRight size={13} className="shrink-0 text-muted-foreground" />
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ActionRow({ icon, title, detail, tag, tone, onClick }: {
  icon: React.ReactNode; title: string; detail: string; tag: string;
  tone: "rose" | "amber" | "emerald" | "stone"; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="-mx-2 w-full px-2 py-2.5 text-left transition-colors hover:bg-secondary">
      <div className="flex items-start gap-3">
        <span className="mt-0.5" style={{ color: tone === "rose" ? "var(--destructive)" : tone === "amber" ? "var(--warning)" : "var(--muted-foreground)" }}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{title}</span>
            <Tag tone={tone}>{tag}</Tag>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</div>
        </div>
        <ChevronRight size={13} className="mt-1 shrink-0 text-muted-foreground" />
      </div>
    </button>
  );
}

type MyTaskApiRow = {
  id: number; projectId: string; phaseId: string; taskId: string;
  projectName: string; projectNumber: string; projectCategory: string;
  sopTemplateVersion?: string | null; customFields?: unknown;
  status: string; priority: string | null; dueDate: string | null;
  assigneeUserId: number | null; completed: boolean;
  instructions?: string | null;
  visibleRoles?: string[] | null;
};

type WorkbenchRole = {
  projectId: string; projectName: string; projectNumber: string; category: string;
  currentPhase: string; targetDate: string | null; role: string; pmUserId: number | null;
};
type WorkbenchReview = {
  id: number; projectId: string; phaseId: string; deliverableName: string; status: string;
  submittedAt: string | Date; projectName: string; projectNumber: string;
};
type WorkbenchIssue = {
  id: number; projectId: string; phaseId: string; title: string; severity: string; status: string;
  category: string; owner: string | null; reporter: string | null; targetDate: string | null;
  relatedTaskId: string | null; projectName: string; projectNumber: string;
};
type WorkbenchGateBlocker = {
  id: number; projectId: string; phaseId: string; blockerType: "quality" | "npi"; title: string;
  description: string | null; status: "open" | "resolved"; createdAt: string | Date;
  projectName: string; projectNumber: string;
};
type WorkbenchActionItem = {
  id: number; kind: string; projectId: string; entityType: string; entityId: string;
  title: string; body: string | null; actionUrl: string; status: string; priority: string;
  dueAt: string | Date | null; snoozedUntil: string | Date | null;
  createdAt: string | Date; metadata: Record<string, unknown> | null;
};
type WorkbenchData = {
  systemRole: string;
  roles: WorkbenchRole[];
  /** 设计4 §6：服务端三桶分类（与钉钉摘要共用）。 */
  buckets?: {
    now: import('@shared/my-work').MyWorkItem[];
    waiting: import('@shared/my-work').MyWorkItem[];
    watching: import('@shared/my-work').MyWorkItem[];
  };
  tasks: MyTaskApiRow[];
  actionItems: WorkbenchActionItem[];
  snoozedActionItems: WorkbenchActionItem[];
  roleTasks: MyTaskApiRow[];
  reviews: WorkbenchReview[];
  issues: WorkbenchIssue[];
  gateBlockers: WorkbenchGateBlocker[];
  portfolio: PortfolioTableRow[];
  admin: null | {
    rulesTotal: number; rulesEnabled: number; recentRuns: number; failedRuns: number;
    usersTotal: number; customFields: number;
  };
};
type QueueItem = {
  key: string;
  projectId: string;
  phaseId?: string;
  taskId?: string;
  tab?: TaskFocus["tab"];
  taskTab?: TaskFocus["taskTab"];
  title: string;
  detail: string;
  tag: string;
  tone: "rose" | "amber" | "emerald" | "stone";
  priority: number;
  icon: React.ReactNode;
};

function RoleWorkbench({ lens, workbench, isLoading, onRefetch, onSelectProject }: {
  lens: Lens; workbench?: WorkbenchData; isLoading: boolean; onRefetch: () => void; onSelectProject: (id: string, focus?: TaskFocus) => void;
}) {
  const tasks = workbench?.tasks ?? [];
  const roleTasks = workbench?.roleTasks ?? [];
  const reviews = workbench?.reviews ?? [];
  const issues = workbench?.issues ?? [];
  const actionItems = workbench?.actionItems ?? [];
  const snoozedActionItems = workbench?.snoozedActionItems ?? [];
  const gateBlockers = workbench?.gateBlockers ?? [];
  const portfolio = workbench?.portfolio ?? [];
  const queue = useMemo(() => buildWorkbenchQueue(tasks, roleTasks, reviews, issues, actionItems), [tasks, roleTasks, reviews, issues, actionItems]);
  const rows: TaskRow[] = mergeTasks(tasks, roleTasks).map((t) => ({
    id: t.id, projectId: t.projectId, phaseId: t.phaseId, taskId: t.taskId,
    projectName: t.projectName, projectNumber: t.projectNumber, projectCategory: t.projectCategory,
    sopTemplateVersion: t.sopTemplateVersion, customFields: t.customFields,
    status: t.status as TaskStatus, priority: (t.priority ?? "medium") as TaskPriority,
    dueDate: t.dueDate ? String(t.dueDate) : null, assigneeUserId: t.assigneeUserId ?? null, completed: t.completed,
  }));

  if (isLoading && !workbench) {
    return (
      <Panel title="我的工作台" icon={<Inbox size={15} />}>
        <div className="text-sm text-muted-foreground">正在聚合你的任务、审核、质量和提醒...</div>
      </Panel>
    );
  }

  if (lens === "quality") {
    return <QualityWorkbench tasks={tasks} roleTasks={roleTasks} reviews={reviews} issues={issues} gateBlockers={gateBlockers} onSelectProject={onSelectProject} />;
  }
  if (lens === "npi") {
    return <NpiWorkbench tasks={tasks} roleTasks={roleTasks} issues={issues} gateBlockers={gateBlockers} portfolio={portfolio} onSelectProject={onSelectProject} />;
  }
  if (lens === "engineering") {
    return <EngineeringWorkbench roles={workbench?.roles ?? []} tasks={tasks} roleTasks={roleTasks} issues={issues} onSelectProject={onSelectProject} />;
  }
  if (lens === "sales") {
    return <SalesWorkbench portfolio={portfolio} tasks={tasks} roleTasks={roleTasks} onSelectProject={onSelectProject} />;
  }
  if (lens === "external") {
    return <ExternalWorkbench portfolio={portfolio} onSelectProject={onSelectProject} />;
  }

  // 设计4 §6："我的工作"三桶——现在处理（服务端分桶 + 富交互行）/ 等待别人 / 仅关注
  const buckets = workbench?.buckets ?? null;
  return (
    <div className="space-y-4">
      <Panel title="🔥 现在处理" icon={<Inbox size={15} />}>
        {buckets ? (
          buckets.now.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无需要你处理的事项。</div>
          ) : (
            <div className="divide-y divide-border">
              {buckets.now.slice(0, 12).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="w-full py-2 text-left text-sm flex items-center gap-2 hover:bg-secondary/60 rounded"
                  onClick={() => item.projectId && onSelectProject(item.projectId, item.taskId ? { tab: 'tasks', phaseId: item.phaseId ?? undefined, taskId: item.taskId } as never : undefined)}
                >
                  <span className={`shrink-0 text-[10px] rounded px-1 border ${item.rank >= 30 ? 'border-[color:var(--destructive)] text-[color:var(--destructive)]' : 'border-border text-muted-foreground'}`}>
                    {item.rank >= 40 ? '逾期' : item.rank >= 30 ? '今日' : item.kind === 'task' ? '任务' : '待办'}
                  </span>
                  <span className="truncate text-foreground">{item.title}</span>
                  {item.dueDate && <span className="shrink-0 text-[11px] num text-muted-foreground">{item.dueDate}</span>}
                </button>
              ))}
            </div>
          )
        ) : (
          /* 服务端分桶未返回时回退旧队列，避免空白 */
          <QueueRows items={queue.slice(0, 10)} onSelectProject={onSelectProject} />
        )}
      </Panel>

      {buckets && buckets.waiting.length > 0 && (
        <Panel title="⏳ 等待别人" icon={<Clock size={15} />}>
          <div className="divide-y divide-border">
            {buckets.waiting.slice(0, 8).map((item) => (
              <button
                key={item.key}
                type="button"
                className="w-full py-2 text-left text-xs text-muted-foreground hover:text-foreground flex items-center gap-2"
                onClick={() => item.projectId && onSelectProject(item.projectId, item.taskId ? { tab: 'tasks', phaseId: item.phaseId ?? undefined, taskId: item.taskId } as never : undefined)}
              >
                <span className="truncate">{item.title}</span>
                <span className="shrink-0 text-[10px] rounded px-1 border border-border">球在别人那</span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      {buckets && buckets.watching.length > 0 && (
        <Panel title="👀 仅关注" icon={<Clock size={15} />}>
          <SnoozedRows items={snoozedActionItems.slice(0, 6)} onSelectProject={onSelectProject} />
        </Panel>
      )}

      <div className="overflow-hidden rounded-[10px] border border-border">
        <TaskListView tasks={rows} isLoading={isLoading} emptyIcon={<CheckCircle2 size={24} />}
          emptyTitle="没有待办任务" emptyDesc="当前没有指派给您的未完成任务。"
          onRefetch={onRefetch} onNavigateToProject={onSelectProject} showOverdueBadge />
      </div>
    </div>
  );
}

function mergeTasks(...groups: MyTaskApiRow[][]): MyTaskApiRow[] {
  const byId = new Map<number, MyTaskApiRow>();
  for (const task of groups.flat()) byId.set(task.id, task);
  return Array.from(byId.values());
}

function makeTaskItems(tasks: MyTaskApiRow[], tag: string, priorityBoost = 0): QueueItem[] {
  return tasks.map((task) => ({
    key: `task-${tag}-${task.id}`,
    projectId: task.projectId,
    phaseId: task.phaseId,
    taskId: task.taskId,
    tab: "tasks",
    title: resolveTaskName(taskProjectLike(task), task.taskId, task.phaseId),
    detail: `${task.projectName} · ${task.dueDate ? `截止 ${task.dueDate}` : "未设截止日"}`,
    tag,
    tone: task.status === "blocked" ? "rose" : task.assigneeUserId == null ? "amber" : "stone",
    priority: priorityBoost + (task.status === "blocked" ? 100 : 0) + priorityScore(task.priority) + (task.dueDate ? dueScore(task.dueDate) : 0),
    icon: task.status === "blocked" ? <Ban size={14} /> : <ListChecks size={14} />,
  } satisfies QueueItem));
}

function makeIssueItems(issues: WorkbenchIssue[], tagForResolved = "待复测"): QueueItem[] {
  return issues.map((issue) => ({
    key: `issue-${issue.id}`,
    projectId: issue.projectId,
    phaseId: issue.phaseId,
    tab: "issues",
    title: issue.title,
    detail: `${issue.projectName} · ${issue.owner ? `责任人 ${issue.owner}` : issue.targetDate ? `目标 ${issue.targetDate}` : "质量关注项"}`,
    tag: issue.status === "resolved" ? tagForResolved : `${issue.severity} Issue`,
    tone: issue.status === "resolved" ? "amber" : issue.severity === "P0" || issue.severity === "P1" ? "rose" : "stone",
    priority: issue.status === "resolved" ? 95 : issue.severity === "P0" ? 98 : issue.severity === "P1" ? 88 : 45,
    icon: <Bug size={14} />,
  } satisfies QueueItem));
}

function makeReviewItems(reviews: WorkbenchReview[]): QueueItem[] {
  return reviews.map((review) => ({
    key: `review-${review.id}`,
    projectId: review.projectId,
    phaseId: review.phaseId,
    tab: "reviews",
    title: review.deliverableName,
    detail: `${review.projectName} · 交付物待审核`,
    tag: "审核",
    tone: "amber",
    priority: 92,
    icon: <FileCheck size={14} />,
  } satisfies QueueItem));
}

function makeActionItemItems(actionItems: WorkbenchActionItem[]): QueueItem[] {
  return actionItems.map((item) => {
    const target = targetFromActionItem(item);
    return {
      key: `action-${item.id}`,
      projectId: item.projectId,
      phaseId: target.phaseId,
      taskId: target.taskId,
      tab: target.tab,
      taskTab: target.taskTab,
      title: item.title,
      detail: item.body || "需要你处理的行动项",
      tag: actionItemTag(item.kind),
      tone: item.priority === "critical" ? "rose" : "amber",
      priority: 120 + (item.priority === "critical" ? 20 : item.priority === "high" ? 10 : 0),
      icon: item.kind.startsWith("deliverable") ? <FileCheck size={14} /> : <ClipboardCheck size={14} />,
    } satisfies QueueItem;
  });
}

function actionItemTag(kind: string) {
  if (kind === "task_approval") return "审批";
  if (kind === "task_rework") return "返工";
  if (kind === "deliverable_review") return "审核";
  if (kind === "deliverable_rework") return "交付物返工";
  if (kind === "critical_issue") return "P0/P1";
  return "行动项";
}

function targetFromActionItem(item: WorkbenchActionItem): Pick<QueueItem, "phaseId" | "taskId" | "tab" | "taskTab"> {
  const meta = item.metadata ?? {};
  const phaseFromMeta = typeof meta.phaseId === "string" ? meta.phaseId : undefined;
  const taskFromMeta = typeof meta.taskId === "string" ? meta.taskId : undefined;
  const urlTarget = targetFromUrl(item.actionUrl);
  const fallbackTab: TaskFocus["tab"] =
    item.kind.startsWith("task_") ? "tasks" :
      item.kind.startsWith("deliverable_") ? "reviews" :
        item.kind === "critical_issue" ? "issues" : undefined;
  return {
    phaseId: phaseFromMeta ?? urlTarget.phaseId,
    taskId: taskFromMeta ?? urlTarget.taskId,
    tab: urlTarget.tab ?? fallbackTab,
    taskTab: urlTarget.taskTab ?? (item.kind.startsWith("task_") ? "approval" : undefined),
  };
}

function targetFromUrl(actionUrl: string): Pick<QueueItem, "phaseId" | "taskId" | "tab" | "taskTab"> {
  try {
    const url = new URL(actionUrl, window.location.origin);
    const tab = url.searchParams.get("tab") as TaskFocus["tab"] | null;
    const taskTab = url.searchParams.get("taskTab") as TaskFocus["taskTab"] | null;
    return {
      phaseId: url.searchParams.get("phaseId") ?? undefined,
      taskId: url.searchParams.get("taskId") ?? undefined,
      tab: tab ?? undefined,
      taskTab: taskTab ?? undefined,
    };
  } catch {
    return {};
  }
}

function makeBlockerItems(blockers: WorkbenchGateBlocker[], type?: "quality" | "npi"): QueueItem[] {
  return blockers
    .filter((blocker) => !type || blocker.blockerType === type)
    .map((blocker) => ({
      key: `blocker-${blocker.id}`,
      projectId: blocker.projectId,
      phaseId: blocker.phaseId,
      title: blocker.title,
      detail: `${blocker.projectName} · ${blocker.phaseId.toUpperCase()} Gate 阻断项`,
      tag: blocker.blockerType === "quality" ? "QA阻断" : "NPI阻断",
      tone: "rose",
      priority: blocker.blockerType === "quality" ? 96 : 94,
      icon: <Flag size={14} />,
    } satisfies QueueItem));
}

function QualityWorkbench({ tasks, roleTasks, reviews, issues, gateBlockers, onSelectProject }: {
  tasks: MyTaskApiRow[]; roleTasks: MyTaskApiRow[]; reviews: WorkbenchReview[];
  issues: WorkbenchIssue[]; gateBlockers: WorkbenchGateBlocker[];
  onSelectProject: (id: string, focus?: TaskFocus) => void;
}) {
  const qualityTasks = mergeTasks(tasks, roleTasks).filter((task) =>
    MANAGEMENT_VALIDATION_PHASE_SET.has(task.phaseId) || /test|qa|quality|cert|battery|safety|report/i.test(`${task.taskId} ${task.instructions ?? ""}`)
  );
  const closureIssues = issues.filter((issue) =>
    issue.status === "resolved" || issue.severity === "P0" || issue.severity === "P1" ||
    ["reliability", "safety", "performance", "thermal"].includes(issue.category)
  );
  const queue = [
    ...makeBlockerItems(gateBlockers, "quality"),
    ...makeIssueItems(closureIssues),
    ...makeReviewItems(reviews),
    ...makeTaskItems(qualityTasks, "测试任务", 8),
  ].sort((a, b) => b.priority - a.priority);

  return (
    <div className="space-y-4">
      <MetricStrip items={[
        { label: "待复测 Issue", value: issues.filter((issue) => issue.status === "resolved").length, tone: "amber" },
        { label: "P0/P1 开放", value: issues.filter((issue) => issue.status !== "resolved" && (issue.severity === "P0" || issue.severity === "P1")).length, tone: "rose" },
        { label: "待审报告", value: reviews.length, tone: "amber" },
        { label: "QA 阻断", value: gateBlockers.filter((blocker) => blocker.blockerType === "quality").length, tone: "rose" },
      ]} />
      <Panel title="质量 / 测试行动队列" icon={<ShieldCheck size={15} />}>
        <QueueRows items={queue.slice(0, 12)} onSelectProject={onSelectProject} />
      </Panel>
      <Panel title="验证 / EVT / DVT / PVT 测试与报告" icon={<ClipboardCheck size={15} />}>
        <QueueRows items={makeTaskItems(qualityTasks, "测试交付").slice(0, 8)} onSelectProject={onSelectProject} />
      </Panel>
    </div>
  );
}

function NpiWorkbench({ tasks, roleTasks, issues, gateBlockers, portfolio, onSelectProject }: {
  tasks: MyTaskApiRow[]; roleTasks: MyTaskApiRow[]; issues: WorkbenchIssue[];
  gateBlockers: WorkbenchGateBlocker[]; portfolio: PortfolioTableRow[];
  onSelectProject: (id: string, focus?: TaskFocus) => void;
}) {
  const npiTasks = mergeTasks(tasks, roleTasks).filter((task) =>
    ["pvt", "mp"].includes(task.phaseId) || /sop|fixture|process|trial|pilot|manufactur|npi|pvt|mp/i.test(`${task.taskId} ${task.instructions ?? ""}`)
  );
  const readinessRows = portfolio
    .filter((row) => ["pvt", "mp"].includes(row.currentPhase) || row.releaseHardBlockers > 0 || row.deliverableGap > 0)
    .sort((a, b) => b.releaseHardBlockers - a.releaseHardBlockers || b.deliverableGap - a.deliverableGap);
  const queue = [
    ...makeBlockerItems(gateBlockers, "npi"),
    ...makeTaskItems(npiTasks, "NPI任务", 10),
    ...makeIssueItems(issues.filter((issue) => ["P0", "P1"].includes(issue.severity) || ["mechanical", "hardware", "reliability"].includes(issue.category)), "待确认"),
  ].sort((a, b) => b.priority - a.priority);

  return (
    <div className="space-y-4">
      <MetricStrip items={[
        { label: "PVT/MP 项目", value: readinessRows.length, tone: readinessRows.length ? "amber" : "stone" },
        { label: "NPI 阻断", value: gateBlockers.filter((blocker) => blocker.blockerType === "npi").length, tone: "rose" },
        { label: "工艺任务", value: npiTasks.length, tone: "amber" },
        { label: "发布硬卡", value: readinessRows.reduce((sum, row) => sum + row.releaseHardBlockers, 0), tone: "rose" },
      ]} />
      <Panel title="PE / NPI 行动队列" icon={<Wrench size={15} />}>
        <QueueRows items={queue.slice(0, 12)} onSelectProject={onSelectProject} />
      </Panel>
      <Panel title="PVT / MP Readiness" icon={<PackageCheck size={15} />}>
        <DecisionRows
          rows={readinessRows.slice(0, 8)}
          empty="暂无 PVT/MP readiness 风险"
          onSelectProject={onSelectProject}
          renderMeta={(row) => (
            <>
              {row.releaseHardBlockers > 0 && <Tag tone="rose">硬卡 {row.releaseHardBlockers}</Tag>}
              {row.deliverableGap > 0 && <Tag tone="amber">交付物缺 {row.deliverableGap}</Tag>}
              <Tag tone="stone">{resolvePhaseName(row, row.currentPhase)}</Tag>
            </>
          )}
          renderDetail={(row) => row.releaseConditions || `Gate ${row.releaseGateName ?? row.gateName ?? "未定义"} · MP 准备状态`}
        />
      </Panel>
    </div>
  );
}

function EngineeringWorkbench({ roles, tasks, roleTasks, issues, onSelectProject }: {
  roles: WorkbenchRole[]; tasks: MyTaskApiRow[]; roleTasks: MyTaskApiRow[];
  issues: WorkbenchIssue[]; onSelectProject: (id: string, focus?: TaskFocus) => void;
}) {
  const roleSet = new Set(roles.map((role) => role.role));
  const categories = roleSet.has("rd_mech") ? ["mechanical", "reliability"] :
    roleSet.has("rd_sw") ? ["software", "performance"] :
    roleSet.has("battery_safety") ? ["safety", "thermal", "hardware"] :
    ["hardware", "thermal", "performance", "safety"];
  const engineeringIssues = issues.filter((issue) => categories.includes(issue.category) || issue.severity === "P0" || issue.severity === "P1");
  const designTasks = mergeTasks(tasks, roleTasks);
  const queue = [
    ...makeIssueItems(engineeringIssues, "待验证"),
    ...makeTaskItems(designTasks, roleTasks.length ? "角色任务" : "设计任务", 6),
  ].sort((a, b) => b.priority - a.priority);
  const icon = roleSet.has("rd_mech") ? <Wrench size={15} /> : <Cpu size={15} />;

  return (
    <div className="space-y-4">
      <MetricStrip items={[
        { label: "设计任务", value: designTasks.length, tone: "amber" },
        { label: "EVT/DVT 问题", value: engineeringIssues.length, tone: engineeringIssues.some((issue) => issue.severity === "P0" || issue.severity === "P1") ? "rose" : "amber" },
        { label: "未分配角色任务", value: roleTasks.length, tone: roleTasks.length ? "amber" : "stone" },
        { label: "阻塞任务", value: designTasks.filter((task) => task.status === "blocked").length, tone: "rose" },
      ]} />
      <Panel title="工程研发行动队列" icon={icon}>
        <QueueRows items={queue.slice(0, 12)} onSelectProject={onSelectProject} />
      </Panel>
    </div>
  );
}

function ProductManagerWorkbench({ rows, tasks, roleTasks, issues, onSelectProject }: {
  rows: PortfolioTableRow[]; tasks: MyTaskApiRow[]; roleTasks: MyTaskApiRow[]; issues: WorkbenchIssue[];
  onSelectProject: (id: string, focus?: TaskFocus) => void;
}) {
  const productTasks = mergeTasks(tasks, roleTasks).filter((task) => /prd|require|spec|product|pd_|cost|benchmark/i.test(`${task.taskId} ${task.instructions ?? ""}`));
  const customerIssues = issues.filter((issue) => issue.reporter || ["performance", "safety", "other"].includes(issue.category));
  const queue = [
    ...makeTaskItems(productTasks, "产品定义", 10),
    ...makeIssueItems(customerIssues, "需求确认"),
    ...rows
      .filter((row) => row.gateBlockers > 0 || row.deliverableGap > 0 || row.criticalIssues > 0)
      .map((row) => ({
        key: `product-risk-${row.id}`,
        projectId: row.id,
        title: row.name,
        detail: row.customer ? `${row.customer} · 规格/风险需产品判断` : "规格/风险需产品判断",
        tag: row.criticalIssues > 0 ? "P0/P1" : "Gate输入",
        tone: row.criticalIssues > 0 ? "rose" : "amber",
        priority: row.criticalIssues > 0 ? 90 : 60,
        icon: <Flag size={14} />,
      } satisfies QueueItem)),
  ].sort((a, b) => b.priority - a.priority);

  return (
    <div className="space-y-4">
      <MetricStrip items={[
        { label: "产品项目", value: rows.length, tone: "stone" },
        { label: "产品定义任务", value: productTasks.length, tone: "amber" },
        { label: "客户/规格问题", value: customerIssues.length, tone: customerIssues.length ? "amber" : "stone" },
        { label: "重大规格风险", value: rows.reduce((sum, row) => sum + row.criticalIssues, 0), tone: "rose" },
      ]} />
      <Panel title="产品定义 / 客户需求队列" icon={<Flag size={15} />}>
        <QueueRows items={queue.slice(0, 12)} onSelectProject={onSelectProject} />
      </Panel>
      <Panel title="关联产品项目" icon={<ListChecks size={15} />}>
        <DecisionRows
          rows={rows.slice(0, 8)}
          empty="暂无关联产品项目"
          onSelectProject={onSelectProject}
          renderMeta={(row) => (
            <>
              {row.customer && <Tag tone="stone">{row.customer}</Tag>}
              {row.gateBlockers > 0 && <Tag tone="amber">Gate缺口 {row.gateBlockers}</Tag>}
            </>
          )}
          renderDetail={(row) => row.ragReasons[0] ?? "关注产品定义冻结、规格偏离与客户输入"}
        />
      </Panel>
    </div>
  );
}

function SalesWorkbench({ portfolio, tasks, roleTasks, onSelectProject }: {
  portfolio: PortfolioTableRow[]; tasks: MyTaskApiRow[]; roleTasks: MyTaskApiRow[];
  onSelectProject: (id: string, focus?: TaskFocus) => void;
}) {
  const customerRows = portfolio
    .filter((row) => row.customer || row.gateDueDate || row.projectedEnd || row.targetDate)
    .sort((a, b) => (a.gateDueDate ?? a.targetDate ?? "9999").localeCompare(b.gateDueDate ?? b.targetDate ?? "9999"));
  const sampleTasks = mergeTasks(tasks, roleTasks).filter((task) => /sample|customer|delivery|ship|confirm|客户|样品|交付/i.test(`${task.taskId} ${task.instructions ?? ""}`));

  return (
    <div className="space-y-4">
      <MetricStrip items={[
        { label: "客户项目", value: customerRows.length, tone: "stone" },
        { label: "样品/交付任务", value: sampleTasks.length, tone: "amber" },
        { label: "延期风险", value: customerRows.filter((row) => isProjectedOverdue(row.projectedEnd, row.targetDate)).length, tone: "rose" },
        { label: "本周 Gate", value: customerRows.filter((row) => row.gateDueDate && row.gateDueDate <= localISODatePlus(7)).length, tone: "amber" },
      ]} />
      <Panel title="客户 / 样品交付风险" icon={<Handshake size={15} />}>
        <DecisionRows
          rows={customerRows.slice(0, 10)}
          empty="暂无客户交付风险"
          onSelectProject={onSelectProject}
          renderMeta={(row) => (
            <>
              {row.customer && <Tag tone="stone">{row.customer}</Tag>}
              {isProjectedOverdue(row.projectedEnd, row.targetDate) && <Tag tone="rose">延期</Tag>}
              {row.gateDueDate && <Tag tone="amber">Gate {row.gateDueDate}</Tag>}
            </>
          )}
          renderDetail={(row) => row.gateName ? `${row.gateName} · 销售只处理客户侧确认与交付风险` : "跟踪客户需求、样品状态与客户可见文件"}
        />
      </Panel>
      <Panel title="销售待办" icon={<ListChecks size={15} />}>
        <QueueRows items={makeTaskItems(sampleTasks, "客户任务").slice(0, 8)} onSelectProject={onSelectProject} />
      </Panel>
    </div>
  );
}

function ExternalWorkbench({ portfolio, onSelectProject }: {
  portfolio: PortfolioTableRow[]; onSelectProject: (id: string, focus?: TaskFocus) => void;
}) {
  return (
    <div className="space-y-4">
      <MetricStrip items={[
        { label: "授权项目", value: portfolio.length, tone: "stone" },
        { label: "可见风险", value: 0, tone: "stone" },
        { label: "内部任务", value: 0, tone: "stone" },
        { label: "内部成本", value: 0, tone: "stone" },
      ]} />
      <Panel title="授权协作项目" icon={<Handshake size={15} />}>
        <DecisionRows
          rows={portfolio}
          empty="暂无授权项目"
          onSelectProject={onSelectProject}
          renderMeta={(row) => (
            <>
              {row.customer && <Tag tone="stone">{row.customer}</Tag>}
              <Tag tone="emerald">授权可见</Tag>
            </>
          )}
          renderDetail={() => "仅查看授权文件、评论、样品与确认事项；内部成本/供应商/工程讨论不会显示"}
        />
      </Panel>
    </div>
  );
}

function MetricStrip({ items }: { items: Array<{ label: string; value: number; tone: "rose" | "amber" | "emerald" | "stone" }> }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-[10px] border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{item.label}</div>
          <div className="num mt-1 text-2xl font-semibold text-foreground">{item.value}</div>
          <div className="mt-2"><Tag tone={item.tone}>{item.tone === "stone" ? "当前" : item.value > 0 ? "需要关注" : "无异常"}</Tag></div>
        </div>
      ))}
    </div>
  );
}

function buildWorkbenchQueue(tasks: MyTaskApiRow[], roleTasks: MyTaskApiRow[], reviews: WorkbenchReview[], issues: WorkbenchIssue[], actionItems: WorkbenchActionItem[]): QueueItem[] {
  const taskKeys = new Set(tasks.map((task) => `${task.projectId}:${task.taskId}`));
  const actionItemItems = makeActionItemItems(actionItems);
  const taskItems = [
    ...makeTaskItems(tasks, "我的任务"),
    ...makeTaskItems(roleTasks, "角色待分配", 12),
  ];
  const reviewItems = makeReviewItems(reviews);
  const issueItems = issues
    .filter((issue) =>
      issue.status === "resolved" ||
      issue.severity === "P0" ||
      issue.severity === "P1" ||
      (issue.relatedTaskId ? taskKeys.has(`${issue.projectId}:${issue.relatedTaskId}`) : false)
    )
    .map((issue) => makeIssueItems([issue])[0]);
  return [...actionItemItems, ...reviewItems, ...issueItems, ...taskItems].sort((a, b) => b.priority - a.priority);
}

function priorityScore(priority: string | null) {
  if (priority === "critical") return 40;
  if (priority === "high") return 30;
  if (priority === "medium") return 18;
  return 8;
}

function dueScore(dueDate: string) {
  const today = toLocalISODate();
  if (dueDate < today) return 35;
  const soon = localISODatePlus(3);
  if (dueDate <= soon) return 20;
  return 0;
}

function QueueRows({ items, onSelectProject }: { items: QueueItem[]; onSelectProject: (id: string, focus?: TaskFocus) => void }) {
  if (items.length === 0) return <div className="text-sm text-muted-foreground">暂无需要你处理的事项。</div>;
  return (
    <div className="divide-y divide-border">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => {
            const focus = item.tab || item.phaseId || item.taskId || item.taskTab
              ? { tab: item.tab, phaseId: item.phaseId, taskId: item.taskId, taskTab: item.taskTab }
              : undefined;
            onSelectProject(item.projectId, focus);
          }}
          className="-mx-2 w-full px-2 py-2.5 text-left transition-colors hover:bg-secondary"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5" style={{ color: item.tone === "rose" ? "var(--destructive)" : item.tone === "amber" ? "var(--warning)" : "var(--muted-foreground)" }}>{item.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                <Tag tone={item.tone}>{item.tag}</Tag>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.detail}</div>
            </div>
            <ChevronRight size={13} className="mt-1 shrink-0 text-muted-foreground" />
          </div>
        </button>
      ))}
    </div>
  );
}

function SnoozedRows({ items, onSelectProject }: { items: WorkbenchActionItem[]; onSelectProject: (id: string, focus?: TaskFocus) => void }) {
  return (
    <div className="divide-y divide-border">
      {items.map((item) => {
        const target = targetFromActionItem(item);
        return (
          <button
            key={item.id}
            onClick={() => onSelectProject(item.projectId, {
              tab: target.tab,
              phaseId: target.phaseId,
              taskId: target.taskId,
              taskTab: target.taskTab,
            })}
            className="-mx-2 w-full px-2 py-2.5 text-left transition-colors hover:bg-secondary"
          >
            <div className="flex items-start gap-3">
              <Clock size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                  <Tag tone="stone">已推迟</Tag>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {item.body || "已暂时移出主待办"} · {item.snoozedUntil ? `恢复 ${formatDateTime(item.snoozedUntil)}` : "等待恢复"}
                </div>
              </div>
              <ChevronRight size={13} className="mt-1 shrink-0 text-muted-foreground" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DecisionRows({
  rows,
  empty,
  onSelectProject,
  renderMeta,
  renderDetail,
}: {
  rows: PortfolioTableRow[];
  empty: string;
  onSelectProject: (id: string) => void;
  renderMeta: (row: PortfolioTableRow) => React.ReactNode;
  renderDetail: (row: PortfolioTableRow) => React.ReactNode;
}) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="divide-y divide-border">
      {rows.map((r) => (
        <button key={r.id} onClick={() => onSelectProject(r.id)} className="-mx-2 w-full px-2 py-2.5 text-left transition-colors hover:bg-secondary">
          <div className="flex items-start gap-3">
            <HealthDot row={r} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{r.name}</span>
                <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{renderDetail(r)}</div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1 max-w-[220px]">{renderMeta(r)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function ScoredRows({
  rows,
  onSelectProject,
  empty = "暂无异常项目",
}: {
  rows: ScoredRow[];
  onSelectProject: (id: string) => void;
  empty?: string;
}) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="divide-y divide-border">
      {rows.map(({ row, level, reasons }) => (
        <button key={row.id} onClick={() => onSelectProject(row.id)} className="-mx-2 w-full px-2 py-2.5 text-left transition-colors hover:bg-secondary">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: level === "red" ? "var(--destructive)" : level === "amber" ? "var(--warning)" : "var(--success)" }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{row.name}</div>
              <div className="num truncate text-[10px] text-muted-foreground">
                {reasons.length ? reasons.join(" / ") : "需关注"}
              </div>
            </div>
            {row.pmName && <Tag tone="stone">PM {row.pmName}</Tag>}
            <ChevronRight size={13} className="shrink-0 text-muted-foreground" />
          </div>
        </button>
      ))}
    </div>
  );
}

function HealthDot({ row }: { row: PortfolioTableRow }) {
  const level = scoreRow(row).level;
  return <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: level === "red" ? "var(--destructive)" : level === "amber" ? "var(--warning)" : "var(--success)" }} />;
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[11px] border border-border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function Tag({ tone, children }: { tone: "rose" | "amber" | "emerald" | "stone"; children: React.ReactNode }) {
  const style: React.CSSProperties =
    tone === "rose" ? { background: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: "var(--destructive)", borderColor: "color-mix(in srgb, var(--destructive) 30%, transparent)" } :
    tone === "amber" ? { background: "color-mix(in srgb, var(--warning) 12%, transparent)", color: "var(--warning)", borderColor: "color-mix(in srgb, var(--warning) 30%, transparent)" } :
    tone === "emerald" ? { background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)", borderColor: "color-mix(in srgb, var(--success) 30%, transparent)" } :
    { background: "var(--secondary)", color: "var(--secondary-foreground)", borderColor: "var(--border)" };
  return <span className="num whitespace-nowrap rounded-[5px] border px-1.5 py-0.5 text-[10px]" style={style}>{children}</span>;
}
