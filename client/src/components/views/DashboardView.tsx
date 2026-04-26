// Design: Industrial Precision - stone/amber color system
// DashboardView: overview stats, phase distribution chart, upcoming gates, P0/P1 issue alerts, project table

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Layers, Hash, Target, TrendingUp, AlertTriangle, Activity, Bug, ChevronRight, ShieldAlert,
} from 'lucide-react';
import {
  Project, PHASE_MAP, RISK_CONFIG, Issue,
  computePhaseProgress, computeOverallProgress, getProjectPhases,
  SEVERITY_CONFIG, STATUS_CONFIG, CATEGORY_LABELS,
} from '@/lib/data';
import { CATEGORY_MAP } from '@/lib/sop-templates';
import { StatCard } from '@/components/shared/StatCard';
import { ProgressBar } from '@/components/shared/ProgressBar';

interface DashboardViewProps {
  projects: Project[];
  onSelectProject: (id: string) => void;
}

interface CriticalIssueRow {
  issue: Issue;
  project: Project;
  phaseId: string;
  phaseName: string;
}

export function DashboardView({ projects, onSelectProject }: DashboardViewProps) {
  const [showAllCritical, setShowAllCritical] = useState(false);

  const stats = useMemo(() => {
    const total = projects.length;
    const active = projects.filter((p) => p.currentPhase !== 'mp').length;
    const atRisk = projects.filter((p) => p.risk === 'high').length;
    const avgProgress = total > 0
      ? Math.round(projects.reduce((sum, p) => sum + computeOverallProgress(p), 0) / total)
      : 0;
    return { total, active, atRisk, avgProgress };
  }, [projects]);

  // ── P0/P1 Critical Issues ─────────────────────────────────────────────────
  const criticalIssues = useMemo<CriticalIssueRow[]>(() => {
    const rows: CriticalIssueRow[] = [];
    projects.forEach((project) => {
      const phases = getProjectPhases(project);
      Object.entries(project.phases).forEach(([phaseId, phaseData]) => {
        const phase = phases.find((p) => p.id === phaseId);
        const phaseName = phase?.name || phaseId;
        (phaseData.issues || []).forEach((issue) => {
          if (
            (issue.severity === 'P0' || issue.severity === 'P1') &&
            issue.status !== 'closed' &&
            issue.status !== 'resolved' &&
            issue.status !== 'wont_fix'
          ) {
            rows.push({ issue, project, phaseId, phaseName });
          }
        });
      });
    });
    // Sort: P0 first, then by foundDate desc
    return rows.sort((a, b) => {
      if (a.issue.severity !== b.issue.severity) {
        return a.issue.severity === 'P0' ? -1 : 1;
      }
      return b.issue.foundDate.localeCompare(a.issue.foundDate);
    });
  }, [projects]);

  const criticalP0 = criticalIssues.filter((r) => r.issue.severity === 'P0').length;
  const criticalP1 = criticalIssues.filter((r) => r.issue.severity === 'P1').length;
  const displayedCritical = showAllCritical ? criticalIssues : criticalIssues.slice(0, 5);

  const phaseDistribution = useMemo(() => {
    const phaseMap = new Map<string, { name: string; code: string; color: string; count: number }>();
    projects.forEach((p) => {
      const phases = getProjectPhases(p);
      phases.forEach((ph) => {
        if (!phaseMap.has(ph.id)) {
          phaseMap.set(ph.id, { name: ph.name, code: ph.code, color: ph.color, count: 0 });
        }
      });
      const cur = phaseMap.get(p.currentPhase);
      if (cur) cur.count++;
    });
    const order = ['concept', 'planning', 'design', 'evt', 'dvt', 'pvt', 'mp'];
    return Array.from(phaseMap.entries())
      .sort(([a], [b]) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
      .map(([, v]) => ({ name: v.code, fullName: v.name, count: v.count, color: v.color, label: v.name }));
  }, [projects]);

  const upcomingMilestones = useMemo(
    () =>
      projects
        .map((p) => {
          const phases = getProjectPhases(p);
          const phase = phases.find((ph) => ph.id === p.currentPhase) || PHASE_MAP[p.currentPhase];
          const progress = computePhaseProgress(p.phases[p.currentPhase], p.currentPhase, phase);
          const catConfig = p.category ? CATEGORY_MAP[p.category] : null;
          return { project: p, phase, progress, gate: phase?.gate, catConfig };
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

      {/* ── P0/P1 Critical Issue Alert ────────────────────────────────────── */}
      {criticalIssues.length > 0 && (
        <div className="bg-white border-2 border-rose-300">
          {/* Alert Header */}
          <div className="flex items-center justify-between p-5 border-b border-rose-100 bg-rose-50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-rose-600 flex items-center justify-center shrink-0">
                <ShieldAlert size={16} className="text-white" />
              </div>
              <div>
                <h3 className="font-serif text-lg text-rose-900">高优先级未关闭问题</h3>
                <p className="text-[10px] font-mono uppercase tracking-widest text-rose-500 mt-0.5">CRITICAL OPEN ISSUES · REQUIRES ATTENTION</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {criticalP0 > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 border border-red-700">
                  <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  <span className="text-xs font-mono font-bold text-white">P0 × {criticalP0}</span>
                </div>
              )}
              {criticalP1 > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 border border-orange-300">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  <span className="text-xs font-mono font-bold text-orange-700">P1 × {criticalP1}</span>
                </div>
              )}
            </div>
          </div>

          {/* Issue Rows */}
          <div className="divide-y divide-rose-50">
            {displayedCritical.map(({ issue, project, phaseName }) => {
              const sev = SEVERITY_CONFIG[issue.severity];
              const sta = STATUS_CONFIG[issue.status];
              const catConfig = project.category ? CATEGORY_MAP[project.category] : null;
              return (
                <div
                  key={`${project.id}-${issue.id}`}
                  onClick={() => onSelectProject(project.id)}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-rose-50/40 cursor-pointer group transition-colors"
                >
                  {/* Severity */}
                  <div className={`shrink-0 w-8 h-6 flex items-center justify-center text-[10px] font-mono font-bold border ${sev.bg} ${sev.border} ${sev.color}`}>
                    {issue.severity}
                  </div>

                  {/* Issue Title + Meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-stone-900 group-hover:text-rose-700 transition-colors truncate">
                        {issue.title}
                      </span>
                      <span className="text-[10px] font-mono text-stone-400 bg-stone-50 px-1.5 py-0.5 border border-stone-200 shrink-0">
                        {CATEGORY_LABELS[issue.category]}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] font-mono text-stone-400 flex-wrap">
                      <span className="font-medium text-stone-600">{project.name}</span>
                      {catConfig && (
                        <span className={`px-1 py-0.5 ${catConfig.color} ${catConfig.textColor} border ${catConfig.borderColor}`}>
                          {catConfig.badge}
                        </span>
                      )}
                      <span>· {phaseName}</span>
                      {issue.owner && <span>· 负责人: {issue.owner}</span>}
                      {issue.targetDate && <span>· 目标: {issue.targetDate}</span>}
                    </div>
                  </div>

                  {/* Status */}
                  <div className={`shrink-0 flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono border ${sta.bg} ${sta.border} ${sta.color}`}>
                    {issue.status === 'open' && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />}
                    {issue.status === 'in_progress' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                    {sta.label}
                  </div>

                  <ChevronRight size={14} className="text-stone-300 group-hover:text-rose-400 transition-colors shrink-0" />
                </div>
              );
            })}
          </div>

          {/* Show More */}
          {criticalIssues.length > 5 && (
            <div className="p-4 border-t border-rose-100 bg-rose-50/30 text-center">
              <button
                onClick={() => setShowAllCritical((v) => !v)}
                className="text-xs font-mono uppercase tracking-wider text-rose-600 hover:text-rose-800 transition-colors"
              >
                {showAllCritical ? '收起' : `查看全部 ${criticalIssues.length} 个高优先级问题`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* No critical issues — show a clean green status */}
      {criticalIssues.length === 0 && projects.some((p) =>
        Object.values(p.phases).some((ph) => (ph.issues || []).length > 0)
      ) && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200">
          <div className="w-6 h-6 bg-emerald-500 flex items-center justify-center shrink-0">
            <Bug size={12} className="text-white" />
          </div>
          <div>
            <span className="text-sm font-medium text-emerald-800">无高优先级未关闭问题</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-500 ml-3">ALL P0/P1 ISSUES RESOLVED</span>
          </div>
        </div>
      )}

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
            {upcomingMilestones.map(({ project, phase, progress, gate, catConfig }) => (
              <div
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className="cursor-pointer group"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium text-stone-900 group-hover:text-amber-700 transition-colors truncate max-w-[140px]">
                      {project.name}
                    </span>
                    {catConfig && (
                      <span className={`text-[9px] font-mono shrink-0 px-1 py-0.5 ${catConfig.color} ${catConfig.textColor} border ${catConfig.borderColor}`}>
                        {catConfig.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-stone-400 ml-2 shrink-0">{progress}%</span>
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
                {['编号', '项目名称', '类型', 'PM', '当前阶段', '整体进度', '风险', '问题', '目标日期'].map((h) => (
                  <th key={h} className="text-left text-[10px] font-mono uppercase tracking-wider text-stone-400 p-4 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const projectPhases = getProjectPhases(project);
                const phase = projectPhases.find((p) => p.id === project.currentPhase) || PHASE_MAP[project.currentPhase];
                const progress = computeOverallProgress(project);
                const risk = RISK_CONFIG[project.risk];
                const catConfig = project.category ? CATEGORY_MAP[project.category] : null;

                // Count open issues by severity
                let p0Open = 0, p1Open = 0, totalOpen = 0;
                Object.values(project.phases).forEach((pd) => {
                  (pd.issues || []).forEach((issue) => {
                    if (issue.status !== 'closed' && issue.status !== 'resolved' && issue.status !== 'wont_fix') {
                      totalOpen++;
                      if (issue.severity === 'P0') p0Open++;
                      else if (issue.severity === 'P1') p1Open++;
                    }
                  });
                });

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
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-stone-900 group-hover:text-amber-700 transition-colors">
                          {project.name}
                        </span>
                        {catConfig && (
                          <span className={`text-[9px] font-mono shrink-0 px-1 py-0.5 ${catConfig.color} ${catConfig.textColor} border ${catConfig.borderColor}`}>
                            {catConfig.badge}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 hidden md:table-cell">
                      <span className="text-xs text-stone-600">{project.type}</span>
                    </td>
                    <td className="p-4 hidden lg:table-cell">
                      <span className="text-xs text-stone-600">{project.pm}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: phase?.color }} />
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
                    <td className="p-4">
                      {totalOpen > 0 ? (
                        <div className="flex items-center gap-1.5">
                          {p0Open > 0 && (
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-red-600 text-white border border-red-700">
                              P0×{p0Open}
                            </span>
                          )}
                          {p1Open > 0 && (
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-orange-50 text-orange-700 border border-orange-300">
                              P1×{p1Open}
                            </span>
                          )}
                          {totalOpen > p0Open + p1Open && (
                            <span className="text-[10px] font-mono text-stone-400">
                              +{totalOpen - p0Open - p1Open}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] font-mono text-stone-300">—</span>
                      )}
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
