import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Send, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { isSystemAdminRole } from '@shared/system-roles';

const ITEM_LABELS = {
  tooling_disposition: '模具与工装处置',
  material_disposition: '物料与在制品处置',
  sample_disposition: '样品与试产件处置',
  customer_commitments: '客户承诺与沟通闭环',
  finance_contracts: '财务、采购与合同闭环',
  ip_documents: '知识产权与受控文件处置',
  knowledge_capture: '复盘与知识沉淀',
} as const;
type ItemKey = keyof typeof ITEM_LABELS;
const EMPTY_ITEMS = Object.keys(ITEM_LABELS).map((itemKey) => ({ itemKey: itemKey as ItemKey, disposition: '', completed: false, evidenceReference: '' }));

export function TerminationReviewPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const bundle = trpc.termination.get.useQuery({ projectId }, { enabled: canEdit });
  const users = trpc.admin.listUsersForSelect.useQuery(undefined, { enabled: canEdit, staleTime: 60_000 });
  const [form, setForm] = useState({ reason: '', sunkCostSummary: '', customerCommunication: '', ownerUserId: null as number | null, approverUserId: null as number | null, items: EMPTY_ITEMS });
  useEffect(() => {
    if (!bundle.data?.review) return;
    const byKey = new Map(bundle.data.items.map((item) => [item.itemKey, item]));
    setForm({
      reason: bundle.data.review.reason,
      sunkCostSummary: bundle.data.review.sunkCostSummary,
      customerCommunication: bundle.data.review.customerCommunication,
      ownerUserId: bundle.data.review.ownerUserId,
      approverUserId: bundle.data.review.approverUserId,
      items: EMPTY_ITEMS.map((item) => {
        const saved = byKey.get(item.itemKey);
        return saved ? { itemKey: item.itemKey, disposition: saved.disposition, completed: saved.completed, evidenceReference: saved.evidenceReference ?? '' } : item;
      }),
    });
  }, [bundle.data]);
  const refresh = async () => { await Promise.all([utils.termination.get.invalidate({ projectId }), utils.projects.get.invalidate({ id: projectId }), utils.projects.list.invalidate()]); };
  const save = trpc.termination.saveDraft.useMutation({ onSuccess: async () => { await refresh(); toast.success('终止善后草稿已保存'); }, onError: (error) => toast.error(error.message) });
  const submit = trpc.termination.submit.useMutation({ onSuccess: async () => { await refresh(); toast.success('终止评审已提交'); }, onError: (error) => toast.error(error.message) });
  const decide = trpc.termination.decide.useMutation({ onSuccess: async (_, input) => { await refresh(); toast.success(input.approve ? '终止评审已批准' : '终止评审已退回'); }, onError: (error) => toast.error(error.message) });
  const terminate = trpc.projects.setLifecycle.useMutation({ onSuccess: async () => { await refresh(); toast.success('项目已按批准的善后方案终止并归档'); }, onError: (error) => toast.error(error.message) });
  const review = bundle.data?.review;
  const canDecide = !!user && review?.status === 'pending_approval' && (review.approverUserId === user.id || isSystemAdminRole(user.role)) && review.createdBy !== user.id;
  const complete = useMemo(() => form.items.every((item) => item.completed && item.disposition.trim() && item.evidenceReference.trim()), [form.items]);
  const canSave = form.reason.trim().length >= 10 && !!form.sunkCostSummary.trim() && !!form.customerCommunication.trim() && !!form.ownerUserId && !!form.approverUserId && form.items.every((item) => item.disposition.trim());

  if (!canEdit) return <p className="text-xs text-muted-foreground">仅项目管理者可编制或审批终止善后方案。</p>;
  return (
    <div className="space-y-4 rounded-lg border border-rose-200 bg-rose-50/40 p-4">
      <div className="flex items-start gap-2"><ClipboardCheck size={16} className="mt-0.5 text-rose-700" /><div><div className="text-sm font-semibold text-rose-700">结构化终止评审</div><div className="text-xs text-muted-foreground">七项善后全部完成并留证、独立批准后，系统才允许终止归档。</div></div></div>
      {review && <div className="text-xs text-muted-foreground">状态：{review.status} · 终止单 #{review.id}</div>}
      {(!review || ['draft', 'rejected'].includes(review.status)) && (
        <div className="grid gap-3 md:grid-cols-2">
          <textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="终止理由与决策依据（至少 10 字）" rows={3} className="rounded border border-border bg-background p-2 text-xs md:col-span-2" />
          <textarea value={form.sunkCostSummary} onChange={(event) => setForm({ ...form, sunkCostSummary: event.target.value })} placeholder="沉没成本与财务影响" rows={2} className="rounded border border-border bg-background p-2 text-xs" />
          <textarea value={form.customerCommunication} onChange={(event) => setForm({ ...form, customerCommunication: event.target.value })} placeholder="客户沟通与承诺闭环" rows={2} className="rounded border border-border bg-background p-2 text-xs" />
          <select value={form.ownerUserId ?? ''} onChange={(event) => setForm({ ...form, ownerUserId: event.target.value ? Number(event.target.value) : null })} className="rounded border border-border bg-background px-2 py-2 text-xs"><option value="">善后责任人</option>{(users.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name || item.username}</option>)}</select>
          <select value={form.approverUserId ?? ''} onChange={(event) => setForm({ ...form, approverUserId: event.target.value ? Number(event.target.value) : null })} className="rounded border border-border bg-background px-2 py-2 text-xs"><option value="">独立批准人</option>{(users.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name || item.username}</option>)}</select>
          <div className="space-y-2 md:col-span-2">
            {form.items.map((item, index) => <div key={item.itemKey} className="grid gap-2 rounded border border-border bg-background p-3 md:grid-cols-[180px_1fr_1fr_auto]"><div className="text-xs font-medium">{ITEM_LABELS[item.itemKey]}</div><input value={item.disposition} onChange={(event) => setForm({ ...form, items: form.items.map((value, i) => i === index ? { ...value, disposition: event.target.value } : value) })} placeholder="处置方案" className="rounded border border-border px-2 py-1.5 text-xs" /><input value={item.evidenceReference} onChange={(event) => setForm({ ...form, items: form.items.map((value, i) => i === index ? { ...value, evidenceReference: event.target.value } : value) })} placeholder="证据/文件编号" className="rounded border border-border px-2 py-1.5 text-xs" /><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={item.completed} onChange={(event) => setForm({ ...form, items: form.items.map((value, i) => i === index ? { ...value, completed: event.target.checked } : value) })} />完成</label></div>)}
          </div>
          <div className="flex justify-end gap-2 md:col-span-2"><button disabled={!canSave || save.isPending} onClick={() => save.mutate({ projectId, ...form, ownerUserId: form.ownerUserId!, approverUserId: form.approverUserId!, items: form.items.map((item) => ({ ...item, evidenceReference: item.evidenceReference || null })) })} className="rounded border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-50">保存草稿</button>{review?.status === 'draft' && <button disabled={!complete || submit.isPending} onClick={() => submit.mutate({ projectId })} className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"><Send size={11} />提交审批</button>}</div>
        </div>
      )}
      {canDecide && <div className="flex gap-2"><button onClick={() => decide.mutate({ projectId, approve: true, note: '同意按善后清单终止' })} className="inline-flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-xs text-white"><ShieldCheck size={11} />批准终止</button><button onClick={() => { const note = window.prompt('退回原因'); if (note) decide.mutate({ projectId, approve: false, note }); }} className="rounded border border-border px-3 py-1.5 text-xs">退回</button></div>}
      {review?.status === 'approved' && <button onClick={() => terminate.mutate({ projectId, lifecycle: 'terminated', reason: review.reason, aftercare: `${review.sunkCostSummary}\n${review.customerCommunication}` })} className="inline-flex items-center gap-1 rounded bg-rose-600 px-3 py-2 text-xs font-semibold text-white"><CheckCircle2 size={12} />执行终止并归档</button>}
    </div>
  );
}
