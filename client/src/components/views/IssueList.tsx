// IssueList: 8D/CAPA Closed-Loop Quality Management
// Features: 8D workflow steps, containment/root-cause/corrective/verification tracking,
// create/edit/delete issues, filter by severity/status/category, stats summary, step progress

import { useState } from 'react';
import { nanoid } from 'nanoid';
import {
  Plus, X, Edit2, Trash2, ChevronDown, ChevronRight,
  AlertCircle, CheckCircle2, Clock, Ban, Search, Filter,
  Bug, Flag, Shield, Microscope, Wrench, FlaskConical, FileCheck,
} from 'lucide-react';
import {
  Issue, IssueSeverity, IssueStatus, IssueCategory,
  SEVERITY_CONFIG, STATUS_CONFIG, CATEGORY_LABELS,
} from '@/lib/data';

interface IssueListProps {
  phaseId: string;
  phaseName: string;
  issues: Issue[];
  onUpdate: (issues: Issue[]) => void;
  canEdit?: boolean;
  /** Current user's ID, used to check if they can close/delete their own issues */
  currentUserId?: string;
  /** If true, user can close/delete any issue (owner/manager/pm role) */
  canManage?: boolean;
}

// ── All issue statuses for the 8D flow ──────────────────────────────────────
const ALL_STATUSES: IssueStatus[] = [
  'open', 'in_progress', 'contained', 'root_caused',
  'correcting', 'verifying', 'resolved', 'closed', 'wont_fix',
];

// ── Empty Issue Form ──────────────────────────────────────────────────────────
const emptyIssue = (): Omit<Issue, 'id'> => ({
  title: '',
  desc: '',
  severity: 'P1',
  status: 'open',
  category: 'hardware',
  owner: '',
  reporter: '',
  foundDate: new Date().toISOString().slice(0, 10),
  targetDate: '',
  rootCause: '',
  solution: '',
  responsibleDept: '',
  containmentAction: '',
  containmentDate: '',
  containmentVerified: false,
  rootCauseMethod: '',
  correctiveAction: '',
  correctiveActionDate: '',
  verificationResult: '',
  verificationDate: '',
  preventiveAction: '',
});

// ── Status Icon ───────────────────────────────────────────────────────────────
function StatusIcon({ status }: { status: IssueStatus }) {
  if (status === 'open') return <AlertCircle size={14} className="text-rose-500" />;
  if (status === 'in_progress') return <Clock size={14} className="text-blue-500" />;
  if (status === 'contained') return <Shield size={14} className="text-orange-500" />;
  if (status === 'root_caused') return <Microscope size={14} className="text-amber-500" />;
  if (status === 'correcting') return <Wrench size={14} className="text-indigo-500" />;
  if (status === 'verifying') return <FlaskConical size={14} className="text-cyan-500" />;
  if (status === 'resolved') return <CheckCircle2 size={14} className="text-emerald-500" />;
  if (status === 'closed') return <FileCheck size={14} className="text-stone-400" />;
  return <Ban size={14} className="text-stone-400" />;
}

// ── 8D Step Progress Bar ─────────────────────────────────────────────────────
function EightDProgress({ status }: { status: IssueStatus }) {
  const cfg = STATUS_CONFIG[status];
  const currentStep = cfg.step ?? 0;
  const steps = [
    { step: 1, label: 'D1 发现' },
    { step: 2, label: 'D2 处理' },
    { step: 3, label: 'D3 临时' },
    { step: 4, label: 'D4 根因' },
    { step: 5, label: 'D5 对策' },
    { step: 6, label: 'D7 验证' },
    { step: 7, label: 'D8 解决' },
    { step: 8, label: '关闭' },
  ];

  return (
    <div className="flex items-center gap-0.5">
      {steps.map(({ step, label }) => (
        <div
          key={step}
          className={`flex items-center`}
          title={label}
        >
          <div
            className={`w-5 h-1.5 transition-all ${
              step <= currentStep
                ? step === currentStep ? `${cfg.bg.replace('bg-', 'bg-')} border ${cfg.border}` : 'bg-emerald-400'
                : 'bg-stone-200'
            }`}
          />
        </div>
      ))}
    </div>
  );
}

