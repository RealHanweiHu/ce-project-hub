// 跨项目组合看板：一屏看全部项目的进度/风险/逾期/阻塞，可排序筛选、点击下钻。
import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { RISK_CONFIG, PHASE_MAP } from '@/lib/data';
import { CATEGORY_MAP } from '@/lib/sop-templates';
import { ProgressBar } from '@/components/shared/ProgressBar';
import { LayoutGrid, AlertTriangle, CalendarClock, Bug, Ban, ChevronRight, Loader2, ArrowUpDown } from 'lucide-react';

type Row = {
  id: string; name: string; projectNumber: string; category: string; risk: string;
  currentPhase: string; startDate: string | null; targetDate: string | null; pmName: string | null;
  taskTotal: number; taskDone: number; overdueTasks: number; blockedTasks: number;
  openIssues: number; projectedEnd: string | null;
};

const progressOf = (r: Row) => (r.taskTotal > 0 ? Math.round((r.taskDone / r.taskTotal) * 100) : 0);
const isOverdue = (r: Row) => !!(r.projectedEnd && r.targetDate && r.projectedEnd > r.targetDate);
const RISK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

type SortKey = 'name' | 'progress' | 'risk' | 'overdueTasks' | 'blockedTasks' | 'openIssues' | 'projectedEnd';

