// SOPLibraryView: SOP library with category tabs (NPD / ECO / IDR) — Linear style

import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap, Target } from 'lucide-react';
import {
  PROJECT_CATEGORIES, CATEGORY_MAP, getPhasesForCategory, ProjectCategory,
} from '@/lib/sop-templates';
import { GateStandardPanel } from '@/components/shared/GateStandardPanel';
import { Kicker } from '@/components/linear/primitives';
import { SopGovernancePanel } from './SopGovernancePanel';

const ROLE_LABELS: Record<string, string> = {
  rd_hw: '硬件研发',
  rd_sw: '软件研发',
  rd_mech: '结构/ID',
  qa: '测试/品质',
  scm: '供应链',
  pe: 'PE 工艺',
  mfg: 'MFG 生产',
  sales: '销售/渠道',
  cert: '认证',
  battery_safety: '电池安全',
  project_manager: '项目经理/PMO',
  pm: '产品经理',
  manager: '管理层',
  owner: '项目创建者',
};
const MANAGEMENT_TASK_ROLES = new Set(['project_manager', 'manager', 'owner']);

function primaryTaskRoleLabel(roles: string[] | undefined, fallback = '项目经理/PMO') {
  const primary = (roles || []).find((role) => !MANAGEMENT_TASK_ROLES.has(role)) ?? (roles || [])[0];
  return primary ? ROLE_LABELS[primary] ?? primary : fallback;
}

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
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-[-0.4px] text-foreground">SOP 标准流程库</h2>
        <Kicker className="mt-0.5">STANDARD OPERATING PROCEDURE</Kicker>
        <p className="text-sm text-muted-foreground mt-3 max-w-3xl">
          按项目类别查看对应的标准开发流程。每个子任务附带详细执行指南，帮助团队规范化产品开发过程。
        </p>
      </div>

      <SopGovernancePanel />

      {/* Category Tabs */}
      <div className="rounded-[11px] border border-border bg-card overflow-x-auto flex gap-0 px-1">
        {PROJECT_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryChange(cat.id)}
            className={`flex items-center gap-2 px-5 py-3 text-xs uppercase tracking-wider border-b-2 transition-all ${
              activeCategory === cat.id
                ? 'border-b-primary text-foreground bg-secondary'
                : 'border-b-transparent text-muted-foreground hover:text-foreground hover:bg-secondary'
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
      <div className={`rounded-[11px] p-5 border ${catConfig.borderColor} ${catConfig.color}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="text-3xl">{catConfig.icon}</span>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className={`text-xl font-semibold ${catConfig.textColor}`}>{catConfig.name}</h3>
                <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${catConfig.borderColor} ${catConfig.textColor}`}>
                  {catConfig.badge}
                </span>
              </div>
              <p className={`text-sm ${catConfig.textColor} opacity-80 max-w-xl`}>{catConfig.desc}</p>
            </div>
          </div>
          <div className="flex gap-6 shrink-0">
            <div className="text-center">
              <div className={`num text-2xl font-semibold ${catConfig.textColor}`}>{phases.length}</div>
              <div className={`text-[10px] uppercase tracking-wider ${catConfig.textColor} opacity-60`}>阶段</div>
            </div>
            <div className="text-center">
              <div className={`num text-2xl font-semibold ${catConfig.textColor}`}>{totalTasks}</div>
              <div className={`text-[10px] uppercase tracking-wider ${catConfig.textColor} opacity-60`}>任务</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-semibold ${catConfig.textColor}`}>{catConfig.typicalDuration}</div>
              <div className={`text-[10px] uppercase tracking-wider ${catConfig.textColor} opacity-60`}>典型周期</div>
            </div>
          </div>
        </div>
      </div>

      {/* Phase Overview Grid */}
      <div className="rounded-[11px] border border-border bg-card p-5 lg:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} className="text-primary" />
          <h3 className="text-lg font-semibold text-foreground">{catConfig.name}开发流程</h3>
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
              className={`rounded-md p-3 border text-left transition-all ${
                expandedPhase === phase.id
                  ? 'border-l-4 bg-secondary'
                  : 'border-border hover:bg-secondary'
              }`}
              style={expandedPhase === phase.id ? { borderLeftColor: phase.color } : {}}
            >
              <div className="num text-[10px] uppercase tracking-widest text-muted-foreground">{phase.code}</div>
              <div className="font-medium text-sm text-foreground mt-1">{phase.name}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{phase.duration}</div>
              <div className="num text-[10px] text-muted-foreground mt-0.5">{phase.tasks.length} 任务</div>
            </button>
          ))}
        </div>
      </div>

      {/* Phase Details */}
      {phases.map((phase) => {
        const isOpen = expandedPhase === phase.id;
        return (
          <div key={phase.id} className="rounded-[11px] border border-border bg-card overflow-hidden">
            <button
              onClick={() => setExpandedPhase(isOpen ? null : phase.id)}
              className="w-full p-6 flex items-center justify-between text-left hover:bg-secondary transition-colors"
              style={{ borderLeftWidth: 4, borderLeftColor: phase.color }}
            >
              <div className="flex items-center gap-4">
                <div className="num text-[10px] uppercase tracking-widest text-muted-foreground px-2">
                  {phase.code}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground">{phase.name}</h3>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span className="uppercase tracking-wider">{phase.nameEn}</span>
                    <span>·</span>
                    <span>{phase.duration}</span>
                    <span>·</span>
                    <span>{phase.tasks.length} 个任务</span>
                  </div>
                </div>
              </div>
              {isOpen ? <ChevronDown size={20} className="text-muted-foreground" /> : <ChevronRight size={20} className="text-muted-foreground" />}
            </button>

            {isOpen && (
              <div className="border-t border-border">
                <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 border-b border-border">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">阶段描述</div>
                    <p className="text-sm text-foreground">{phase.desc}</p>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">交付物</div>
                    <div className="space-y-1">
                      {phase.deliverables.map((d, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-foreground">
                          <span className="text-muted-foreground/60 mt-0.5">▸</span>
                          <span>{d}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Gate 评审</div>
                    <div className="flex items-start gap-2">
                      <Target size={14} className="text-primary mt-0.5 shrink-0" />
                      <span className="text-sm font-medium text-foreground">{phase.gate}</span>
                    </div>
                  </div>
                </div>

                {phase.gateStandard && (
                  <div className="p-6 border-b border-border bg-secondary/40">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-4">Gate 管理标准</div>
                    <GateStandardPanel standard={phase.gateStandard} />
                  </div>
                )}

                <div className="p-6">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-4">子任务清单</div>
                  <div className="space-y-3">
                    {phase.tasks.map((task, idx) => (
                      <div key={task.id} className="rounded-[11px] border border-border bg-card overflow-hidden">
                        <div className="flex items-start gap-3 p-3 bg-secondary/50">
                          <div className="num text-[10px] text-muted-foreground mt-0.5 w-5 shrink-0">{idx + 1}</div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-foreground">{task.name}</span>
                              <span className="num text-[10px] uppercase tracking-wider text-muted-foreground">{task.id}</span>
                              <span className="text-[10px] text-muted-foreground">责任角色: {primaryTaskRoleLabel(task.visibleRoles)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{task.desc}</p>
                            {task.owner && (
                              <div className="text-[10px] text-muted-foreground mt-1">职能说明: {task.owner}</div>
                            )}
                          </div>
                        </div>
                        {task.guide && (
                          <div className="p-3 border-l-2 border-[color:var(--primary)] bg-[color:var(--acc-soft)]">
                            <div className="text-[10px] uppercase tracking-widest text-primary mb-1.5">操作指南</div>
                            <pre className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{task.guide}</pre>
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
