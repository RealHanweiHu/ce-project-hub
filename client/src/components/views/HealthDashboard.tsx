/**
 * HealthDashboard — Management-level Project Health Center
 *
 * Features:
 * - Project health score (composite metric)
 * - Overdue projects / tasks summary
 * - P0/P1 open issues count
 * - Gate review blockages
 * - Resource load (tasks per person)
 * - Phase pass rate (gate approval %)
 * - Risk heatmap
 * - Next week key items
 * - Trend charts (progress over time)
 */

import { useMemo } from 'react';
import {
  Activity, AlertTriangle, Clock, CheckCircle2, Users,
  TrendingUp, TrendingDown, Minus, BarChart3, Target,
  Shield, Flame, Calendar, ArrowUpRight,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProjectSummary {
  id: string;
  name: string;
  currentPhase: string;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  openP0Issues: number;
  openP1Issues: number;
  totalIssues: number;
  closedIssues: number;
  gatesPassed: number;
  gatesTotal: number;
  daysRemaining?: number;
  isOverdue: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  members: Array<{ id: number; name: string; taskCount: number }>;
}

interface HealthDashboardProps {
  projects: ProjectSummary[];
  /** Current user's name for greeting */
  userName?: string;
}

// ── Health Score Calculation ──────────────────────────────────────────────────

function calculateHealthScore(project: ProjectSummary): number {
  let score = 100;

  // Deduct for overdue tasks (5 points each, max 30)
  score -= Math.min(project.overdueTasks * 5, 30);

  // Deduct for blocked tasks (8 points each, max 24)
  score -= Math.min(project.blockedTasks * 8, 24);

  // Deduct for P0 issues (15 points each, max 30)
  score -= Math.min(project.openP0Issues * 15, 30);

  // Deduct for P1 issues (5 points each, max 15)
  score -= Math.min(project.openP1Issues * 5, 15);

  // Bonus for completion rate
  const completionRate = project.totalTasks > 0 ? project.completedTasks / project.totalTasks : 0;
  score += completionRate * 10;

  // Deduct if project is overdue
  if (project.isOverdue) score -= 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getHealthColor(score: number): { text: string; bg: string; border: string } {
  if (score >= 80) return { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' };
  if (score >= 60) return { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' };
  if (score >= 40) return { text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' };
  return { text: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200' };
}

function getHealthLabel(score: number): string {
  if (score >= 80) return '健康';
  if (score >= 60) return '关注';
  if (score >= 40) return '风险';
  return '告警';
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <TrendingUp size={12} className="text-emerald-500" />;
  if (trend === 'down') return <TrendingDown size={12} className="text-rose-500" />;
  return <Minus size={12} className="text-stone-400" />;
}

// ── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({
  icon,
  label,
  value,
  subtext,
  color = 'text-stone-900',
  bgColor = 'bg-white',
  borderColor = 'border-stone-200',
  alert = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  alert?: boolean;
}) {
  return (
    <div className={`${bgColor} border ${borderColor} p-4 ${alert ? 'ring-1 ring-rose-300' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{label}</span>
      </div>
      <div className={`text-2xl font-serif font-bold ${color}`}>{value}</div>
      {subtext && <div className="text-[10px] font-mono text-stone-400 mt-1">{subtext}</div>}
    </div>
  );
}

// ── Project Health Row ───────────────────────────────────────────────────────

function ProjectHealthRow({ project }: { project: ProjectSummary }) {
  const score = calculateHealthScore(project);
  const hc = getHealthColor(score);
  const completionPct = project.totalTasks > 0 ? Math.round((project.completedTasks / project.totalTasks) * 100) : 0;
  const issueClosureRate = project.totalIssues > 0 ? Math.round((project.closedIssues / project.totalIssues) * 100) : 100;

  return (
    <div className="bg-white border border-stone-200 p-4 hover:border-stone-400 transition-all">
      <div className="flex items-center gap-4">
        {/* Health Score */}
        <div className={`w-12 h-12 flex items-center justify-center border-2 ${hc.border} ${hc.bg} shrink-0`}>
          <span className={`text-sm font-mono font-bold ${hc.text}`}>{score}</span>
        </div>

        {/* Project Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-stone-900 truncate">{project.name}</span>
            <span className={`text-[9px] font-mono px-1.5 py-0.5 border ${hc.bg} ${hc.border} ${hc.text}`}>
              {getHealthLabel(score)}
            </span>
            {project.isOverdue && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 bg-rose-50 border border-rose-200 text-rose-600">
                逾期
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-[10px] font-mono text-stone-400">
            <span>阶段: {project.currentPhase}</span>
            <span>进度: {completionPct}%</span>
            <span>问题关闭率: {issueClosureRate}%</span>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="flex items-center gap-3 shrink-0">
          {project.openP0Issues > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-rose-50 border border-rose-200">
              <Flame size={10} className="text-rose-600" />
              <span className="text-[10px] font-mono font-bold text-rose-700">P0×{project.openP0Issues}</span>
            </div>
          )}
          {project.overdueTasks > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200">
              <Clock size={10} className="text-amber-600" />
              <span className="text-[10px] font-mono font-bold text-amber-700">{project.overdueTasks}逾期</span>
            </div>
          )}
          {project.blockedTasks > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-orange-50 border border-orange-200">
              <AlertTriangle size={10} className="text-orange-600" />
              <span className="text-[10px] font-mono font-bold text-orange-700">{project.blockedTasks}阻塞</span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="w-24 shrink-0">
          <div className="h-2 bg-stone-100 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <div className="text-[9px] font-mono text-stone-400 text-right mt-0.5">
            {project.completedTasks}/{project.totalTasks}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Resource Load Chart ──────────────────────────────────────────────────────

function ResourceLoadChart({ projects }: { projects: ProjectSummary[] }) {
  // Aggregate tasks per person across all projects
  const loadMap = new Map<string, { name: string; taskCount: number; overdueCount: number }>();

  projects.forEach((p) => {
    p.members.forEach((m) => {
      const existing = loadMap.get(m.name) || { name: m.name, taskCount: 0, overdueCount: 0 };
      existing.taskCount += m.taskCount;
      loadMap.set(m.name, existing);
    });
  });

  const sorted = Array.from(loadMap.values()).sort((a, b) => b.taskCount - a.taskCount).slice(0, 10);
  const maxTasks = Math.max(...sorted.map((s) => s.taskCount), 1);

  if (sorted.length === 0) return null;

  return (
    <div className="bg-white border border-stone-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users size={14} className="text-stone-500" />
        <span className="text-xs font-mono uppercase tracking-wider text-stone-500 font-bold">资源负载 TOP 10</span>
      </div>
      <div className="space-y-2">
        {sorted.map((person) => (
          <div key={person.name} className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-stone-600 w-16 truncate shrink-0">{person.name}</span>
            <div className="flex-1 h-4 bg-stone-100 relative overflow-hidden">
              <div
                className={`h-full transition-all ${
                  person.taskCount > 8 ? 'bg-rose-400' : person.taskCount > 5 ? 'bg-amber-400' : 'bg-blue-400'
                }`}
                style={{ width: `${(person.taskCount / maxTasks) * 100}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-stone-500 w-6 text-right shrink-0">{person.taskCount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Risk Heatmap ─────────────────────────────────────────────────────────────

function RiskHeatmap({ projects }: { projects: ProjectSummary[] }) {
  const riskColors: Record<string, string> = {
    low: 'bg-emerald-200',
    medium: 'bg-amber-300',
    high: 'bg-orange-400',
    critical: 'bg-rose-500',
  };

  return (
    <div className="bg-white border border-stone-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield size={14} className="text-stone-500" />
        <span className="text-xs font-mono uppercase tracking-wider text-stone-500 font-bold">风险热力图</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {projects.slice(0, 12).map((p) => {
          const score = calculateHealthScore(p);
          const risk = score >= 80 ? 'low' : score >= 60 ? 'medium' : score >= 40 ? 'high' : 'critical';
          return (
            <div
              key={p.id}
              className={`${riskColors[risk]} p-2 flex flex-col items-center justify-center min-h-[48px]`}
              title={`${p.name}: 健康度 ${score}`}
            >
              <span className="text-[9px] font-mono text-white font-bold truncate max-w-full text-center">
                {p.name.slice(0, 6)}
              </span>
              <span className="text-[8px] font-mono text-white/80">{score}</span>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 text-[9px] font-mono text-stone-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-200" /> 健康</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-300" /> 关注</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-400" /> 风险</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-rose-500" /> 告警</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function HealthDashboard({ projects, userName }: HealthDashboardProps) {
  // ── Aggregate Metrics ──────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const totalProjects = projects.length;
    const overdueProjects = projects.filter((p) => p.isOverdue).length;
    const totalTasks = projects.reduce((sum, p) => sum + p.totalTasks, 0);
    const completedTasks = projects.reduce((sum, p) => sum + p.completedTasks, 0);
    const overdueTasks = projects.reduce((sum, p) => sum + p.overdueTasks, 0);
    const blockedTasks = projects.reduce((sum, p) => sum + p.blockedTasks, 0);
    const openP0 = projects.reduce((sum, p) => sum + p.openP0Issues, 0);
    const openP1 = projects.reduce((sum, p) => sum + p.openP1Issues, 0);
    const totalIssues = projects.reduce((sum, p) => sum + p.totalIssues, 0);
    const closedIssues = projects.reduce((sum, p) => sum + p.closedIssues, 0);
    const gatesPassed = projects.reduce((sum, p) => sum + p.gatesPassed, 0);
    const gatesTotal = projects.reduce((sum, p) => sum + p.gatesTotal, 0);

    const avgHealth = projects.length > 0
      ? Math.round(projects.reduce((sum, p) => sum + calculateHealthScore(p), 0) / projects.length)
      : 100;

    return {
      totalProjects, overdueProjects,
      totalTasks, completedTasks, overdueTasks, blockedTasks,
      openP0, openP1, totalIssues, closedIssues,
      gatesPassed, gatesTotal, avgHealth,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      issueClosureRate: totalIssues > 0 ? Math.round((closedIssues / totalIssues) * 100) : 100,
      gatePassRate: gatesTotal > 0 ? Math.round((gatesPassed / gatesTotal) * 100) : 0,
    };
  }, [projects]);

  const avgHealthColor = getHealthColor(metrics.avgHealth);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl text-stone-900">项目健康度中心</h2>
          <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">
            MANAGEMENT DASHBOARD · {new Date().toLocaleDateString('zh-CN')}
          </p>
        </div>
        <div className={`px-4 py-2 border-2 ${avgHealthColor.border} ${avgHealthColor.bg} flex items-center gap-2`}>
          <Activity size={16} className={avgHealthColor.text} />
          <span className={`text-lg font-mono font-bold ${avgHealthColor.text}`}>{metrics.avgHealth}</span>
          <span className={`text-[10px] font-mono ${avgHealthColor.text}`}>综合健康度</span>
        </div>
      </div>

      {/* Top Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard
          icon={<BarChart3 size={14} className="text-blue-500" />}
          label="项目总数"
          value={metrics.totalProjects}
          subtext={`${metrics.overdueProjects} 逾期`}
          alert={metrics.overdueProjects > 0}
        />
        <MetricCard
          icon={<Target size={14} className="text-emerald-500" />}
          label="任务完成率"
          value={`${metrics.completionRate}%`}
          subtext={`${metrics.completedTasks}/${metrics.totalTasks}`}
        />
        <MetricCard
          icon={<Clock size={14} className="text-amber-500" />}
          label="逾期任务"
          value={metrics.overdueTasks}
          subtext={`阻塞 ${metrics.blockedTasks}`}
          color={metrics.overdueTasks > 0 ? 'text-amber-700' : 'text-stone-900'}
          bgColor={metrics.overdueTasks > 0 ? 'bg-amber-50' : 'bg-white'}
          borderColor={metrics.overdueTasks > 0 ? 'border-amber-200' : 'border-stone-200'}
          alert={metrics.overdueTasks > 5}
        />
        <MetricCard
          icon={<Flame size={14} className="text-rose-500" />}
          label="P0/P1 问题"
          value={metrics.openP0 + metrics.openP1}
          subtext={`P0:${metrics.openP0} P1:${metrics.openP1}`}
          color={metrics.openP0 > 0 ? 'text-rose-700' : 'text-stone-900'}
          bgColor={metrics.openP0 > 0 ? 'bg-rose-50' : 'bg-white'}
          borderColor={metrics.openP0 > 0 ? 'border-rose-200' : 'border-stone-200'}
          alert={metrics.openP0 > 0}
        />
        <MetricCard
          icon={<CheckCircle2 size={14} className="text-emerald-500" />}
          label="问题关闭率"
          value={`${metrics.issueClosureRate}%`}
          subtext={`${metrics.closedIssues}/${metrics.totalIssues}`}
        />
        <MetricCard
          icon={<Shield size={14} className="text-indigo-500" />}
          label="Gate 通过率"
          value={`${metrics.gatePassRate}%`}
          subtext={`${metrics.gatesPassed}/${metrics.gatesTotal}`}
        />
      </div>

      {/* Projects Health List */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} className="text-stone-500" />
          <span className="text-xs font-mono uppercase tracking-wider text-stone-500 font-bold">各项目健康度</span>
        </div>
        <div className="space-y-2">
          {projects
            .sort((a, b) => calculateHealthScore(a) - calculateHealthScore(b))
            .map((p) => (
              <ProjectHealthRow key={p.id} project={p} />
            ))}
        </div>
      </div>

      {/* Bottom Row: Resource Load + Risk Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ResourceLoadChart projects={projects} />
        <RiskHeatmap projects={projects} />
      </div>
    </div>
  );
}

export default HealthDashboard;
