// 项目总揽：左侧分区导航 + 右侧内容。把原先堆在一页的功能整理为
// 基础信息 / 团队与分工 / 排期与周会 / 钉钉群 / 自定义字段 五个分区。
import { useEffect, useState } from 'react';
import { Project, HEALTH_CONFIG, getProjectPhases, computeOverallProgress } from '@/lib/data';
import { CATEGORY_MAP } from '@/lib/sop-templates';
import { trpc } from '@/lib/trpc';
import {
  Hash, User, AlertTriangle, CalendarRange, Flag, GaugeCircle, ListChecks, Bug, GitBranch,
  Users, CalendarClock, RefreshCw, UserCheck, Rocket, FileText, MessagesSquare, CheckCircle2, Loader2, Boxes,
} from 'lucide-react';
import { MeetingConfigPanel } from './MeetingConfigPanel';
import { MembersPanel } from './MembersPanel';
import { CustomFieldsPanel } from './CustomFieldsPanel';
import { KickoffWizard } from './KickoffWizard';
import { isProjectedOverdue } from '@shared/health';
import { toast } from 'sonner';

type SectionKey = 'info' | 'team' | 'schedule' | 'dingtalk' | 'fields';
const SECTIONS: Array<{ key: SectionKey; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: 'info', label: '基础信息', icon: FileText },
  { key: 'team', label: '团队与分工', icon: Users },
  { key: 'schedule', label: '排期与周会', icon: CalendarClock },
  { key: 'dingtalk', label: '钉钉对接群', icon: MessagesSquare },
  { key: 'fields', label: '自定义字段', icon: ListChecks },
];

type ProductHandoff = {
  product: { id: string; productNumber: string; name: string; category: string; targetMarkets: string[] | null } | null;
  snapshot: {
    id: number;
    versionNumber: number;
    title: string;
    snapshot: {
      prdSummary?: string | null;
      specs?: Array<{ label: string; target: string; tolerance?: string; verification?: string; ownerRole?: string }>;
      skuPlan?: Array<{ name: string; code?: string; targetMarket?: string; price?: string; differences?: string }>;
      competitors?: Array<{ brand?: string; model?: string; price?: string; channel?: string; notes?: string }>;
      targetCost?: string;
      targetPrice?: string;
      targetGrossMargin?: string;
    };
    confirmedAt: string | Date;
  } | null;
  snapshotSource: 'none' | 'locked' | 'latest';
  changes: Array<{ id: number; title: string; area: string; status: string; costImpact?: string | null; scheduleImpact?: string | null }>;
  roleBuckets: Array<{
    role: string;
    label: string;
    itemCount: number;
    specs: Array<{ label: string; target: string; tolerance?: string; verification?: string; ownerRole?: string }>;
    changes: Array<{ id: number; title: string; area: string; status: string; costImpact?: string | null; scheduleImpact?: string | null }>;
  }>;
};

const HANDOFF_CHANGE_STATUS: Record<string, string> = {
  proposed: '提议中',
  approved: '已批准',
  rejected: '已拒绝',
  implemented: '已实施',
  cancelled: '已取消',
};

