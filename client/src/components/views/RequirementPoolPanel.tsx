import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import type { SOPPhase } from '@/lib/data';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { LinearCard, Kicker, SegToggle } from '@/components/linear/primitives';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Edit2,
  Flag,
  Inbox,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  PauseCircle,
  Plus,
  Search,
  Target,
  Trash2,
  X,
  XCircle,
  ArrowUpRight,
} from 'lucide-react';

type RequirementStatus = 'new' | 'triaged' | 'planned' | 'in_progress' | 'accepted' | 'deferred' | 'rejected';
type RequirementPriority = 'P0' | 'P1' | 'P2' | 'P3';
type RequirementSource = 'customer' | 'sales' | 'market' | 'internal' | 'regulatory' | 'manufacturing' | 'quality' | 'supplier' | 'other';
type RequirementType = 'functional' | 'performance' | 'compliance' | 'cost' | 'schedule' | 'quality' | 'manufacturing' | 'ux' | 'packaging' | 'other';

type ConvertTarget = 'task' | 'issue' | 'change';

type Requirement = {
  id: number;
  projectId: string | null;
  productId?: string | null;
  convertedType?: ConvertTarget | null;
  convertedId?: string | null;
  title: string;
  description: string | null;
  source: RequirementSource;
  sourceDetail: string | null;
  type: RequirementType;
  priority: RequirementPriority;
  status: RequirementStatus;
  owner: string | null;
  targetPhaseId: string | null;
  linkedTaskId: string | null;
  businessGoal: string | null;
  projectGoal: string | null;
  successMetric: string | null;
  acceptanceCriteria: string | null;
  decisionNote: string | null;
  creatorId: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RequirementForm = {
  title: string;
  description: string;
  source: RequirementSource;
  sourceDetail: string;
  type: RequirementType;
  priority: RequirementPriority;
  status: RequirementStatus;
  owner: string;
  targetPhaseId: string;
  linkedTaskId: string;
  businessGoal: string;
  projectGoal: string;
  successMetric: string;
  acceptanceCriteria: string;
  decisionNote: string;
};

// Status badge styling — each real status keeps a tone token. Linear palette.
const STATUS_OPTIONS: Array<{
  value: RequirementStatus;
  label: string;
  badge: string;
  /** badge classes (bg/text/border via CSS vars) */
  cls: string;
  /** solid color (CSS var) for dots / accents */
  color: string;
  icon: ReactNode;
}> = [
  { value: 'new', label: '新需求', badge: 'NEW', cls: 'bg-secondary text-[color:var(--secondary-foreground)] border-border', color: 'var(--muted-foreground)', icon: <AlertCircle size={11} /> },
  { value: 'triaged', label: '已澄清', badge: 'TRIAGED', cls: 'bg-[color:var(--acc-soft)] text-primary border-[color:var(--acc-border)]', color: 'var(--primary)', icon: <Search size={11} /> },
  { value: 'planned', label: '已纳入计划', badge: 'PLANNED', cls: 'bg-[color:var(--acc-soft)] text-primary border-[color:var(--acc-border)]', color: 'var(--primary)', icon: <Target size={11} /> },
  { value: 'in_progress', label: '执行中', badge: 'DOING', cls: 'bg-[color:var(--acc-soft)] text-primary border-[color:var(--acc-border)]', color: 'var(--primary)', icon: <Clock size={11} /> },
  { value: 'accepted', label: '已验收', badge: 'ACCEPTED', cls: 'bg-[color:var(--success-soft,#e7f6ee)] text-[color:var(--success)] border-[color:var(--success)]/30', color: 'var(--success)', icon: <CheckCircle2 size={11} /> },
  { value: 'deferred', label: '暂缓', badge: 'DEFERRED', cls: 'bg-[color:var(--warning-soft,#fbf0dd)] text-[color:var(--warning)] border-[color:var(--warning)]/30', color: 'var(--warning)', icon: <PauseCircle size={11} /> },
  { value: 'rejected', label: '已拒绝', badge: 'REJECTED', cls: 'bg-[color:var(--destructive-soft,#fdeceb)] text-[color:var(--destructive)] border-[color:var(--destructive)]/30', color: 'var(--destructive)', icon: <XCircle size={11} /> },
];

// Priority drives differentiation (no vote field exists). Flag tone + left-border accent.
const PRIORITY_OPTIONS: Array<{ value: RequirementPriority; label: string; short: string; color: string; border: string }> = [
  { value: 'P0', label: 'P0 必须满足', short: '高', color: 'var(--destructive)', border: 'border-l-[color:var(--destructive)]' },
  { value: 'P1', label: 'P1 高价值', short: '高', color: 'var(--warning)', border: 'border-l-[color:var(--warning)]' },
  { value: 'P2', label: 'P2 常规', short: '中', color: 'var(--primary)', border: 'border-l-[color:var(--primary)]' },
  { value: 'P3', label: 'P3 可选', short: '低', color: 'var(--muted-foreground)', border: 'border-l-border' },
];

// Visual status groups (the design's 4 buckets). Real 7 statuses fold into these.
type GroupKey = 'new' | 'review' | 'planned' | 'rejected';
const STATUS_GROUPS: Array<{ key: GroupKey; label: string; color: string; statuses: RequirementStatus[] }> = [
  { key: 'new', label: '新建 / 待评估', color: 'var(--muted-foreground)', statuses: ['new'] },
  { key: 'review', label: '评估中', color: 'var(--primary)', statuses: ['triaged'] },
  { key: 'planned', label: '已立项', color: 'var(--success)', statuses: ['planned', 'in_progress', 'accepted'] },
  { key: 'rejected', label: '已拒绝 / 暂缓', color: 'var(--border)', statuses: ['deferred', 'rejected'] },
];
const STATUS_TO_GROUP: Record<RequirementStatus, GroupKey> = STATUS_GROUPS.reduce((acc, g) => {
  g.statuses.forEach((s) => { acc[s] = g.key; });
  return acc;
}, {} as Record<RequirementStatus, GroupKey>);

// Source badge styling (design: 客户/市场/内部 colored chips; other sources fall back to neutral).
const SOURCE_BADGE: Record<RequirementSource, string> = {
  customer: 'bg-[color:var(--acc-soft)] text-primary',
  sales: 'bg-[color:var(--acc-soft)] text-primary',
  market: 'bg-[color:var(--warning-soft,#fbf0dd)] text-[color:var(--warning)]',
  internal: 'bg-secondary text-[color:var(--secondary-foreground)]',
  regulatory: 'bg-secondary text-[color:var(--secondary-foreground)]',
  manufacturing: 'bg-secondary text-[color:var(--secondary-foreground)]',
  quality: 'bg-secondary text-[color:var(--secondary-foreground)]',
  supplier: 'bg-secondary text-[color:var(--secondary-foreground)]',
  other: 'bg-secondary text-[color:var(--secondary-foreground)]',
};

// Source filter chips (design has all/客户/市场/内部).
const SOURCE_FILTERS: Array<{ key: 'all' | RequirementSource; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'customer', label: '客户' },
  { key: 'market', label: '市场' },
  { key: 'internal', label: '内部' },
];

