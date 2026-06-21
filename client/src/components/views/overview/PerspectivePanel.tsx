// 千人千面面板：管理层看决策，PM 看异常，我的视角看待办。
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { PHASE_MAP } from "@/lib/data";
import { TaskListView, resolveTaskName, type TaskRow, type TaskFocus } from "../TaskListView";
import type { TaskStatus, TaskPriority } from "@shared/const";
import { isProjectedOverdue, type RagLevel } from "@shared/health";
import {
  buildTodayItems, buildCoordinationQueue, projectHeadlineMetric,
  type TodayItem, type CoordItem,
} from "@shared/pm-workbench";
import {
  AlertTriangle, Ban, Bug, CalendarClock, CheckCircle2, ChevronRight,
  ClipboardCheck, FileCheck, Flag, Inbox, ListChecks, Rocket, UserMinus,
} from "lucide-react";
import type { PortfolioTableRow } from "./PortfolioTable";

export type Lens = "exec" | "pm" | "mine";

type ScoredRow = { row: PortfolioTableRow; level: RagLevel; reasons: string[] };

const overdue = (r: PortfolioTableRow) => isProjectedOverdue(r.projectedEnd, r.targetDate);
const byDue = (a: PortfolioTableRow, b: PortfolioTableRow) => (a.gateDueDate ?? "9999").localeCompare(b.gateDueDate ?? "9999");

function scoreRow(row: PortfolioTableRow): ScoredRow {
  return { row, level: row.ragLevel, reasons: row.ragReasons };
}

