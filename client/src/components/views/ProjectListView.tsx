// Design: Industrial Precision - stone/amber color system
// ProjectListView: project cards with category badges and 3-step new project wizard

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Plus, Trash2, FolderKanban, ChevronRight, ChevronLeft, Check, Copy, Lock, AlertTriangle } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Project, SOP_PHASES, PHASE_MAP, HEALTH_CONFIG,
  computePhaseProgress, computeOverallProgress,
} from '@/lib/data';
import {
  PROJECT_CATEGORIES, ProjectCategory, getPhasesForCategory, CATEGORY_MAP,
} from '@/lib/sop-templates';
import { ProgressBar } from '@/components/shared/ProgressBar';

interface ProjectListViewProps {
  projects: Project[];
  onSelectProject: (id: string) => void;
  onAddProject: (project: Omit<Project, 'id' | 'phases'>) => void;
  onDeleteProject: (id: string) => void;
  onCloneProject?: (sourceId: string, overrides: Partial<Omit<Project, 'id' | 'phases'>>) => void;
  /** Whether the current user can create new projects */
  canCreateProject?: boolean;
}

// ── Wizard Steps ──────────────────────────────────────────────────────────────
type WizardStep = 1 | 2 | 3;

const STEP_LABELS: Record<WizardStep, string> = {
  1: '选择类别',
  2: '填写信息',
  3: '确认流程',
};

const PRODUCT_TYPES = [
  '汽车充气泵', '自行车充气泵', '户外充气泵', '车载吸尘器',
  '暴力风扇', '胎压计', '机械式打气筒', '组件',
];

