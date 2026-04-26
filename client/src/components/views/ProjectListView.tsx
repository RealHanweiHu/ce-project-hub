// Design: Industrial Precision - stone/amber color system
// ProjectListView: project cards with phase progress and risk indicators

import { useState } from 'react';
import { Plus, Trash2, FolderKanban } from 'lucide-react';
import {
  Project, SOP_PHASES, PHASE_MAP, RISK_CONFIG,
  computePhaseProgress, computeOverallProgress,
} from '@/lib/data';
import { ProgressBar } from '@/components/shared/ProgressBar';

interface ProjectListViewProps {
  projects: Project[];
  onSelectProject: (id: string) => void;
  onAddProject: (project: Omit<Project, 'id' | 'phases'>) => void;
  onDeleteProject: (id: string) => void;
}

export function ProjectListView({
  projects,
  onSelectProject,
  onAddProject,
  onDeleteProject,
}: ProjectListViewProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    type: '可穿戴',
    pm: '',
    startDate: '',
    targetDate: '',
    risk: 'medium' as 'low' | 'medium' | 'high',
  });

  const handleAdd = () => {
    if (!form.name.trim()) return;
    onAddProject({
      ...form,
      currentPhase: 'concept',
    });
    setForm({ code: '', name: '', type: '可穿戴', pm: '', startDate: '', targetDate: '', risk: 'medium' });
    setShowAdd(false);
  };

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
          const phase = PHASE_MAP[project.currentPhase];
          const phaseProgress = computePhaseProgress(project.phases[project.currentPhase], project.currentPhase);
          const overallProgress = computeOverallProgress(project);
          const risk = RISK_CONFIG[project.risk];

          return (
            <div
              key={project.id}
              className="group bg-white border border-stone-200 hover:border-stone-300 transition-all cursor-pointer"
              style={{ borderTopWidth: 3, borderTopColor: phase?.color }}
              onClick={() => onSelectProject(project.id)}
            >
              <div className="p-5 border-b border-stone-100">
                <div className="flex items-start justify-between mb-3">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">
                    {project.code}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`确定删除项目「${project.name}」？`)) onDeleteProject(project.id);
                    }}
                    className="text-stone-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all p-0.5"
                  >
                    <Trash2 size={14} />
                  </button>
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
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: phase?.color }} />
                    <span className="text-sm font-medium text-stone-900">{phase?.name}</span>
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
              {SOP_PHASES.map((phase) => {
                const count = projects.filter((p) => p.currentPhase === phase.id).length;
                return count > 0 ? (
                  <div key={phase.id} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: phase.color }} />
                    <span className="font-mono text-stone-600 flex-1 text-left">{phase.code}</span>
                    <span className="font-mono text-stone-900 font-medium">{count}</span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}
      </div>

      {/* Add Project Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-stone-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="font-serif text-xl text-stone-900">新建项目</h3>
                <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">NEW PROJECT</p>
              </div>
              <button onClick={() => setShowAdd(false)} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">项目名称 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors"
                  placeholder="输入项目名称"
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
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1.5">产品类型</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors bg-white"
                >
                  {['可穿戴', '音频', '影像', 'IoT', '移动设备', '其他'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
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
                <select
                  value={form.risk}
                  onChange={(e) => setForm({ ...form, risk: e.target.value as 'low' | 'medium' | 'high' })}
                  className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm transition-colors bg-white"
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
              </div>
            </div>
            <div className="p-6 border-t border-stone-200 flex gap-3 justify-end">
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 text-xs font-mono uppercase tracking-wider text-stone-600 border border-stone-300 hover:bg-stone-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAdd}
                className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-stone-900 text-stone-50 hover:bg-stone-700 transition-colors"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