const SOURCE_LABELS: Record<RequirementSource, string> = {
  customer: '客户',
  sales: '销售/渠道',
  market: '市场',
  internal: '内部',
  regulatory: '法规/认证',
  manufacturing: '制造',
  quality: '质量',
  supplier: '供应商',
  other: '其他',
};

const TYPE_LABELS: Record<RequirementType, string> = {
  functional: '功能',
  performance: '性能',
  compliance: '合规',
  cost: '成本',
  schedule: '进度',
  quality: '质量',
  manufacturing: '制造',
  ux: '体验',
  packaging: '包装',
  other: '其他',
};

// Shared input/select/textarea styling (Linear field).
const FIELD_CLS = 'w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-[color:var(--acc-border)]';

const emptyForm = (): RequirementForm => ({
  title: '',
  description: '',
  source: 'internal',
  sourceDetail: '',
  type: 'functional',
  priority: 'P2',
  status: 'new',
  owner: '',
  targetPhaseId: '',
  linkedTaskId: '',
  businessGoal: '',
  projectGoal: '',
  successMetric: '',
  acceptanceCriteria: '',
  decisionNote: '',
});

function StatusBadge({ status }: { status: RequirementStatus }) {
  const cfg = STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[0];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em]', cfg.cls)}>
      {cfg.icon}
      {cfg.badge}
    </span>
  );
}

function PriorityFlag({ priority }: { priority: RequirementPriority }) {
  const cfg = PRIORITY_OPTIONS.find((p) => p.value === priority) || PRIORITY_OPTIONS[2];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: cfg.color }} title={`${cfg.label}`}>
      <Flag size={12} style={{ fill: cfg.color, color: cfg.color }} />
      <span className="num">{priority}</span>
    </span>
  );
}

function priorityBorder(priority: RequirementPriority): string {
  return (PRIORITY_OPTIONS.find((p) => p.value === priority) || PRIORITY_OPTIONS[2]).border;
}

function SourceBadge({ source }: { source: RequirementSource }) {
  return (
    <span className={cn('inline-flex items-center rounded-[6px] px-2 py-0.5 text-[11px] font-semibold', SOURCE_BADGE[source])}>
      {SOURCE_LABELS[source]}
    </span>
  );
}

