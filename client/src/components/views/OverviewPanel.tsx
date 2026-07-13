// 项目总揽：左侧分区导航 + 右侧内容。把原先堆在一页的功能整理为
// 基础信息 / 团队与分工 / 排期与周会 / 钉钉群 / 自定义字段 五个分区。
import { useEffect, useState } from 'react';
import { Project, HEALTH_CONFIG, getProjectPhases, getOverallProgress } from '@/lib/data';
import {
  CATEGORY_MAP,
  DERIVATIVE_REUSE_LEVEL_LABELS,
  DERIVATIVE_REUSE_MODULE_RULES,
  getDerivativeEffectiveTaskIds,
  normalizeDerivativeReuseStrategy,
  type DerivativeReuseLevel,
  type DerivativeReuseStrategy,
} from '@/lib/sop-templates';
import { trpc } from '@/lib/trpc';
import { useProjectPermission } from '@/hooks/useProjectPermission';
import {
  Hash, User, AlertTriangle, CalendarRange, Flag, GaugeCircle, ListChecks, Bug, GitBranch,
  Users, CalendarClock, RefreshCw, UserCheck, Rocket, FileText, MessagesSquare, CheckCircle2, Loader2, Boxes, ShieldAlert, Edit3,
  PauseCircle,
  Handshake,
  WalletCards,
} from 'lucide-react';
import { MeetingConfigPanel } from './MeetingConfigPanel';
import { MembersPanel } from './MembersPanel';
import { CustomFieldsPanel } from './CustomFieldsPanel';
import { KickoffWizard } from './KickoffWizard';
import { RisksPanel } from './RisksPanel';
import { CertificationCoveragePanel } from './CertificationCoveragePanel';
import { ControlledConditionsPanel } from './ControlledConditionsPanel';
import { CloseHandoffPanel } from './CloseHandoffPanel';
import { ProjectExpensePanel } from './ProjectExpensePanel';
import { ControlledTransitionPanel } from './ControlledTransitionPanel';
import { TerminationReviewPanel } from './TerminationReviewPanel';
import { isProjectedOverdue } from '@shared/health';
import {
  EMPTY_CHANGE_SCOPE_DECLARATION,
  type ProjectChangeScopeDeclaration,
} from '@shared/sop-risk';
import { toast } from 'sonner';

const CHANGE_SCOPE_FIELDS: Array<{ key: keyof ProjectChangeScopeDeclaration; label: string }> = [
  { key: 'batteryCellChange', label: '电芯变化' },
  { key: 'batteryPackOrBmsChange', label: '电池包 / BMS / 保护板变化' },
  { key: 'protectionParameterChange', label: '充放电或保护参数变化' },
  { key: 'powerOrThermalBoundaryChange', label: '功率 / 电流 / 温升边界变化' },
  { key: 'pressurizedStructureChange', label: '受压结构或过压保护变化' },
  { key: 'targetMarketExpansion', label: '新增目标市场' },
  { key: 'criticalSafetySupplierChange', label: '关键安全件供应商 / 二供变化' },
  { key: 'safetyRelatedSoftwareChange', label: '安全相关固件 / OTA / APP 变化' },
  { key: 'eolTestChange', label: 'EOL 测试项目、限值或能力变化' },
  { key: 'otherSafetyOrRegulatoryChange', label: '其他安全或法规变化' },
];

type SectionKey = 'info' | 'process' | 'risks' | 'expenses' | 'close' | 'team' | 'schedule' | 'dingtalk' | 'fields' | 'lifecycle';
const SECTIONS: Array<{ key: SectionKey; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: 'info', label: '基础信息', icon: FileText },
  { key: 'process', label: '流程策略', icon: GitBranch },
  { key: 'risks', label: '风险生命周期', icon: ShieldAlert },
  { key: 'expenses', label: '项目费用', icon: WalletCards },
  { key: 'close', label: '关闭移交', icon: Handshake },
  { key: 'team', label: '团队与分工', icon: Users },
  { key: 'schedule', label: '排期与周会', icon: CalendarClock },
  { key: 'dingtalk', label: '钉钉对接群', icon: MessagesSquare },
  { key: 'fields', label: '自定义字段', icon: ListChecks },
  { key: 'lifecycle', label: '暂停与终止', icon: PauseCircle },
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