export function PerspectivePanel({ lens, rows, onSelectProject }: { lens: Lens; rows: PortfolioTableRow[]; onSelectProject: (id: string, focus?: TaskFocus) => void }) {
  const { user } = useAuth();
  const { data: workbench, isLoading: workbenchLoading, refetch: refetchWorkbench } = trpc.workbench.mine.useQuery();
  const scored = useMemo(() => rows.map(scoreRow), [rows]);
  const myProjects = useMemo(() => rows.filter((r) => r.pmUserId === user?.id), [rows, user?.id]);

  if (lens === "exec") {
    return <ExecutiveDecisionBoard rows={rows} scored={scored} onSelectProject={onSelectProject} />;
  }

  if (lens === "pm") {
    return (
      <PmCockpit
        myRows={myProjects}
        tasks={workbench?.tasks ?? []}
        reviews={workbench?.reviews ?? []}
        onSelectProject={onSelectProject}
      />
    );
  }

  return <RoleWorkbench workbench={workbench} isLoading={workbenchLoading} onRefetch={() => refetchWorkbench()} onSelectProject={onSelectProject} />;
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

function PmCockpit({ myRows, tasks, reviews, onSelectProject }: {
  myRows: PortfolioTableRow[];
  tasks: MyTaskApiRow[];
  reviews: WorkbenchReview[];
  onSelectProject: (id: string, focus?: TaskFocus) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const todayItems = useMemo(() => buildTodayItems(tasks, myRows, today), [tasks, myRows, today]);
  const coordItems = useMemo(() => buildCoordinationQueue(reviews, myRows), [reviews, myRows]);

  if (myRows.length === 0) {
    return (
      <Panel title="我的项目工作台" icon={<ListChecks size={15} />}>
        <div className="text-sm text-stone-400">你当前不是任何项目的 PM。</div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel title="TODAY · 今天要做" icon={<CalendarClock size={15} />}>
        {todayItems.length === 0 ? (
          <div className="text-sm text-stone-400">今天没有紧急事项。</div>
        ) : (
          <div className="divide-y divide-stone-100">
              {todayItems.slice(0, 10).map((item) => (
                <ActionRow key={item.key} icon={TODAY_ICON[item.kind]} title={item.title} detail={item.detail}
                tag={item.tag} tone={item.tone} onClick={() => onSelectProject(item.projectId, item.kind === 'risk' ? { tab: 'issues' } : undefined)} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="待我协调 / 拍板" icon={<Inbox size={15} />}>
          {coordItems.length === 0 ? (
            <div className="text-sm text-stone-400">暂无待你协调或拍板的事项。</div>
          ) : (
            <div className="divide-y divide-stone-100">
              {coordItems.slice(0, 10).map((item) => (
                <ActionRow key={item.key} icon={COORD_ICON[item.kind]} title={item.title} detail={item.detail}
                  tag={item.tag} tone={item.tone} onClick={() => onSelectProject(item.projectId, item.kind === 'issue' ? { tab: 'issues' } : undefined)} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="我负责的项目" icon={<ListChecks size={15} />}>
          <div className="divide-y divide-stone-100">
            {myRows.map((r) => {
              const metric = projectHeadlineMetric(r);
              return (
                <button key={r.id} onClick={() => onSelectProject(r.id)}
                  className="w-full text-left py-2.5 hover:bg-stone-50/70 -mx-2 px-2 transition-colors">
                  <div className="flex items-center gap-3">
                    <HealthDot row={r} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-stone-800 truncate">{r.name}</div>
                      <div className="text-[10px] font-mono text-stone-400 truncate">
                        {PHASE_MAP[r.currentPhase]?.name ?? r.currentPhase}
                      </div>
                    </div>
                    {metric && <Tag tone={metric.tone}>{metric.label}</Tag>}
                    <ChevronRight size={13} className="text-stone-300 shrink-0" />
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
    <button onClick={onClick} className="w-full text-left py-2.5 hover:bg-stone-50/70 -mx-2 px-2 transition-colors">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 ${tone === "rose" ? "text-rose-500" : tone === "amber" ? "text-amber-500" : "text-stone-400"}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-stone-800 truncate">{title}</span>
            <Tag tone={tone}>{tag}</Tag>
          </div>
          <div className="text-[11px] text-stone-500 mt-0.5 truncate">{detail}</div>
        </div>
        <ChevronRight size={13} className="mt-1 text-stone-300 shrink-0" />
      </div>
    </button>
  );
}

type MyTaskApiRow = {
  id: number; projectId: string; phaseId: string; taskId: string;
  projectName: string; projectNumber: string; projectCategory: string;
  status: string; priority: string | null; dueDate: string | null;
  assigneeUserId: number | null; completed: boolean;
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
type WorkbenchData = {
  systemRole: string;
  roles: WorkbenchRole[];
  tasks: MyTaskApiRow[];
  reviews: WorkbenchReview[];
  issues: WorkbenchIssue[];
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
  title: string;
  detail: string;
  tag: string;
  tone: "rose" | "amber" | "emerald" | "stone";
  priority: number;
  icon: React.ReactNode;
};

function RoleWorkbench({ workbench, isLoading, onRefetch, onSelectProject }: {
  workbench?: WorkbenchData; isLoading: boolean; onRefetch: () => void; onSelectProject: (id: string, focus?: TaskFocus) => void;
}) {
  const tasks = workbench?.tasks ?? [];
  const reviews = workbench?.reviews ?? [];
  const issues = workbench?.issues ?? [];
  const queue = useMemo(() => buildWorkbenchQueue(tasks, reviews, issues), [tasks, reviews, issues]);
  const rows: TaskRow[] = tasks.map((t) => ({
    id: t.id, projectId: t.projectId, phaseId: t.phaseId, taskId: t.taskId,
    projectName: t.projectName, projectNumber: t.projectNumber, projectCategory: t.projectCategory,
    status: t.status as TaskStatus, priority: (t.priority ?? "medium") as TaskPriority,
    dueDate: t.dueDate ? String(t.dueDate) : null, assigneeUserId: t.assigneeUserId ?? null, completed: t.completed,
  }));

  if (isLoading && !workbench) {
    return (
      <Panel title="我的工作台" icon={<Inbox size={15} />}>
        <div className="text-sm text-stone-400">正在聚合你的任务、审核、质量和提醒...</div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel title="待我处理" icon={<Inbox size={15} />}>
        <QueueRows items={queue.slice(0, 10)} onSelectProject={onSelectProject} />
      </Panel>

      <div className="ce-table-shell">
        <TaskListView tasks={rows} isLoading={isLoading} emptyIcon={<CheckCircle2 size={24} />}
          emptyTitle="没有待办任务" emptyDesc="当前没有指派给您的未完成任务。"
          onRefetch={onRefetch} onNavigateToProject={onSelectProject} showOverdueBadge />
      </div>
    </div>
  );
}

function buildWorkbenchQueue(tasks: MyTaskApiRow[], reviews: WorkbenchReview[], issues: WorkbenchIssue[]): QueueItem[] {
  const taskKeys = new Set(tasks.map((task) => `${task.projectId}:${task.taskId}`));
  const taskItems = tasks.map((task) => ({
    key: `task-${task.id}`,
    projectId: task.projectId,
    phaseId: task.phaseId,
    taskId: task.taskId,
    title: resolveTaskName(task.taskId, task.phaseId, task.projectCategory),
    detail: `${task.projectName} · ${task.dueDate ? `截止 ${task.dueDate}` : "未设截止日"}`,
    tag: task.priority === "critical" ? "P0任务" : task.priority === "high" ? "P1任务" : "我的任务",
    tone: task.status === "blocked" ? "rose" : task.priority === "critical" || task.priority === "high" ? "amber" : "stone",
    priority: (task.status === "blocked" ? 100 : 0) + priorityScore(task.priority) + (task.dueDate ? dueScore(task.dueDate) : 0),
    icon: task.status === "blocked" ? <Ban size={14} /> : <ListChecks size={14} />,
  } satisfies QueueItem));
  const reviewItems = reviews.map((review) => ({
    key: `review-${review.id}`,
    projectId: review.projectId,
    title: review.deliverableName,
    detail: `${review.projectName} · 交付物待审核`,
    tag: "审核",
    tone: "amber",
    priority: 92,
    icon: <FileCheck size={14} />,
  } satisfies QueueItem));
  const issueItems = issues
    .filter((issue) =>
      issue.status === "resolved" ||
      issue.severity === "P0" ||
      issue.severity === "P1" ||
      (issue.relatedTaskId ? taskKeys.has(`${issue.projectId}:${issue.relatedTaskId}`) : false)
    )
    .map((issue) => ({
      key: `issue-${issue.id}`,
      projectId: issue.projectId,
      phaseId: issue.phaseId,
      title: issue.title,
      detail: `${issue.projectName} · ${issue.owner ? `责任人 ${issue.owner}` : issue.targetDate ? `目标 ${issue.targetDate}` : "质量关注项"}`,
      tag: issue.status === "resolved" ? "待复测" : `${issue.severity} Issue`,
      tone: issue.status === "resolved" ? "amber" : issue.severity === "P0" || issue.severity === "P1" ? "rose" : "stone",
      priority: issue.status === "resolved" ? 95 : issue.severity === "P0" ? 98 : issue.severity === "P1" ? 88 : 45,
      icon: <Bug size={14} />,
    } satisfies QueueItem));
  return [...reviewItems, ...issueItems, ...taskItems].sort((a, b) => b.priority - a.priority);
}

function priorityScore(priority: string | null) {
  if (priority === "critical") return 40;
  if (priority === "high") return 30;
  if (priority === "medium") return 18;
  return 8;
}

function dueScore(dueDate: string) {
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return 35;
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  if (dueDate <= soon) return 20;
  return 0;
}

function QueueRows({ items, onSelectProject }: { items: QueueItem[]; onSelectProject: (id: string, focus?: TaskFocus) => void }) {
  if (items.length === 0) return <div className="text-sm text-stone-400">暂无需要你处理的事项。</div>;
  return (
    <div className="divide-y divide-stone-100">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onSelectProject(
            item.projectId,
            item.phaseId && item.taskId
              ? { tab: 'tasks', phaseId: item.phaseId, taskId: item.taskId }
              : item.key.startsWith('issue-')
                ? { tab: 'issues', phaseId: item.phaseId }
                : undefined
          )}
          className="w-full text-left py-2.5 hover:bg-stone-50/70 -mx-2 px-2 transition-colors"
        >
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 ${item.tone === "rose" ? "text-rose-500" : item.tone === "amber" ? "text-amber-500" : "text-stone-400"}`}>{item.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-stone-800 truncate">{item.title}</span>
                <Tag tone={item.tone}>{item.tag}</Tag>
              </div>
              <div className="text-[11px] text-stone-500 mt-0.5 truncate">{item.detail}</div>
            </div>
            <ChevronRight size={13} className="mt-1 text-stone-300 shrink-0" />
          </div>
        </button>
      ))}
    </div>
  );
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
  if (rows.length === 0) return <div className="text-sm text-stone-400">{empty}</div>;
  return (
    <div className="divide-y divide-stone-100">
      {rows.map((r) => (
        <button key={r.id} onClick={() => onSelectProject(r.id)} className="w-full text-left py-2.5 hover:bg-stone-50/70 -mx-2 px-2 transition-colors">
          <div className="flex items-start gap-3">
            <HealthDot row={r} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-stone-800 truncate">{r.name}</span>
                <ChevronRight size={12} className="text-stone-300 shrink-0" />
              </div>
              <div className="text-[11px] text-stone-500 mt-0.5 line-clamp-1">{renderDetail(r)}</div>
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
  if (rows.length === 0) return <div className="text-sm text-stone-400">{empty}</div>;
  return (
    <div className="divide-y divide-stone-100">
      {rows.map(({ row, level, reasons }) => (
        <button key={row.id} onClick={() => onSelectProject(row.id)} className="w-full text-left py-2.5 hover:bg-stone-50/70 -mx-2 px-2 transition-colors">
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full shrink-0 ${level === "red" ? "bg-rose-500" : level === "amber" ? "bg-amber-500" : "bg-emerald-500"}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-stone-800 truncate">{row.name}</div>
              <div className="text-[10px] font-mono text-stone-400 truncate">
                {reasons.length ? reasons.join(" / ") : "需关注"}
              </div>
            </div>
            {row.pmName && <Tag tone="stone">PM {row.pmName}</Tag>}
            <ChevronRight size={13} className="text-stone-300 shrink-0" />
          </div>
        </button>
      ))}
    </div>
  );
}

function HealthDot({ row }: { row: PortfolioTableRow }) {
  const level = scoreRow(row).level;
  return <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${level === "red" ? "bg-rose-500" : level === "amber" ? "bg-amber-500" : "bg-emerald-500"}`} />;
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="ce-panel p-4">
      <h3 className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-stone-400 mb-3">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function Tag({ tone, children }: { tone: "rose" | "amber" | "emerald" | "stone"; children: React.ReactNode }) {
  const cls =
    tone === "rose" ? "bg-rose-50 text-rose-700 border-rose-200" :
    tone === "amber" ? "bg-amber-50 text-amber-700 border-amber-200" :
    tone === "emerald" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    "bg-stone-50 text-stone-600 border-stone-200";
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 border whitespace-nowrap ${cls}`}>{children}</span>;
}