function ChainStep({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <Kicker className="mb-0.5 text-[10px]">{label}</Kicker>
      <div className="text-xs leading-relaxed text-[color:var(--secondary-foreground)] line-clamp-3 whitespace-pre-wrap">
        {value || <span className="text-muted-foreground/50">—</span>}
      </div>
    </div>
  );
}

function toForm(row: Requirement): RequirementForm {
  return {
    title: row.title,
    description: row.description || '',
    source: row.source,
    sourceDetail: row.sourceDetail || '',
    type: row.type,
    priority: row.priority,
    status: row.status,
    owner: row.owner || '',
    targetPhaseId: row.targetPhaseId || '',
    linkedTaskId: row.linkedTaskId || '',
    businessGoal: row.businessGoal || '',
    projectGoal: row.projectGoal || '',
    successMetric: row.successMetric || '',
    acceptanceCriteria: row.acceptanceCriteria || '',
    decisionNote: row.decisionNote || '',
  };
}

function cleanForm(form: RequirementForm) {
  return {
    title: form.title.trim(),
    description: form.description.trim() || null,
    source: form.source,
    sourceDetail: form.sourceDetail.trim() || null,
    type: form.type,
    priority: form.priority,
    status: form.status,
    owner: form.owner.trim() || null,
    targetPhaseId: form.targetPhaseId || null,
    linkedTaskId: form.linkedTaskId || null,
    businessGoal: form.businessGoal.trim() || null,
    projectGoal: form.projectGoal.trim() || null,
    successMetric: form.successMetric.trim() || null,
    acceptanceCriteria: form.acceptanceCriteria.trim() || null,
    decisionNote: form.decisionNote.trim() || null,
  };
}

function formatDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

const CONVERT_LABELS: Record<ConvertTarget, string> = { task: '任务', issue: '问题', change: '变更' };
type ChangeType = 'decision' | 'tradeoff' | 'eco' | 'ecn' | 'spec' | 'cost' | 'schedule' | 'supplier' | 'other';
const CHANGE_TYPE_OPTIONS: Array<{ value: ChangeType; label: string }> = [
  { value: 'spec', label: '规格变更' },
  { value: 'eco', label: 'ECO 工程变更' },
  { value: 'ecn', label: 'ECN 变更通知' },
  { value: 'cost', label: '成本变更' },
  { value: 'schedule', label: '进度变更' },
  { value: 'supplier', label: '供应商变更' },
  { value: 'decision', label: '关键决策' },
  { value: 'tradeoff', label: '方案取舍' },
  { value: 'other', label: '其他' },
];

/** 三种使用场景:项目过滤视图 / 产品 backlog / 全局池。一套面板、多视图。 */
export type RequirementPanelScope =
  | { kind: 'project'; projectId: string; phases: SOPPhase[] }
  | { kind: 'product'; productId: string }
  | { kind: 'global' };

interface RequirementPoolPanelProps {
  scope: RequirementPanelScope;
  /** 是否可编辑/删除/转化(管理)。项目视图传项目角色;产品/全局可改用 canManageRow 细分到行 */
  canEdit?: boolean;
  /** 是否可新增需求(提需求);默认跟随 canEdit。产品/全局可设为 true 实现「人人可提」 */
  canCreate?: boolean;
  /** 逐行管理权限判定;默认 () => canEdit。产品/全局可传「admin 或创建人」 */
  canManageRow?: (row: Requirement) => boolean;
  title?: string;
  subtitle?: string;
}

const NO_PHASES: SOPPhase[] = [];

