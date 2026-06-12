// Design: Industrial Precision - stone/amber color system
// SOPLibraryView: SOP library with category tabs (NPD / ECO / IDR)

import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap, Target } from 'lucide-react';
import {
  PROJECT_CATEGORIES, CATEGORY_MAP, getPhasesForCategory, ProjectCategory,
} from '@/lib/sop-templates';
import { GateStandardPanel } from '@/components/shared/GateStandardPanel';

export function SOPLibraryView() {
  const [activeCategory, setActiveCategory] = useState<ProjectCategory>('npd');
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);

  const catConfig = CATEGORY_MAP[activeCategory];
  const phases = getPhasesForCategory(activeCategory);

  const handleCategoryChange = (cat: ProjectCategory) => {
    setActiveCategory(cat);
    setExpandedPhase(phases[0]?.id || null);
  };

  const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-serif text-2xl text-stone-900">SOP 标准流程库</h2>
        <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">STANDARD OPERATING PROCEDURE</p>
        <p className="text-sm text-stone-600 mt-3 max-w-3xl">
          按项目类别查看对应的标准开发流程。每个子任务附带详细执行指南，帮助团队规范化产品开发过程。
        </p>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-0 border-b border-stone-200">
        {PROJECT_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryChange(cat.id)}
            className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
              activeCategory === cat.id
                ? 'border-b-stone-900 text-stone-900 bg-stone-50'
                : 'border-b-transparent text-stone-400 hover:text-stone-700 hover:bg-stone-50'
            }`}
          >
            <span>{cat.icon}</span>
            <span>{cat.name}</span>
            <span className={`text-[9px] px-1.5 py-0.5 ${cat.color} ${cat.textColor} border ${cat.borderColor}`}>
              {cat.badge}
            </span>
          </button>
        ))}
      </div>

      {/* Category Summary Card */}
      <div className={`p-5 border ${catConfig.borderColor} ${catConfig.color}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="text-3xl">{catConfig.icon}</span>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className={`font-serif text-xl ${catConfig.textColor}`}>{catConfig.name}</h3>
                <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 border ${catConfig.borderColor} ${catConfig.textColor}`}>
                  {catConfig.badge}
                </span>
              </div>
              <p className={`text-sm ${catConfig.textColor} opacity-80 max-w-xl`}>{catConfig.desc}</p>
            </div>
          </div>
          <div className="flex gap-6 shrink-0">
            <div className="text-center">
              <div className={`text-2xl font-serif font-semibold ${catConfig.textColor}`}>{phases.length}</div>
              <div className={`text-[10px] font-mono uppercase tracking-wider ${catConfig.textColor} opacity-60`}>阶段</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-serif font-semibold ${catConfig.textColor}`}>{totalTasks}</div>
              <div className={`text-[10px] font-mono uppercase tracking-wider ${catConfig.textColor} opacity-60`}>任务</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-serif font-semibold ${catConfig.textColor}`}>{catConfig.typicalDuration}</div>
              <div className={`text-[10px] font-mono uppercase tracking-wider ${catConfig.textColor} opacity-60`}>典型周期</div>
            </div>
          </div>
        </div>
      </div>

      {/* Phase Overview Grid */}
      <div className="bg-white border border-stone-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} className="text-amber-600" />
          <h3 className="font-serif text-lg text-stone-900">{catConfig.name}开发流程</h3>
        </div>
        <div className={`grid gap-2 ${
          phases.length <= 4
            ? 'grid-cols-2 md:grid-cols-4'
            : phases.length <= 5
            ? 'grid-cols-2 md:grid-cols-5'
            : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-7'
        }`}>
          {phases.map((phase) => (
            <button
              key={phase.id}
              onClick={() => setExpandedPhase(expandedPhase === phase.id ? null : phase.id)}
              className={`p-3 border text-left transition-all ${
                expandedPhase === phase.id
                  ? 'border-l-4 bg-stone-50'
                  : 'border-stone-200 hover:bg-stone-50'
              }`}
              style={expandedPhase === phase.id ? { borderLeftColor: phase.color } : {}}
            >
              <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400">{phase.code}</div>
              <div className="font-medium text-sm text-stone-900 mt-1">{phase.name}</div>
              <div className="text-[10px] text-stone-500 mt-1">{phase.duration}</div>
              <div className="text-[10px] font-mono text-stone-400 mt-0.5">{phase.tasks.length} 任务</div>
            </button>
          ))}
        </div>
      </div>

      {/* Phase Details */}
      {phases.map((phase) => {
        const isOpen = expandedPhase === phase.id;
        return (
          <div key={phase.id} className="bg-white border border-stone-200">
            <button
              onClick={() => setExpandedPhase(isOpen ? null : phase.id)}
              className="w-full p-6 flex items-center justify-between text-left hover:bg-stone-50 transition-colors"
              style={{ borderLeftWidth: 4, borderLeftColor: phase.color }}
            >
              <div className="flex items-center gap-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 px-2">
                  {phase.code}
                </div>
                <div>
                  <h3 className="font-serif text-xl text-stone-900">{phase.name}</h3>
                  <div className="flex items-center gap-3 text-xs text-stone-500 mt-0.5">
                    <span className="font-mono uppercase tracking-wider">{phase.nameEn}</span>
                    <span>·</span>
                    <span>{phase.duration}</span>
                    <span>·</span>
                    <span>{phase.tasks.length} 个任务</span>
                  </div>
                </div>
              </div>
              {isOpen ? <ChevronDown size={20} className="text-stone-400" /> : <ChevronRight size={20} className="text-stone-400" />}
            </button>

            {isOpen && (
              <div className="border-t border-stone-100">
                <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 border-b border-stone-100">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-2">阶段描述</div>
                    <p className="text-sm text-stone-700">{phase.desc}</p>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-2">交付物</div>
                    <div className="space-y-1">
                      {phase.deliverables.map((d, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-stone-700">
                          <span className="text-stone-300 mt-0.5">▸</span>
                          <span>{d}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-2">Gate 评审</div>
                    <div className="flex items-start gap-2">
                      <Target size={14} className="text-amber-600 mt-0.5 shrink-0" />
                      <span className="text-sm font-medium text-stone-900">{phase.gate}</span>
                    </div>
                  </div>
                </div>

                {phase.gateStandard && (
                  <div className="p-6 border-b border-stone-100 bg-stone-50/40">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-4">Gate 管理标准</div>
                    <GateStandardPanel standard={phase.gateStandard} />
                  </div>
                )}

                <div className="p-6">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-4">子任务清单</div>
                  <div className="space-y-3">
                    {phase.tasks.map((task, idx) => (
                      <div key={task.id} className="border border-stone-200 hover:border-stone-300 transition-colors">
                        <div className="flex items-start gap-3 p-3 bg-stone-50/50">
                          <div className="text-[10px] font-mono text-stone-400 mt-0.5 w-5 shrink-0">{idx + 1}</div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-stone-900">{task.name}</span>
                              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{task.id}</span>
                              <span className="text-[10px] font-mono text-stone-400">负责人: {task.owner}</span>
                            </div>
                            <p className="text-xs text-stone-600 mt-1">{task.desc}</p>
                          </div>
                        </div>
                        {task.guide && (
                          <div className="p-3 border-l-2 border-amber-500 bg-amber-50">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-amber-600 mb-1.5">操作指南</div>
                            <pre className="text-xs text-stone-700 whitespace-pre-wrap font-sans leading-relaxed">{task.guide}</pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