export function OverviewPanel({
  project,
  onUpdate,
  canEdit,
  canManageMembers,
  isAdmin,
  onOpenRiskOverride,
}: {
  project: Project;
  onUpdate: (p: Project) => void;
  canEdit: boolean;
  canManageMembers: boolean;
  isAdmin: boolean;
  onOpenRiskOverride?: () => void;
}) {
  // 多岗成员按"有效角色集合"判权，不再只看主角色（accessRole）——否则兼任 scm/cert
  // 的成员在费用/认证面板拿不到 extraRoles 授予的能力（一人多岗设计 §2.1）。
  const unionPerms = useProjectPermission(project.id);
  const hasAnyRole = (list: readonly string[]) =>
    unionPerms.roles.some((role) => list.includes(role)) || list.includes(project.accessRole ?? '');
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
  const overallProgress = getOverallProgress(project);
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
      <nav className="lg:w-44 shrink-0 flex lg:flex-col gap-1 overflow-x-auto border-b lg:border-b-0 lg:border-r border-border lg:pr-3 pb-2 lg:pb-0">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button key={s.key} onClick={() => setSection(s.key)}
              className={`flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap text-left transition-colors ${section === s.key ? 'bg-primary text-primary-foreground lg:bg-transparent lg:text-foreground lg:border-l-2 lg:border-l-primary lg:-ml-px lg:font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
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
              <div className={`rounded-[11px] border border-border bg-card flex items-start gap-4 border ${catConfig.borderColor} ${catConfig.color} p-4 shadow-none`}>
                <span className="text-3xl leading-none">{catConfig.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${catConfig.textColor}`}>{catConfig.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 border ${catConfig.borderColor} ${catConfig.textColor}`}>{catConfig.badge}</span>
                    <span className="text-[10px] text-muted-foreground">{catConfig.phaseCount} 阶段 · {catConfig.typicalDuration}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{catConfig.desc}</p>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">关键信息</h3>
              <div className="grid grid-cols-2 gap-x-8 gap-y-5 rounded-[12px] border border-border bg-card px-5 py-[18px] md:grid-cols-3">
                <InfoCell icon={<Hash size={13} />} label="项目编号" value={project.code || '—'} mono />
                <InfoCell icon={<User size={13} />} label="项目经理" value={pmName} />
                <InfoCell icon={<Boxes size={13} />} label="关联产品" value={linkedProduct ? linkedProduct.name : (project.productId ? project.productId : '新产品 / 未关联')} />
                <InfoCell icon={<AlertTriangle size={13} />} label="项目健康度" value={
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 ${health?.color}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${health?.dot ?? 'bg-muted-foreground'}`} />
                        {health?.label ?? project.risk}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{project.riskOverrideRisk ? '手动覆盖' : '自动计算'}</span>
                      {canEdit && onOpenRiskOverride && (
                        <button
                          type="button"
                          onClick={onOpenRiskOverride}
                          className="rounded-[7px] inline-flex items-center gap-1 border border-border bg-card px-2 py-1 text-[10px] text-[color:var(--secondary-foreground)] transition-colors hover:border-[color:var(--acc-border)] hover:text-foreground"
                        >
                          <Edit3 size={10} />
                          手动覆盖
                        </button>
                      )}
                    </div>
                    {project.riskOverrideReason && (
                      <div className="text-[11px] leading-relaxed text-muted-foreground">原因：{project.riskOverrideReason}</div>
                    )}
                    {!canEdit && (
                      <div className="text-[11px] text-muted-foreground">仅 Owner / 管理层 / PM 可覆盖</div>
                    )}
                  </div>
                } />
                <InfoCell icon={<Flag size={13} />} label="当前阶段" value={currentPhaseName} />
                <InfoCell icon={<CalendarRange size={13} />} label="计划起止" value={`${project.startDate || '—'} ~ ${project.targetDate || '—'}`} mono />
                <InfoCell className="col-span-2 md:col-span-3" icon={<GaugeCircle size={13} />} label="整体进度" value={
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary min-w-[48px]"><div className="h-full rounded-full bg-primary" style={{ width: `${overallProgress}%` }} /></div>
                    <span className="num text-xs text-[color:var(--secondary-foreground)]">{overallProgress}%</span>
                  </div>
                } />
              </div>
            </div>

            <div>
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">立项信息</h3>
              <div className="grid grid-cols-1 gap-x-8 gap-y-[18px] rounded-[12px] border border-border bg-card px-5 py-[18px] md:grid-cols-2">
                <Field label="客户 / 对接方" value={info.customer} onCommit={(v) => commitInfo({ customer: v })} canEdit={canEdit} placeholder="客户名称 / 内部对接方" />
                <Field label="预期价值" value={info.value} onCommit={(v) => commitInfo({ value: v })} canEdit={canEdit} placeholder="目标销量 / 营收 / 战略价值" />
                <Field label="项目背景" value={info.background} onCommit={(v) => commitInfo({ background: v })} canEdit={canEdit} placeholder="为什么做这个项目、市场/客户背景" textarea className="md:col-span-2" />
                <Field label="项目描述" value={info.description} onCommit={(v) => commitInfo({ description: v })} canEdit={canEdit} placeholder="一句话/一段话说明产品定位与范围" textarea className="md:col-span-2" />
              </div>
            </div>

            <div>
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">关键指标</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric icon={<ListChecks size={15} />} label="任务完成率" value={`${taskRate}%`} sub={`${doneTasks}/${totalTasks}`} />
                <Metric icon={<Bug size={15} />} label="开放问题" value={String(openIssues)} accent={openIssues > 0 ? 'text-[color:var(--destructive)]' : undefined} />
                <Metric icon={<GitBranch size={15} />} label="待决变更" value={String(pendingChanges)} accent={pendingChanges > 0 ? 'text-[color:var(--warning)]' : undefined} />
                <Metric icon={<Users size={15} />} label="项目成员" value={String(members.length)} />
              </div>
            </div>
          </>
        )}

        {section === 'process' && (
          <div className="space-y-5">
            <ControlledTransitionPanel project={project} canEdit={canEdit || isAdmin} />
            <DerivativeReuseStrategyPanel
              project={project}
              canEdit={canEdit}
            />
          </div>
        )}

        {section === 'lifecycle' && (
          <ProjectLifecyclePanel project={project} canEdit={canEdit} />
        )}

        {section === 'close' && (
          <CloseHandoffPanel projectId={project.id} canEdit={canEdit || isAdmin} isAdmin={isAdmin} />
        )}

        {section === 'expenses' && (
          <ProjectExpensePanel
            projectId={project.id}
            canView={isAdmin || canEdit || hasAnyRole(['owner', 'manager', 'project_manager', 'pm', 'scm'])}
            canEdit={isAdmin || canEdit || hasAnyRole(['pm', 'scm'])}
          />
        )}

        {section === 'risks' && (
          <div className="space-y-6">
            <SopRiskScopePanel project={project} canEdit={canEdit} isAdmin={isAdmin} />
            <CertificationCoveragePanel
              projectId={project.id}
              canEdit={canEdit || isAdmin || hasAnyRole(['cert', 'qa', 'battery_safety'])}
              canReview={isAdmin || hasAnyRole(['cert', 'qa', 'battery_safety'])}
            />
            <ControlledConditionsPanel projectId={project.id} canEdit={canEdit || isAdmin} />
            <div>
            <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">风险生命周期</h3>
            <RisksPanel projectId={project.id} canEdit={canEdit} />
            </div>
          </div>
        )}

        {section === 'team' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground">团队与分工</h3>
              {canEdit && (
                <div className="flex items-center gap-2">
                  <button onClick={() => { if (confirm('按各成员角色，把未分配的任务自动指派给对应负责人，并给每人发钉钉任务通知？')) assignByRole.mutate({ projectId: project.id }); }}
                    disabled={assignByRole.isPending}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] uppercase tracking-wider border border-border text-[color:var(--secondary-foreground)] hover:bg-secondary disabled:opacity-50 transition-colors"
                    title="按角色把未分配任务指派给对应成员并发钉钉通知">
                    <UserCheck size={12} />{assignByRole.isPending ? '分配中…' : '按角色分配'}
                  </button>
                  <button onClick={() => setKickoffOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] uppercase tracking-wider bg-primary text-primary-foreground hover:opacity-90 transition-colors"
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
            <div className="rounded-[11px] border border-border bg-card p-4 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2"><CalendarClock size={14} className="text-primary" /><span className="text-sm font-medium text-foreground">自动排期</span></div>
              <div className="flex items-center gap-1.5 text-sm"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">预计完成</span><span className="num text-foreground">{projectedEnd || '未排期'}</span></div>
              {overdue && <span className="text-[11px] num px-1.5 py-0.5 bg-[color:var(--destructive)]/10 text-[color:var(--destructive)] border border-[color:var(--destructive)]/30">超出目标日 {project.targetDate}</span>}
              <div className="text-[11px] text-muted-foreground flex-1">按 SOP 工期+依赖、从开始日 {project.startDate || '（未设）'} 自动生成（约 3-4 个月）</div>
              {canEdit && (
                <button disabled={regenerate.isPending || !project.startDate} onClick={() => regenerate.mutate({ projectId: project.id })}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider border border-border text-[color:var(--secondary-foreground)] hover:bg-secondary disabled:opacity-40 transition-colors"
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
            <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">钉钉对接群</h3>
            {project.dingtalkChatId ? (
              <div className="rounded-[11px] border border-border bg-card border-[color:var(--acc-border)] bg-[color:var(--success)]/10 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm text-[color:var(--success)]"><CheckCircle2 size={15} />已绑定项目钉钉群</div>
                <div className="text-xs text-[color:var(--secondary-foreground)]">群 ID:<span className="num ml-1">{project.dingtalkChatId.slice(0, 12)}…</span></div>
                <p className="text-xs text-muted-foreground leading-relaxed">该项目的提醒(逾期 / Gate / 任务分配 / 周会等)会自动发到此群。在钉钉里搜索「【{project.name}】项目群」即可进入。</p>
              </div>
            ) : (
              <div className="rounded-[11px] border border-border bg-card p-4 space-y-3">
                <p className="text-sm text-foreground leading-relaxed">
                  一键在钉钉创建本项目的对接群:群主为 <strong>PM(无则创建者)</strong>,成员为<strong>已配手机号的项目成员</strong>。建群后,项目提醒会统一发到该群。
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">需成员在「团队与分工 / 系统管理」里配置手机号;至少 2 名成员(含群主)才能建群。</p>
                {canEdit ? (
                  <button onClick={() => createGroup.mutate({ projectId: project.id })} disabled={createGroup.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-colors">
                    {createGroup.isPending ? <Loader2 size={13} className="animate-spin" /> : <MessagesSquare size={13} />}创建钉钉项目群
                  </button>
                ) : <p className="text-xs text-muted-foreground">仅 Owner / 管理层 / PM 可创建项目群</p>}
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
      <div className="rounded-[11px] border border-border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />加载产品定义交接…
      </div>
    );
  }

  if (!linkedProductId || !handoff?.product) {
    return (
      <div className="rounded-[11px] border border-border bg-card p-4 border-dashed border-border bg-secondary">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Boxes size={15} className="text-muted-foreground" />未关联产品型号
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          产品定义、规格输入和客户差异先随项目 SOP 推进；项目完成或 SKU 明确后，再沉淀到产品库。
        </p>
      </div>
    );
  }

  const snapshot = handoff.snapshot;
  const approvedChanges = handoff.changes.filter((change) => change.status === 'approved' || change.status === 'implemented');
  const pendingChanges = handoff.changes.filter((change) => change.status === 'proposed');

  if (!snapshot) {
    return (
      <div className="rounded-[11px] border border-border bg-card p-4 border-[color:var(--acc-border)] bg-[color:var(--acc-soft)]">
        <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--warning)]">
          <AlertTriangle size={15} />关联产品缺少已确认 PRD 快照
        </div>
        <p className="text-xs text-[color:var(--warning)] mt-1">可继续在项目 SOP 中推进产品定义；需要把产品库定义作为交接输入时，再确认 PRD 快照。</p>
      </div>
    );
  }

  return (
    <div className="rounded-[11px] border border-border bg-card p-4 space-y-4 border-[color:var(--acc-border)] bg-[color:var(--success)]/10">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FileText size={15} className="text-[color:var(--success)]" />
            <h3 className="text-sm font-semibold text-foreground">产品定义交接</h3>
            <span className="text-[10px] num px-1.5 py-0.5 bg-primary text-primary-foreground">PRD v{snapshot.versionNumber}</span>
            <span className={`text-[10px] px-1.5 py-0.5 border ${
              handoff.snapshotSource === 'locked'
                ? 'bg-[color:var(--success)]/10 text-[color:var(--success)] border-[color:var(--acc-border)]'
                : 'bg-[color:var(--acc-soft)] text-[color:var(--warning)] border-[color:var(--acc-border)]'
            }`}>
              {handoff.snapshotSource === 'locked' && lockedSnapshotId ? '项目锁定快照' : '最新快照回退'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {handoff.product.name}
            {handoff.product.productNumber ? ` · ${handoff.product.productNumber}` : ''}
            {handoff.product.category ? ` · ${handoff.product.category}` : ''}
            {' · '}
            {new Date(snapshot.confirmedAt).toLocaleString('zh-CN')}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="grid grid-cols-3 gap-px bg-secondary text-xs min-w-[220px]">
            <div className="bg-card px-2 py-1.5"><div className="text-muted-foreground">SPEC</div><div className="num">{snapshot.snapshot.specs?.length ?? 0}</div></div>
            <div className="bg-card px-2 py-1.5"><div className="text-muted-foreground">SKU</div><div className="num">{snapshot.snapshot.skuPlan?.length ?? 0}</div></div>
            <div className="bg-card px-2 py-1.5"><div className="text-muted-foreground">CHANGE</div><div className="num">{approvedChanges.length}/{pendingChanges.length}</div></div>
          </div>
          {canGenerate && (
            <button
              type="button"
              onClick={() => generateTasks.mutate({ projectId })}
              disabled={generateTasks.isPending || handoff.roleBuckets.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-colors"
              title="按角色交接清单生成 P1/P2 执行任务"
            >
              {generateTasks.isPending ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
              生成任务
            </button>
          )}
        </div>
      </div>

      {snapshot.snapshot.prdSummary ? (
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{snapshot.snapshot.prdSummary}</p>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="bg-card border border-border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">商业目标</div>
          <div className="space-y-1 text-xs text-foreground">
            <div>目标成本：{snapshot.snapshot.targetCost || '—'}</div>
            <div>目标售价：{snapshot.snapshot.targetPrice || '—'}</div>
            <div>毛利要求：{snapshot.snapshot.targetGrossMargin || '—'}</div>
          </div>
        </div>
        <div className="bg-card border border-border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">目标规格</div>
          <div className="space-y-1.5">
            {(snapshot.snapshot.specs ?? []).slice(0, 4).map((spec, index) => (
              <div key={`${spec.label}-${index}`} className="text-xs text-foreground">
                <span className="text-foreground">{spec.label}</span>
                <span className="text-muted-foreground"> · </span>
                {spec.target}
              </div>
            ))}
            {(snapshot.snapshot.specs?.length ?? 0) === 0 ? <div className="text-xs text-muted-foreground">—</div> : null}
          </div>
        </div>
        <div className="bg-card border border-border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">变更影响</div>
          <div className="space-y-1.5">
            {handoff.changes.slice(0, 4).map((change) => (
              <div key={change.id} className="text-xs text-foreground">
                <span className="text-foreground">{change.title}</span>
                <span className="text-muted-foreground"> · </span>
                {HANDOFF_CHANGE_STATUS[change.status] ?? change.status}
              </div>
            ))}
            {handoff.changes.length === 0 ? <div className="text-xs text-muted-foreground">暂无产品定义变更</div> : null}
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">角色交接清单</div>
        {handoff.roleBuckets.length === 0 ? (
          <div className="bg-card border border-border p-3 text-xs text-muted-foreground">
            暂无按角色归属的规格或变更。可在产品定义规格里填写责任角色，例如“结构 / 电子 / 采购 / 品质”。
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {handoff.roleBuckets.map((bucket) => (
              <div key={bucket.role} className="bg-card border border-border p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <UserCheck size={14} className="text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{bucket.label}</span>
                  </div>
                  <span className="text-[10px] num px-1.5 py-0.5 bg-secondary text-muted-foreground">
                    {bucket.itemCount} 项输入
                  </span>
                </div>
                <div className="space-y-2">
                  {bucket.specs.slice(0, 4).map((spec, index) => (
                    <div key={`spec-${bucket.role}-${index}`} className="text-xs text-foreground">
                      <span className="text-[10px] text-[color:var(--success)] bg-[color:var(--success)]/10 border border-[color:var(--acc-border)] px-1 py-0.5 mr-1.5">SPEC</span>
                      <span className="text-foreground">{spec.label}</span>
                      <span className="text-muted-foreground"> · </span>
                      {spec.target}
                      {spec.verification ? <span className="text-muted-foreground"> · {spec.verification}</span> : null}
                    </div>
                  ))}
                  {bucket.changes.slice(0, 4).map((change) => (
                    <div key={`change-${change.id}`} className="text-xs text-foreground">
                      <span className="text-[10px] text-[color:var(--warning)] bg-[color:var(--acc-soft)] border border-[color:var(--acc-border)] px-1 py-0.5 mr-1.5">CHANGE</span>
                      <span className="text-foreground">{change.title}</span>
                      <span className="text-muted-foreground"> · </span>
                      {HANDOFF_CHANGE_STATUS[change.status] ?? change.status}
                      {change.costImpact ? <span className="text-muted-foreground"> · {change.costImpact}</span> : null}
                      {change.scheduleImpact ? <span className="text-muted-foreground"> · {change.scheduleImpact}</span> : null}
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

/** 项目生命周期面板：暂停（可恢复）/ 恢复 / 终止（终局，理由必填+善后说明留痕）。权限同量产发布。 */
function ProjectLifecyclePanel({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const lifecycle = project.lifecycle ?? 'active';
  const [pauseReason, setPauseReason] = useState('');

  const mut = trpc.projects.setLifecycle.useMutation({
    onSuccess: async (_r, vars) => {
      await Promise.all([
        utils.projects.get.invalidate({ id: project.id }),
        utils.projects.list.invalidate(),
      ]);
      toast.success(
        vars.lifecycle === 'terminated' ? '项目已终止并归档（终局，不可恢复）'
          : vars.lifecycle === 'paused' ? '项目已暂停：保留可见，退出逾期与自动化提醒'
            : '项目已恢复'
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const badge = lifecycle === 'terminated'
    ? <span className="text-[10px] rounded px-1.5 py-0.5 bg-rose-100 text-rose-700 border border-rose-200">已终止</span>
    : lifecycle === 'paused'
      ? <span className="text-[10px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200">已暂停</span>
      : <span className="text-[10px] rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-700 border border-emerald-200">进行中</span>;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">暂停与终止</h3>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">当前状态</span>
          {badge}
        </div>
        {lifecycle !== 'active' && project.lifecycleReason && (
          <p className="mt-1.5 text-xs text-muted-foreground">理由：{project.lifecycleReason}</p>
        )}
      </div>

      {lifecycle === 'terminated' && (
        <p className="text-xs text-muted-foreground">
          项目已终止并归档：不再出现在活跃列表与统计中，不能量产发布，也不可恢复。善后记录见项目动态。
        </p>
      )}

      {lifecycle === 'paused' && canEdit && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="text-xs text-muted-foreground">暂停中：项目保留可见，但不进逾期统计与自动化提醒。</div>
          <button
            disabled={mut.isPending}
            onClick={() => mut.mutate({ projectId: project.id, lifecycle: 'active' })}
            className="text-xs rounded px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >恢复项目</button>
        </div>
      )}

      {lifecycle === 'active' && canEdit && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="text-xs font-medium text-foreground">暂停项目</div>
          <div className="text-xs text-muted-foreground">适用：等客户回复、等物料等外部依赖。暂停可随时恢复。</div>
          <textarea
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            placeholder="暂停理由（必填），例：等客户确认规格，预计两周"
            className="w-full text-xs rounded border border-border bg-background p-2 min-h-[52px]"
          />
          <button
            disabled={mut.isPending || !pauseReason.trim()}
            onClick={() => mut.mutate({ projectId: project.id, lifecycle: 'paused', reason: pauseReason.trim() })}
            className="text-xs rounded px-3 py-1.5 bg-secondary text-foreground border border-border hover:bg-secondary/80 disabled:opacity-50"
          >暂停项目</button>
        </div>
      )}

      {lifecycle !== 'terminated' && <TerminationReviewPanel projectId={project.id} canEdit={canEdit} />}

      {!canEdit && lifecycle !== 'terminated' && (
        <p className="text-xs text-muted-foreground">仅项目创建人 / PM / 管理层可暂停或终止项目。</p>
      )}
    </div>
  );
}

function DerivativeReuseStrategyPanel({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const rawStrategy = project.customFields?.derivativeReuseStrategy;
  const committedStrategy = normalizeDerivativeReuseStrategy(rawStrategy);
  const [draftStrategy, setDraftStrategy] = useState<DerivativeReuseStrategy>(committedStrategy);
  const toStrategyRecord = (strategy: DerivativeReuseStrategy): Record<string, DerivativeReuseLevel> => Object.fromEntries(
    DERIVATIVE_REUSE_MODULE_RULES.map((rule) => [rule.id, strategy[rule.id] ?? rule.defaultLevel])
  ) as Record<string, DerivativeReuseLevel>;
  const fingerprint = (strategy: DerivativeReuseStrategy) => JSON.stringify(Object.entries(toStrategyRecord(strategy)));
  const committedFingerprint = fingerprint(committedStrategy);
  const draftFingerprint = fingerprint(draftStrategy);
  const dirty = committedFingerprint !== draftFingerprint;

  useEffect(() => {
    setDraftStrategy(committedStrategy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, committedFingerprint]);

  const applyStrategy = trpc.projects.applyDerivativeStrategy.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.projects.get.invalidate({ id: project.id }),
        utils.projects.list.invalidate(),
        utils.tasks.list.invalidate({ projectId: project.id }),
        utils.tailoring.effectiveProcess.invalidate({ projectId: project.id }),
      ]);
      toast.success(`已应用流程策略：有效任务 ${result.effectiveTasks}，跳过 ${result.skippedTasks}${result.insertedTasks ? `，新增 ${result.insertedTasks}` : ''}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const moduleLevels = DERIVATIVE_REUSE_MODULE_RULES.map((rule) => draftStrategy[rule.id] ?? rule.defaultLevel);
  const deepChangeCount = moduleLevels.filter((level) => level === 'light_modify' || level === 'redevelop').length;
  const redevelopCount = moduleLevels.filter((level) => level === 'redevelop').length;
  const gateSuggestion = redevelopCount > 0 || deepChangeCount >= 2
    ? '建议按大改款 Gate 深度控制'
    : '建议按中改款 Gate 深度控制';
  const fullTaskCount = getProjectPhases(project).reduce((sum, phase) => sum + phase.tasks.length, 0);
  const effectiveTaskCount = getDerivativeEffectiveTaskIds(draftStrategy, project.sopTemplateVersion).size;

  const updateLevel = (moduleId: string, level: DerivativeReuseLevel) => {
    if (!canEdit) return;
    setDraftStrategy((prev) => ({ ...prev, [moduleId]: level }));
  };

  const resetDraft = () => {
    setDraftStrategy(committedStrategy);
  };

  const confirmApply = () => {
    if (!canEdit || project.category !== 'derivative' || applyStrategy.isPending) return;
    applyStrategy.mutate({ projectId: project.id, strategy: toStrategyRecord(normalizeDerivativeReuseStrategy(draftStrategy)) });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">流程策略</h3>
        <div className="rounded-[11px] border border-border bg-card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <GitBranch size={15} className="text-primary" />
                模块复用驱动的 DRV 裁剪
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                大改款/中改款先按电池、机芯、PCBA、软件、结构/模具、包装/认证判断复用等级，再绑定保留任务、交付物和 Gate 深度。极小改仍走 ECO，纯外观/换色仍走 IDR。
              </p>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                同一个任务只要仍被任一非直接复用模块需要，就会保留；当多个模块都直接复用且边界未变时，有效任务数会自动减少。
              </p>
            </div>
            <div className="shrink-0 rounded-[8px] border border-border bg-secondary px-3 py-2 text-xs">
              <div className="text-muted-foreground">当前建议</div>
              <div className="mt-0.5 font-medium text-foreground">{gateSuggestion}</div>
              <div className="mt-1 num text-[11px] text-muted-foreground">有效任务 {effectiveTaskCount}/{fullTaskCount}</div>
              <div className={`mt-1 text-[11px] ${dirty ? 'text-[color:var(--warning)]' : 'text-muted-foreground'}`}>
                {dirty ? '有未应用调整' : '已应用到项目'}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-5">
            {[
              ['P1', '输出初版'],
              ['Gate1', '冻结等级/深度'],
              ['Gate2', '复核验证矩阵'],
              ['EVT Gate', '关闭选做项'],
              ['DVT Gate', '确认 PVT 保留项'],
            ].map(([code, label]) => (
              <div key={code} className="border border-border bg-background px-3 py-2">
                <div className="text-[10px] num uppercase tracking-wider text-muted-foreground">{code}</div>
                <div className="mt-0.5 text-xs font-medium text-foreground">{label}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-xs leading-relaxed text-muted-foreground">
              调整复用等级后，需要确认应用，系统才会同步任务构成、排期和负责人。已完成或待审批任务不会被直接裁剪。
            </div>
            {canEdit && project.category === 'derivative' && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={resetDraft}
                  disabled={!dirty || applyStrategy.isPending}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-border px-3 py-1.5 text-xs text-[color:var(--secondary-foreground)] transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  撤销调整
                </button>
                <button
                  type="button"
                  onClick={confirmApply}
                  disabled={!dirty || applyStrategy.isPending}
                  className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {applyStrategy.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  确认应用
                </button>
              </div>
            )}
            {!canEdit && (
              <div className="text-xs text-muted-foreground">仅 Owner / 管理层 / PM 可应用流程策略</div>
            )}
          </div>
        </div>
      </div>

      {project.category !== 'derivative' && (
        <div className="rounded-[11px] border border-border bg-secondary p-4 text-sm text-muted-foreground">
          当前项目类型不是 DRV。模块复用策略主要用于产品迭代/衍生开发；如只是换料、降本、小范围设计变更，建议保持 ECO 流程。
        </div>
      )}

      <div className="overflow-hidden rounded-[11px] border border-border bg-card">
        <div className="grid grid-cols-[1.1fr_1fr_1.4fr_1.2fr] gap-px bg-border text-[11px] uppercase tracking-wider text-muted-foreground max-lg:hidden">
          <div className="bg-secondary px-3 py-2">模块类型</div>
          <div className="bg-secondary px-3 py-2">复用等级</div>
          <div className="bg-secondary px-3 py-2">Gate 深度</div>
          <div className="bg-secondary px-3 py-2">任务 / 交付物</div>
        </div>

        <div className="divide-y divide-border">
          {DERIVATIVE_REUSE_MODULE_RULES.map((rule) => {
            const selectedLevel = draftStrategy[rule.id] ?? rule.defaultLevel;
            return (
              <div key={rule.id} className="grid grid-cols-1 gap-0 lg:grid-cols-[1.1fr_1fr_1.4fr_1.2fr]">
                <div className="border-border p-3 lg:border-r">
                  <div className="text-sm font-semibold text-foreground">{rule.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rule.examples}</p>
                  {rule.cannotCut && (
                    <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--warning)]">{rule.cannotCut}</p>
                  )}
                </div>

                <div className="border-border p-3 lg:border-r">
                  <label className="sr-only" htmlFor={`reuse-${rule.id}`}>{rule.name}复用等级</label>
                  <select
                    id={`reuse-${rule.id}`}
                    value={selectedLevel}
                    onChange={(event) => updateLevel(rule.id, event.target.value as DerivativeReuseLevel)}
                    disabled={!canEdit}
                    className="w-full rounded-[8px] border border-border bg-background px-2 py-2 text-xs text-foreground outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
                  >
                    {Object.entries(DERIVATIVE_REUSE_LEVEL_LABELS).map(([level, label]) => (
                      <option key={level} value={level}>{label}</option>
                    ))}
                  </select>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {rule.timing.slice(0, 3).map((item) => (
                      <span key={item} className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{item}</span>
                    ))}
                  </div>
                </div>

                <div className="border-border p-3 lg:border-r">
                  <p className="text-xs leading-relaxed text-foreground">{rule.gateDepth[selectedLevel]}</p>
                </div>

                <div className="p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {rule.taskIds.map((taskId) => (
                      <span key={taskId} className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] num text-foreground">{taskId}</span>
                    ))}
                  </div>
                  <div className="mt-2 space-y-1">
                    {rule.deliverables.map((item) => (
                      <div key={item} className="text-[11px] leading-snug text-muted-foreground">{item}</div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SopRiskScopePanel({ project, canEdit, isAdmin }: { project: Project; canEdit: boolean; isAdmin: boolean }) {
  const utils = trpc.useUtils();
  const { data: riskScope, isLoading } = trpc.projects.riskScope.useQuery({ projectId: project.id });
  const [draft, setDraft] = useState<ProjectChangeScopeDeclaration>(EMPTY_CHANGE_SCOPE_DECLARATION);

  useEffect(() => {
    setDraft({
      ...EMPTY_CHANGE_SCOPE_DECLARATION,
      ...(riskScope?.declaration ?? project.changeScopeDeclaration ?? {}),
      targetMarkets: riskScope?.declaration?.targetMarkets ?? project.changeScopeDeclaration?.targetMarkets ?? [],
    });
  }, [project.id, project.changeScopeDeclaration, riskScope?.id]);

  const save = trpc.projects.setRiskScope.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.projects.riskScope.invalidate({ projectId: project.id }),
        utils.projects.get.invalidate({ id: project.id }),
      ]);
      toast.success('变更范围声明已生成新版本，风险和 Gate 要求已重新计算');
    },
    onError: (error) => toast.error(error.message),
  });
  const confirmScope = trpc.projects.confirmRiskScope.useMutation({
    onSuccess: async () => {
      await utils.projects.riskScope.invalidate({ projectId: project.id });
      toast.success('专业确认已记录');
    },
    onError: (error) => toast.error(error.message),
  });

  const assessment = riskScope?.assessment;
  const highSafety = (assessment?.safetyRiskLevel ?? project.safetyRiskLevel) === 'high';
  const highRegulatory = (assessment?.regulatoryRiskLevel ?? project.regulatoryRiskLevel) === 'high';
  const scopePerms = useProjectPermission(project.id);
  const scopeHasAnyRole = (list: readonly string[]) =>
    scopePerms.roles.some((role) => list.includes(role)) || list.includes(project.accessRole ?? '');
  const canConfirmEngineering = isAdmin || scopeHasAnyRole(['rd_hw', 'rd_sw', 'rd_mech']);
  const canConfirmQaOrCert = isAdmin || scopeHasAnyRole(['qa', 'cert', 'battery_safety']);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground">变更范围声明与自动风险</h3>
        <div className="flex items-center gap-2 text-[10px]">
          <span className={`rounded border px-2 py-1 ${highSafety ? 'border-red-300 bg-red-50 text-red-700' : 'border-border text-muted-foreground'}`}>
            安全 {highSafety ? '高风险' : '标准'}
          </span>
          <span className={`rounded border px-2 py-1 ${highRegulatory ? 'border-red-300 bg-red-50 text-red-700' : 'border-border text-muted-foreground'}`}>
            法规 {highRegulatory ? '高风险' : '标准'}
          </span>
          {riskScope?.version && <span className="num text-muted-foreground">v{riskScope.version}</span>}
        </div>
      </div>

      <div className="rounded-[11px] border border-border bg-card p-4">
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          系统只读取这些结构化选项和产品目标市场，不扫描备注关键词。风险升级会作废未完成的 Gate 会签轮次并按新矩阵重开。
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />加载声明…</div>
        ) : (
          <>
            <div className="grid gap-2 md:grid-cols-2">
              {CHANGE_SCOPE_FIELDS.map((field) => (
                <label key={field.key} className="flex items-start gap-2 rounded-[8px] border border-border bg-background px-3 py-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={draft[field.key] === true}
                    disabled={!canEdit}
                    onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>{field.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                本项目目标市场
                <input
                  value={draft.targetMarkets.join(', ')}
                  disabled={!canEdit}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    targetMarkets: event.target.value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
                  }))}
                  placeholder="例如 US, EU, JP"
                  className="mt-1 w-full rounded-[8px] border border-border bg-background px-3 py-2 text-xs normal-case text-foreground outline-none focus:border-primary disabled:bg-secondary"
                />
              </label>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                声明备注（不参与自动判定）
                <input
                  value={draft.notes ?? ''}
                  disabled={!canEdit}
                  onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="说明范围和依据"
                  className="mt-1 w-full rounded-[8px] border border-border bg-background px-3 py-2 text-xs normal-case text-foreground outline-none focus:border-primary disabled:bg-secondary"
                />
              </label>
            </div>

            {(assessment?.safetyReasons?.length || assessment?.regulatoryReasons?.length) ? (
              <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                {[...(assessment?.safetyReasons ?? []), ...(assessment?.regulatoryReasons ?? [])].filter((item, index, all) => all.indexOf(item) === index).join('；')}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div className="text-[11px] text-muted-foreground">
                研发确认：{riskScope?.engineeringConfirmedAt ? '已确认' : '待确认'} · QA/认证确认：{riskScope?.qaOrCertConfirmedAt ? '已确认' : '待确认'}
              </div>
              <div className="flex flex-wrap gap-2">
                {riskScope?.version && (canConfirmEngineering || canConfirmQaOrCert) && (
                  <>
                    {canConfirmEngineering && (
                      <button type="button" onClick={() => confirmScope.mutate({ projectId: project.id, version: riskScope.version, kind: 'engineering' })}
                        disabled={confirmScope.isPending} className="rounded-[8px] border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50">研发确认</button>
                    )}
                    {canConfirmQaOrCert && (
                      <button type="button" onClick={() => confirmScope.mutate({ projectId: project.id, version: riskScope.version, kind: 'qa_or_cert' })}
                        disabled={confirmScope.isPending} className="rounded-[8px] border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50">QA/认证确认</button>
                    )}
                  </>
                )}
                {canEdit && (
                  <button type="button" onClick={() => save.mutate({ projectId: project.id, declaration: draft })}
                    disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                    {save.isPending && <Loader2 size={12} className="animate-spin" />}
                    保存为新版本
                  </button>
                )}
              </div>
            </div>
          </>
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
  const editClass = "w-full border-b border-transparent pb-0.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-border focus:border-primary";
  return (
    <div className={className ?? ''}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</div>
      {!canEdit ? (
        <div className="text-sm text-foreground whitespace-pre-wrap min-h-[1.25rem]">{value || <span className="text-muted-foreground">—</span>}</div>
      ) : textarea ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} rows={3} placeholder={placeholder}
          className={`${editClass} resize-none`} />
      ) : (
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} placeholder={placeholder}
          className={editClass} />
      )}
    </div>
  );
}

function InfoCell({ icon, label, value, mono, className }: { icon: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{icon}{label}</div>
      <div className={`text-sm text-foreground ${mono ? 'num' : ''}`}>{value}</div>
    </div>
  );
}

function Metric({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-[10px] uppercase tracking-wider">{label}</span></div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-2xl font-semibold ${accent ?? 'text-foreground'}`}>{value}</span>
        {sub && <span className="text-[11px] num text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}
