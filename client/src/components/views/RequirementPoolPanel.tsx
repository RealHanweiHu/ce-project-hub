import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import type { SOPPhase } from '@/lib/data';
import { trpc } from '@/lib/trpc';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Edit2,
  Inbox,
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
  acceptanceCriteria: string;
  decisionNote: string;
};

const STATUS_OPTIONS: Array<{
  value: RequirementStatus;
  label: string;
  badge: string;
  color: string;
  textColor: string;
  borderColor: string;
  icon: ReactNode;
}> = [
  { value: 'new', label: '新需求', badge: 'NEW', color: 'bg-stone-100', textColor: 'text-stone-700', borderColor: 'border-stone-200', icon: <AlertCircle size={11} /> },
  { value: 'triaged', label: '已澄清', badge: 'TRIAGED', color: 'bg-sky-50', textColor: 'text-sky-700', borderColor: 'border-sky-200', icon: <Search size={11} /> },
  { value: 'planned', label: '已纳入计划', badge: 'PLANNED', color: 'bg-amber-50', textColor: 'text-amber-700', borderColor: 'border-amber-200', icon: <Target size={11} /> },
  { value: 'in_progress', label: '执行中', badge: 'DOING', color: 'bg-blue-50', textColor: 'text-blue-700', borderColor: 'border-blue-200', icon: <Clock size={11} /> },
  { value: 'accepted', label: '已验收', badge: 'ACCEPTED', color: 'bg-emerald-50', textColor: 'text-emerald-700', borderColor: 'border-emerald-200', icon: <CheckCircle2 size={11} /> },
  { value: 'deferred', label: '暂缓', badge: 'DEFERRED', color: 'bg-orange-50', textColor: 'text-orange-700', borderColor: 'border-orange-200', icon: <PauseCircle size={11} /> },
  { value: 'rejected', label: '已拒绝', badge: 'REJECTED', color: 'bg-rose-50', textColor: 'text-rose-700', borderColor: 'border-rose-200', icon: <XCircle size={11} /> },
];

const PRIORITY_OPTIONS: Array<{ value: RequirementPriority; label: string; color: string; dot: string; border: string }> = [
  { value: 'P0', label: 'P0 必须满足', color: 'text-rose-700', dot: 'bg-rose-500', border: 'border-l-rose-500' },
  { value: 'P1', label: 'P1 高价值', color: 'text-orange-700', dot: 'bg-orange-500', border: 'border-l-orange-500' },
  { value: 'P2', label: 'P2 常规', color: 'text-amber-700', dot: 'bg-amber-500', border: 'border-l-amber-500' },
  { value: 'P3', label: 'P3 可选', color: 'text-stone-600', dot: 'bg-stone-400', border: 'border-l-stone-300' },
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
  acceptanceCriteria: '',
  decisionNote: '',
});

