// Design: Industrial Precision — stone/amber color system
// ChangeLog: project-level change & decision log (ECR / ECN / decisions / tradeoffs)

import { useState } from 'react';
import {
  ChangeRecord, ChangeType, ChangeStatus,
} from '@/lib/data';
import { nanoid } from 'nanoid';
import {
  Plus, X, ChevronDown, ChevronUp, Edit2, Trash2,
  GitBranch, DollarSign, Clock, Package, Truck, Zap, Scale, CheckCircle2, XCircle, AlertCircle, Circle,
} from 'lucide-react';

// ── Config ────────────────────────────────────────────────────────────────────

export const CHANGE_TYPE_CONFIG: Record<ChangeType, {
  label: string; labelEn: string; color: string; textColor: string; borderColor: string; icon: React.ReactNode; badge: string;
}> = {
  decision:  { label: '决策拍板', labelEn: 'Decision',  color: 'bg-purple-50',  textColor: 'text-purple-700', borderColor: 'border-purple-200', icon: <Zap size={12} />,      badge: 'DECISION' },
  tradeoff:  { label: '方案取舍', labelEn: 'Tradeoff',  color: 'bg-blue-50',    textColor: 'text-blue-700',   borderColor: 'border-blue-200',   icon: <Scale size={12} />,     badge: 'TRADEOFF' },
  eco:       { label: 'ECO',      labelEn: 'ECO',        color: 'bg-amber-50',   textColor: 'text-amber-700',  borderColor: 'border-amber-200',  icon: <GitBranch size={12} />, badge: 'ECO' },
  ecn:       { label: 'ECN',      labelEn: 'ECN',        color: 'bg-orange-50',  textColor: 'text-orange-700', borderColor: 'border-orange-200', icon: <GitBranch size={12} />, badge: 'ECN' },
  spec:      { label: '规格变更', labelEn: 'Spec',       color: 'bg-sky-50',     textColor: 'text-sky-700',    borderColor: 'border-sky-200',    icon: <Package size={12} />,   badge: 'SPEC' },
  cost:      { label: '成本变更', labelEn: 'Cost',       color: 'bg-emerald-50', textColor: 'text-emerald-700',borderColor: 'border-emerald-200',icon: <DollarSign size={12} />,badge: 'COST' },
  schedule:  { label: '进度变更', labelEn: 'Schedule',   color: 'bg-rose-50',    textColor: 'text-rose-700',   borderColor: 'border-rose-200',   icon: <Clock size={12} />,     badge: 'SCHED' },
  supplier:  { label: '供应商变更',labelEn: 'Supplier',  color: 'bg-teal-50',    textColor: 'text-teal-700',   borderColor: 'border-teal-200',   icon: <Truck size={12} />,     badge: 'SUPPLIER' },
  other:     { label: '其他',     labelEn: 'Other',      color: 'bg-stone-50',   textColor: 'text-stone-600',  borderColor: 'border-stone-200',  icon: <Circle size={12} />,    badge: 'OTHER' },
};

export const CHANGE_STATUS_CONFIG: Record<ChangeStatus, {
  label: string; color: string; textColor: string; icon: React.ReactNode;
}> = {
  proposed:    { label: '提议中',  color: 'bg-stone-100',   textColor: 'text-stone-600',  icon: <AlertCircle size={11} /> },
  approved:    { label: '已批准',  color: 'bg-emerald-100', textColor: 'text-emerald-700',icon: <CheckCircle2 size={11} /> },
  rejected:    { label: '已拒绝',  color: 'bg-rose-100',    textColor: 'text-rose-700',   icon: <XCircle size={11} /> },
  implemented: { label: '已实施',  color: 'bg-blue-100',    textColor: 'text-blue-700',   icon: <CheckCircle2 size={11} /> },
  cancelled:   { label: '已取消',  color: 'bg-stone-100',   textColor: 'text-stone-400',  icon: <XCircle size={11} /> },
};