export function PortfolioBoard({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const { data: rows = [], isLoading } = trpc.projects.portfolio.useQuery();
  const [riskFilter, setRiskFilter] = useState<string>('');
  const [catFilter, setCatFilter] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('risk');
  const [sortAsc, setSortAsc] = useState(true);

  const data = rows as Row[];
  const stats = useMemo(() => ({
    total: data.length,
    highRisk: data.filter((r) => r.risk === 'high').length,
    overdue: data.filter(isOverdue).length,
    overdueTasks: data.reduce((s, r) => s + r.overdueTasks, 0),
    blocked: data.reduce((s, r) => s + r.blockedTasks, 0),
  }), [data]);

  const filtered = useMemo(() => {
    let r = data.filter((x) => (!riskFilter || x.risk === riskFilter) && (!catFilter || x.category === catFilter));
    r = [...r].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'progress': cmp = progressOf(a) - progressOf(b); break;
        case 'risk': cmp = (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9); break;
        case 'projectedEnd': cmp = (a.projectedEnd ?? '9999').localeCompare(b.projectedEnd ?? '9999'); break;
        default: cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortAsc ? cmp : -cmp;
    });
    return r;
  }, [data, riskFilter, catFilter, sortKey, sortAsc]);

  const sortBtn = (key: SortKey, label: string) => (
    <button onClick={() => { sortKey === key ? setSortAsc(!sortAsc) : (setSortKey(key), setSortAsc(true)); }}
      className={`flex items-center gap-1 hover:text-stone-700 ${sortKey === key ? 'text-stone-900' : ''}`}>
      {label}<ArrowUpDown size={10} className="opacity-50" />
    </button>
  );

  if (isLoading) return <div className="flex items-center gap-2 text-stone-400 py-12 justify-center"><Loader2 size={16} className="animate-spin" />加载组合看板…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <LayoutGrid size={18} className="text-amber-500" />
        <h1 className="font-serif text-xl text-stone-900">组合看板</h1>
        <span className="text-[11px] font-mono text-stone-400">{stats.total} 个项目</span>
      </div>

      {/* 汇总 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<AlertTriangle size={15} />} label="高风险项目" value={stats.highRisk} accent={stats.highRisk > 0 ? 'text-rose-600' : undefined} />
        <Stat icon={<CalendarClock size={15} />} label="预计超期项目" value={stats.overdue} accent={stats.overdue > 0 ? 'text-amber-600' : undefined} />
        <Stat icon={<Bug size={15} />} label="逾期任务总数" value={stats.overdueTasks} accent={stats.overdueTasks > 0 ? 'text-rose-600' : undefined} />
        <Stat icon={<Ban size={15} />} label="阻塞任务总数" value={stats.blocked} accent={stats.blocked > 0 ? 'text-amber-600' : undefined} />
      </div>

      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="border border-stone-300 px-2 py-1.5">
          <option value="">全部风险</option><option value="high">高风险</option><option value="medium">中风险</option><option value="low">低风险</option>
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="border border-stone-300 px-2 py-1.5">
          <option value="">全部类型</option><option value="npd">新产品开发</option><option value="eco">迭代升级</option><option value="idr">外观翻新</option>
        </select>
        <span className="text-stone-400">显示 {filtered.length} / {data.length}</span>
      </div>

      {/* 表格 */}
      <div className="border border-stone-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50 text-[10px] font-mono uppercase tracking-wider text-stone-400">
              <th className="text-left px-3 py-2.5">{sortBtn('name', '项目')}</th>
              <th className="text-left px-3 py-2.5">类型</th>
              <th className="text-left px-3 py-2.5">当前阶段</th>
              <th className="text-left px-3 py-2.5 w-40">{sortBtn('progress', '进度')}</th>
              <th className="text-center px-3 py-2.5">{sortBtn('risk', '风险')}</th>
              <th className="text-center px-3 py-2.5">{sortBtn('overdueTasks', '逾期')}</th>
              <th className="text-center px-3 py-2.5">{sortBtn('blockedTasks', '阻塞')}</th>
              <th className="text-center px-3 py-2.5">{sortBtn('openIssues', '开放问题')}</th>
              <th className="text-left px-3 py-2.5">{sortBtn('projectedEnd', '预计完成')}</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const cat = CATEGORY_MAP[r.category as keyof typeof CATEGORY_MAP];
              const risk = RISK_CONFIG[r.risk as keyof typeof RISK_CONFIG];
              const prog = progressOf(r);
              const overdue = isOverdue(r);
              return (
                <tr key={r.id} onClick={() => onSelectProject(r.id)} className="border-b border-stone-50 hover:bg-stone-50/60 cursor-pointer">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-stone-800">{r.name}</div>
                    <div className="text-[10px] font-mono text-stone-400">{r.projectNumber || '—'}{r.pmName ? ` · PM ${r.pmName}` : ''}</div>
                  </td>
                  <td className="px-3 py-2.5">{cat ? <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${cat.borderColor} ${cat.color} ${cat.textColor}`}>{cat.badge}</span> : r.category}</td>
                  <td className="px-3 py-2.5 text-xs text-stone-600">{PHASE_MAP[r.currentPhase]?.name ?? r.currentPhase}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2"><div className="flex-1 min-w-[60px]"><ProgressBar value={prog} color="bg-stone-800" height="h-1.5" /></div><span className="text-[11px] font-mono text-stone-500">{prog}%</span></div>
                    <div className="text-[10px] font-mono text-stone-300">{r.taskDone}/{r.taskTotal}</div>
                  </td>
                  <td className="px-3 py-2.5 text-center"><span className={`text-xs font-medium ${risk?.color}`}>{risk?.label ?? r.risk}</span></td>
                  <td className="px-3 py-2.5 text-center"><Cell n={r.overdueTasks} tone="rose" /></td>
                  <td className="px-3 py-2.5 text-center"><Cell n={r.blockedTasks} tone="amber" /></td>
                  <td className="px-3 py-2.5 text-center"><Cell n={r.openIssues} tone="rose" /></td>
                  <td className="px-3 py-2.5 text-xs font-mono">
                    <span className={overdue ? 'text-rose-600' : 'text-stone-600'}>{r.projectedEnd || '未排期'}</span>
                    {overdue && <span className="block text-[9px] text-rose-500">超目标 {r.targetDate}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-stone-300"><ChevronRight size={14} /></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={10} className="px-3 py-10 text-center text-stone-400 text-sm">暂无项目</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white border border-stone-200 p-4">
      <div className="flex items-center gap-1.5 text-stone-400">{icon}<span className="text-[10px] font-mono uppercase tracking-wider">{label}</span></div>
      <div className={`mt-1.5 text-2xl font-serif font-semibold ${accent ?? 'text-stone-900'}`}>{value}</div>
    </div>
  );
}

function Cell({ n, tone }: { n: number; tone: 'rose' | 'amber' }) {
  if (!n) return <span className="text-stone-300">—</span>;
  const cls = tone === 'rose' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200';
  return <span className={`text-[11px] font-mono px-1.5 py-0.5 border ${cls}`}>{n}</span>;
}
