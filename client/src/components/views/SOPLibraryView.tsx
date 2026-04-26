// Design: Industrial Precision - stone/amber color system
// SOPLibraryView: SOP standard process library with 7 phases and 44 tasks

import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap, Target } from 'lucide-react';
import { SOP_PHASES } from '@/lib/data';

export function SOPLibraryView() {
  const [expandedPhase, setExpandedPhase] = useState<string | null>('concept');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-serif text-2xl text-stone-900">SOP 标准流程库</h2>
        <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">STANDARD OPERATING PROCEDURE</p>
        <p className="text-sm text-stone-600 mt-3 max-w-3xl">
          消费电子产品开发标准流程，包含 <strong>7 个主要阶段</strong>、<strong>44 个关键子任务</strong>。每个子任务都附带详细执行指南，帮助团队规范化产品开发过程。
        </p>
      </div>

      {/* Phase Overview */}
      <div className="bg-white border border-stone-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} className="text-amber-600" />
          <h3 className="font-serif text-lg text-stone-900">完整开发流程</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {SOP_PHASES.map((phase) => (
            <button
              key={phase.id}
              onClick={() => setExpandedPhase(phase.id)}
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
            </button>
          ))}
        </div>
      </div>

      {/* Phase Details */}
      {SOP_PHASES.map((phase) => {
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
