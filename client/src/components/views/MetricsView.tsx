import { useMemo, useState } from 'react';
import type React from 'react';
import {
  Activity,
  AlertTriangle,
  Bug,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Gauge,
  Timer,
  TrendingDown,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { trpc } from '@/lib/trpc';
import { getProjectPhases, type Project } from '@/lib/data';

type WindowMode = 'project' | 'last4w' | 'custom';

const CATEGORY_LABELS: Record<string, string> = {
  hardware: '硬件',
  software: '软件',
  mechanical: '结构',
  thermal: '热设计',
  reliability: '可靠性',
  safety: '安全',
  performance: '性能',
  other: '其他',
};

export function MetricsView({ project }: { project: Project }) {
  const todayISO = useMemo(() => shanghaiTodayISO(), []);
  const [mode, setMode] = useState<WindowMode>('project');
  const [customFrom, setCustomFrom] = useState(addDays(todayISO, -27));
  const [customTo, setCustomTo] = useState(todayISO);

  const queryInput = useMemo(() => {
    if (mode === 'last4w') {
      return { projectId: project.id, fromISO: addDays(todayISO, -27), toISO: todayISO };
    }
    if (mode === 'custom') {
      return { projectId: project.id, fromISO: customFrom || undefined, toISO: customTo || undefined };
    }
    return { projectId: project.id };
  }, [customFrom, customTo, mode, project.id, todayISO]);

  const queryEnabled = mode !== 'custom' || (!!customFrom && !!customTo);
  const { data: metrics, isLoading, error } = trpc.analytics.projectMetrics.useQuery(queryInput, {
    enabled: queryEnabled,
  });

  const phaseNameById = useMemo(() => {
    return new Map(getProjectPhases(project).map((phase) => [phase.id, phase.name]));
  }, [project]);

  const throughputData = metrics?.efficiency.throughputByWeek.map((row) => ({
    week: row.weekKey.replace(`${row.weekKey.slice(0, 4)}-`, ''),
    count: row.count,
  })) ?? [];
  const qualityTrendData = metrics?.quality.openClose.map((row) => ({
    week: row.weekKey.replace(`${row.weekKey.slice(0, 4)}-`, ''),
    opened: row.opened,
    closed: row.closed,
    cumulativeOpen: row.cumulativeOpen,
  })) ?? [];
  const severityData = metrics?.quality.bySeverity.map((row) => ({
    severity: row.severity,
    count: row.count,
  })) ?? [];
  const categoryData = metrics?.quality.byCategory.map((row) => ({
    category: CATEGORY_LABELS[row.category] ?? row.category,
    count: row.count,
  })) ?? [];
  const taskBurndownData = metrics?.burndown.task.map((row) => ({
    date: shortDate(row.dateISO),
    remaining: row.remaining,
    ideal: row.ideal,
  })) ?? [];
  const defectBurndownData = metrics?.burndown.defect.map((row) => ({
    date: shortDate(row.dateISO),
    remaining: row.remaining,
  })) ?? [];
  const phaseDurationData = metrics?.process.phaseDurations.map((row) => ({
    phase: phaseNameById.get(row.phaseId) ?? row.phaseId,
    plannedDays: row.plannedDays,
    actualDays: row.actualDays,
  })) ?? [];

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <MetricsHeader mode={mode} onModeChange={setMode} customFrom={customFrom} customTo={customTo} onCustomFrom={setCustomFrom} onCustomTo={setCustomTo} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="border border-border bg-card rounded-[11px] h-80 animate-pulse bg-secondary" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-4">
        <MetricsHeader mode={mode} onModeChange={setMode} customFrom={customFrom} customTo={customTo} onCustomFrom={setCustomFrom} onCustomTo={setCustomTo} />
        <div className="border border-border bg-card rounded-[11px] p-8 text-center">
          <AlertTriangle size={24} className="mx-auto text-destructive mb-3" />
          <div className="text-sm text-foreground">度量数据加载失败</div>
          <div className="text-xs text-muted-foreground mt-1">{error.message}</div>
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="p-6 space-y-4">
      <MetricsHeader mode={mode} onModeChange={setMode} customFrom={customFrom} customTo={customTo} onCustomFrom={setCustomFrom} onCustomTo={setCustomTo} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricTile icon={<Timer size={15} />} label="Lead Time 中位" value={formatDays(metrics.efficiency.leadTimeDaysMedian)} />
        <MetricTile icon={<Clock3 size={15} />} label="Lead Time P85" value={formatDays(metrics.efficiency.leadTimeDaysP85)} />
        <MetricTile icon={<Activity size={15} />} label="完成任务" value={`${metrics.efficiency.completedCount}/${metrics.efficiency.plannedCount}`} />
        <MetricTile icon={<AlertTriangle size={15} />} label="逾期率" value={formatPct(metrics.efficiency.overdueRatePct)} accent={metrics.efficiency.overdueRatePct ? 'text-destructive' : undefined} />
        <MetricTile icon={<Bug size={15} />} label="缺陷 DI" value={formatNumber(metrics.quality.diValue)} accent={metrics.quality.diValue > 0 ? 'text-destructive' : undefined} />
        <MetricTile icon={<CheckCircle2 size={15} />} label="Gate 一次通过" value={formatPct(metrics.process.gateFirstPassRatePct)} accent="text-[color:var(--success)]" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <MetricPanel title="任务效能" kicker="EFFICIENCY" icon={<Gauge size={16} />}>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <InlineStat label="完成" value={metrics.efficiency.completedCount} />
            <InlineStat label="计划" value={metrics.efficiency.plannedCount} />
            <InlineStat label="逾期" value={formatPct(metrics.efficiency.overdueRatePct)} tone={metrics.efficiency.overdueRatePct ? 'rose' : 'stone'} />
          </div>
          <ChartFrame empty={!hasAnyValue(throughputData, ['count'])}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={throughputData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="week" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="count" name="完成任务" fill="var(--primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </MetricPanel>

        <MetricPanel title="质量趋势" kicker="QUALITY" icon={<Bug size={16} />}>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <InlineStat label="DI" value={formatNumber(metrics.quality.diValue)} tone={metrics.quality.diValue > 0 ? 'rose' : 'stone'} />
            <InlineStat label="未关闭" value={metrics.quality.bySeverity.reduce((sum, row) => sum + row.count, 0)} />
            <InlineStat label="分类数" value={metrics.quality.byCategory.length} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
            <ChartFrame empty={!hasAnyValue(qualityTrendData, ['opened', 'closed', 'cumulativeOpen'])}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={qualityTrendData} margin={{ top: 8, right: 12, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="week" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip {...tooltipProps} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="opened" name="新增" stroke="var(--destructive)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="closed" name="关闭" stroke="var(--success)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="cumulativeOpen" name="累计未关" stroke="var(--muted-foreground)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartFrame>
            <div className="grid grid-cols-1 gap-3">
              <MiniBar title="严重度" data={severityData} dataKey="severity" />
              <MiniBar title="分类" data={categoryData} dataKey="category" />
            </div>
          </div>
        </MetricPanel>

        <MetricPanel title="进度燃尽" kicker="BURNDOWN" icon={<TrendingDown size={16} />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartBlock title="任务燃尽">
              <ChartFrame empty={!hasAnyValue(taskBurndownData, ['remaining', 'ideal'])}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={taskBurndownData} margin={{ top: 8, right: 12, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} minTickGap={16} />
                    <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip {...tooltipProps} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="remaining" name="实际剩余" stroke="var(--primary)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="ideal" name="理想线" stroke="var(--warning)" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </ChartFrame>
            </ChartBlock>
            <ChartBlock title="缺陷燃尽">
              <ChartFrame empty={!hasAnyValue(defectBurndownData, ['remaining'])}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={defectBurndownData} margin={{ top: 8, right: 12, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} minTickGap={16} />
                    <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip {...tooltipProps} />
                    <Line type="monotone" dataKey="remaining" name="未关闭缺陷" stroke="var(--destructive)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartFrame>
            </ChartBlock>
          </div>
        </MetricPanel>

        <MetricPanel title="流程 / Gate" kicker="PROCESS" icon={<CalendarDays size={16} />}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <InlineStat label="一次通过率" value={formatPct(metrics.process.gateFirstPassRatePct)} tone="emerald" />
            <InlineStat label="阶段数" value={metrics.process.phaseDurations.length} />
          </div>
          <ChartFrame empty={!hasAnyValue(phaseDurationData, ['plannedDays', 'actualDays'])}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={phaseDurationData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="phase" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...tooltipProps} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="plannedDays" name="计划天数" fill="var(--muted-foreground)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="actualDays" name="实际天数" fill="var(--primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </MetricPanel>
      </div>
    </div>
  );
}

function MetricsHeader({
  mode,
  onModeChange,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
}: {
  mode: WindowMode;
  onModeChange: (mode: WindowMode) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (value: string) => void;
  onCustomTo: (value: string) => void;
}) {
  return (
    <div className="border border-border bg-card rounded-[11px] px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <Gauge size={17} className="text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <h2 className="text-lg text-foreground leading-tight">项目度量</h2>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">PROJECT METRICS</p>
        </div>
      </div>
      <div className="lg:ml-auto flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex border border-border rounded-md w-fit">
          <WindowButton active={mode === 'project'} icon={<CalendarDays size={13} />} label="项目至今" onClick={() => onModeChange('project')} />
          <WindowButton active={mode === 'last4w'} icon={<Activity size={13} />} label="近 4 周" onClick={() => onModeChange('last4w')} />
          <WindowButton active={mode === 'custom'} icon={<Clock3 size={13} />} label="自定义" onClick={() => onModeChange('custom')} />
        </div>
        {mode === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(event) => onCustomFrom(event.target.value)}
              className="num rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground w-36"
            />
            <span className="text-muted-foreground">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(event) => onCustomTo(event.target.value)}
              className="num rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground w-36"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function WindowButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MetricTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent?: string }) {
  return (
    <div className="border border-border bg-card rounded-[11px] px-4 py-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-wider truncate">{label}</span>
      </div>
      <div className={`num mt-1.5 text-2xl font-semibold ${accent ?? 'text-foreground'}`}>{value}</div>
    </div>
  );
}

function MetricPanel({ title, kicker, icon, children }: { title: string; kicker: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-card rounded-[11px] p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-md border border-border bg-secondary flex items-center justify-center text-muted-foreground shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="text-base text-foreground leading-tight">{title}</h3>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{kicker}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function InlineStat({ label, value, tone = 'stone' }: { label: string; value: string | number; tone?: 'stone' | 'rose' | 'emerald' }) {
  const toneClass = tone === 'rose' ? 'text-destructive' : tone === 'emerald' ? 'text-[color:var(--success)]' : 'text-foreground';
  return (
    <div className="rounded-md border border-border bg-secondary px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className={`num mt-0.5 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function ChartBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}

function ChartFrame({ empty, children }: { empty: boolean; children: React.ReactNode }) {
  return (
    <div className="h-[240px] min-h-[240px]">
      {empty ? (
        <div className="h-full rounded-md border border-dashed border-border bg-secondary flex items-center justify-center text-xs text-muted-foreground">
          暂无足够数据
        </div>
      ) : children}
    </div>
  );
}

function MiniBar({ title, data, dataKey }: { title: string; data: Array<Record<string, string | number>>; dataKey: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
      <ChartFrame empty={!hasAnyValue(data, ['count'])}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey={dataKey} tick={axisTick} axisLine={false} tickLine={false} width={48} />
            <Tooltip {...tooltipProps} />
            <Bar dataKey="count" name="数量" fill="var(--primary)" radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}

const axisTick = {
  fontSize: 11,
  fill: 'var(--muted-foreground)',
};

const tooltipProps = {
  contentStyle: {
    backgroundColor: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 7,
    fontSize: 11,
  },
};

function hasAnyValue<T extends Record<string, unknown>>(rows: T[], keys: string[]) {
  return rows.some((row) => keys.some((key) => {
    const value = row[key];
    return typeof value === 'number' && value > 0;
  }));
}

function formatDays(value: number | null) {
  return value === null ? '—' : `${value} 天`;
}

function formatPct(value: number | null) {
  return value === null ? '—' : `${value}%`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function shortDate(value: string) {
  return value.slice(5);
}

function shanghaiTodayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(dateISO: string, days: number) {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
