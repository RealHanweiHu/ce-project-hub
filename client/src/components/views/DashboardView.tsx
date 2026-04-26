// Design: Industrial Precision - stone/amber color system
// DashboardView: overview stats, phase distribution chart, upcoming gates, project table

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Layers, Hash, Target, TrendingUp, AlertTriangle, Activity,
} from 'lucide-react';
import {
  Project, SOP_PHASES, PHASE_MAP, RISK_CONFIG,
  computePhaseProgress, computeOverallProgress,
} from '@/lib/data';
import { StatCard } from '@/components/shared/StatCard';
import { ProgressBar } from '@/components/shared/ProgressBar';

interface DashboardViewProps {
  projects: Project[];
  onSelectProject: (id: string) => void;
}

export function DashboardView({ projects, onSelectProject }: DashboardViewProps) {
  const stats = useMemo(() => {
    const total = projects.length;
    const active = projects.filter((p) => p.currentPhase !== 'mp').length;
    const atRisk = projects.filter((p) => p.risk === 'high').length;
    const avgProgress = total > 0
      ? Math.round(projects.reduce((sum, p) => sum + computeOverallProgress(p), 0) / total)
      : 0;
    return { total, active, atRisk, avgProgress };
  }, [projects]);

  const phaseDistribution = useMemo(
    () =>
      SOP_PHASES.map((phase) => ({
        name: phase.code,
        fullName: phase.name,
        count: projects.filter((p) => p.currentPhase === phase.id).length,
        color: phase.color,
        label: phase.name,
      })),
    [projects]
  );

  const upcomingMilestones = useMemo(
    () =>
      projects
        .map((p) => {
          const phase = PHASE_MAP[p.currentPhase];
          const progress = computePhaseProgress(p.phases[p.currentPhase], p.currentPhase);
          return { project: p, phase, progress, gate: phase?.gate };
        })
        .sort((a, b) => b.progress - a.progress)
        .slice(0, 5),
    [projects]
  );

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="项目总数" value={stats.total} sub="ACTIVE" accent="bg-stone-100" icon={<Hash size={16} />} />
        <StatCard label="进行中" value={stats.active} sub="IN PROGRESS" accent="bg-amber-50" icon={<Activity size={16} />} />
        <StatCard label="高风险" value={stats.atRisk} sub="AT RISK" accent="bg-rose-50" icon={<AlertTriangle size={16} />} />
        <StatCard label="平均进度" value={`${stats.avgProgress}%`} sub="OVERALL" accent="bg-emerald-50" icon={<TrendingUp size={16} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Phase Distribution Chart */}
        <div className="lg:col-span-2 bg-white border border-stone-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-serif text-xl text-stone-900">阶段分布</h3>
              <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">PHASE DISTRIBUTION</p>
            </div>
            <Layers size={20} className="text-stone-300" />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={phaseDistribution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fill: '#78716c' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fill: '#78716c' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e7e5e4',
                  borderRadius: '2px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11,
                }}
                formatter={(value, _, props) => [
                  `${value} 个项目`,
                  phaseDistribution.find((p) => p.name === props.payload?.name)?.fullName || '',
                ]}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {phaseDistribution.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Upcoming Gates */}
        <div className="bg-white border border-stone-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-serif text-xl text-stone-900">即将到来的 Gate</h3>
              <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">UPCOMING GATES</p>
            </div>
            <Target size={20} className="text-stone-300" />
          </div>
          <div className="space-y-4">
            {upcomingMilestones.map(({ project, phase, progress, gate }) => (
              <div
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className="cursor-pointer group"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-stone-900 group-hover:text-amber-700 transition-colors truncate max-w-[160px]">
                    {project.name}
                  </span>
                  <span className="text-[10px] font-mono text-stone-400 ml-2">{progress}%</span>
                </div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-1.5 truncate">
                  {gate}
                </div>
                <ProgressBar value={progress} color="bg-amber-500" height="h-1" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Project Table */}
      <div className="bg-white border border-stone-200">
        <div className="flex items-center justify-between p-6 border-b border-stone-200">
          <div>
            <h3 className="font-serif text-xl text-stone-900">项目总览</h3>
            <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">PROJECT OVERVIEW</p>
          </div>
          <Hash size={20} className="text-stone-300" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50">
                {['编号', '项目名称', '类型', 'PM', '当前阶段', '整体进度', '风险', '目标日期'].map((h) => (
                  <th key={h} className="text-left text-[10px] font-mono uppercase tracking-wider text-stone-400 p-4 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const phase = PHASE_MAP[project.currentPhase];
                const progress = computeOverallProgress(project);
                const risk = RISK_CONFIG[project.risk];
                return (
                  <tr
                    key={project.id}
                    onClick={() => onSelectProject(project.id)}
                    className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer transition-colors group"
                  >
                    <td className="p-4">
                      <span className="text-xs font-mono text-stone-500">{project.code}</span>
                    </td>
                    <td className="p-4">
                      <span className="text-sm font-medium text-stone-900 group-hover:text-amber-700 transition-colors">
                        {project.name}
                      </span>
                    </td>
                    <td className="p-4 hidden md:table-cell">
                      <span className="text-xs text-stone-600">{project.type}</span>
                    </td>
                    <td className="p-4 hidden lg:table-cell">
                      <span className="text-xs text-stone-600">{project.pm}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: phase?.color }}
                        />
                        <span className="text-xs font-mono text-stone-700">{phase?.code}</span>
                        <span className="text-xs text-stone-500 hidden sm:inline">{phase?.name}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-[60px]">
                          <ProgressBar value={progress} color="bg-stone-900" height="h-1" />
                        </div>
                        <span className="text-xs font-mono text-stone-700 w-9">{progress}%</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 ${risk.bg} ${risk.border} border`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
                        <span className={`text-xs font-medium ${risk.color}`}>{risk.label}</span>
                      </div>
                    </td>
                    <td className="p-4 hidden md:table-cell">
                      <span className="text-xs font-mono text-stone-500">{project.targetDate}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