export function RequirementPoolPanel({ scope, canEdit = false, canCreate, canManageRow, title, subtitle }: RequirementPoolPanelProps) {
  const allowCreate = canCreate ?? canEdit;
  const canManage = canManageRow ?? (() => canEdit);
  const projectId = scope.kind === 'project' ? scope.projectId : undefined;
  const phases = scope.kind === 'project' ? scope.phases : NO_PHASES;
  const listInput = useMemo(
    () => (scope.kind === 'project' ? { projectId: scope.projectId }
      : scope.kind === 'product' ? { productId: scope.productId }
      : {}),
    [scope]
  );

  const utils = trpc.useUtils();
  const { data = [], isLoading } = trpc.requirements.list.useQuery(listInput);
  const requirements = data as Requirement[];
  const invalidateList = () => utils.requirements.list.invalidate(listInput);
  const createMutation = trpc.requirements.create.useMutation({ onSuccess: invalidateList });
  const updateMutation = trpc.requirements.update.useMutation({ onSuccess: invalidateList });
  const deleteMutation = trpc.requirements.delete.useMutation({ onSuccess: invalidateList });
  const convertMutation = trpc.requirements.convert.useMutation({
    onSuccess: () => {
      invalidateList();
      if (projectId) {
        // 让新建的问题/变更立即出现在对应 tab
        utils.issues.list.invalidate({ projectId });
        utils.changelog.list.invalidate({ projectId });
      }
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [statusFilter, setStatusFilter] = useState<RequirementStatus | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | RequirementSource>('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');

  const selectedPhase = phases.find((p) => p.id === form.targetPhaseId);
  const linkedTaskOptions = selectedPhase?.tasks || [];

  const set = <K extends keyof RequirementForm>(key: K, value: RequirementForm[K]) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'targetPhaseId' ? { linkedTaskId: '' } : {}),
    }));
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (row: Requirement) => {
    setEditingId(row.id);
    setForm(toForm(row));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const handleSave = async () => {
    const payload = cleanForm(form);
    if (!payload.title) {
      toast.error('请填写需求标题');
      return;
    }
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, patch: payload });
      } else if (scope.kind === 'project') {
        await createMutation.mutateAsync({ projectId: scope.projectId, ...payload });
      } else if (scope.kind === 'product') {
        await createMutation.mutateAsync({ productId: scope.productId, ...payload });
      } else {
        await createMutation.mutateAsync({ ...payload });
      }
      toast.success(editingId ? '需求已更新' : '需求已创建');
      closeForm();
    } catch (err) {
      toast.error(`保存失败：${err instanceof Error ? err.message : '请重试'}`);
    }
  };

  const handleQuickStatus = (row: Requirement, status: RequirementStatus) => {
    if (!canManage(row) || row.status === status) return;
    updateMutation.mutate({ id: row.id, patch: { status } });
  };

  const handleDelete = (row: Requirement) => {
    if (!confirm(`删除需求「${row.title}」？`)) return;
    deleteMutation.mutate({ id: row.id });
  };

  // ── 采纳转化 ──────────────────────────────────────────────────────────────
  const [convertRow, setConvertRow] = useState<Requirement | null>(null);
  const [convertForm, setConvertForm] = useState<{ target: ConvertTarget; phaseId: string; taskId: string; changeType: ChangeType; note: string }>(
    { target: 'issue', phaseId: '', taskId: '', changeType: 'spec', note: '' }
  );
  const convertPhase = phases.find((p) => p.id === convertForm.phaseId);

  const openConvert = (row: Requirement) => {
    setConvertForm({
      target: 'issue',
      phaseId: row.targetPhaseId || phases[0]?.id || '',
      taskId: row.linkedTaskId || '',
      changeType: 'other',
      note: '',
    });
    setConvertRow(row);
  };

  const handleConvert = async () => {
    if (!convertRow || scope.kind !== 'project') return;
    const f = convertForm;
    if (f.target === 'task' && !f.taskId) { alert('请选择要关联的任务'); return; }
    await convertMutation.mutateAsync({
      id: convertRow.id,
      target: f.target,
      projectId: scope.projectId,
      phaseId: f.phaseId || undefined,
      taskId: f.target === 'task' ? f.taskId : undefined,
      changeType: f.target === 'change' ? f.changeType : undefined,
      note: f.note || undefined,
    });
    setConvertRow(null);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requirements
      .filter((row) => statusFilter === 'all' || row.status === statusFilter)
      .filter((row) => sourceFilter === 'all' || row.source === sourceFilter)
      .filter((row) => {
        if (!q) return true;
        return [
          row.title,
          row.description,
          row.sourceDetail,
          row.owner,
          row.businessGoal,
          row.projectGoal,
          row.successMetric,
          row.acceptanceCriteria,
          row.decisionNote,
        ].some((value) => (value || '').toLowerCase().includes(q));
      });
  }, [requirements, search, statusFilter, sourceFilter]);

  // Bucket the filtered rows into the 4 visual status groups (design grouping).
  const grouped = useMemo(() => {
    const map = new Map<GroupKey, Requirement[]>();
    STATUS_GROUPS.forEach((g) => map.set(g.key, []));
    filtered.forEach((row) => { map.get(STATUS_TO_GROUP[row.status])?.push(row); });
    return map;
  }, [filtered]);

  const stats = {
    total: requirements.length,
    open: requirements.filter((r) => r.status === 'new' || r.status === 'triaged').length,
    planned: requirements.filter((r) => ['planned', 'in_progress', 'accepted'].includes(r.status)).length,
    closed: requirements.filter((r) => r.status === 'deferred' || r.status === 'rejected').length,
  };

  // Linked project code for accepted/planned items (design: 已立项关联项目编号).
  const linkedCode = (row: Requirement): string | null => {
    if (row.convertedType && row.convertedId) {
      return `${CONVERT_LABELS[row.convertedType]} ${row.convertedId}`;
    }
    return null;
  };

  // ── Compact board card (design: 看板卡片) ──
  function BoardCard({ row }: { row: Requirement }) {
    const link = linkedCode(row);
    return (
      <LinearCard hover className={cn('border-l-[3px] p-3', priorityBorder(row.priority))}>
        <div className="flex items-start justify-between gap-2">
          <PriorityFlag priority={row.priority} />
          {canManage(row) && (
            <div className="flex items-center gap-0.5">
              <button onClick={() => openEdit(row)} className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="编辑需求">
                <Edit2 size={13} />
              </button>
              <button onClick={() => handleDelete(row)} className="rounded p-1 text-muted-foreground transition-colors hover:bg-[color:var(--destructive-soft,#fdeceb)] hover:text-[color:var(--destructive)]" title="删除需求">
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
        <div className="mt-1.5 text-[12.5px] font-semibold leading-snug text-foreground">{row.title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <SourceBadge source={row.source} />
          <span className="num text-[10px] text-muted-foreground">REQ-{String(row.id).padStart(4, '0')}</span>
        </div>
        {link && (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
            <ArrowUpRight size={11} />{link}
          </span>
        )}
      </LinearCard>
    );
  }

  // ── Full list card (rich detail preserved) ──
  function ListCard({ row }: { row: Requirement }) {
    const phase = phases.find((p) => p.id === row.targetPhaseId);
    const task = phase?.tasks.find((t) => t.id === row.linkedTaskId);
    const hasValueChain = !!(row.businessGoal || row.projectGoal || row.successMetric || row.convertedType);
    return (
      <LinearCard hover className={cn('border-l-[3px] p-4', priorityBorder(row.priority))}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <PriorityFlag priority={row.priority} />
              <StatusBadge status={row.status} />
              <SourceBadge source={row.source} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{TYPE_LABELS[row.type]}</span>
              <span className="num text-[10px] text-muted-foreground/60">REQ-{String(row.id).padStart(4, '0')}</span>
              {row.convertedType && (
                <span className="inline-flex items-center gap-1 rounded-[6px] border border-[color:var(--success)]/30 bg-[color:var(--success-soft,#e7f6ee)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--success)]">
                  <ArrowUpRight size={10} />
                  已转{CONVERT_LABELS[row.convertedType]}{row.convertedType !== 'task' ? ` #${row.convertedId}` : ` ${row.convertedId}`}
                </span>
              )}
            </div>
            <h4 className="text-sm font-semibold leading-snug text-foreground">{row.title}</h4>
            {row.description && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{row.description}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>来源：<span className="text-[color:var(--secondary-foreground)]">{SOURCE_LABELS[row.source]}</span>{row.sourceDetail ? ` · ${row.sourceDetail}` : ''}</span>
              {row.owner && <span>负责人：<span className="text-[color:var(--secondary-foreground)]">{row.owner}</span></span>}
              {phase && <span>阶段：<span className="text-[color:var(--secondary-foreground)]">{phase.code} {phase.name}</span></span>}
              {task && <span>任务：<span className="num text-[color:var(--secondary-foreground)]">{task.id}</span></span>}
              <span>创建：<span className="num">{formatDate(row.createdAt)}</span></span>
            </div>
            {hasValueChain && (
              <div className="mt-3 rounded-[9px] border border-border bg-secondary px-3 py-2">
                <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
                  <Target size={11} />
                  <Kicker className="text-[10px]">价值链路</Kicker>
                </div>
                <div className="grid grid-cols-1 gap-2 text-xs lg:grid-cols-4">
                  <ChainStep label="商业目标" value={row.businessGoal} />
                  <ChainStep label="项目目标" value={row.projectGoal} />
                  <ChainStep label="需求" value={row.title} />
                  <ChainStep
                    label="执行承接"
                    value={row.convertedType ? `${CONVERT_LABELS[row.convertedType]} ${row.convertedId ?? ''}` : null}
                  />
                </div>
                {row.successMetric && (
                  <div className="mt-2 border-t border-border pt-2">
                    <Kicker className="mb-1 text-[10px]">成功指标</Kicker>
                    <div className="text-xs text-[color:var(--secondary-foreground)] whitespace-pre-wrap">{row.successMetric}</div>
                  </div>
                )}
              </div>
            )}
            {(row.acceptanceCriteria || row.decisionNote) && (
              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                {row.acceptanceCriteria && (
                  <div className="rounded-[9px] border border-border bg-secondary px-3 py-2">
                    <Kicker className="mb-1 text-[10px]">验收标准</Kicker>
                    <div className="text-xs text-[color:var(--secondary-foreground)] whitespace-pre-wrap">{row.acceptanceCriteria}</div>
                  </div>
                )}
                {row.decisionNote && (
                  <div className="rounded-[9px] border border-[color:var(--warning)]/25 bg-[color:var(--warning-soft,#fbf0dd)] px-3 py-2">
                    <Kicker className="mb-1 text-[10px] text-[color:var(--warning)]">决策备注</Kicker>
                    <div className="text-xs text-[color:var(--secondary-foreground)] whitespace-pre-wrap">{row.decisionNote}</div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 lg:justify-end">
            {canManage(row) && (
              <select
                value={row.status}
                onChange={(e) => handleQuickStatus(row, e.target.value as RequirementStatus)}
                className="rounded-[7px] border border-border bg-secondary px-2 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-[color:var(--acc-border)]"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            )}
            {scope.kind === 'project' && canManage(row) && !row.convertedType && (
              <button onClick={() => openConvert(row)} className="inline-flex items-center gap-1 rounded-[7px] border border-[color:var(--success)]/30 bg-[color:var(--success-soft,#e7f6ee)] px-2 py-1.5 text-xs font-medium text-[color:var(--success)] transition-colors hover:opacity-90" title="采纳并转为任务/问题/变更">
                <ArrowUpRight size={13} />采纳转化
              </button>
            )}
            {canManage(row) && (
              <>
                <button onClick={() => openEdit(row)} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="编辑需求">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => handleDelete(row)} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-[color:var(--destructive-soft,#fdeceb)] hover:text-[color:var(--destructive)]" title="删除需求">
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </LinearCard>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold tracking-[-0.3px] text-foreground">{title ?? '需求池'}</h3>
          <Kicker className="mt-0.5">{subtitle ?? 'REQUIREMENT POOL'}</Kicker>
        </div>
        <div className="flex items-center gap-2">
          <SegToggle<'list' | 'board'>
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'list', label: <><ListIcon size={12} />列表</> },
              { value: 'board', label: <><LayoutGrid size={12} />看板</> },
            ]}
          />
          {allowCreate && (
            <button
              onClick={openCreate}
              className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-[7px] bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:opacity-90"
            >
              <Plus size={15} />
              提交需求
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <LinearCard className="px-4 py-3">
          <Kicker>总需求</Kicker>
          <p className="num mt-0.5 text-2xl font-bold text-foreground">{stats.total}</p>
        </LinearCard>
        <LinearCard className="px-4 py-3">
          <Kicker className="text-primary">待澄清</Kicker>
          <p className="num mt-0.5 text-2xl font-bold text-primary">{stats.open}</p>
        </LinearCard>
        <LinearCard className="px-4 py-3">
          <Kicker className="text-[color:var(--success)]">已纳入</Kicker>
          <p className="num mt-0.5 text-2xl font-bold text-[color:var(--success)]">{stats.planned}</p>
        </LinearCard>
        <LinearCard className="px-4 py-3">
          <Kicker>暂缓/拒绝</Kicker>
          <p className="num mt-0.5 text-2xl font-bold text-muted-foreground">{stats.closed}</p>
        </LinearCard>
      </div>

      {showForm && (
        <LinearCard className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <div className="text-sm font-semibold text-foreground">{editingId ? '编辑需求' : '新增需求'}</div>
              <Kicker className="mt-0.5">CAPTURE / TRIAGE</Kicker>
            </div>
            <button onClick={closeForm} className="text-muted-foreground transition-colors hover:text-foreground">
              <X size={18} />
            </button>
          </div>
          <div className="space-y-4 p-4">
            <div>
              <Kicker className="mb-1.5">需求标题 *</Kicker>
              <input
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                className={FIELD_CLS}
                placeholder="例如：海外版增加低噪模式"
                autoFocus
              />
            </div>
            <div>
              <Kicker className="mb-1.5">需求描述</Kicker>
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={3}
                className={cn(FIELD_CLS, 'resize-none')}
                placeholder="记录背景、使用场景、约束条件和影响范围"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div>
                <Kicker className="mb-1.5">类型</Kicker>
                <select value={form.type} onChange={(e) => set('type', e.target.value as RequirementType)} className={FIELD_CLS}>
                  {(Object.keys(TYPE_LABELS) as RequirementType[]).map((value) => (
                    <option key={value} value={value}>{TYPE_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Kicker className="mb-1.5">来源</Kicker>
                <select value={form.source} onChange={(e) => set('source', e.target.value as RequirementSource)} className={FIELD_CLS}>
                  {(Object.keys(SOURCE_LABELS) as RequirementSource[]).map((value) => (
                    <option key={value} value={value}>{SOURCE_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Kicker className="mb-1.5">优先级</Kicker>
                <select value={form.priority} onChange={(e) => set('priority', e.target.value as RequirementPriority)} className={FIELD_CLS}>
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Kicker className="mb-1.5">状态</Kicker>
                <select value={form.status} onChange={(e) => set('status', e.target.value as RequirementStatus)} className={FIELD_CLS}>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              <div>
                <Kicker className="mb-1.5">来源说明</Kicker>
                <input value={form.sourceDetail} onChange={(e) => set('sourceDetail', e.target.value)} className={FIELD_CLS} placeholder="客户/渠道/会议" />
              </div>
              <div>
                <Kicker className="mb-1.5">负责人</Kicker>
                <input value={form.owner} onChange={(e) => set('owner', e.target.value)} className={FIELD_CLS} placeholder="PM / 工程负责人" />
              </div>
              {phases.length > 0 && (
                <>
                  <div>
                    <Kicker className="mb-1.5">目标阶段</Kicker>
                    <select value={form.targetPhaseId} onChange={(e) => set('targetPhaseId', e.target.value)} className={FIELD_CLS}>
                      <option value="">未指定</option>
                      {phases.map((phase) => (
                        <option key={phase.id} value={phase.id}>{phase.code} {phase.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Kicker className="mb-1.5">关联任务</Kicker>
                    <select value={form.linkedTaskId} onChange={(e) => set('linkedTaskId', e.target.value)} disabled={!form.targetPhaseId} className={cn(FIELD_CLS, 'disabled:bg-secondary disabled:text-muted-foreground')}>
                      <option value="">未关联</option>
                      {linkedTaskOptions.map((task) => (
                        <option key={task.id} value={task.id}>{task.id} {task.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <Kicker className="mb-1.5">商业目标</Kicker>
                <textarea value={form.businessGoal} onChange={(e) => set('businessGoal', e.target.value)} rows={3} className={cn(FIELD_CLS, 'resize-none')} placeholder="目标销量、收入、毛利、客户承诺或战略价值" />
              </div>
              <div>
                <Kicker className="mb-1.5">项目目标</Kicker>
                <textarea value={form.projectGoal} onChange={(e) => set('projectGoal', e.target.value)} rows={3} className={cn(FIELD_CLS, 'resize-none')} placeholder="本项目要解决的问题、交付范围或阶段目标" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div>
                <Kicker className="mb-1.5">成功指标</Kicker>
                <textarea value={form.successMetric} onChange={(e) => set('successMetric', e.target.value)} rows={3} className={cn(FIELD_CLS, 'resize-none')} placeholder="可量化 KPI、测试指标或放行标准" />
              </div>
              <div>
                <Kicker className="mb-1.5">验收标准</Kicker>
                <textarea value={form.acceptanceCriteria} onChange={(e) => set('acceptanceCriteria', e.target.value)} rows={3} className={cn(FIELD_CLS, 'resize-none')} placeholder="满足什么条件才算完成" />
              </div>
              <div>
                <Kicker className="mb-1.5">决策备注</Kicker>
                <textarea value={form.decisionNote} onChange={(e) => set('decisionNote', e.target.value)} rows={3} className={cn(FIELD_CLS, 'resize-none')} placeholder="采纳、延期或拒绝的原因" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={!form.title.trim() || createMutation.isPending || updateMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 size={13} className="animate-spin" />}
                保存需求
              </button>
              <button onClick={closeForm} className="rounded-[7px] border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary">
                取消
              </button>
            </div>
          </div>
        </LinearCard>
      )}

      {/* Toolbar: search + source filter + view-scoped status filter + count */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex h-[34px] w-full items-center gap-2 rounded-lg border border-border bg-card px-3 lg:max-w-xs focus-within:border-[color:var(--acc-border)] focus-within:ring-2 focus-within:ring-[color:var(--acc-soft)]">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="搜索需求…"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Source filter (design: all/客户/市场/内部) */}
          <div className="flex items-center gap-1.5">
            <Kicker>来源</Kicker>
            <div className="flex rounded-[7px] bg-[color:var(--secondary)] p-0.5">
              {SOURCE_FILTERS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSourceFilter(s.key)}
                  className={cn(
                    'rounded-[5px] px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
                    sourceFilter === s.key ? 'bg-card font-semibold text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]' : 'text-muted-foreground',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <span className="num text-[12px] text-muted-foreground">
            共 {filtered.length} 条 · {stats.open} 条待处理
          </span>
        </div>
      </div>

      {/* Status quick filter chips (real 7 statuses) */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <button
          onClick={() => setStatusFilter('all')}
          className={cn(
            'inline-flex h-[26px] items-center rounded-[7px] border px-2.5 text-[12px] whitespace-nowrap transition-colors',
            statusFilter === 'all'
              ? 'border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] text-primary'
              : 'border-transparent bg-secondary text-[color:var(--secondary-foreground)] hover:bg-[color:var(--muted)]',
          )}
        >
          全部状态
        </button>
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status.value}
            onClick={() => setStatusFilter(status.value)}
            className={cn(
              'inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border px-2.5 text-[12px] whitespace-nowrap transition-colors',
              statusFilter === status.value
                ? 'border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] text-primary'
                : 'border-transparent bg-secondary text-[color:var(--secondary-foreground)] hover:bg-[color:var(--muted)]',
            )}
          >
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: status.color }} />
            {status.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <LinearCard className="border-dashed px-4 py-12 text-center">
          <Inbox size={28} className="mx-auto mb-3 text-muted-foreground/40" />
          <div className="text-sm font-medium text-muted-foreground">暂无匹配需求</div>
          <div className="mt-1 text-xs text-muted-foreground/70">新的客户、市场、制造或合规诉求会先进入这里等待澄清</div>
        </LinearCard>
      ) : viewMode === 'board' ? (
        // ── 看板：4 状态组分列 ──
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          {STATUS_GROUPS.map((g) => {
            const items = grouped.get(g.key) ?? [];
            return (
              <div key={g.key} className="flex flex-col rounded-[12px] border border-border bg-[color:var(--secondary)]">
                <div className="flex items-center gap-2 px-3 pb-2.5 pt-3">
                  <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
                  <span className="flex-1 text-[12.5px] font-semibold text-foreground">{g.label}</span>
                  <span className="num rounded-full border border-border bg-card px-2 py-px text-[12px] text-muted-foreground">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2.5 px-2.5 pb-2.5">
                  {items.map((row) => <BoardCard key={row.id} row={row} />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // ── 列表：4 状态组分段 ──
        <div className="space-y-5">
          {STATUS_GROUPS.map((g) => {
            const items = grouped.get(g.key) ?? [];
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-[9px] w-[9px] rounded-full" style={{ background: g.color }} />
                  <span className="text-[12.5px] font-semibold text-foreground">{g.label}</span>
                  <span className="num text-[12px] text-muted-foreground">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((row) => <ListCard key={row.id} row={row} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 采纳转化子窗口 */}
      {convertRow && (
        <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-foreground/40 p-4 backdrop-blur-sm sm:p-8" onClick={() => setConvertRow(null)}>
          <LinearCard className="relative my-auto h-fit w-full max-w-[min(32rem,calc(100vw-1.5rem))] max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <div className="text-sm font-semibold text-foreground">采纳转化</div>
                <Kicker className="mt-0.5">「{convertRow.title}」</Kicker>
              </div>
              <button onClick={() => setConvertRow(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <Kicker className="mb-1.5">转为</Kicker>
                <div className="grid grid-cols-3 gap-2">
                  {(['issue', 'change', 'task'] as ConvertTarget[]).map((t) => (
                    <button key={t} onClick={() => setConvertForm((p) => ({ ...p, target: t }))}
                      className={cn('rounded-[7px] border px-3 py-2 text-sm transition-colors', convertForm.target === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-[color:var(--secondary-foreground)] hover:border-[color:var(--acc-border)]')}>
                      {CONVERT_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {(convertForm.target === 'issue' || convertForm.target === 'task') && (
                <div>
                  <Kicker className="mb-1.5">所属阶段</Kicker>
                  <select value={convertForm.phaseId} onChange={(e) => setConvertForm((p) => ({ ...p, phaseId: e.target.value, taskId: '' }))} className={FIELD_CLS}>
                    {phases.map((ph) => <option key={ph.id} value={ph.id}>{ph.code} {ph.name}</option>)}
                  </select>
                </div>
              )}

              {convertForm.target === 'task' && (
                <div>
                  <Kicker className="mb-1.5">关联任务 *</Kicker>
                  <select value={convertForm.taskId} onChange={(e) => setConvertForm((p) => ({ ...p, taskId: e.target.value }))} className={FIELD_CLS}>
                    <option value="">选择任务</option>
                    {(convertPhase?.tasks || []).map((t) => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}
                  </select>
                </div>
              )}

              {convertForm.target === 'change' && (
                <div>
                  <Kicker className="mb-1.5">变更类型</Kicker>
                  <select value={convertForm.changeType} onChange={(e) => setConvertForm((p) => ({ ...p, changeType: e.target.value as ChangeType }))} className={FIELD_CLS}>
                    {CHANGE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}

              <div>
                <Kicker className="mb-1.5">决策备注</Kicker>
                <textarea value={convertForm.note} onChange={(e) => setConvertForm((p) => ({ ...p, note: e.target.value }))} rows={2} className={cn(FIELD_CLS, 'resize-none')} placeholder="为什么采纳、范围与约束" />
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-muted-foreground">转化后需求归属本项目并标记「已验收」</p>
                <div className="flex gap-2">
                  <button onClick={() => setConvertRow(null)} className="rounded-[7px] border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary">取消</button>
                  <button onClick={handleConvert} disabled={convertMutation.isPending} className="inline-flex items-center gap-1.5 rounded-[7px] bg-[color:var(--success)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50">
                    {convertMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpRight size={13} />}
                    确认转化
                  </button>
                </div>
              </div>
            </div>
          </LinearCard>
        </div>
      )}
    </div>
  );
}