export function OverviewPanel({ project, onUpdate, canEdit, canManageMembers, isAdmin }: { project: Project; onUpdate: (p: Project) => void; canEdit: boolean; canManageMembers: boolean; isAdmin: boolean }) {
  const { data: members = [] } = trpc.members.list.useQuery({ projectId: project.id });
  const { data: users = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const { data: productList = [] } = trpc.products.list.useQuery(undefined, { staleTime: 60_000 });
  const { data: productHandoff, isLoading: productHandoffLoading } = trpc.projects.productHandoff.useQuery(
    { projectId: project.id },
    { staleTime: 60_000 },
  );
  const linkedProduct = project.productId ? (productList as Array<{ id: string; name: string }>).find((p) => p.id === project.productId) : null;
  const utils = trpc.useUtils();

  const [section, setSection] = useState<SectionKey>('info');
  const [kickoffOpen, setKickoffOpen] = useState(false);

  const catConfig = project.category ? CATEGORY_MAP[project.category] : null;
  const phases = getProjectPhases(project);
  const currentPhaseName = phases.find((p) => p.id === project.currentPhase)?.name ?? project.currentPhase;
  const overallProgress = computeOverallProgress(project);
  const health = HEALTH_CONFIG[project.risk];
  const pmName = project.pmUserId ? users.find((u) => u.id === project.pmUserId)?.name ?? '—' : '—';

  let doneTasks = 0, totalTasks = 0;
  for (const phase of phases) {
    const taskState = project.phases[phase.id]?.tasks ?? {};
    for (const task of phase.tasks) { totalTasks += 1; if (taskState[task.id]) doneTasks += 1; }
  }
  const taskRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const openIssues = phases.reduce((sum, phase) => sum + (project.phases[phase.id]?.issues ?? []).filter((i) => i.status === 'open' || i.status === 'in_progress').length, 0);
  const pendingChanges = (project.changeLog ?? []).filter((r) => r.status === 'proposed').length;

  let projectedEnd: string | null = null;
  for (const phase of phases) {
    const td = project.phases[phase.id]?.taskDetails ?? {};
    for (const id of Object.keys(td)) { const due = td[id]?.dueDate; if (due && (!projectedEnd || due > projectedEnd)) projectedEnd = due; }
  }
  const overdue = isProjectedOverdue(projectedEnd, project.targetDate);

  // ── 立项基础信息编辑(客户/背景/价值/描述) ───────────────────────────────
  const [info, setInfo] = useState({ description: '', customer: '', background: '', value: '' });
  useEffect(() => {
    setInfo({
      description: project.description ?? '', customer: project.customer ?? '',
      background: project.background ?? '', value: project.value ?? '',
    });
  }, [project.id, project.description, project.customer, project.background, project.value]);
  const commitInfo = (patch: Partial<typeof info>) => {
    const next = { ...info, ...patch };
    setInfo(next);
    onUpdate({ ...project, description: next.description, customer: next.customer, background: next.background, value: next.value });
  };

  const regenerate = trpc.tasks.regenerateSchedule.useMutation({
    onSuccess: (r) => { utils.tasks.list.invalidate({ projectId: project.id }); toast.success(`已重新生成排期（${r.count} 个任务）`); },
    onError: (e) => toast.error(e.message),
  });
  const assignByRole = trpc.projects.assignByRole.useMutation({
    onSuccess: (r) => { utils.tasks.list.invalidate({ projectId: project.id }); toast.success(`已按角色分配 ${r.assigned} 项任务给 ${r.recipients} 人${r.notified ? `，已发钉钉通知 ${r.notified} 人` : ''}`); },
    onError: (e) => toast.error(e.message),
  });
  const createGroup = trpc.projects.createDingtalkGroup.useMutation({
    onSuccess: (r) => { utils.projects.get.invalidate({ id: project.id }); toast.success(r.already ? '项目群已存在' : '钉钉项目群已创建'); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* 侧边分区导航 */}
      <nav className="lg:w-44 shrink-0 flex lg:flex-col gap-1 overflow-x-auto border-b lg:border-b-0 lg:border-r border-stone-200 lg:pr-3 pb-2 lg:pb-0">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button key={s.key} onClick={() => setSection(s.key)}
              className={`flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap text-left transition-colors ${section === s.key ? 'bg-stone-900 text-white lg:bg-transparent lg:text-stone-900 lg:border-l-2 lg:border-l-stone-900 lg:-ml-px lg:font-medium' : 'text-stone-500 hover:text-stone-900 hover:bg-stone-50'}`}>
              <Icon size={14} />{s.label}
            </button>
          );
        })}
      </nav>

      {/* 内容区 */}
      <div className="flex-1 min-w-0 space-y-6">
        {section === 'info' && (
          <>
            <ProductDefinitionHandoffPanel
              projectId={project.id}
              handoff={productHandoff as ProductHandoff | undefined}
              isLoading={productHandoffLoading}
              linkedProductId={project.productId ?? null}
              lockedSnapshotId={project.productDefinitionSnapshotId ?? null}
              canGenerate={canEdit}
            />

            {catConfig && (
              <div className={`ce-panel flex items-start gap-4 border ${catConfig.borderColor} ${catConfig.color} p-4 shadow-none`}>
                <span className="text-3xl leading-none">{catConfig.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${catConfig.textColor}`}>{catConfig.name}</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${catConfig.borderColor} ${catConfig.textColor}`}>{catConfig.badge}</span>
                    <span className="text-[10px] font-mono text-stone-400">{catConfig.phaseCount} 阶段 · {catConfig.typicalDuration}</span>
                  </div>
                  <p className="text-xs text-stone-500 mt-1 leading-relaxed">{catConfig.desc}</p>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400 mb-3">关键信息</h3>
              <div className="ce-table-shell grid grid-cols-2 md:grid-cols-3 gap-px bg-stone-200">
                <InfoCell icon={<Hash size={13} />} label="项目编号" value={project.code || '—'} mono />
                <InfoCell icon={<User size={13} />} label="项目经理" value={pmName} />
                <InfoCell icon={<Boxes size={13} />} label="关联产品" value={linkedProduct ? linkedProduct.name : (project.productId ? project.productId : '新产品 / 未关联')} />
                <InfoCell icon={<AlertTriangle size={13} />} label="项目健康度" value={<span className={health?.color}>{health?.label ?? project.risk}</span>} />
                <InfoCell icon={<Flag size={13} />} label="当前阶段" value={currentPhaseName} />
                <InfoCell icon={<CalendarRange size={13} />} label="计划起止" value={`${project.startDate || '—'} ~ ${project.targetDate || '—'}`} mono />
                <InfoCell icon={<GaugeCircle size={13} />} label="整体进度" value={
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-stone-200 overflow-hidden min-w-[48px]"><div className="h-full bg-stone-800" style={{ width: `${overallProgress}%` }} /></div>
                    <span className="text-xs font-mono text-stone-600">{overallProgress}%</span>
                  </div>
                } />
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400 mb-3">立项信息</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="客户 / 对接方" value={info.customer} onCommit={(v) => commitInfo({ customer: v })} canEdit={canEdit} placeholder="客户名称 / 内部对接方" />
                <Field label="预期价值" value={info.value} onCommit={(v) => commitInfo({ value: v })} canEdit={canEdit} placeholder="目标销量 / 营收 / 战略价值" />
                <Field label="项目背景" value={info.background} onCommit={(v) => commitInfo({ background: v })} canEdit={canEdit} placeholder="为什么做这个项目、市场/客户背景" textarea className="md:col-span-2" />
                <Field label="项目描述" value={info.description} onCommit={(v) => commitInfo({ description: v })} canEdit={canEdit} placeholder="一句话/一段话说明产品定位与范围" textarea className="md:col-span-2" />
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400 mb-3">关键指标</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric icon={<ListChecks size={15} />} label="任务完成率" value={`${taskRate}%`} sub={`${doneTasks}/${totalTasks}`} />
                <Metric icon={<Bug size={15} />} label="开放问题" value={String(openIssues)} accent={openIssues > 0 ? 'text-rose-600' : undefined} />
                <Metric icon={<GitBranch size={15} />} label="待决变更" value={String(pendingChanges)} accent={pendingChanges > 0 ? 'text-amber-600' : undefined} />
                <Metric icon={<Users size={15} />} label="项目成员" value={String(members.length)} />
              </div>
            </div>
          </>
        )}

        {section === 'team' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400">团队与分工</h3>
              {canEdit && (
                <div className="flex items-center gap-2">
                  <button onClick={() => { if (confirm('按各成员角色，把未分配的任务自动指派给对应负责人，并给每人发钉钉任务通知？')) assignByRole.mutate({ projectId: project.id }); }}
                    disabled={assignByRole.isPending}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-50 transition-colors"
                    title="按角色把未分配任务指派给对应成员并发钉钉通知">
                    <UserCheck size={12} />{assignByRole.isPending ? '分配中…' : '按角色分配'}
                  </button>
                  <button onClick={() => setKickoffOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider bg-stone-900 text-white hover:bg-stone-700 transition-colors"
                    title="一步完成:设开始日 + 各角色配人 + 派任务 + 建项目群 + 设置周会 + 聚合通知">
                    <Rocket size={12} />立项向导
                  </button>
                </div>
              )}
            </div>
            <MembersPanel projectId={project.id} canManage={canManageMembers} />
          </div>
        )}

        {section === 'schedule' && (
          <div className="space-y-6">
            <div className="ce-panel p-4 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2"><CalendarClock size={14} className="text-amber-500" /><span className="text-sm font-medium text-stone-800">自动排期</span></div>
              <div className="flex items-center gap-1.5 text-sm"><span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">预计完成</span><span className="font-mono text-stone-700">{projectedEnd || '未排期'}</span></div>
              {overdue && <span className="text-[11px] font-mono px-1.5 py-0.5 bg-rose-50 text-rose-600 border border-rose-200">超出目标日 {project.targetDate}</span>}
              <div className="text-[11px] text-stone-400 flex-1">按 SOP 工期+依赖、从开始日 {project.startDate || '（未设）'} 自动生成（约 3-4 个月）</div>
              {canEdit && (
                <button disabled={regenerate.isPending || !project.startDate} onClick={() => regenerate.mutate({ projectId: project.id })}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-40 transition-colors"
                  title={project.startDate ? '按开始日重新生成整套排期' : '请先设置项目开始日期'}>
                  <RefreshCw size={12} />重新生成排期
                </button>
              )}
            </div>
            <MeetingConfigPanel projectId={project.id} canEdit={canEdit} />
          </div>
        )}

        {section === 'dingtalk' && (
          <div>
            <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400 mb-3">钉钉对接群</h3>
            {project.dingtalkChatId ? (
              <div className="ce-panel border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 size={15} />已绑定项目钉钉群</div>
                <div className="text-xs text-stone-600">群 ID:<span className="font-mono ml-1">{project.dingtalkChatId.slice(0, 12)}…</span></div>
                <p className="text-xs text-stone-500 leading-relaxed">该项目的提醒(逾期 / Gate / 任务分配 / 周会等)会自动发到此群。在钉钉里搜索「【{project.name}】项目群」即可进入。</p>
              </div>
            ) : (
              <div className="ce-panel p-4 space-y-3">
                <p className="text-sm text-stone-700 leading-relaxed">
                  一键在钉钉创建本项目的对接群:群主为 <strong>PM(无则创建者)</strong>,成员为<strong>已配手机号的项目成员</strong>。建群后,项目提醒会统一发到该群。
                </p>
                <p className="text-[11px] text-stone-400 leading-relaxed">需成员在「团队与分工 / 系统管理」里配置手机号;至少 2 名成员(含群主)才能建群。</p>
                {canEdit ? (
                  <button onClick={() => createGroup.mutate({ projectId: project.id })} disabled={createGroup.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors">
                    {createGroup.isPending ? <Loader2 size={13} className="animate-spin" /> : <MessagesSquare size={13} />}创建钉钉项目群
                  </button>
                ) : <p className="text-xs text-stone-400">仅 Owner / 管理层 / PM 可创建项目群</p>}
              </div>
            )}
          </div>
        )}

        {section === 'fields' && (
          <CustomFieldsPanel project={project} onUpdate={onUpdate} canEdit={canEdit} isAdmin={isAdmin} />
        )}
      </div>

      {kickoffOpen && (
        <KickoffWizard
          project={{ id: project.id, name: project.name, category: project.category ?? 'npd', pmUserId: project.pmUserId ?? null, startDate: project.startDate ?? null }}
          onClose={() => setKickoffOpen(false)}
        />
      )}
    </div>
  );
}

function ProductDefinitionHandoffPanel({
  projectId, handoff, isLoading, linkedProductId, lockedSnapshotId, canGenerate,
}: {
  projectId: string;
  handoff?: ProductHandoff;
  isLoading: boolean;
  linkedProductId: string | null;
  lockedSnapshotId: number | null;
  canGenerate: boolean;
}) {
  const utils = trpc.useUtils();
  const generateTasks = trpc.projects.generateHandoffTasks.useMutation({
    onSuccess: async (result) => {
      toast.success(`已生成产品定义交接任务：新增 ${result.created}，更新 ${result.updated}${result.assigned ? `，已分配 ${result.assigned}` : ''}`);
      await Promise.all([
        utils.projects.productHandoff.invalidate({ projectId }),
        utils.tasks.list.invalidate({ projectId }),
        utils.projects.get.invalidate({ id: projectId }),
      ]);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="ce-panel p-4 flex items-center gap-2 text-sm text-stone-400">
        <Loader2 size={14} className="animate-spin" />加载产品定义交接…
      </div>
    );
  }

  if (!linkedProductId || !handoff?.product) {
    return (
      <div className="ce-panel p-4 border-dashed border-stone-300 bg-stone-50/50">
        <div className="flex items-center gap-2 text-sm text-stone-700">
          <Boxes size={15} className="text-stone-400" />未关联产品，暂无产品定义交接输入
        </div>
      </div>
    );
  }

  const snapshot = handoff.snapshot;
  const approvedChanges = handoff.changes.filter((change) => change.status === 'approved' || change.status === 'implemented');
  const pendingChanges = handoff.changes.filter((change) => change.status === 'proposed');

  if (!snapshot) {
    return (
      <div className="ce-panel p-4 border-amber-200 bg-amber-50/60">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
          <AlertTriangle size={15} />关联产品缺少已确认 PRD 快照
        </div>
        <p className="text-xs text-amber-700 mt-1">请回产品库确认产品定义后，再作为项目开发输入。</p>
      </div>
    );
  }

  return (
    <div className="ce-panel p-4 space-y-4 border-emerald-200 bg-emerald-50/30">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FileText size={15} className="text-emerald-600" />
            <h3 className="text-sm font-semibold text-stone-900">产品定义交接</h3>
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-stone-900 text-white">PRD v{snapshot.versionNumber}</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${
              handoff.snapshotSource === 'locked'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              {handoff.snapshotSource === 'locked' && lockedSnapshotId ? '项目锁定快照' : '最新快照回退'}
            </span>
          </div>
          <div className="text-xs text-stone-500 mt-1">
            {handoff.product.name}
            {handoff.product.productNumber ? ` · ${handoff.product.productNumber}` : ''}
            {handoff.product.category ? ` · ${handoff.product.category}` : ''}
            {' · '}
            {new Date(snapshot.confirmedAt).toLocaleString('zh-CN')}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="grid grid-cols-3 gap-px bg-stone-200 text-xs min-w-[220px]">
            <div className="bg-white px-2 py-1.5"><div className="text-stone-400 font-mono">SPEC</div><div>{snapshot.snapshot.specs?.length ?? 0}</div></div>
            <div className="bg-white px-2 py-1.5"><div className="text-stone-400 font-mono">SKU</div><div>{snapshot.snapshot.skuPlan?.length ?? 0}</div></div>
            <div className="bg-white px-2 py-1.5"><div className="text-stone-400 font-mono">CHANGE</div><div>{approvedChanges.length}/{pendingChanges.length}</div></div>
          </div>
          {canGenerate && (
            <button
              type="button"
              onClick={() => generateTasks.mutate({ projectId })}
              disabled={generateTasks.isPending || handoff.roleBuckets.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 transition-colors"
              title="按角色交接清单生成 P1/P2 执行任务"
            >
              {generateTasks.isPending ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
              生成任务
            </button>
          )}
        </div>
      </div>

      {snapshot.snapshot.prdSummary ? (
        <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{snapshot.snapshot.prdSummary}</p>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="bg-white border border-stone-200 p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-2">商业目标</div>
          <div className="space-y-1 text-xs text-stone-700">
            <div>目标成本：{snapshot.snapshot.targetCost || '—'}</div>
            <div>目标售价：{snapshot.snapshot.targetPrice || '—'}</div>
            <div>毛利要求：{snapshot.snapshot.targetGrossMargin || '—'}</div>
          </div>
        </div>
        <div className="bg-white border border-stone-200 p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-2">目标规格</div>
          <div className="space-y-1.5">
            {(snapshot.snapshot.specs ?? []).slice(0, 4).map((spec, index) => (
              <div key={`${spec.label}-${index}`} className="text-xs text-stone-700">
                <span className="text-stone-900">{spec.label}</span>
                <span className="text-stone-400"> · </span>
                {spec.target}
              </div>
            ))}
            {(snapshot.snapshot.specs?.length ?? 0) === 0 ? <div className="text-xs text-stone-400">—</div> : null}
          </div>
        </div>
        <div className="bg-white border border-stone-200 p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-2">变更影响</div>
          <div className="space-y-1.5">
            {handoff.changes.slice(0, 4).map((change) => (
              <div key={change.id} className="text-xs text-stone-700">
                <span className="text-stone-900">{change.title}</span>
                <span className="text-stone-400"> · </span>
                {HANDOFF_CHANGE_STATUS[change.status] ?? change.status}
              </div>
            ))}
            {handoff.changes.length === 0 ? <div className="text-xs text-stone-400">暂无产品定义变更</div> : null}
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-2">角色交接清单</div>
        {handoff.roleBuckets.length === 0 ? (
          <div className="bg-white border border-stone-200 p-3 text-xs text-stone-400">
            暂无按角色归属的规格或变更。可在产品定义规格里填写责任角色，例如“结构 / 电子 / 采购 / 品质”。
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {handoff.roleBuckets.map((bucket) => (
              <div key={bucket.role} className="bg-white border border-stone-200 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <UserCheck size={14} className="text-stone-400" />
                    <span className="text-sm font-medium text-stone-900">{bucket.label}</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 bg-stone-100 text-stone-500">
                    {bucket.itemCount} 项输入
                  </span>
                </div>
                <div className="space-y-2">
                  {bucket.specs.slice(0, 4).map((spec, index) => (
                    <div key={`spec-${bucket.role}-${index}`} className="text-xs text-stone-700">
                      <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-100 px-1 py-0.5 mr-1.5">SPEC</span>
                      <span className="text-stone-900">{spec.label}</span>
                      <span className="text-stone-400"> · </span>
                      {spec.target}
                      {spec.verification ? <span className="text-stone-400"> · {spec.verification}</span> : null}
                    </div>
                  ))}
                  {bucket.changes.slice(0, 4).map((change) => (
                    <div key={`change-${change.id}`} className="text-xs text-stone-700">
                      <span className="text-[10px] font-mono text-amber-700 bg-amber-50 border border-amber-100 px-1 py-0.5 mr-1.5">CHANGE</span>
                      <span className="text-stone-900">{change.title}</span>
                      <span className="text-stone-400"> · </span>
                      {HANDOFF_CHANGE_STATUS[change.status] ?? change.status}
                      {change.costImpact ? <span className="text-stone-400"> · {change.costImpact}</span> : null}
                      {change.scheduleImpact ? <span className="text-stone-400"> · {change.scheduleImpact}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onCommit, canEdit, placeholder, textarea, className }: {
  label: string; value: string; onCommit: (v: string) => void; canEdit: boolean; placeholder?: string; textarea?: boolean; className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <div className={`ce-card p-3 ${className ?? ''}`}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-1.5">{label}</div>
      {!canEdit ? (
        <div className="text-sm text-stone-700 whitespace-pre-wrap min-h-[1.25rem]">{value || <span className="text-stone-300">—</span>}</div>
      ) : textarea ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} rows={3} placeholder={placeholder}
          className="w-full text-sm text-stone-800 outline-none resize-none placeholder:text-stone-300" />
      ) : (
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} placeholder={placeholder}
          className="w-full text-sm text-stone-800 outline-none placeholder:text-stone-300" />
      )}
    </div>
  );
}

function InfoCell({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="bg-white p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-1">{icon}{label}</div>
      <div className={`text-sm text-stone-800 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function Metric({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="ce-card p-4">
      <div className="flex items-center gap-1.5 text-stone-400">{icon}<span className="text-[10px] font-mono uppercase tracking-wider">{label}</span></div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-2xl font-semibold ${accent ?? 'text-stone-800'}`}>{value}</span>
        {sub && <span className="text-[11px] font-mono text-stone-400">{sub}</span>}
      </div>
    </div>
  );
}