// ── Issue Form Modal (8D Enhanced) ───────────────────────────────────────────
function IssueFormModal({
  initial,
  onSave,
  onClose,
  title,
}: {
  initial: Omit<Issue, 'id'> & { id?: string };
  onSave: (issue: Omit<Issue, 'id'> & { id?: string }) => void;
  onClose: () => void;
  title: string;
}) {
  const [form, setForm] = useState(initial);
  const [activeTab, setActiveTab] = useState<'basic' | '8d'>('basic');
  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const isValid = form.title.trim().length > 0;

  const tabs = [
    { id: 'basic' as const, label: '基本信息' },
    { id: '8d' as const, label: '8D/CAPA 流程' },
  ];

  return (
    <div className="fixed inset-0 bg-stone-900/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-stone-200 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-serif text-xl text-stone-900">{title}</h3>
            <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">8D / CAPA MANAGEMENT</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-200 shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 text-xs font-mono uppercase tracking-wider transition-all border-b-2 ${
                activeTab === tab.id
                  ? 'border-stone-900 text-stone-900 font-bold'
                  : 'border-transparent text-stone-400 hover:text-stone-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'basic' && (
            <>
              {/* Title */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">问题标题 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                  placeholder="简要描述问题"
                  autoFocus
                />
              </div>

              {/* Severity + Status + Category */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">缺陷等级</label>
                  <div className="flex flex-col gap-1">
                    {(['P0', 'P1', 'P2', 'P3'] as IssueSeverity[]).map((s) => {
                      const cfg = SEVERITY_CONFIG[s];
                      return (
                        <button
                          key={s}
                          onClick={() => set('severity', s)}
                          className={`flex items-center gap-2 px-2 py-1.5 border text-xs font-mono transition-all ${
                            form.severity === s
                              ? `${cfg.bg} ${cfg.border} border-2 ${cfg.color} font-bold`
                              : 'bg-white border-stone-200 text-stone-500 hover:border-stone-300'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                          <span>{s}</span>
                          <span className="text-[10px] opacity-70">{cfg.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">8D 状态</label>
                  <div className="flex flex-col gap-1">
                    {ALL_STATUSES.map((s) => {
                      const cfg = STATUS_CONFIG[s];
                      return (
                        <button
                          key={s}
                          onClick={() => set('status', s)}
                          className={`flex items-center gap-2 px-2 py-1.5 border text-xs transition-all ${
                            form.status === s
                              ? `${cfg.bg} ${cfg.border} border-2 ${cfg.color} font-medium`
                              : 'bg-white border-stone-200 text-stone-500 hover:border-stone-300'
                          }`}
                        >
                          <StatusIcon status={s} />
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">问题类别</label>
                  <div className="flex flex-col gap-1">
                    {(Object.keys(CATEGORY_LABELS) as IssueCategory[]).map((c) => (
                      <button
                        key={c}
                        onClick={() => set('category', c)}
                        className={`px-2 py-1.5 border text-xs text-left transition-all ${
                          form.category === c
                            ? 'bg-stone-900 border-stone-900 text-white font-medium'
                            : 'bg-white border-stone-200 text-stone-500 hover:border-stone-300'
                        }`}
                      >
                        {CATEGORY_LABELS[c]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">问题描述</label>
                <textarea
                  value={form.desc}
                  onChange={(e) => set('desc', e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors resize-none"
                  rows={3}
                  placeholder="详细描述问题现象、复现步骤、影响范围..."
                />
              </div>

              {/* Owner + Reporter + Dept */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">负责人</label>
                  <input
                    type="text"
                    value={form.owner}
                    onChange={(e) => set('owner', e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                    placeholder="负责解决的工程师"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">发现人</label>
                  <input
                    type="text"
                    value={form.reporter}
                    onChange={(e) => set('reporter', e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                    placeholder="发现并提报问题的人"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">责任部门</label>
                  <input
                    type="text"
                    value={form.responsibleDept || ''}
                    onChange={(e) => set('responsibleDept', e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                    placeholder="如：硬件部、结构部"
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">发现日期</label>
                  <input
                    type="date"
                    value={form.foundDate}
                    onChange={(e) => set('foundDate', e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">目标关闭日期</label>
                  <input
                    type="date"
                    value={form.targetDate}
                    onChange={(e) => set('targetDate', e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === '8d' && (
            <>
              {/* D3: Containment */}
              <div className="border-l-3 border-orange-400 pl-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-orange-600" />
                  <span className="text-xs font-mono uppercase tracking-wider text-orange-700 font-bold">D3: 临时措施 (Containment)</span>
                </div>
                <textarea
                  value={form.containmentAction || ''}
                  onChange={(e) => set('containmentAction', e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-orange-400 outline-none text-sm transition-colors resize-none"
                  rows={2}
                  placeholder="描述已采取的临时措施，防止问题扩大..."
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-stone-500 block mb-1">实施日期</label>
                    <input
                      type="date"
                      value={form.containmentDate || ''}
                      onChange={(e) => set('containmentDate', e.target.value)}
                      className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.containmentVerified || false}
                        onChange={(e) => set('containmentVerified', e.target.checked)}
                        className="w-4 h-4 accent-orange-600"
                      />
                      <span className="text-xs text-stone-600">临时措施已验证有效</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* D4: Root Cause */}
              <div className="border-l-3 border-amber-400 pl-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Microscope size={14} className="text-amber-600" />
                  <span className="text-xs font-mono uppercase tracking-wider text-amber-700 font-bold">D4: 根本原因分析 (Root Cause)</span>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-stone-500 block mb-1">分析方法</label>
                  <select
                    value={form.rootCauseMethod || ''}
                    onChange={(e) => set('rootCauseMethod', e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                  >
                    <option value="">选择分析方法...</option>
                    <option value="5-Why">5-Why 分析</option>
                    <option value="Fishbone">鱼骨图 (Fishbone)</option>
                    <option value="FTA">故障树分析 (FTA)</option>
                    <option value="FMEA">FMEA</option>
                    <option value="DOE">实验设计 (DOE)</option>
                    <option value="Pareto">帕累托分析</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <textarea
                  value={form.rootCause || ''}
                  onChange={(e) => set('rootCause', e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-amber-400 outline-none text-sm transition-colors resize-none"
                  rows={3}
                  placeholder="根本原因分析结论..."
                />
              </div>

              {/* D5/D6: Corrective Action */}
              <div className="border-l-3 border-indigo-400 pl-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Wrench size={14} className="text-indigo-600" />
                  <span className="text-xs font-mono uppercase tracking-wider text-indigo-700 font-bold">D5/D6: 永久纠正措施 (Corrective Action)</span>
                </div>
                <textarea
                  value={form.correctiveAction || ''}
                  onChange={(e) => set('correctiveAction', e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-indigo-400 outline-none text-sm transition-colors resize-none"
                  rows={2}
                  placeholder="永久性纠正措施方案..."
                />
                <textarea
                  value={form.solution || ''}
                  onChange={(e) => set('solution', e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-indigo-400 outline-none text-sm transition-colors resize-none"
                  rows={2}
                  placeholder="具体实施方案 / 技术解决方案..."
                />
                <div>
                  <label className="text-[10px] font-mono text-stone-500 block mb-1">对策实施日期</label>
                  <input
                    type="date"
                    value={form.correctiveActionDate || ''}
                    onChange={(e) => set('correctiveActionDate', e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                  />
                </div>
              </div>

              {/* D7: Verification */}
              <div className="border-l-3 border-cyan-400 pl-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FlaskConical size={14} className="text-cyan-600" />
                  <span className="text-xs font-mono uppercase tracking-wider text-cyan-700 font-bold">D7: 效果验证 (Verification)</span>
                </div>
                <textarea
                  value={form.verificationResult || ''}
                  onChange={(e) => set('verificationResult', e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-cyan-400 outline-none text-sm transition-colors resize-none"
                  rows={2}
                  placeholder="验证方法和结果（如：N=30 连续合格）..."
                />
                <div>
                  <label className="text-[10px] font-mono text-stone-500 block mb-1">验证日期</label>
                  <input
                    type="date"
                    value={form.verificationDate || ''}
                    onChange={(e) => set('verificationDate', e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                  />
                </div>
              </div>

              {/* D8: Prevention */}
              <div className="border-l-3 border-emerald-400 pl-4 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  <span className="text-xs font-mono uppercase tracking-wider text-emerald-700 font-bold">D8: 预防措施 (Prevention)</span>
                </div>
                <textarea
                  value={form.preventiveAction || ''}
                  onChange={(e) => set('preventiveAction', e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-emerald-400 outline-none text-sm transition-colors resize-none"
                  rows={2}
                  placeholder="防止问题复发的系统性措施、标准化改进..."
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-stone-200 flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-mono uppercase tracking-wider text-stone-600 border border-stone-300 hover:bg-stone-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => isValid && onSave(form)}
            disabled={!isValid}
            className={`px-5 py-2 text-xs font-mono uppercase tracking-wider bg-stone-900 text-stone-50 hover:bg-stone-700 transition-colors ${!isValid ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            保存问题
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function IssueList({ phaseId, phaseName, issues, onUpdate, canEdit = true, currentUserId, canManage = false }: IssueListProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<IssueSeverity | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<IssueStatus | 'all'>('all');
  const [searchText, setSearchText] = useState('');

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    total: issues.length,
    open: issues.filter((i) => i.status === 'open').length,
    inProgress: issues.filter((i) => ['in_progress', 'contained', 'root_caused', 'correcting', 'verifying'].includes(i.status)).length,
    resolved: issues.filter((i) => i.status === 'resolved' || i.status === 'closed').length,
    p0: issues.filter((i) => i.severity === 'P0').length,
    p1: issues.filter((i) => i.severity === 'P1').length,
    p2: issues.filter((i) => i.severity === 'P2').length,
    p3: issues.filter((i) => i.severity === 'P3').length,
    closureRate: issues.length > 0
      ? Math.round((issues.filter((i) => i.status === 'resolved' || i.status === 'closed' || i.status === 'wont_fix').length / issues.length) * 100)
      : 0,
  };

  // ── Filtered Issues ───────────────────────────────────────────────────────
  const filtered = issues.filter((issue) => {
    if (filterSeverity !== 'all' && issue.severity !== filterSeverity) return false;
    if (filterStatus !== 'all' && issue.status !== filterStatus) return false;
    if (searchText && !issue.title.toLowerCase().includes(searchText.toLowerCase()) &&
        !issue.desc.toLowerCase().includes(searchText.toLowerCase()) &&
        !issue.owner.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const handleCreate = (data: Omit<Issue, 'id'>) => {
    const newIssue: Issue = { ...data, id: nanoid(8), creatorId: currentUserId };
    onUpdate([...issues, newIssue]);
    setShowForm(false);
  };

  const handleEdit = (data: Omit<Issue, 'id'> & { id?: string }) => {
    if (!data.id) return;
    onUpdate(issues.map((i) => (i.id === data.id ? { ...data, id: data.id } as Issue : i)));
    setEditingIssue(null);
  };

  const handleDelete = (id: string) => {
    if (!confirm('确定删除此问题记录？')) return;
    onUpdate(issues.filter((i) => i.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const handleStatusChange = (id: string, status: IssueStatus) => {
    onUpdate(issues.map((i) => {
      if (i.id !== id) return i;
      const closedDate = (status === 'resolved' || status === 'closed') ? new Date().toISOString().slice(0, 10) : undefined;
      return { ...i, status, closedDate };
    }));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bug size={16} className="text-stone-500" />
          <div>
            <span className="font-serif text-lg text-stone-900">问题清单</span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400 ml-3">8D/CAPA · {phaseName}</span>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-stone-900 text-stone-50 text-xs font-mono uppercase tracking-wider hover:bg-stone-700 transition-colors"
          >
            <Plus size={12} />
            新建问题
          </button>
        )}
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-stone-200 p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-1">总计</div>
          <div className="text-2xl font-serif font-semibold text-stone-900">{stats.total}</div>
          <div className="text-[10px] font-mono text-stone-400 mt-0.5">关闭率 {stats.closureRate}%</div>
        </div>
        <div className="bg-rose-50 border border-rose-200 p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-rose-500 mb-1">待处理</div>
          <div className="text-2xl font-serif font-semibold text-rose-700">{stats.open}</div>
          <div className="text-[10px] font-mono text-rose-400 mt-0.5">处理中 {stats.inProgress}</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-600 mb-1">已解决</div>
          <div className="text-2xl font-serif font-semibold text-emerald-700">{stats.resolved}</div>
          <div className="text-[10px] font-mono text-emerald-500 mt-0.5">占比 {stats.total > 0 ? Math.round(stats.resolved / stats.total * 100) : 0}%</div>
        </div>
        <div className="bg-white border border-stone-200 p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-1">等级分布</div>
          <div className="flex items-center gap-2 mt-1">
            {(['P0', 'P1', 'P2', 'P3'] as IssueSeverity[]).map((s) => {
              const cfg = SEVERITY_CONFIG[s];
              const count = s === 'P0' ? stats.p0 : s === 'P1' ? stats.p1 : s === 'P2' ? stats.p2 : stats.p3;
              return count > 0 ? (
                <div key={s} className={`flex items-center gap-1 px-1.5 py-0.5 ${cfg.bg} border ${cfg.border}`}>
                  <span className={`text-[10px] font-mono font-bold ${cfg.color}`}>{s}</span>
                  <span className={`text-[10px] font-mono ${cfg.color}`}>{count}</span>
                </div>
              ) : null;
            })}
            {stats.total === 0 && <span className="text-[10px] font-mono text-stone-400">暂无问题</span>}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-stone-300 focus:border-stone-900 outline-none text-xs transition-colors"
            placeholder="搜索问题标题、描述、负责人..."
          />
        </div>

        {/* Severity Filter */}
        <div className="flex items-center gap-1">
          <Filter size={11} className="text-stone-400" />
          {(['all', 'P0', 'P1', 'P2', 'P3'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterSeverity(s)}
              className={`px-2 py-1 text-[10px] font-mono uppercase border transition-all ${
                filterSeverity === s
                  ? s === 'all' ? 'bg-stone-900 text-white border-stone-900' : `${SEVERITY_CONFIG[s as IssueSeverity].bg} ${SEVERITY_CONFIG[s as IssueSeverity].border} ${SEVERITY_CONFIG[s as IssueSeverity].color} font-bold`
                  : 'bg-white border-stone-200 text-stone-500 hover:border-stone-300'
              }`}
            >
              {s === 'all' ? '全部' : s}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1 flex-wrap">
          {(['all', ...ALL_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-2 py-1 text-[10px] font-mono border transition-all ${
                filterStatus === s
                  ? s === 'all' ? 'bg-stone-900 text-white border-stone-900' : `${STATUS_CONFIG[s as IssueStatus].bg} ${STATUS_CONFIG[s as IssueStatus].border} ${STATUS_CONFIG[s as IssueStatus].color} font-medium`
                  : 'bg-white border-stone-200 text-stone-500 hover:border-stone-300'
              }`}
            >
              {s === 'all' ? '全部' : STATUS_CONFIG[s as IssueStatus].label}
            </button>
          ))}
        </div>
      </div>

      {/* Issue List */}
      {filtered.length === 0 ? (
        <div className="bg-stone-50 border border-stone-200 border-dashed p-10 text-center">
          <Bug size={28} className="text-stone-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-stone-500">
            {issues.length === 0 ? `${phaseName} 阶段暂无问题记录` : '没有符合过滤条件的问题'}
          </p>
          {issues.length === 0 && canEdit && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 px-4 py-2 text-xs font-mono uppercase tracking-wider bg-stone-900 text-stone-50 hover:bg-stone-700 transition-colors"
            >
              <Plus size={12} className="inline mr-1.5" />
              新建第一个问题
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((issue) => {
            const sev = SEVERITY_CONFIG[issue.severity];
            const sta = STATUS_CONFIG[issue.status];
            const isExpanded = expandedId === issue.id;
            const isClosed = issue.status === 'closed' || issue.status === 'resolved' || issue.status === 'wont_fix';

            return (
              <div
                key={issue.id}
                className={`bg-white border border-stone-200 transition-all ${isClosed ? 'opacity-70' : ''}`}
                style={{ borderLeftWidth: 3, borderLeftColor: sev.dot.replace('bg-', '').includes('red') ? '#ef4444' : sev.dot.includes('orange') ? '#f97316' : sev.dot.includes('amber') ? '#f59e0b' : '#a8a29e' }}
              >
                {/* Issue Row */}
                <div className="flex items-center gap-3 p-3">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : issue.id)}
                    className="text-stone-400 hover:text-stone-700 transition-colors shrink-0"
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>

                  {/* Severity Badge */}
                  <div className={`shrink-0 w-8 h-6 flex items-center justify-center text-[10px] font-mono font-bold border ${sev.bg} ${sev.border} ${sev.color}`}>
                    {issue.severity}
                  </div>

                  {/* Title + Meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium text-stone-900 ${isClosed ? 'line-through text-stone-400' : ''}`}>
                        {issue.title}
                      </span>
                      <span className="text-[10px] font-mono text-stone-400 bg-stone-50 px-1.5 py-0.5 border border-stone-200">
                        {CATEGORY_LABELS[issue.category]}
                      </span>
                      {issue.responsibleDept && (
                        <span className="text-[10px] font-mono text-blue-500 bg-blue-50 px-1.5 py-0.5 border border-blue-200">
                          {issue.responsibleDept}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <EightDProgress status={issue.status} />
                      <div className="flex items-center gap-3 text-[10px] font-mono text-stone-400">
                        {issue.owner && <span>负责人: {issue.owner}</span>}
                        {issue.foundDate && <span>发现: {issue.foundDate}</span>}
                        {issue.targetDate && <span>目标: {issue.targetDate}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Status Selector */}
                  {(() => {
                    const canChangeStatus = canEdit && (canManage || (currentUserId && issue.creatorId === currentUserId));
                    return canChangeStatus ? (
                      <select
                        value={issue.status}
                        onChange={(e) => handleStatusChange(issue.id, e.target.value as IssueStatus)}
                        onClick={(e) => e.stopPropagation()}
                        className={`shrink-0 text-[10px] font-mono border px-2 py-1 outline-none cursor-pointer ${sta.bg} ${sta.border} ${sta.color}`}
                      >
                        {ALL_STATUSES.map((s) => (
                          <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`shrink-0 text-[10px] font-mono border px-2 py-1 ${sta.bg} ${sta.border} ${sta.color}`}>
                        {STATUS_CONFIG[issue.status].label}
                      </span>
                    );
                  })()}

                  {/* Actions */}
                  {canEdit && (() => {
                    const isCreator = currentUserId && issue.creatorId === currentUserId;
                    const canEditThis = canManage || isCreator;
                    if (!canEditThis) return null;
                    return (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingIssue(issue); }}
                          className="p-1.5 text-stone-400 hover:text-stone-700 transition-colors"
                          title="编辑"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(issue.id); }}
                          className="p-1.5 text-stone-400 hover:text-rose-600 transition-colors"
                          title="删除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* Expanded Details - 8D View */}
                {isExpanded && (
                  <div className="border-t border-stone-100 p-4 space-y-4 bg-stone-50/50">
                    {/* Problem Description */}
                    {issue.desc && (
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-1">D1: 问题描述</div>
                        <p className="text-sm text-stone-700 leading-relaxed">{issue.desc}</p>
                      </div>
                    )}

                    {/* D3: Containment */}
                    {issue.containmentAction && (
                      <div className="border-l-2 border-orange-400 pl-3">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-orange-600 mb-1">D3: 临时措施</div>
                        <p className="text-sm text-stone-700 leading-relaxed">{issue.containmentAction}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-stone-400">
                          {issue.containmentDate && <span>实施: {issue.containmentDate}</span>}
                          {issue.containmentVerified && <span className="text-emerald-600">✓ 已验证</span>}
                        </div>
                      </div>
                    )}

                    {/* D4: Root Cause */}
                    {issue.rootCause && (
                      <div className="border-l-2 border-amber-400 pl-3">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-amber-600 mb-1">
                          D4: 根本原因 {issue.rootCauseMethod && `(${issue.rootCauseMethod})`}
                        </div>
                        <p className="text-sm text-stone-700 leading-relaxed">{issue.rootCause}</p>
                      </div>
                    )}

                    {/* D5/D6: Corrective Action */}
                    {(issue.correctiveAction || issue.solution) && (
                      <div className="border-l-2 border-indigo-400 pl-3">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-indigo-600 mb-1">D5/D6: 永久纠正措施</div>
                        {issue.correctiveAction && <p className="text-sm text-stone-700 leading-relaxed">{issue.correctiveAction}</p>}
                        {issue.solution && <p className="text-sm text-stone-700 leading-relaxed mt-1">{issue.solution}</p>}
                        {issue.correctiveActionDate && (
                          <div className="text-[10px] font-mono text-stone-400 mt-1">实施日期: {issue.correctiveActionDate}</div>
                        )}
                      </div>
                    )}

                    {/* D7: Verification */}
                    {issue.verificationResult && (
                      <div className="border-l-2 border-cyan-400 pl-3">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-600 mb-1">D7: 效果验证</div>
                        <p className="text-sm text-stone-700 leading-relaxed">{issue.verificationResult}</p>
                        {issue.verificationDate && (
                          <div className="text-[10px] font-mono text-stone-400 mt-1">验证日期: {issue.verificationDate}</div>
                        )}
                      </div>
                    )}

                    {/* D8: Prevention */}
                    {issue.preventiveAction && (
                      <div className="border-l-2 border-emerald-400 pl-3">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-600 mb-1">D8: 预防措施</div>
                        <p className="text-sm text-stone-700 leading-relaxed">{issue.preventiveAction}</p>
                      </div>
                    )}

                    {/* Meta info */}
                    <div className="text-[10px] font-mono text-stone-400 flex items-center gap-4 pt-2 border-t border-stone-200">
                      {issue.reporter && <span>发现人: {issue.reporter}</span>}
                      {issue.responsibleDept && <span>责任部门: {issue.responsibleDept}</span>}
                      {issue.closedDate && <span>关闭日期: {issue.closedDate}</span>}
                      {issue.recurrenceCount && issue.recurrenceCount > 0 && (
                        <span className="text-rose-500">复发次数: {issue.recurrenceCount}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Form Modal */}
      {showForm && (
        <IssueFormModal
          title="新建问题"
          initial={emptyIssue()}
          onSave={(data) => handleCreate(data as Omit<Issue, 'id'>)}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Edit Form Modal */}
      {editingIssue && (
        <IssueFormModal
          title="编辑问题"
          initial={editingIssue}
          onSave={handleEdit}
          onClose={() => setEditingIssue(null)}
        />
      )}
    </div>
  );
}