export function ProjectListView({
  projects,
  onSelectProject,
  onAddProject,
  onDeleteProject,
  onCloneProject,
  canCreateProject = false,
}: ProjectListViewProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [cloneSource, setCloneSource] = useState<Project | null>(null);
  const [cloneForm, setCloneForm] = useState({ name: '', code: '', pmUserId: null as number | null, startDate: '', targetDate: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  const handleOpenClone = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setCloneSource(project);
    setCloneForm({
      name: `${project.name}（副本）`,
      code: '',
      pmUserId: project.pmUserId ?? null,
      startDate: '',
      targetDate: '',
    });
  };

  const handleCloneConfirm = () => {
    if (!cloneSource || !cloneForm.name.trim()) return;
    onCloneProject?.(cloneSource.id, {
      name: cloneForm.name.trim(),
      code: cloneForm.code.trim() || undefined as unknown as string,
      pmUserId: cloneForm.pmUserId,
      startDate: cloneForm.startDate,
      targetDate: cloneForm.targetDate,
    });
    setCloneSource(null);
  };
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedCategory, setSelectedCategory] = useState<ProjectCategory>('npd');
  const { data: userList, isLoading: usersLoading, isError: usersError } = trpc.admin.listUsersForSelect.useQuery();
  const utils = trpc.useUtils();
  const { data: productList = [] } = trpc.products.list.useQuery(undefined);
  const products = productList as Array<{ id: string; name: string; productNumber: string }>;
  const createProductMutation = trpc.products.create.useMutation({
    onSuccess: () => utils.products.list.invalidate(),
  });

  const emptyForm = {
    code: '',
    name: '',
    type: '汽车充气泵',
    pmUserId: null as number | null,
    productId: '' as string,        // 关联已有产品
    newProductName: '' as string,   // 新产品(填写则建档并关联)
    startDate: '',
    targetDate: '',
    risk: 'low' as 'low' | 'medium' | 'high',
  };
  const [form, setForm] = useState(emptyForm);

  const resetWizard = () => {
    setStep(1);
    setSelectedCategory('npd');
    setForm(emptyForm);
  };

  const handleClose = () => {
    setShowAdd(false);
    resetWizard();
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const phases = getPhasesForCategory(selectedCategory);
    const firstPhaseId = phases[0]?.id || 'concept';
    // 关联产品:选了已有 → 用它;否则填了新产品名 → 先建档再关联
    let productId: string | null = form.productId || null;
    if (!productId && form.newProductName.trim()) {
      try {
        const res = await createProductMutation.mutateAsync({ name: form.newProductName.trim(), type: 'finished', category: form.type });
        productId = res.id;
      } catch { /* 建产品失败不阻断建项目 */ }
    }
    onAddProject({
      code: form.code, name: form.name, type: form.type, pmUserId: form.pmUserId,
      startDate: form.startDate, targetDate: form.targetDate, risk: form.risk,
      productId,
      pm: '',
      currentPhase: firstPhaseId,
      category: selectedCategory,
    });
    handleClose();
  };

  const categoryConfig = CATEGORY_MAP[selectedCategory];
  const sopPhases = getPhasesForCategory(selectedCategory);

  return (
    <div className="ce-page">
      {/* Header */}
      <div className="ce-page-header">
        <div>
          <h2 className="font-serif text-2xl text-stone-900">项目列表</h2>
          <p className="ce-kicker mt-0.5">
            {projects.length} PROJECTS
          </p>
        </div>
        {canCreateProject ? (
          <button
            onClick={() => setShowAdd(true)}
            className="ce-control flex items-center gap-2 px-4 py-2 bg-stone-900 text-stone-50 text-xs font-mono uppercase tracking-wider shadow-sm hover:bg-stone-700 transition-colors"
          >
            <Plus size={14} />
            新建项目
          </button>
        ) : (
          <div className="ce-control flex items-center gap-2 px-3 py-1.5 bg-stone-100 border border-stone-200 text-stone-400 text-[10px] font-mono uppercase tracking-wider cursor-not-allowed" title="仅管理员、管理层和 PM 可创建项目">
            <Lock size={12} />
            无创建权限
          </div>
        )}
      </div>

      {/* Project Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {projects.map((project) => {
          const phases = project.category
            ? getPhasesForCategory(project.category)
            : SOP_PHASES;
          const phaseObj = phases.find((p) => p.id === project.currentPhase) || PHASE_MAP[project.currentPhase];
          const phaseProgress = computePhaseProgress(project.phases[project.currentPhase], project.currentPhase);
          const overallProgress = computeOverallProgress(project);
          const health = HEALTH_CONFIG[project.risk];
          const catConfig = project.category ? CATEGORY_MAP[project.category] : null;

          return (
            <div
              key={project.id}
              className="ce-card group cursor-pointer overflow-hidden"
              style={{ borderTopWidth: 3, borderTopColor: phaseObj?.color || '#78716c' }}
              onClick={() => onSelectProject(project.id)}
            >
              <div className="p-5 border-b border-stone-100">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">
                      {project.code}
                    </span>
                    {catConfig && (
                      <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 ${catConfig.color} ${catConfig.textColor} border ${catConfig.borderColor}`}>
                        {catConfig.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={(e) => handleOpenClone(e, project)}
                      className="text-stone-300 hover:text-amber-500 transition-colors p-0.5"
                      title="克隆项目"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm({ id: project.id, name: project.name });
                      }}
                      className="text-stone-300 hover:text-rose-500 transition-colors p-0.5"
                      title="删除项目"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <h3 className="font-serif text-lg text-stone-900 leading-tight mb-2">
                  {project.name}
                </h3>
                <div className="flex items-center gap-2 text-xs text-stone-500">
                  <span>{project.type}</span>
                  <span>·</span>
                  <span>PM {project.pm}</span>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* Current Phase */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">当前阶段</span>
                    <span className="text-xs font-mono text-stone-700">{phaseProgress}%</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: phaseObj?.color || '#78716c' }} />
                    <span className="text-sm font-medium text-stone-900">{phaseObj?.name}</span>
                  </div>
                  <ProgressBar value={phaseProgress} color="bg-amber-500" height="h-1" />
                </div>

                {/* Overall Progress */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">整体进度</span>
                    <span className="text-xs font-mono text-stone-700">{overallProgress}%</span>
                  </div>
                  <ProgressBar value={overallProgress} color="bg-stone-900" height="h-1" />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-stone-100">
                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 ${health.bg} ${health.border} border`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${health.dot}`} />
                    <span className={`text-xs font-medium ${health.color}`}>{health.label}</span>
                  </div>
                  <span className="text-[10px] font-mono text-stone-400">{project.targetDate}</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Phase Progress Summary */}
        {projects.length > 0 && (
          <div className="ce-muted-band border-dashed p-5 flex flex-col justify-center items-center text-center">
            <FolderKanban size={24} className="text-stone-300 mb-3" />
            <p className="text-sm font-medium text-stone-500">阶段概览</p>
            <div className="mt-4 w-full space-y-2">
              {/* Show all unique current phases across all projects */}
              {Array.from(new Set(projects.map((p) => p.currentPhase))).map((phaseId) => {
                const count = projects.filter((p) => p.currentPhase === phaseId).length;
                const phaseObj = PHASE_MAP[phaseId] || { code: phaseId.toUpperCase(), color: '#78716c' };
                return (
                  <div key={phaseId} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: phaseObj.color }} />
                    <span className="font-mono text-stone-600 flex-1 text-left">{phaseObj.code}</span>
                    <span className="font-mono text-stone-900 font-medium">{count}</span>
                  </div>
                );
              })}
            </div>
            {/* Category breakdown */}
            <div className="mt-4 w-full pt-3 border-t border-stone-200 space-y-1.5">
              {PROJECT_CATEGORIES.map((cat) => {
                const count = projects.filter((p) => (p.category || 'npd') === cat.id).length;
                return count > 0 ? (
                  <div key={cat.id} className="flex items-center gap-2 text-xs">
                    <span className={`text-[9px] font-mono px-1 py-0.5 ${cat.color} ${cat.textColor} border ${cat.borderColor}`}>{cat.badge}</span>
                    <span className="text-stone-500 flex-1 text-left">{cat.name}</span>
                    <span className="font-mono text-stone-900 font-medium">{count}</span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Clone Project Modal ──────────────────────────────────────────────── */}
      {cloneSource && (
        <div className="fixed inset-0 bg-stone-900/50 z-50 flex items-center justify-center p-4" onClick={() => setCloneSource(null)}>
          <div
            className="bg-white w-full max-w-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="font-serif text-xl text-stone-900">克隆项目</h3>
                <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">CLONE PROJECT</p>
              </div>
              <button onClick={() => setCloneSource(null)} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
            </div>

            {/* Source Info */}
            <div className="px-6 pt-5 pb-3">
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 mb-5">
                <Copy size={13} className="text-amber-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-amber-900 truncate">基于「{cloneSource.name}」克隆</p>
                  <p className="text-[10px] font-mono text-amber-600">
                    {cloneSource.category ? CATEGORY_MAP[cloneSource.category]?.name : 'NPD'}
                    {' · '}
                    {cloneSource.category ? CATEGORY_MAP[cloneSource.category]?.phaseCount : 7} 个阶段 · 进度将清零
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">新项目名称 *</label>
                  <input
                    type="text"
                    value={cloneForm.name}
                    onChange={(e) => setCloneForm({ ...cloneForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">项目编号</label>
                    <input
                      type="text"
                      value={cloneForm.code}
                      onChange={(e) => setCloneForm({ ...cloneForm, code: e.target.value })}
                      className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                      placeholder={cloneSource.code ? `${cloneSource.code}-2` : 'CE-2026-XXX'}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">项目经理</label>
                    <select
                      value={cloneForm.pmUserId ?? ''}
                      onChange={(e) => setCloneForm({ ...cloneForm, pmUserId: e.target.value ? Number(e.target.value) : null })}
                      disabled={usersLoading}
                      className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors bg-white disabled:opacity-50"
                    >
                      {usersLoading && <option value="">加载中...</option>}
                      {usersError && <option value="">加载失败</option>}
                      {!usersLoading && !usersError && <option value="">选择项目经理...</option>}
                      {(userList || []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name || u.username}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">开始日期</label>
                    <input
                      type="date"
                      value={cloneForm.startDate}
                      onChange={(e) => setCloneForm({ ...cloneForm, startDate: e.target.value })}
                      className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">目标日期</label>
                    <input
                      type="date"
                      value={cloneForm.targetDate}
                      onChange={(e) => setCloneForm({ ...cloneForm, targetDate: e.target.value })}
                      className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-stone-200 flex items-center justify-between">
              <button
                onClick={() => setCloneSource(null)}
                className="px-4 py-2 text-xs font-mono uppercase tracking-wider text-stone-600 border border-stone-300 hover:bg-stone-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCloneConfirm}
                disabled={!cloneForm.name.trim()}
                className={`flex items-center gap-2 px-5 py-2 text-xs font-mono uppercase tracking-wider bg-amber-500 text-white hover:bg-amber-600 transition-colors ${
                  !cloneForm.name.trim() ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <Copy size={13} />
                克隆项目
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Project Wizard Modal ─────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 bg-stone-900/50 z-50 flex items-center justify-center p-4" onClick={handleClose}>
          <div
            className="bg-white w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-stone-200 flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-serif text-xl text-stone-900">新建项目</h3>
                <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">NEW PROJECT</p>
              </div>
              <button onClick={handleClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center px-6 py-3 border-b border-stone-100 bg-stone-50 shrink-0">
              {([1, 2, 3] as WizardStep[]).map((s, i) => (
                <div key={s} className="flex items-center">
                  <div className={`flex items-center gap-2 ${step === s ? 'text-stone-900' : step > s ? 'text-emerald-600' : 'text-stone-400'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold border ${
                      step === s ? 'bg-stone-900 text-white border-stone-900' :
                      step > s ? 'bg-emerald-500 text-white border-emerald-500' :
                      'bg-white text-stone-400 border-stone-300'
                    }`}>
                      {step > s ? <Check size={10} /> : s}
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-wider">{STEP_LABELS[s]}</span>
                  </div>
                  {i < 2 && <div className="w-8 h-px bg-stone-200 mx-3" />}
                </div>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Step 1: Category Selection (SKG 式 3 卡片) ── */}
              {step === 1 && (
                <div className="p-6 space-y-4">
                  <p className="text-sm text-stone-600">选择项目类型，系统将自动匹配对应的 SOP 流程模板。</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {PROJECT_CATEGORIES.map((cat) => {
                      const active = selectedCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`relative flex flex-col text-left p-4 border-2 transition-all ${
                            active
                              ? 'border-stone-900 bg-stone-50'
                              : 'border-stone-200 hover:border-stone-300 bg-white'
                          }`}
                        >
                          {active && (
                            <div className="absolute top-2 right-2 w-5 h-5 bg-stone-900 rounded-full flex items-center justify-center">
                              <Check size={11} className="text-white" />
                            </div>
                          )}
                          <span className="text-3xl">{cat.icon}</span>
                          <span className="font-serif text-base text-stone-900 font-medium mt-3">{cat.name}</span>
                          <span className={`self-start text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 mt-1.5 ${cat.color} ${cat.textColor} border ${cat.borderColor}`}>
                            {cat.badge}
                          </span>
                          <p className="text-xs text-stone-500 leading-relaxed mt-2 flex-1">{cat.desc}</p>
                          <div className="mt-3 pt-3 border-t border-stone-100 flex flex-col gap-0.5">
                            <span className="text-[10px] font-mono text-stone-400">{cat.phaseCount} 个阶段</span>
                            <span className="text-[10px] font-mono text-stone-400">典型周期 {cat.typicalDuration}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Step 2: Basic Info ── */}
              {step === 2 && (
                <div className="p-6 space-y-4">
                  {/* Category reminder */}
                  <div className={`flex items-center gap-2 px-3 py-2 ${categoryConfig.color} border ${categoryConfig.borderColor}`}>
                    <span>{categoryConfig.icon}</span>
                    <span className={`text-xs font-medium ${categoryConfig.textColor}`}>
                      {categoryConfig.name} · {categoryConfig.phaseCount} 个阶段 · {categoryConfig.typicalDuration}
                    </span>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">项目名称 *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                      placeholder="输入项目名称"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">项目编号</label>
                    <input
                      type="text"
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                      placeholder="CE-2026-XXX"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">产品类型</label>
                      <select
                        value={form.type}
                        onChange={(e) => setForm({ ...form, type: e.target.value })}
                        className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors bg-white"
                      >
                        {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">项目经理</label>
                      <select
                        value={form.pmUserId ?? ''}
                        onChange={(e) => setForm({ ...form, pmUserId: e.target.value ? Number(e.target.value) : null })}
                        disabled={usersLoading}
                        className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors bg-white disabled:opacity-50"
                      >
                        {usersLoading && <option value="">加载中...</option>}
                        {usersError && <option value="">加载失败，可手动输入</option>}
                        {!usersLoading && !usersError && <option value="">选择项目经理...</option>}
                        {(userList || []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name || u.username}
                          </option>
                        ))}
                        {!usersLoading && !usersError && (userList?.length ?? 0) === 0 && (
                          <option value="" disabled>暂无用户，请先在管理员后台创建用户</option>
                        )}
                      </select>
                    </div>
                  </div>
                  {/* 关联产品:立项时可选；产品定义和客户差异在项目 SOP 中推进，项目完成或 SKU 明确后再补 PLM。 */}
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">
                      关联产品型号（选填）
                    </label>
                    <select
                      value={form.productId}
                      onChange={(e) => setForm({ ...form, productId: e.target.value, newProductName: '' })}
                      className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors bg-white"
                    >
                      <option value="">暂不关联，先按 SOP 完成立项与产品定义…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}{p.productNumber ? ` · ${p.productNumber}` : ''}</option>
                      ))}
                    </select>
                    {selectedCategory === 'npd' && (
                      <p className="mt-1.5 text-[11px] text-stone-500">
                        产品定义、客户差异、规格确认属于项目 SOP 输入；不要求先在产品库建档。项目完成或 SKU 明确后，可在产品库沉淀产品型号与可销售版本。
                      </p>
                    )}
                    {selectedCategory !== 'npd' && !form.productId && (
                      <input
                        value={form.newProductName}
                        onChange={(e) => setForm({ ...form, newProductName: e.target.value })}
                        placeholder="新产品名称（选填，填写则在产品库建档并关联）"
                        className="mt-2 w-full px-3 py-2 border border-stone-200 focus:border-stone-900 outline-none text-sm transition-colors"
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">开始日期</label>
                      <input
                        type="date"
                        value={form.startDate}
                        onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                        className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">目标日期</label>
                      <input
                        type="date"
                        value={form.targetDate}
                        onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                        className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 3: SOP Preview ── */}
              {step === 3 && (
                <div className="p-6 space-y-4">
                  <div className="flex items-start gap-3 p-3 bg-stone-50 border border-stone-200">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-serif text-base text-stone-900">{form.name || '（未命名）'}</span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 ${categoryConfig.color} ${categoryConfig.textColor} border ${categoryConfig.borderColor}`}>
                          {categoryConfig.badge}
                        </span>
                      </div>
                      <div className="text-xs text-stone-500 font-mono">
                        {form.code && <span className="mr-3">{form.code}</span>}
                        {form.pmUserId && <span className="mr-3">PM: {userList?.find(u => u.id === form.pmUserId)?.name || userList?.find(u => u.id === form.pmUserId)?.username || ''}</span>}
                        {form.startDate && <span>{form.startDate} → {form.targetDate || '?'}</span>}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-3">
                      {categoryConfig.name} SOP 流程 · {sopPhases.length} 个阶段
                    </div>
                    <div className="space-y-2">
                      {sopPhases.map((phase, idx) => (
                        <div key={phase.id} className="flex items-start gap-3 p-3 border border-stone-100 bg-white">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-mono font-bold shrink-0 mt-0.5"
                            style={{ backgroundColor: phase.color }}
                          >
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-medium text-stone-900">{phase.name}</span>
                              <span className="text-[10px] font-mono text-stone-400">{phase.duration}</span>
                            </div>
                            <p className="text-xs text-stone-500">{phase.desc}</p>
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-[9px] font-mono text-amber-600 uppercase tracking-wider">
                                Gate: {phase.gate}
                              </span>
                              <span className="text-[9px] text-stone-300">·</span>
                              <span className="text-[9px] font-mono text-stone-400">
                                {phase.tasks.length} 个任务
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-stone-200 flex items-center justify-between shrink-0">
              <button
                onClick={() => step > 1 ? setStep((step - 1) as WizardStep) : handleClose()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono uppercase tracking-wider text-stone-600 border border-stone-300 hover:bg-stone-50 transition-colors"
              >
                <ChevronLeft size={14} />
                {step === 1 ? '取消' : '上一步'}
              </button>

              {step < 3 ? (
                <button
                  onClick={() => {
                    if (step === 2 && !form.name.trim()) return;
                    setStep((step + 1) as WizardStep);
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-mono uppercase tracking-wider bg-stone-900 text-stone-50 hover:bg-stone-700 transition-colors ${
                    step === 2 && !form.name.trim() ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  下一步
                  <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  className="flex items-center gap-1.5 px-5 py-2 text-xs font-mono uppercase tracking-wider bg-stone-900 text-stone-50 hover:bg-stone-700 transition-colors"
                >
                  <Check size={14} />
                  创建项目
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Dialog ── */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-700">
              <AlertTriangle size={18} className="text-rose-600" />
              删除项目
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-stone-700">
                <p>
                  您即将删除项目 <span className="font-semibold text-stone-900">「{deleteConfirm?.name}」</span>。
                </p>
                <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-800 space-y-1">
                  <p className="font-medium">此操作将永久删除：</p>
                  <ul className="list-disc list-inside space-y-0.5 text-xs">
                    <li>项目所有阶段和任务数据</li>
                    <li>所有问题记录和关门评审</li>
                    <li>所有附件文件（S3 存储）</li>
                    <li>变更日志和操作记录</li>
                  </ul>
                  <p className="font-medium mt-2">此操作不可撤销。</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirm(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteConfirm) {
                  onDeleteProject(deleteConfirm.id);
                  setDeleteConfirm(null);
                }
              }}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
