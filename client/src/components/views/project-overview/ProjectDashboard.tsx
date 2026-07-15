// 项目详情 · 总览三栏只读仪表盘
// 固定排版：每张卡片高度固定，列表区 overflow-y-auto；增删条目不改变整体高度。
// 数据全部来自 project + 现有 hooks/selector，不新增后端调用。
import {
  AlertTriangle, ArrowRight, CheckCircle2, Circle, Settings as SettingsIcon,
  ListChecks, Bug, GaugeCircle, Flag,
} from 'lucide-react';
import {
  Project, HEALTH_CONFIG, getProjectPhases, getOverallProgress,
  Issue, ChangeRecord, ISSUE_SEVERITIES,
} from '@/lib/data';
import { CATEGORY_MAP } from '@/lib/sop-templates';
import { CHANGE_TYPE_CONFIG } from './../ChangeLog';
import { LinearCard, Kicker, LinearBar } from '@/components/linear/primitives';
import { trpc } from '@/lib/trpc';

// ── helpers ───────────────────────────────────────────────────────────────────
function daysFromToday(iso?: string | null): number | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function relativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} 个月前`;
  return `${Math.floor(mon / 12)} 年前`;
}

const ISSUE_STATUS_LABEL: Record<string, string> = {
  open: '待处理', in_progress: '处理中', resolved: '待复测', closed: '复测通过', wont_fix: '不修复',
};
const ISSUE_CATEGORY_LABEL: Record<string, string> = {
  hardware: '硬件', software: '软件', mechanical: '结构', thermal: '热设计',
  reliability: '可靠性', safety: '安全', performance: '性能', other: '其他',
};
const TASK_STATUS_LABEL: Record<string, string> = {
  todo: '待开始', in_progress: '进行中', blocked: '阻塞', done: '已完成',
  skipped: '跳过', pending_approval: '待审批',
};
const SEV_ORDER: Record<string, number> = Object.fromEntries(ISSUE_SEVERITIES.map((s, i) => [s, i]));

interface FlatTask {
  id: string; name: string; status: string; dueDate?: string | null; assigneeUserId?: number | null;
}

export function ProjectDashboard({
  project, onOpenSettings, onSelectTab,
}: {
  project: Project;
  onOpenSettings: () => void;
  onSelectTab: (tab: string) => void;
}) {
  const { data: users = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  // 设计4 §1 焦点三卡：下一里程碑/前三阻断 来自统一状态摘要；待决事项来自个人行动项
  const { data: statusSummary } = trpc.projects.statusSummary.useQuery(
    { projectId: project.id }, { staleTime: 5_000 },
  );
  const { data: myWork } = trpc.workbench.mine.useQuery(undefined, { staleTime: 15_000 });
  const userName = (id?: number | null) => (id ? users.find((u) => u.id === id)?.name ?? '—' : '未分配');

  const phases = getProjectPhases(project);
  const overallProgress = getOverallProgress(project);
  const health = HEALTH_CONFIG[project.risk];
  const pmName = project.pmUserId ? users.find((u) => u.id === project.pmUserId)?.name ?? '—' : '—';
  const productLine = project.category ? CATEGORY_MAP[project.category]?.name ?? project.category : '—';
  const currentPhaseName = phases.find((p) => p.id === project.currentPhase)?.name ?? project.currentPhase;

  // ── tasks: flatten across phases ────────────────────────────────────────────
  // 计数与列表/组合看板同口径：读服务端摘要，不再本地累计（本地循环只负责挑待办行）
  const doneTasks = statusSummary?.counts?.taskDone
    ?? project.phaseProgress?.reduce((n, item) => n + item.done, 0) ?? 0;
  const totalTasks = statusSummary?.counts?.taskTotal
    ?? project.phaseProgress?.reduce((n, item) => n + item.total, 0) ?? 0;
  const todoTasks: FlatTask[] = [];
  for (const phase of phases) {
    const pd = project.phases[phase.id];
    const checked = pd?.tasks ?? {};
    const details = pd?.taskDetails ?? {};
    for (const task of phase.tasks) {
      const isDone = checked[task.id] === true;
      if (isDone) continue;
      const d = details[task.id];
      const status = d?.taskStatus ?? 'todo';
      if (status === 'done' || status === 'skipped') continue;
      todoTasks.push({
        id: `${phase.id}:${task.id}`, name: task.name, status,
        dueDate: d?.dueDate, assigneeUserId: d?.assigneeUserId,
      });
    }
  }
  // 待办优先级：有截止日的排前面、按日期升序
  todoTasks.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  });

  // ── issues: open / in_progress across phases ────────────────────────────────
  const openIssues: Issue[] = [];
  for (const phase of phases) {
    for (const issue of project.phases[phase.id]?.issues ?? []) {
      if (issue.status === 'open' || issue.status === 'in_progress') openIssues.push(issue);
    }
  }
  openIssues.sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));

  // ── changelog: recent entries ───────────────────────────────────────────────
  const recentChanges: ChangeRecord[] = [...(project.changeLog ?? [])]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const atRisk = project.risk === 'high' || project.risk === 'medium';

  // ── 设计4 §1 焦点三卡数据 ────────────────────────────────────────────────
  const summaryGate = statusSummary?.nextGate ?? null;
  const gapDims = summaryGate?.gaps ?? [];
  const criticalTitles = gapDims.find((g) => g.dimension === 'critical_issues')?.blockers ?? [];
  const missingDeliverables = gapDims.find((g) => g.dimension === 'deliverables')?.blockers ?? [];
  const overdueRedline = statusSummary?.overdueRedlineTasks ?? [];
  type Blocker = { kind: string; label: string; owner: string | null; tab: string };
  const topBlockers: Blocker[] = [
    ...criticalTitles.map((title) => ({ kind: 'P0/P1', label: title, owner: null, tab: 'issues' })),
    ...overdueRedline.map((task) => ({
      kind: '逾期红线', label: task.name, owner: userName(task.assigneeUserId), tab: 'tasks',
    })),
    ...missingDeliverables.map((name) => ({ kind: '缺证据', label: name, owner: null, tab: 'tasks' })),
  ].slice(0, 3);
  const pendingMine = (myWork?.actionItems ?? []).filter((item: { projectId?: string | null; kind?: string }) =>
    item.projectId === project.id &&
    ['task_approval', 'deliverable_review', 'mp_release_confirm', 'issue_validation'].includes(item.kind ?? ''),
  ).slice(0, 3);
  const gateDays = summaryGate?.dueDate ? daysFromToday(summaryGate.dueDate) : null;

  return (
    <div className="space-y-4">
      {/* ── 设计4 §1：焦点三卡（排版固定，不随内容增减改变）──────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-[11px] border border-border bg-card p-4 min-h-[104px]">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">🎯 下一里程碑</div>
          {summaryGate ? (
            <button type="button" className="text-left w-full" onClick={() => onSelectTab('tasks')}>
              <div className="text-sm font-semibold text-foreground truncate">{summaryGate.gateName}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {summaryGate.dueDate ? `${summaryGate.dueDate} · ${gateDays != null && gateDays >= 0 ? `剩 ${gateDays} 天` : `已逾期 ${Math.abs(gateDays ?? 0)} 天`}` : '未排期'}
                {summaryGate.ready === true
                  ? <span className="ml-2 text-[color:var(--success)]">缺口清零 ✓</span>
                  : <span className="ml-2 text-[color:var(--warning)]">还差 {summaryGate.gapCount} 项</span>}
              </div>
            </button>
          ) : (
            <div className="text-xs text-muted-foreground">当前阶段无 Gate 信息</div>
          )}
        </div>
        <div className="rounded-[11px] border border-border bg-card p-4 min-h-[104px]">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">🚧 前三阻断</div>
          {topBlockers.length === 0 ? (
            <div className="text-xs text-[color:var(--success)]">无阻断 ✓</div>
          ) : (
            <ul className="space-y-1">
              {topBlockers.map((blocker, i) => (
                <li key={i}>
                  <button type="button" className="w-full text-left text-xs flex items-center gap-1.5" onClick={() => onSelectTab(blocker.tab)}>
                    <span className="shrink-0 rounded px-1 text-[10px] border border-[color:var(--warning)] text-[color:var(--warning)]">{blocker.kind}</span>
                    <span className="truncate text-foreground">{blocker.label}</span>
                    {blocker.owner && <span className="shrink-0 text-muted-foreground">@{blocker.owner}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-[11px] border border-border bg-card p-4 min-h-[104px]">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">⏳ 待决事项</div>
          {pendingMine.length === 0 ? (
            <div className="text-xs text-[color:var(--success)]">没有等你的决定 ✓</div>
          ) : (
            <ul className="space-y-1">
              {pendingMine.map((item: { id: number; title?: string | null }) => (
                <li key={item.id}>
                  <button type="button" className="w-full text-left text-xs text-foreground truncate hover:underline" onClick={() => onSelectTab('tasks')}>
                    {item.title ?? '待处理事项'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── 风险预警横幅（仅风险项目显示，缺省不占位）──────────────────────────── */}
      {atRisk && (
        <div
          className="flex items-start gap-3 rounded-[11px] border px-4 py-3"
          style={{
            borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)',
            background: 'var(--warning-soft)',
          }}
        >
          <AlertTriangle size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
          <div className="min-w-0">
            <div className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>
              {health?.label ?? '需关注'} · 项目存在风险
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground truncate">
              {project.riskOverrideReason?.trim()
                || (openIssues.length > 0
                  ? `${openIssues.length} 个未关闭问题需要收口，当前阶段「${currentPhaseName}」`
                  : `当前阶段「${currentPhaseName}」存在进度风险，请关注关键节点`)}
            </div>
          </div>
        </div>
      )}

      {/* ── 三栏主网格 ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_360px] gap-4 items-start">
        {/* 左列 */}
        <div className="space-y-4">
          {/* 待办任务 */}
          <LinearCard className="p-4">
            <CardHeader title="待办任务" actionLabel="查看全部" onAction={() => onSelectTab('tasks')} />
            <div className="h-[248px] overflow-y-auto -mr-1 pr-1">
              {todoTasks.length === 0 ? (
                <EmptyState text="暂无待办" />
              ) : (
                <ul className="space-y-0.5">
                  {todoTasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-secondary">
                      <Circle size={13} className="shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">{t.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {TASK_STATUS_LABEL[t.status] ?? t.status} · {userName(t.assigneeUserId)}
                        </div>
                      </div>
                      {t.dueDate && (
                        <span className="num shrink-0 text-[11px] text-muted-foreground">{t.dueDate.slice(5)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </LinearCard>

          {/* 未关闭问题 */}
          <LinearCard className="p-4">
            <CardHeader title="未关闭问题" actionLabel="查看全部" onAction={() => onSelectTab('issues')} />
            <div className="h-[168px] overflow-y-auto -mr-1 pr-1">
              {openIssues.length === 0 ? (
                <EmptyState text="暂无未关闭问题" />
              ) : (
                <ul className="space-y-0.5">
                  {openIssues.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-secondary">
                      <SeverityBadge sev={i.severity} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">{i.title}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {ISSUE_CATEGORY_LABEL[i.category] ?? i.category} · {i.owner || '—'}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{ISSUE_STATUS_LABEL[i.status] ?? i.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </LinearCard>
        </div>

        {/* 中列 */}
        <div className="space-y-4">
          {/* 关键信息 */}
          <LinearCard className="p-4">
            <CardHeader title="关键信息" actionLabel="设置" onAction={onOpenSettings} icon={<SettingsIcon size={12} />} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 pt-1">
              <InfoCell label="项目编号" value={project.code || '—'} mono />
              <InfoCell label="项目经理" value={pmName} />
              <InfoCell label="产品线" value={productLine} />
              <InfoCell label="当前阶段" value={currentPhaseName} />
              <InfoCell label="开始" value={project.startDate || '—'} mono />
              <InfoCell label="目标量产" value={project.targetDate || '—'} mono />
            </div>
          </LinearCard>

          {/* 最近变更 */}
          <LinearCard className="p-4">
            <CardHeader title="最近变更" actionLabel="查看全部" onAction={() => onSelectTab('changelog')} />
            <div className="h-[168px] overflow-y-auto -mr-1 pr-1">
              {recentChanges.length === 0 ? (
                <EmptyState text="暂无变更记录" />
              ) : (
                <ul className="space-y-0.5">
                  {recentChanges.map((c) => {
                    const cfg = CHANGE_TYPE_CONFIG[c.type];
                    return (
                      <li key={c.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-secondary">
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold border ${cfg?.color ?? 'bg-secondary'} ${cfg?.textColor ?? 'text-muted-foreground'} ${cfg?.borderColor ?? 'border-border'}`}>
                          {cfg?.badge ?? c.type.toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-foreground">{c.title}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {(c.decisionMaker || '—')} · {relativeTime(c.createdAt)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </LinearCard>
        </div>

        {/* 右列（固定 360px） */}
        <div className="space-y-4">
          {/* 进度 */}
          <LinearCard className="p-4">
            <Kicker className="mb-3 flex items-center gap-1.5"><GaugeCircle size={12} />进度</Kicker>
            <div className="flex items-baseline gap-2">
              <span className="num text-3xl font-semibold text-foreground">{overallProgress}</span>
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <LinearBar value={overallProgress} className="mt-3" />
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Stat icon={<ListChecks size={13} />} label="任务完成" value={`${doneTasks}/${totalTasks}`} />
              <Stat icon={<Bug size={13} />} label="未关闭问题" value={String(openIssues.length)} accent={openIssues.length > 0} />
              <Stat
                icon={<span className={`h-2 w-2 rounded-full ${health?.dot ?? 'bg-muted-foreground'}`} />}
                label="风险等级"
                value={health?.label ?? project.risk}
              />
            </div>
          </LinearCard>

          {/* 保留原右栏两卡节奏；Gate 数据只在顶部焦点卡展示。 */}
          <LinearCard className="overflow-hidden p-0">
            <button
              type="button"
              onClick={() => onSelectTab('tasks')}
              className="min-h-[116px] w-full bg-primary p-4 text-left text-primary-foreground transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Kicker className="flex items-center gap-1.5 text-primary-foreground/80">
                <Flag size={12} />Gate 评审入口
              </Kicker>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">查看 Gate 任务</div>
                  <div className="mt-1 text-xs text-primary-foreground/75">就绪清单与评审操作集中在任务页</div>
                </div>
                <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
              </div>
            </button>
          </LinearCard>
        </div>
      </div>
    </div>
  );
}

// ── sub-components ──────────────────────────────────────────────────────────────
function CardHeader({ title, actionLabel, onAction, icon }: {
  title: string; actionLabel: string; onAction: () => void; icon?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <Kicker>{title}</Kicker>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {icon}{actionLabel}{icon ? null : <ArrowRight size={11} />}
      </button>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</div>
  );
}

function InfoCell({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-sm text-foreground ${mono ? 'num' : ''}`}>{value}</div>
    </div>
  );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md bg-secondary px-1.5 py-2">
      <div className="flex items-center justify-center text-muted-foreground">{icon}</div>
      <div className={`mt-1 truncate text-sm font-semibold ${accent ? 'text-[color:var(--destructive)]' : 'text-foreground'}`}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function SeverityBadge({ sev }: { sev: string }) {
  const tone = sev === 'P0' || sev === 'P1'
    ? 'text-[color:var(--destructive)] border-[color:var(--destructive)]/30 bg-[color:var(--destructive-soft)]'
    : sev === 'P2'
      ? 'text-[color:var(--warning)] border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)]'
      : 'text-muted-foreground border-border bg-secondary';
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold border num ${tone}`}>{sev}</span>
  );
}
