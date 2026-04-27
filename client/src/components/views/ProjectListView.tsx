// Design: Industrial Precision - stone/amber color system
// ProjectListView: project cards with category badges and 3-step new project wizard

import { useState } from 'react';
import { Plus, Trash2, FolderKanban, ChevronRight, ChevronLeft, Check, Copy } from 'lucide-react';
import {
  Project, SOP_PHASES, PHASE_MAP, RISK_CONFIG,
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
}

// ── Wizard Steps ──────────────────────────────────────────────────────────────
type WizardStep = 1 | 2 | 3;

const STEP_LABELS: Record<WizardStep, string> = {
  1: '选择类别',
  2: '填写信息',
  3: '确认流程',
};

const PRODUCT_TYPES = ['可穿戴', '音频', '影像', 'IoT', '移动设备', '其他'];

export function ProjectListView({
  projects,
  onSelectProject,
  onAddProject,
  onDeleteProject,
  onCloneProject,
}: ProjectListViewProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [cloneSource, setCloneSource] = useState<Project | null>(null);
  const [cloneForm, setCloneForm] = useState({ name: '', code: '', pm: '', startDate: '', targetDate: '' });

  const handleOpenClone = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setCloneSource(project);
    setCloneForm({
      name: `${project.name}（副本）`,
      code: '',
      pm: project.pm,
      startDate: '',
      targetDate: '',
    });
  };

  const handleCloneConfirm = () => {
    if (!cloneSource || !cloneForm.name.trim()) return;
    onCloneProject?.(cloneSource.id, {
      name: cloneForm.name.trim(),
      code: cloneForm.code.trim() || undefined as unknown as string,
      pm: cloneForm.pm.trim(),
      startDate: cloneForm.startDate,
      targetDate: cloneForm.targetDate,
    });
    setCloneSource(null);
  };
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedCategory, setSelectedCategory] = useState<ProjectCategory>('npd');
  const [form, setForm] = useState({
    code: '',
    name: '',
    type: '可穿戴',
    pm: '',
    startDate: '',
    targetDate: '',
    risk: 'medium' as 'low' | 'medium' | 'high',
  });

  const resetWizard = () => {
    setStep(1);
    setSelectedCategory('npd');
    setForm({ code: '', name: '', type: '可穿戴', pm: '', startDate: '', targetDate: '', risk: 'medium' });
  };

  const handleClose = () => {
    setShowAdd(false);
    resetWizard();
  };

  const handleCreate = () => {
    if (!form.name.trim()) return;
    const phases = getPhasesForCategory(selectedCategory);
    const firstPhaseId = phases[0]?.id || 'concept';
    onAddProject({
      ...form,
      currentPhase: firstPhaseId,
      category: selectedCategory,
    });
    handleClose();
  };

  const categoryConfig = CATEGORY_MAP[selectedCategory];
  const sopPhases = getPhasesForCategory(selectedCategory);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-stone-900">项目列表</h2>
          <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">
            {projects.length} PROJECTS
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-stone-900 text-stone-50 text-xs font-mono uppercase tracking-wider hover:bg-stone-700 transition-colors"
        >
          <Plus size={14} />
          新建项目
        </button>
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
          const risk = RISK_CONFIG[project.risk];
          const catConfig = project.category ? CATEGORY_MAP[project.category] : null;

          return (
            <div
              key={project.id}
              className="group bg-white border border-stone-200 hover:border-stone-300 transition-all cursor-pointer"
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
                        if (confirm(`确定删除项目「${project.name}」？`)) onDeleteProject(project.id);
                      }}
                      className="text-stone-300 hover:text-rose-500 transition-colors p-0.5"
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
                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 ${risk.bg} ${risk.border} border`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
                    <span className={`text-xs font-medium ${risk.color}`}>{risk.label}风险</span>
                  </div>
                  <span className="text-[10px] font-mono text-stone-400">{project.targetDate}</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Phase Progress Summary */}
        {projects.length > 0 && (
          <div className="bg-stone-50 border border-stone-200 border-dashed p-5 flex flex-col justify-center items-center text-center">
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
                    <input
                      type="text"
                      value={cloneForm.pm}
                      onChange={(e) => setCloneForm({ ...cloneForm, pm: e.target.value })}
                      className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                    />
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
            className="bg-white w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
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

              {/* ── Step 1: Category Selection ── */}
              {step === 1 && (
                <div className="p-6 space-y-4">
                  <p className="text-sm text-stone-600">选择项目类别，系统将自动匹配对应的 SOP 流程模板。</p>
                  <div className="space-y-3">
                    {PROJECT_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`w-full text-left p-4 border-2 transition-all ${
                          selectedCategory === cat.id
                            ? 'border-stone-900 bg-stone-50'
                            : 'border-stone-200 hover:border-stone-300 bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <span className="text-2xl shrink-0 mt-0.5">{cat.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-serif text-base text-stone-900 font-medium">{cat.name}</span>
                              <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 ${cat.color} ${cat.textColor} border ${cat.borderColor}`}>
                                {cat.badge}
                              </span>
                            </div>
                            <p className="text-xs text-stone-500 leading-relaxed">{cat.desc}</p>
                            <div className="flex items-center gap-4 mt-2">
                              <span className="text-[10px] font-mono text-stone-400">
                                {cat.phaseCount} 个阶段
                              </span>
                              <span className="text-[10px] font-mono text-stone-400">
                                典型周期 {cat.typicalDuration}
                              </span>
                            </div>
                          </div>
                          {selectedCategory === cat.id && (
                            <div className="shrink-0 w-5 h-5 bg-stone-900 rounded-full flex items-center justify-center">
                              <Check size={11} className="text-white" />
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
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
                      <input
                        type="text"
                        value={form.pm}
                        onChange={(e) => setForm({ ...form, pm: e.target.value })}
                        className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                        placeholder="PM 姓名"
                      />
                    </div>
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
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">风险等级</label>
                    <div className="flex gap-2">
                      {(['low', 'medium', 'high'] as const).map((r) => {
                        const rc = RISK_CONFIG[r];
                        return (
                          <button
                            key={r}
                            onClick={() => setForm({ ...form, risk: r })}
                            className={`flex-1 py-2 text-xs font-medium border transition-all ${
                              form.risk === r
                                ? `${rc.bg} ${rc.border} ${rc.color} border-2`
                                : 'bg-white border-stone-200 text-stone-500 hover:border-stone-300'
                            }`}
                          >
                            {rc.label}风险
                          </button>
                        );
                      })}
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
                        {form.pm && <span className="mr-3">PM: {form.pm}</span>}
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
    </div>
  );
}
