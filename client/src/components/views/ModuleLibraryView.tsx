// 模块库视图（只读）：共享模块 + 品类核心模块，展开看任务块。
import { useState } from 'react';
import { Boxes, ChevronRight, ChevronDown, Loader2, Cpu, Layers } from 'lucide-react';
import { trpc } from '@/lib/trpc';

const PHASE_LABELS: Record<string, string> = {
  concept: '概念', planning: '规划', design: '设计', evt: 'EVT', dvt: 'DVT', pvt: '试产', mp: '量产',
};
const EXECUTOR_LABELS: Record<string, string> = { internal: '内部', supplier: '供应商', lab: '实验室' };

type ModuleTask = { id: number; phase: string; task: string; executor: string; ownerRoles: string[] | null; gateName: string | null; checklist: string[] | null };
type Module = { id: number; moduleKey: string; name: string; scope: string; category: string; ownerRoles: string[] | null; tasks: ModuleTask[] };

export function ModuleLibraryView() {
  const { data: modules = [], isLoading } = trpc.modules.library.useQuery();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (k: string) => setExpanded((p) => {
    const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n;
  });

  const shared = (modules as Module[]).filter((m) => m.scope === 'shared');
  const core = (modules as Module[]).filter((m) => m.scope === 'core');

  const ModuleCard = ({ m }: { m: Module }) => {
    const open = expanded.has(m.moduleKey);
    return (
      <div className="border border-stone-200 bg-white">
        <button onClick={() => toggle(m.moduleKey)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-stone-50 transition-colors">
          {open ? <ChevronDown size={14} className="text-stone-400" /> : <ChevronRight size={14} className="text-stone-400" />}
          <span className="font-medium text-stone-900 text-sm">{m.name}</span>
          <span className="text-[10px] font-mono text-stone-400">{m.category || '通用'}</span>
          <div className="ml-auto flex gap-1">
            {(m.ownerRoles || []).map((r) => (
              <span key={r} className="text-[9px] font-mono px-1 py-0.5 bg-stone-100 text-stone-500">{r}</span>
            ))}
          </div>
        </button>
        {open && (
          <div className="border-t border-stone-100 px-4 py-3">
            {m.tasks.length === 0 ? (
              <p className="text-xs text-stone-400">（任务块待填）</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] font-mono uppercase tracking-wider text-stone-400 text-left">
                    <th className="pb-1.5 pr-2">阶段</th><th className="pb-1.5 pr-2">任务</th>
                    <th className="pb-1.5 pr-2">执行方</th><th className="pb-1.5 pr-2">责任</th><th className="pb-1.5">门禁</th>
                  </tr>
                </thead>
                <tbody>
                  {m.tasks.map((t) => (
                    <tr key={t.id} className="border-t border-stone-50 align-top">
                      <td className="py-1.5 pr-2 whitespace-nowrap text-stone-500">{PHASE_LABELS[t.phase] || t.phase}</td>
                      <td className="py-1.5 pr-2 text-stone-800">
                        {t.task}
                        {(t.checklist || []).length > 0 && (
                          <div className="text-[10px] text-stone-400 mt-0.5">检查项：{(t.checklist || []).join(' · ')}</div>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap text-stone-500">{EXECUTOR_LABELS[t.executor] || t.executor}</td>
                      <td className="py-1.5 pr-2 text-stone-500">{(t.ownerRoles || []).join('·')}</td>
                      <td className="py-1.5">{t.gateName ? <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-50 text-amber-700">{t.gateName}</span> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl text-stone-900">模块库</h2>
        <p className="text-[11px] font-mono uppercase tracking-widest text-stone-400 mt-1">MODULE LIBRARY · 模块化 SOP</p>
      </div>
      {isLoading ? (
        <div className="flex justify-center h-40 items-center"><Loader2 className="animate-spin text-amber-500" /></div>
      ) : (
        <div className="space-y-8">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-3 flex items-center gap-2"><Layers size={12} /> 共享模块 · {shared.length}</div>
            <div className="space-y-2">{shared.map((m) => <ModuleCard key={m.moduleKey} m={m} />)}</div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-3 flex items-center gap-2"><Cpu size={12} /> 品类核心模块 · {core.length}</div>
            <div className="space-y-2">{core.map((m) => <ModuleCard key={m.moduleKey} m={m} />)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
