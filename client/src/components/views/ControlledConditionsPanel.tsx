import { useState } from 'react';
import { CheckCircle2, Clock3, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { toLocalISODate } from '@/lib/utils';
import { useAuth } from '@/_core/hooks/useAuth';

export function ControlledConditionsPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const conditions = trpc.conditions.list.useQuery({ projectId });
  const readiness = trpc.conditions.readiness.useQuery({ projectId });
  const { data: members = [] } = trpc.members.list.useQuery({ projectId });
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', ownerUserId: 0, dueDate: toLocalISODate(new Date()) });
  const currentProject = projects.find((project) => project.id === projectId);
  const ecoProjects = projects.filter((project) =>
    project.category === 'eco' && project.id !== projectId &&
    (!currentProject?.productId || project.productId === currentProject.productId)
  );

  const refresh = async () => {
    await Promise.all([
      utils.conditions.list.invalidate({ projectId }),
      utils.conditions.readiness.invalidate({ projectId }),
    ]);
  };
  const create = trpc.conditions.createWaiver.useMutation({
    onSuccess: async () => { await refresh(); setShowForm(false); toast.success('让步单已创建；延期不会解除 Close 阻塞'); },
    onError: (error) => toast.error(error.message),
  });
  const extend = trpc.conditions.extend.useMutation({
    onSuccess: async () => { await refresh(); toast.success('截止日期已更新，条件项仍保持未关闭'); },
    onError: (error) => toast.error(error.message),
  });
  const resolve = trpc.conditions.resolve.useMutation({
    onSuccess: async () => { await refresh(); toast.success('条件项已闭环'); },
    onError: (error) => toast.error(error.message),
  });

  const extendCondition = (conditionId: number) => {
    const dueDate = window.prompt('新的截止日期（YYYY-MM-DD）');
    if (!dueDate) return;
    const note = window.prompt('延期原因');
    if (!note?.trim()) return;
    extend.mutate({ projectId, conditionId, dueDate, note: note.trim() });
  };
  const closeCondition = (conditionId: number) => {
    const note = window.prompt('请输入闭环证据或结论');
    if (!note?.trim()) return;
    resolve.mutate({ projectId, conditionId, resolution: 'closed', note: note.trim() });
  };
  const convertCondition = (conditionId: number) => {
    if (ecoProjects.length === 0) { toast.error('没有可关联的 ECO 项目，请先创建并关联同一产品的 ECO'); return; }
    const choices = ecoProjects.map((project) => `${project.id} — ${project.name}`).join('\n');
    const linkedEcoProjectId = window.prompt(`请输入目标 ECO 项目 ID：\n${choices}`);
    if (!linkedEcoProjectId?.trim()) return;
    const note = window.prompt('请输入转 ECO 的范围和责任说明');
    if (!note?.trim()) return;
    resolve.mutate({ projectId, conditionId, resolution: 'converted_to_eco', linkedEcoProjectId: linkedEcoProjectId.trim(), note: note.trim() });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground">条件项与让步闭环</h3>
        <span className={`text-[10px] font-semibold ${readiness.data?.ready ? 'text-[color:var(--success)]' : 'text-[color:var(--warning)]'}`}>
          {readiness.data?.ready ? '全部闭环' : `未关闭 ${readiness.data?.openCount ?? 0} 项`}
        </span>
      </div>
      <div className="rounded-[11px] border border-border bg-card p-4">
        <p className="mb-3 text-xs text-muted-foreground">只有“关闭”或“转 ECO”才解除 Close 阻塞；延期只更新截止日期，不视为闭环。</p>
        <div className="space-y-2">
          {(conditions.data ?? []).map((condition) => (
            <div key={condition.id} className="rounded-[8px] border border-border bg-secondary/20 p-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground">{condition.title}</div>
                  <p className="mt-1 text-muted-foreground">{condition.description}</p>
                  <div className="mt-1 text-[11px] text-muted-foreground">负责人 #{condition.ownerUserId} · 截止 {condition.dueDate} · 来源 {condition.sourceType}</div>
                </div>
                <span className={`inline-flex items-center gap-1 text-[10px] ${condition.status === 'open' ? 'text-[color:var(--warning)]' : 'text-[color:var(--success)]'}`}>
                  {condition.status === 'open' ? <Clock3 size={11} /> : <CheckCircle2 size={11} />}
                  {condition.status === 'open' ? '未关闭' : condition.status === 'converted_to_eco' ? '已转 ECO' : '已关闭'}
                </span>
              </div>
              {condition.status === 'open' && (canEdit || condition.ownerUserId === user?.id) && (
                <div className="mt-2 flex flex-wrap gap-2 border-t border-border pt-2">
                  <button type="button" onClick={() => extendCondition(condition.id)} className="text-[10px] text-muted-foreground hover:text-foreground">延期</button>
                  <button type="button" onClick={() => closeCondition(condition.id)} className="text-[10px] text-[color:var(--success)]">关闭</button>
                  <button type="button" onClick={() => convertCondition(condition.id)} className="text-[10px] text-primary">转 ECO</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {canEdit && !showForm && <button type="button" onClick={() => setShowForm(true)} className="mt-3 inline-flex items-center gap-1 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-secondary"><Plus size={12} />新建让步单</button>}
        {showForm && (
          <div className="mt-3 grid gap-2 rounded-[8px] border border-border bg-secondary/20 p-3 md:grid-cols-2">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="让步标题" className="rounded border border-border bg-card px-2 py-2 text-xs" />
            <select value={form.ownerUserId || ''} onChange={(e) => setForm({ ...form, ownerUserId: Number(e.target.value) })} className="rounded border border-border bg-card px-2 py-2 text-xs"><option value="">选择负责人</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.userName || `用户 #${member.userId}`}</option>)}</select>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="让步内容、风险与边界" rows={2} className="rounded border border-border bg-card px-2 py-2 text-xs md:col-span-2" />
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="rounded border border-border bg-card px-2 py-2 text-xs" />
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="px-2 py-1 text-xs text-muted-foreground">取消</button><button type="button" disabled={!form.title.trim() || !form.description.trim() || !form.ownerUserId || create.isPending} onClick={() => create.mutate({ projectId, ...form })} className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">创建</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
