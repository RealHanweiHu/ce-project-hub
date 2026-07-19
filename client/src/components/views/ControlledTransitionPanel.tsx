import { useState } from 'react';
import { ArrowRightLeft, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { CATEGORY_MAP, PROJECT_CATEGORIES, type ProjectCategory } from '@/lib/sop-templates';

export function ControlledTransitionPanel({
  project,
  canEdit,
}: {
  project: { id: string; projectNumber?: string; code?: string; name: string; category?: ProjectCategory | null };
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    targetProjectNumber: `${project.projectNumber || project.code || project.id}-T1`,
    targetName: `${project.name}（转轨）`,
    toCategory: (project.category === 'npd' ? 'eco' : 'npd') as ProjectCategory,
    reason: '',
  });
  const execute = trpc.transitions.execute.useMutation({
    onSuccess: async (result) => {
      await Promise.all([utils.projects.list.invalidate(), utils.projects.get.invalidate({ id: project.id })]);
      toast.success(`转轨完成：新项目 ${result.targetProjectId} 已建立，原项目已归档`);
      setOpen(false);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="rounded-[11px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="rounded-[8px] bg-secondary p-2 text-primary"><ArrowRightLeft size={15} /></div>
          <div>
            <div className="text-sm font-semibold">受控转轨</div>
            <div className="mt-1 text-xs text-muted-foreground">新建目标轨道项目并复制未结问题、文件引用、成员和可执行任务；原项目保留完整历史并归档，禁止直接改轨道。</div>
          </div>
        </div>
        {canEdit && <button onClick={() => setOpen((value) => !value)} className="rounded border border-border px-3 py-1.5 text-xs hover:bg-secondary">{open ? '收起' : '发起转轨'}</button>}
      </div>
      {open && canEdit && (
        <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-2">
          <input value={form.targetProjectNumber} onChange={(event) => setForm({ ...form, targetProjectNumber: event.target.value })} placeholder="新项目编号" className="rounded border border-border bg-background px-3 py-2 text-sm" />
          <input value={form.targetName} onChange={(event) => setForm({ ...form, targetName: event.target.value })} placeholder="新项目名称" className="rounded border border-border bg-background px-3 py-2 text-sm" />
          <select value={form.toCategory} onChange={(event) => setForm({ ...form, toCategory: event.target.value as ProjectCategory })} className="rounded border border-border bg-background px-3 py-2 text-sm md:col-span-2">
            {PROJECT_CATEGORIES.filter((category) => category.id !== project.category).map((category) => <option key={category.id} value={category.id}>{CATEGORY_MAP[category.id].name}</option>)}
          </select>
          <textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="转轨原因、决策依据与范围边界（至少 10 字）" rows={3} className="rounded border border-border bg-background px-3 py-2 text-sm md:col-span-2" />
          <div className="flex justify-end md:col-span-2">
            <button
              disabled={execute.isPending || form.reason.trim().length < 10 || !form.targetProjectNumber.trim() || !form.targetName.trim()}
              onClick={() => execute.mutate({ sourceProjectId: project.id, ...form, reason: form.reason.trim() })}
              className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            ><ShieldCheck size={12} />确认新建并归档原项目</button>
          </div>
        </div>
      )}
    </div>
  );
}