function StatusBadge({ status }: { status: RequirementStatus }) {
  const cfg = STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[0];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 border ${cfg.color} ${cfg.textColor} ${cfg.borderColor}`}>
      {cfg.icon}
      {cfg.badge}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: RequirementPriority }) {
  const cfg = PRIORITY_OPTIONS.find((p) => p.value === priority) || PRIORITY_OPTIONS[2];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {priority}
    </span>
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
  const [search, setSearch] = useState('');

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
      .filter((row) => {
        if (!q) return true;
        return [
          row.title,
          row.description,
          row.sourceDetail,
          row.owner,
          row.acceptanceCriteria,
          row.decisionNote,
        ].some((value) => (value || '').toLowerCase().includes(q));
      });
  }, [requirements, search, statusFilter]);

  const stats = {
    total: requirements.length,
    open: requirements.filter((r) => r.status === 'new' || r.status === 'triaged').length,
    planned: requirements.filter((r) => ['planned', 'in_progress', 'accepted'].includes(r.status)).length,
    closed: requirements.filter((r) => r.status === 'deferred' || r.status === 'rejected').length,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg text-stone-900">{title ?? '需求池'}</h3>
          <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">{subtitle ?? 'REQUIREMENT POOL'}</p>
        </div>
        {allowCreate && (
          <button
            onClick={openCreate}
            className="ce-control inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-stone-900 text-stone-50 text-xs font-mono uppercase tracking-wider hover:bg-stone-700 transition-colors"
          >
            <Plus size={13} />
            新增需求
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="ce-card bg-stone-50 px-4 py-3 shadow-none">
          <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400">总需求</p>
          <p className="text-2xl font-serif text-stone-900 mt-0.5">{stats.total}</p>
        </div>
        <div className="ce-card bg-sky-50 border-sky-200 px-4 py-3 shadow-none">
          <p className="text-[10px] font-mono uppercase tracking-widest text-sky-700">待澄清</p>
          <p className="text-2xl font-serif text-sky-700 mt-0.5">{stats.open}</p>
        </div>
        <div className="ce-card bg-amber-50 border-amber-200 px-4 py-3 shadow-none">
          <p className="text-[10px] font-mono uppercase tracking-widest text-amber-700">已纳入</p>
          <p className="text-2xl font-serif text-amber-700 mt-0.5">{stats.planned}</p>
        </div>
        <div className="ce-card bg-stone-100 px-4 py-3 shadow-none">
          <p className="text-[10px] font-mono uppercase tracking-widest text-stone-500">暂缓/拒绝</p>
          <p className="text-2xl font-serif text-stone-700 mt-0.5">{stats.closed}</p>
        </div>
      </div>

      {showForm && (
        <div className="ce-panel overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-stone-100">
            <div>
              <div className="text-sm font-semibold text-stone-900">{editingId ? '编辑需求' : '新增需求'}</div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">CAPTURE / TRIAGE</div>
            </div>
            <button onClick={closeForm} className="text-stone-400 hover:text-stone-700 transition-colors">
              <X size={18} />
            </button>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">需求标题 *</label>
              <input
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                placeholder="例如：海外版增加低噪模式"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">需求描述</label>
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors resize-none"
                placeholder="记录背景、使用场景、约束条件和影响范围"
              />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">类型</label>
                <select value={form.type} onChange={(e) => set('type', e.target.value as RequirementType)} className="w-full px-2 py-2 border border-stone-300 bg-white text-xs outline-none focus:border-stone-900">
                  {(Object.keys(TYPE_LABELS) as RequirementType[]).map((value) => (
                    <option key={value} value={value}>{TYPE_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">来源</label>
                <select value={form.source} onChange={(e) => set('source', e.target.value as RequirementSource)} className="w-full px-2 py-2 border border-stone-300 bg-white text-xs outline-none focus:border-stone-900">
                  {(Object.keys(SOURCE_LABELS) as RequirementSource[]).map((value) => (
                    <option key={value} value={value}>{SOURCE_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">优先级</label>
                <select value={form.priority} onChange={(e) => set('priority', e.target.value as RequirementPriority)} className="w-full px-2 py-2 border border-stone-300 bg-white text-xs outline-none focus:border-stone-900">
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">状态</label>
                <select value={form.status} onChange={(e) => set('status', e.target.value as RequirementStatus)} className="w-full px-2 py-2 border border-stone-300 bg-white text-xs outline-none focus:border-stone-900">
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">来源说明</label>
                <input value={form.sourceDetail} onChange={(e) => set('sourceDetail', e.target.value)} className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm" placeholder="客户/渠道/会议" />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">负责人</label>
                <input value={form.owner} onChange={(e) => set('owner', e.target.value)} className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm" placeholder="PM / 工程负责人" />
              </div>
              {phases.length > 0 && (
                <>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">目标阶段</label>
                    <select value={form.targetPhaseId} onChange={(e) => set('targetPhaseId', e.target.value)} className="w-full px-2 py-2 border border-stone-300 bg-white text-xs outline-none focus:border-stone-900">
                      <option value="">未指定</option>
                      {phases.map((phase) => (
                        <option key={phase.id} value={phase.id}>{phase.code} {phase.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">关联任务</label>
                    <select value={form.linkedTaskId} onChange={(e) => set('linkedTaskId', e.target.value)} disabled={!form.targetPhaseId} className="w-full px-2 py-2 border border-stone-300 bg-white text-xs outline-none focus:border-stone-900 disabled:bg-stone-50 disabled:text-stone-400">
                      <option value="">未关联</option>
                      {linkedTaskOptions.map((task) => (
                        <option key={task.id} value={task.id}>{task.id} {task.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">验收标准</label>
                <textarea value={form.acceptanceCriteria} onChange={(e) => set('acceptanceCriteria', e.target.value)} rows={3} className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm resize-none" placeholder="满足什么条件才算完成" />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">决策备注</label>
                <textarea value={form.decisionNote} onChange={(e) => set('decisionNote', e.target.value)} rows={3} className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm resize-none" placeholder="采纳、延期或拒绝的原因" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={!form.title.trim() || createMutation.isPending || updateMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-stone-900 text-stone-50 text-xs font-mono uppercase tracking-wider hover:bg-stone-700 transition-colors disabled:opacity-50"
              >
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 size={13} className="animate-spin" />}
                保存需求
              </button>
              <button onClick={closeForm} className="px-4 py-2 border border-stone-300 text-stone-600 text-xs font-mono uppercase tracking-wider hover:bg-stone-50 transition-colors">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-xl">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ce-control w-full pl-9 pr-3 py-2 border border-stone-200 bg-white text-sm outline-none focus:border-stone-900 transition-colors"
            placeholder="搜索标题、说明、负责人、验收标准"
          />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider border whitespace-nowrap ${
              statusFilter === 'all' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
            }`}
          >
            全部
          </button>
          {STATUS_OPTIONS.map((status) => (
            <button
              key={status.value}
              onClick={() => setStatusFilter(status.value)}
              className={`px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider border whitespace-nowrap ${
                statusFilter === status.value
                  ? `${status.color} ${status.textColor} ${status.borderColor}`
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
            >
              {status.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-amber-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="ce-muted-band border-dashed py-12 px-4 text-center">
          <Inbox size={28} className="mx-auto text-stone-300 mb-3" />
          <div className="text-sm font-medium text-stone-600">暂无匹配需求</div>
          <div className="text-xs text-stone-400 mt-1">新的客户、市场、制造或合规诉求会先进入这里等待澄清</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => {
            const priority = PRIORITY_OPTIONS.find((p) => p.value === row.priority) || PRIORITY_OPTIONS[2];
            const phase = phases.find((p) => p.id === row.targetPhaseId);
            const task = phase?.tasks.find((t) => t.id === row.linkedTaskId);
            return (
              <div key={row.id} className={`ce-card border-l-4 ${priority.border} p-4`}>
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <PriorityBadge priority={row.priority} />
                      <StatusBadge status={row.status} />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{TYPE_LABELS[row.type]}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-stone-300">REQ-{String(row.id).padStart(4, '0')}</span>
                      {row.convertedType && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5">
                          <ArrowUpRight size={10} />
                          已转{CONVERT_LABELS[row.convertedType]}{row.convertedType !== 'task' ? ` #${row.convertedId}` : ` ${row.convertedId}`}
                        </span>
                      )}
                    </div>
                    <h4 className="text-sm font-semibold text-stone-900 leading-snug">{row.title}</h4>
                    {row.description && (
                      <p className="text-xs text-stone-500 mt-1 leading-relaxed whitespace-pre-wrap">{row.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500">
                      <span>来源：<span className="text-stone-700">{SOURCE_LABELS[row.source]}</span>{row.sourceDetail ? ` · ${row.sourceDetail}` : ''}</span>
                      {row.owner && <span>负责人：<span className="text-stone-700">{row.owner}</span></span>}
                      {phase && <span>阶段：<span className="text-stone-700">{phase.code} {phase.name}</span></span>}
                      {task && <span>任务：<span className="font-mono text-stone-700">{task.id}</span></span>}
                      <span>创建：{formatDate(row.createdAt)}</span>
                    </div>
                    {(row.acceptanceCriteria || row.decisionNote) && (
                      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {row.acceptanceCriteria && (
                          <div className="bg-stone-50 border border-stone-100 px-3 py-2">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">验收标准</div>
                            <div className="text-xs text-stone-600 whitespace-pre-wrap">{row.acceptanceCriteria}</div>
                          </div>
                        )}
                        {row.decisionNote && (
                          <div className="bg-amber-50/60 border border-amber-100 px-3 py-2">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-amber-600 mb-1">决策备注</div>
                            <div className="text-xs text-stone-600 whitespace-pre-wrap">{row.decisionNote}</div>
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
                        className="text-xs bg-stone-50 border border-stone-200 px-2 py-1.5 outline-none focus:border-stone-900"
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status.value} value={status.value}>{status.label}</option>
                        ))}
                      </select>
                    )}
                    {scope.kind === 'project' && canManage(row) && !row.convertedType && (
                      <button onClick={() => openConvert(row)} className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors" title="采纳并转为任务/问题/变更">
                        <ArrowUpRight size={13} />采纳转化
                      </button>
                    )}
                    {canManage(row) && (
                      <>
                        <button onClick={() => openEdit(row)} className="p-1.5 text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors" title="编辑需求">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDelete(row)} className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="删除需求">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 采纳转化子窗口 */}
      {convertRow && (
        <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-stone-900/40 backdrop-blur-sm p-4 sm:p-8" onClick={() => setConvertRow(null)}>
          <div className="relative w-full max-w-lg h-fit my-auto ce-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-stone-100">
              <div>
                <div className="text-sm font-semibold text-stone-900">采纳转化</div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">「{convertRow.title}」</div>
              </div>
              <button onClick={() => setConvertRow(null)} className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">转为</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['issue', 'change', 'task'] as ConvertTarget[]).map((t) => (
                    <button key={t} onClick={() => setConvertForm((p) => ({ ...p, target: t }))}
                      className={`px-3 py-2 text-sm border transition-colors ${convertForm.target === t ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 text-stone-600 hover:border-stone-500'}`}>
                      {CONVERT_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {(convertForm.target === 'issue' || convertForm.target === 'task') && (
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">所属阶段</label>
                  <select value={convertForm.phaseId} onChange={(e) => setConvertForm((p) => ({ ...p, phaseId: e.target.value, taskId: '' }))} className="w-full px-2 py-2 border border-stone-300 bg-white text-xs outline-none focus:border-stone-900">
                    {phases.map((ph) => <option key={ph.id} value={ph.id}>{ph.code} {ph.name}</option>)}
                  </select>
                </div>
              )}

              {convertForm.target === 'task' && (
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">关联任务 *</label>
                  <select value={convertForm.taskId} onChange={(e) => setConvertForm((p) => ({ ...p, taskId: e.target.value }))} className="w-full px-2 py-2 border border-stone-300 bg-white text-xs outline-none focus:border-stone-900">
                    <option value="">选择任务</option>
                    {(convertPhase?.tasks || []).map((t) => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}
                  </select>
                </div>
              )}

              {convertForm.target === 'change' && (
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">变更类型</label>
                  <select value={convertForm.changeType} onChange={(e) => setConvertForm((p) => ({ ...p, changeType: e.target.value as ChangeType }))} className="w-full px-2 py-2 border border-stone-300 bg-white text-xs outline-none focus:border-stone-900">
                    {CHANGE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">决策备注</label>
                <textarea value={convertForm.note} onChange={(e) => setConvertForm((p) => ({ ...p, note: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm resize-none" placeholder="为什么采纳、范围与约束" />
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-stone-400">转化后需求归属本项目并标记「已验收」</p>
                <div className="flex gap-2">
                  <button onClick={() => setConvertRow(null)} className="px-3 py-1.5 text-xs text-stone-600 border border-stone-300 hover:bg-stone-50">取消</button>
                  <button onClick={handleConvert} disabled={convertMutation.isPending} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs hover:bg-emerald-700 disabled:opacity-50">
                    {convertMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpRight size={13} />}
                    确认转化
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
