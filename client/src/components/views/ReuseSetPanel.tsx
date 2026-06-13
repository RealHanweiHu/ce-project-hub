// 项目复用集面板：对每个模块声明变更等级（5 级）。
import { Loader2, Layers } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

const CHANGE_LEVELS: { value: string; label: string }[] = [
  { value: 'carryover', label: '完全复用' },
  { value: 'reuse_verify', label: '复用+兼容验证' },
  { value: 'minor', label: '小改' },
  { value: 'redesign', label: '重做' },
  { value: 'new', label: '新开发' },
];

type Module = { moduleKey: string; name: string; scope: string; category: string };

export function ReuseSetPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data: modules = [], isLoading } = trpc.modules.library.useQuery();
  const { data: projectMods = [] } = trpc.modules.projectModules.useQuery({ projectId });
  const setMutation = trpc.modules.setProjectModule.useMutation({
    onSuccess: () => utils.modules.projectModules.invalidate({ projectId }),
    onError: (e) => toast.error(e.message),
  });

  const levelOf = (moduleKey: string) =>
    (projectMods as { moduleKey: string; changeLevel: string }[]).find((m) => m.moduleKey === moduleKey)?.changeLevel ?? '';

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-amber-500" /></div>;

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-2 text-[11px] font-mono text-stone-400">
        <Layers size={13} /> 对每个模块声明变更等级——决定任务清单、阶段轻重与会签职能。
      </div>
      <div className="border border-stone-200 divide-y divide-stone-100">
        {(modules as Module[]).map((m) => (
          <div key={m.moduleKey} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <span className="text-sm text-stone-800">{m.name}</span>
              <span className="ml-2 text-[10px] font-mono text-stone-400">{m.scope === 'core' ? (m.category || '核心') : '共享'}</span>
            </div>
            <select
              value={levelOf(m.moduleKey)}
              disabled={!canEdit || setMutation.isPending}
              onChange={(e) => setMutation.mutate({ projectId, moduleKey: m.moduleKey, changeLevel: e.target.value as 'carryover' | 'reuse_verify' | 'minor' | 'redesign' | 'new' })}
              className="border border-stone-300 text-sm px-2 py-1.5 bg-white disabled:opacity-60"
            >
              <option value="">未声明</option>
              {CHANGE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
