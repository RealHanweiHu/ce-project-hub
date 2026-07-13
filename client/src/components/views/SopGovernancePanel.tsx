import { useState } from 'react';
import { GitPullRequest, Send, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { isSystemAdminRole } from '@shared/system-roles';
import { PROJECT_CATEGORIES, type ProjectCategory } from '@/lib/sop-templates';

const today = () => new Date().toISOString().slice(0, 10);
const empty = () => ({ title: '', currentVersion: '2026-07-v1', proposedVersion: '2026-07-v2', affectedTracks: [] as ProjectCategory[], changeSummary: '', rationale: '', impactAnalysis: '', migrationStrategy: '', rollbackPlan: '', effectiveDate: today(), approverUserId: null as number | null });

export function SopGovernancePanel() {
  const { user } = useAuth();
  const isAdmin = isSystemAdminRole(user?.role);
  const utils = trpc.useUtils();
  const requests = trpc.sopGovernance.list.useQuery(undefined, { enabled: isAdmin });
  const users = trpc.admin.listUsersForSelect.useQuery(undefined, { enabled: isAdmin, staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const refresh = () => utils.sopGovernance.list.invalidate();
  const save = trpc.sopGovernance.saveDraft.useMutation({ onSuccess: async () => { setForm(empty()); setOpen(false); await refresh(); toast.success('SOP 变更申请已保存'); }, onError: (error) => toast.error(error.message) });
  const submit = trpc.sopGovernance.submit.useMutation({ onSuccess: async () => { await refresh(); toast.success('SOP 变更已提交独立审批'); }, onError: (error) => toast.error(error.message) });
  const decide = trpc.sopGovernance.decide.useMutation({ onSuccess: async (_, input) => { await refresh(); toast.success(input.approve ? 'SOP 变更已批准' : 'SOP 变更已退回'); }, onError: (error) => toast.error(error.message) });
  const publish = trpc.sopGovernance.publish.useMutation({ onSuccess: async () => { await refresh(); toast.success('SOP 新版本已发布并留存审计事件'); }, onError: (error) => toast.error(error.message) });
  if (!isAdmin) return null;
  const canSave = form.title.trim() && form.affectedTracks.length && form.changeSummary.trim() && form.rationale.trim() && form.impactAnalysis.trim() && form.migrationStrategy.trim() && form.rollbackPlan.trim() && form.approverUserId;

  return <div className="rounded-[11px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-2.5"><GitPullRequest size={17} className="mt-0.5 text-primary" /><div><div className="text-sm font-semibold">SOP 的 SOP：受控变更治理</div><div className="mt-1 text-xs text-muted-foreground">先提案、做影响/迁移/回滚分析，再由独立管理员批准并发布；已开启项目继续使用自己的模板快照。</div></div></div><button onClick={() => setOpen((value) => !value)} className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground">{open ? '收起' : '发起变更'}</button></div>
    {open && <div className="mt-4 grid gap-2 border-t border-[color:var(--acc-border)] pt-4 md:grid-cols-2">
      <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="变更标题" className="rounded border border-border bg-card px-3 py-2 text-sm md:col-span-2" />
      <input value={form.currentVersion} onChange={(event) => setForm({ ...form, currentVersion: event.target.value })} placeholder="当前版本" className="rounded border border-border bg-card px-3 py-2 text-sm" /><input value={form.proposedVersion} onChange={(event) => setForm({ ...form, proposedVersion: event.target.value })} placeholder="拟发布版本" className="rounded border border-border bg-card px-3 py-2 text-sm" />
      <div className="flex flex-wrap gap-2 md:col-span-2">{PROJECT_CATEGORIES.map((category) => <label key={category.id} className="flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs"><input type="checkbox" checked={form.affectedTracks.includes(category.id)} onChange={(event) => setForm({ ...form, affectedTracks: event.target.checked ? [...form.affectedTracks, category.id] : form.affectedTracks.filter((track) => track !== category.id) })} />{category.name}</label>)}</div>
      <textarea value={form.changeSummary} onChange={(event) => setForm({ ...form, changeSummary: event.target.value })} placeholder="改什么" rows={2} className="rounded border border-border bg-card p-2 text-xs" /><textarea value={form.rationale} onChange={(event) => setForm({ ...form, rationale: event.target.value })} placeholder="为什么改 / 风险依据" rows={2} className="rounded border border-border bg-card p-2 text-xs" />
      <textarea value={form.impactAnalysis} onChange={(event) => setForm({ ...form, impactAnalysis: event.target.value })} placeholder="对在途项目、数据、角色、Gate 的影响" rows={2} className="rounded border border-border bg-card p-2 text-xs" /><textarea value={form.migrationStrategy} onChange={(event) => setForm({ ...form, migrationStrategy: event.target.value })} placeholder="历史与在途项目迁移策略" rows={2} className="rounded border border-border bg-card p-2 text-xs" />
      <textarea value={form.rollbackPlan} onChange={(event) => setForm({ ...form, rollbackPlan: event.target.value })} placeholder="回滚触发条件和方案" rows={2} className="rounded border border-border bg-card p-2 text-xs md:col-span-2" />
      <label className="text-xs text-muted-foreground">生效日<input type="date" value={form.effectiveDate} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })} className="mt-1 w-full rounded border border-border bg-card px-2 py-2 text-xs" /></label><select value={form.approverUserId ?? ''} onChange={(event) => setForm({ ...form, approverUserId: event.target.value ? Number(event.target.value) : null })} className="self-end rounded border border-border bg-card px-2 py-2 text-xs"><option value="">独立批准人</option>{(users.data ?? []).filter((item) => item.id !== user?.id).map((item) => <option key={item.id} value={item.id}>{item.name || item.username}</option>)}</select>
      <div className="flex justify-end md:col-span-2"><button disabled={!canSave || save.isPending} onClick={() => save.mutate({ ...form, approverUserId: form.approverUserId! })} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50">保存变更草稿</button></div>
    </div>}
    <div className="mt-4 space-y-2">{(requests.data ?? []).map((request) => <div key={request.id} className="rounded border border-border bg-card p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-semibold">{request.title}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{request.requestNumber} · {request.currentVersion} → {request.proposedVersion} · {request.status}</div></div><div className="flex gap-2">{request.status === 'draft' && request.requesterUserId === user?.id && <button onClick={() => submit.mutate({ id: request.id })} className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground"><Send size={11} />提交</button>}{request.status === 'pending_approval' && request.approverUserId === user?.id && request.requesterUserId !== user?.id && <><button onClick={() => decide.mutate({ id: request.id, approve: true, note: '影响、迁移和回滚方案已评审' })} className="inline-flex items-center gap-1 rounded bg-[color:var(--success)] px-2 py-1 text-xs text-white"><ShieldCheck size={11} />批准</button><button onClick={() => { const note = window.prompt('退回原因'); if (note) decide.mutate({ id: request.id, approve: false, note }); }} className="rounded border border-border px-2 py-1 text-xs">退回</button></>}{request.status === 'approved' && <button onClick={() => publish.mutate({ id: request.id })} className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground"><Upload size={11} />发布</button>}</div></div><p className="mt-2 text-xs text-muted-foreground">{request.changeSummary}</p></div>)}{requests.data?.length === 0 && <div className="text-xs text-muted-foreground">暂无 SOP 变更记录</div>}</div>
  </div>;
}