const PHASE_OPTIONS = [
  { id: 'concept',    label: 'P1 概念' },
  { id: 'planning',   label: 'P2 规划' },
  { id: 'design',     label: 'P3 设计' },
  { id: 'evt',        label: 'P4 EVT' },
  { id: 'dvt',        label: 'P5 DVT' },
  { id: 'pvt',        label: 'P6 PVT' },
  { id: 'mp',         label: 'P7 MP' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateNumber(type: ChangeType, existing: ChangeRecord[]): string {
  const prefix = type === 'eco' ? 'ECO' : type === 'ecn' ? 'ECN' : type === 'decision' ? 'DEC' : type === 'tradeoff' ? 'TRD' : 'ECR';
  const same = existing.filter((r) => r.number.startsWith(prefix));
  return `${prefix}-${String(same.length + 1).padStart(3, '0')}`;
}

// ── Empty Form ────────────────────────────────────────────────────────────────

const emptyForm = (): Omit<ChangeRecord, 'id' | 'number' | 'createdAt'> => ({
  type: 'decision',
  title: '',
  description: '',
  reason: '',
  decisionMaker: '',
  affectedPhases: [],
  status: 'proposed',
  costImpact: '',
  scheduleImpact: '',
  createdDate: new Date().toISOString().split('T')[0],
  implementedDate: '',
  notes: '',
});

// ── Sub-components ────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: ChangeType }) {
  const cfg = CHANGE_TYPE_CONFIG[type];
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 border ${cfg.color} ${cfg.textColor} ${cfg.borderColor}`}>
      {cfg.icon}
      {cfg.badge}
    </span>
  );
}

function StatusBadge({ status }: { status: ChangeStatus }) {
  const cfg = CHANGE_STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${cfg.color} ${cfg.textColor}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface ChangeLogProps {
  projectId: string;
  records: ChangeRecord[];
  onUpdate: (records: ChangeRecord[]) => void;
  canEdit?: boolean;
}

export function ChangeLog({ records, onUpdate, canEdit = true }: ChangeLogProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<ChangeType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<ChangeStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const openCreate = () => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (record: ChangeRecord) => {
    setForm({
      type: record.type,
      title: record.title,
      description: record.description,
      reason: record.reason,
      decisionMaker: record.decisionMaker,
      affectedPhases: record.affectedPhases,
      status: record.status,
      costImpact: record.costImpact || '',
      scheduleImpact: record.scheduleImpact || '',
      createdDate: record.createdDate,
      implementedDate: record.implementedDate || '',
      notes: record.notes || '',
    });
    setEditingId(record.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.title.trim()) return;
    if (editingId) {
      onUpdate(records.map((r) => r.id === editingId ? { ...r, ...form } : r));
    } else {
      const newRecord: ChangeRecord = {
        id: nanoid(8),
        number: generateNumber(form.type, records),
        ...form,
        createdAt: new Date().toISOString(),
      };
      onUpdate([...records, newRecord]);
    }
    setShowForm(false);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (!confirm('确定删除此变更记录？')) return;
    onUpdate(records.filter((r) => r.id !== id));
  };

  const togglePhase = (phaseId: string) => {
    setForm((f) => ({
      ...f,
      affectedPhases: f.affectedPhases.includes(phaseId)
        ? f.affectedPhases.filter((p) => p !== phaseId)
        : [...f.affectedPhases, phaseId],
    }));
  };

  // Filter & sort
  const filtered = records
    .filter((r) => filterType === 'all' || r.type === filterType)
    .filter((r) => filterStatus === 'all' || r.status === filterStatus)
    .filter((r) => !search || r.title.toLowerCase().includes(search.toLowerCase()) || r.description.toLowerCase().includes(search.toLowerCase()) || r.number.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Stats
  const openCount = records.filter((r) => r.status === 'proposed').length;
  const ecoEcnCount = records.filter((r) => r.type === 'eco' || r.type === 'ecn').length;
  const decisionCount = records.filter((r) => r.type === 'decision' || r.type === 'tradeoff').length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-serif text-lg text-stone-900">变更记录</h3>
          <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">CHANGE LOG / ECR</p>
        </div>
        {canEdit && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 text-stone-50 text-xs font-mono uppercase tracking-wider hover:bg-stone-700 transition-colors"
          >
            <Plus size={13} />
            新增记录
          </button>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-stone-50 border border-stone-200 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400">总记录</p>
          <p className="text-2xl font-serif text-stone-900 mt-0.5">{records.length}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-amber-600">ECO / ECN</p>
          <p className="text-2xl font-serif text-amber-700 mt-0.5">{ecoEcnCount}</p>
        </div>
        <div className="bg-purple-50 border border-purple-200 px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-purple-600">决策 / 取舍</p>
          <p className="text-2xl font-serif text-purple-700 mt-0.5">{decisionCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索标题、描述、编号..."
          className="flex-1 min-w-[180px] px-3 py-1.5 border border-stone-200 text-xs focus:border-stone-400 outline-none"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as ChangeType | 'all')}
          className="px-2 py-1.5 border border-stone-200 text-xs bg-white focus:border-stone-400 outline-none"
        >
          <option value="all">全部类型</option>
          {(Object.keys(CHANGE_TYPE_CONFIG) as ChangeType[]).map((t) => (
            <option key={t} value={t}>{CHANGE_TYPE_CONFIG[t].label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as ChangeStatus | 'all')}
          className="px-2 py-1.5 border border-stone-200 text-xs bg-white focus:border-stone-400 outline-none"
        >
          <option value="all">全部状态</option>
          {(Object.keys(CHANGE_STATUS_CONFIG) as ChangeStatus[]).map((s) => (
            <option key={s} value={s}>{CHANGE_STATUS_CONFIG[s].label}</option>
          ))}
        </select>
        {openCount > 0 && (
          <span className="text-[10px] font-mono text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1">
            {openCount} 条待处理
          </span>
        )}
      </div>

      {/* Timeline List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-stone-400">
          <GitBranch size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">暂无变更记录</p>
          <p className="text-xs mt-1">点击「新增记录」记录决策、ECO/ECN 或规格变更</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[19px] top-0 bottom-0 w-px bg-stone-200" />
          <div className="space-y-3">
            {filtered.map((record) => {
              const typeCfg = CHANGE_TYPE_CONFIG[record.type];
              const isExpanded = expandedId === record.id;
              return (
                <div key={record.id} className="relative pl-10">
                  {/* Timeline dot */}
                  <div className={`absolute left-[11px] top-4 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center ${typeCfg.color} ${typeCfg.borderColor} border`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${typeCfg.textColor.replace('text-', 'bg-')}`} />
                  </div>

                  <div className={`border ${isExpanded ? 'border-stone-300' : 'border-stone-200'} bg-white hover:border-stone-300 transition-colors`}>
                    {/* Card Header */}
                    <div
                      className="flex items-start gap-3 p-4 cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : record.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-mono text-stone-400">{record.number}</span>
                          <TypeBadge type={record.type} />
                          <StatusBadge status={record.status} />
                        </div>
                        <p className="text-sm font-medium text-stone-900 leading-snug">{record.title}</p>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5">
                          <span className="text-[10px] font-mono text-stone-400">{record.createdDate}</span>
                          {record.decisionMaker && (
                            <span className="text-[10px] text-stone-500">拍板: <span className="font-medium text-stone-700">{record.decisionMaker}</span></span>
                          )}
                          {record.costImpact && (
                            <span className="text-[10px] text-emerald-600 font-mono">成本: {record.costImpact}</span>
                          )}
                          {record.scheduleImpact && (
                            <span className="text-[10px] text-rose-600 font-mono">进度: {record.scheduleImpact}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {canEdit && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); openEdit(record); }}
                              className="p-1 text-stone-300 hover:text-amber-500 transition-colors"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(record.id); }}
                              className="p-1 text-stone-300 hover:text-rose-500 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                        {isExpanded ? <ChevronUp size={14} className="text-stone-400" /> : <ChevronDown size={14} className="text-stone-400" />}
                      </div>
                    </div>

                    {/* Expanded Detail */}
                    {isExpanded && (
                      <div className="border-t border-stone-100 px-4 pb-4 pt-3 space-y-3">
                        {record.description && (
                          <div>
                            <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">变更内容</p>
                            <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{record.description}</p>
                          </div>
                        )}
                        {record.reason && (
                          <div>
                            <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">变更原因</p>
                            <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{record.reason}</p>
                          </div>
                        )}
                        {record.affectedPhases.length > 0 && (
                          <div>
                            <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1.5">影响阶段</p>
                            <div className="flex flex-wrap gap-1.5">
                              {record.affectedPhases.map((phaseId) => {
                                const po = PHASE_OPTIONS.find((p) => p.id === phaseId);
                                return (
                                  <span key={phaseId} className="text-[10px] font-mono px-2 py-0.5 bg-stone-100 text-stone-600 border border-stone-200">
                                    {po?.label || phaseId}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {(record.costImpact || record.scheduleImpact) && (
                          <div className="grid grid-cols-2 gap-3">
                            {record.costImpact && (
                              <div className="bg-emerald-50 border border-emerald-200 px-3 py-2">
                                <p className="text-[9px] font-mono uppercase tracking-wider text-emerald-600 mb-0.5">成本影响</p>
                                <p className="text-sm font-mono font-medium text-emerald-800">{record.costImpact}</p>
                              </div>
                            )}
                            {record.scheduleImpact && (
                              <div className="bg-rose-50 border border-rose-200 px-3 py-2">
                                <p className="text-[9px] font-mono uppercase tracking-wider text-rose-600 mb-0.5">进度影响</p>
                                <p className="text-sm font-mono font-medium text-rose-800">{record.scheduleImpact}</p>
                              </div>
                            )}
                          </div>
                        )}
                        {record.notes && (
                          <div>
                            <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">备注</p>
                            <p className="text-sm text-stone-600 leading-relaxed whitespace-pre-wrap">{record.notes}</p>
                          </div>
                        )}
                        {record.implementedDate && (
                          <p className="text-[10px] font-mono text-stone-400">实施日期: {record.implementedDate}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Form Modal ──────────────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-stone-900/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div
            className="bg-white w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-stone-200 flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-serif text-xl text-stone-900">{editingId ? '编辑变更记录' : '新增变更记录'}</h3>
                <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">
                  {editingId ? 'EDIT CHANGE RECORD' : 'NEW CHANGE RECORD'}
                </p>
              </div>
              <button onClick={() => setShowForm(false)} className="text-stone-400 hover:text-stone-600 text-xl leading-none"><X size={18} /></button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Type */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-2">变更类型 *</label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(CHANGE_TYPE_CONFIG) as ChangeType[]).map((t) => {
                    const cfg = CHANGE_TYPE_CONFIG[t];
                    return (
                      <button
                        key={t}
                        onClick={() => setForm({ ...form, type: t })}
                        className={`flex items-center gap-2 px-3 py-2 border text-xs transition-all ${
                          form.type === t
                            ? `${cfg.color} ${cfg.borderColor} ${cfg.textColor} border-2`
                            : 'border-stone-200 text-stone-500 hover:border-stone-300'
                        }`}
                      >
                        {cfg.icon}
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">标题 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm"
                  placeholder="简短描述这次变更/决策"
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">变更内容</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm resize-none"
                  rows={3}
                  placeholder="详细描述变更了什么（规格、方案、供应商等）"
                />
              </div>

              {/* Reason */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">变更原因</label>
                <textarea
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm resize-none"
                  rows={2}
                  placeholder="为什么做这个变更？（老板指示、成本压力、技术风险、客户要求等）"
                />
              </div>

              {/* Decision Maker + Status + Date */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">拍板人</label>
                  <input
                    type="text"
                    value={form.decisionMaker}
                    onChange={(e) => setForm({ ...form, decisionMaker: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm"
                    placeholder="姓名/职位"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">状态</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as ChangeStatus })}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm bg-white"
                  >
                    {(Object.keys(CHANGE_STATUS_CONFIG) as ChangeStatus[]).map((s) => (
                      <option key={s} value={s}>{CHANGE_STATUS_CONFIG[s].label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">记录日期</label>
                  <input
                    type="date"
                    value={form.createdDate}
                    onChange={(e) => setForm({ ...form, createdDate: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm"
                  />
                </div>
              </div>

              {/* Cost & Schedule Impact */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">成本影响</label>
                  <input
                    type="text"
                    value={form.costImpact}
                    onChange={(e) => setForm({ ...form, costImpact: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm"
                    placeholder="+$2/unit, BOM +5%, 无影响"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">进度影响</label>
                  <input
                    type="text"
                    value={form.scheduleImpact}
                    onChange={(e) => setForm({ ...form, scheduleImpact: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm"
                    placeholder="+2周, 无影响, 提前1周"
                  />
                </div>
              </div>

              {/* Affected Phases */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-2">影响阶段</label>
                <div className="flex flex-wrap gap-2">
                  {PHASE_OPTIONS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => togglePhase(p.id)}
                      className={`text-xs font-mono px-2.5 py-1 border transition-all ${
                        form.affectedPhases.includes(p.id)
                          ? 'bg-stone-900 text-white border-stone-900'
                          : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">备注</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm resize-none"
                  rows={2}
                  placeholder="其他补充信息"
                />
              </div>

              {/* Implemented Date */}
              {(form.status === 'implemented') && (
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">实施日期</label>
                  <input
                    type="date"
                    value={form.implementedDate}
                    onChange={(e) => setForm({ ...form, implementedDate: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm"
                  />
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-stone-200 flex items-center justify-between shrink-0">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-xs font-mono uppercase tracking-wider text-stone-600 border border-stone-300 hover:bg-stone-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={!form.title.trim()}
                className={`flex items-center gap-2 px-5 py-2 text-xs font-mono uppercase tracking-wider bg-stone-900 text-stone-50 hover:bg-stone-700 transition-colors ${
                  !form.title.trim() ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <CheckCircle2 size={13} />
                {editingId ? '保存修改' : '创建记录'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
