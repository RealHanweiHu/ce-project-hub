import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Send, ShieldCheck } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { isSystemAdminRole } from '@shared/system-roles';
import { toast } from 'sonner';

type ProductRef = { id: string; currentRevisionId?: number | null; createdBy?: number; productManagerUserId?: number | null; maintenanceOwnerUserId?: number | null };
const today = () => new Date().toISOString().slice(0, 10);
const empty = () => ({ id: null as number | null, title: '', deviationDescription: '', impactAssessment: '', containmentPlan: '', scopeType: 'batch' as 'lot' | 'batch' | 'quantity' | 'timeboxed', lotOrBatch: '', quantityLimit: '', affectedPartNumbers: '', effectiveFrom: today(), expiresOn: '', riskLevel: 'medium' as 'low' | 'medium' | 'high', ownerUserId: null as number | null, approverUserId: null as number | null, evidenceReference: '' });

export function ProductWaiverPanel({ product }: { product: ProductRef }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const rows = trpc.productWaivers.list.useQuery({ productId: product.id });
  const users = trpc.admin.listUsersForSelect.useQuery();
  const [form, setForm] = useState(empty);
  const isAdmin = isSystemAdminRole(user?.role);
  const canMaintain = !!user && (isAdmin || product.createdBy === user.id || product.productManagerUserId === user.id || product.maintenanceOwnerUserId === user.id);
  const userById = useMemo(() => new Map((users.data ?? []).map((item) => [item.id, item.name || item.username || `#${item.id}`])), [users.data]);
  const refresh = () => utils.productWaivers.list.invalidate({ productId: product.id });
  const save = trpc.productWaivers.saveDraft.useMutation({ onSuccess: async () => { toast.success('量产让步草稿已保存'); setForm(empty()); await refresh(); }, onError: (error) => toast.error(error.message) });
  const submit = trpc.productWaivers.submit.useMutation({ onSuccess: async () => { toast.success('已提交独立审批'); await refresh(); }, onError: (error) => toast.error(error.message) });
  const decide = trpc.productWaivers.decide.useMutation({ onSuccess: async (_, input) => { toast.success(input.approve ? '让步已批准' : '让步已拒绝'); await refresh(); }, onError: (error) => toast.error(error.message) });
  const resolve = trpc.productWaivers.resolve.useMutation({ onSuccess: async () => { toast.success('让步已闭环'); await refresh(); }, onError: (error) => toast.error(error.message) });

  const saveDraft = () => {
    if (!form.title || !form.deviationDescription || !form.impactAssessment || !form.containmentPlan || !form.expiresOn || !form.ownerUserId || !form.approverUserId || !form.evidenceReference) return toast.error('请补齐让步边界、影响、责任、审批和证据');
    save.mutate({
      ...form,
      ownerUserId: form.ownerUserId,
      approverUserId: form.approverUserId,
      productId: product.id,
      projectId: null,
      quantityLimit: form.quantityLimit ? Number(form.quantityLimit) : null,
      affectedPartNumbers: form.affectedPartNumbers.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
    });
  };

  return <div className="space-y-4">
    <div className="flex items-start gap-2.5"><div className="rounded-[8px] bg-[color:var(--warning-soft)] p-2 text-[color:var(--warning)]"><AlertTriangle size={16} /></div><div><div className="text-sm font-semibold">量产让步 / 临时代料</div><div className="text-xs text-muted-foreground">限定批次、数量或期限；编制人不能自批，到期后必须关闭或转 ECO。</div></div></div>
    {canMaintain && <div className="grid grid-cols-1 gap-2 rounded-[10px] border border-border bg-secondary p-4 md:grid-cols-2">
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="让步标题" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
      <select value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value as typeof form.scopeType })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm"><option value="lot">限定 Lot</option><option value="batch">限定批次</option><option value="quantity">限定数量</option><option value="timeboxed">限定期限</option></select>
      <textarea value={form.deviationDescription} onChange={(e) => setForm({ ...form, deviationDescription: e.target.value })} placeholder="偏差或临时代料说明" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
      <textarea value={form.impactAssessment} onChange={(e) => setForm({ ...form, impactAssessment: e.target.value })} placeholder="质量、安全、认证与客户影响评估" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
      <textarea value={form.containmentPlan} onChange={(e) => setForm({ ...form, containmentPlan: e.target.value })} placeholder="围堵、隔离与追溯方案" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm md:col-span-2" />
      <input value={form.lotOrBatch} onChange={(e) => setForm({ ...form, lotOrBatch: e.target.value })} placeholder="Lot / 批次标识" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
      <input type="number" value={form.quantityLimit} onChange={(e) => setForm({ ...form, quantityLimit: e.target.value })} placeholder="数量上限（按需）" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
      <input value={form.affectedPartNumbers} onChange={(e) => setForm({ ...form, affectedPartNumbers: e.target.value })} placeholder="受影响料号，逗号分隔" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm md:col-span-2" />
      <label className="text-xs text-muted-foreground">生效日<input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} className="mt-1 w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm" /></label>
      <label className="text-xs text-muted-foreground">到期日<input type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} className="mt-1 w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm" /></label>
      <select value={form.ownerUserId ?? ''} onChange={(e) => setForm({ ...form, ownerUserId: e.target.value ? Number(e.target.value) : null })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm"><option value="">让步责任人</option>{(users.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name || item.username}</option>)}</select>
      <select value={form.approverUserId ?? ''} onChange={(e) => setForm({ ...form, approverUserId: e.target.value ? Number(e.target.value) : null })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm"><option value="">独立批准人</option>{(users.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name || item.username}</option>)}</select>
      <input value={form.evidenceReference} onChange={(e) => setForm({ ...form, evidenceReference: e.target.value })} placeholder="检验报告、偏差照片或受控证据引用" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm md:col-span-2" />
      <div className="flex justify-end md:col-span-2"><button onClick={saveDraft} className="inline-flex items-center gap-1 rounded-[7px] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"><Plus size={12} />保存草稿</button></div>
    </div>}
    <div className="space-y-2">{(rows.data ?? []).map((row) => <div key={row.id} className="rounded-[9px] border border-border bg-card p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-semibold">{row.title}<span className="ml-2 text-[10px] text-muted-foreground">{row.waiverNumber} · {row.status}</span></div><div className="mt-1 text-xs text-muted-foreground">{row.scopeType} {row.lotOrBatch || ''} · 有效至 {row.expiresOn} · 责任人 {userById.get(row.ownerUserId)} · 批准人 {userById.get(row.approverUserId)}</div></div><div className="flex flex-wrap gap-2">{row.status === 'draft' && canMaintain && <><button onClick={() => submit.mutate({ productId: product.id, id: row.id })} className="inline-flex items-center gap-1 rounded-[6px] bg-primary px-2 py-1 text-xs text-primary-foreground"><Send size={11} />提交</button><button onClick={() => resolve.mutate({ productId: product.id, id: row.id, resolution: 'cancelled', note: '草稿取消', linkedEcoProjectId: null })} className="rounded-[6px] border border-border px-2 py-1 text-xs">取消</button></>}{row.status === 'pending_approval' && user && row.createdBy !== user.id && (isAdmin || row.approverUserId === user.id) && <><button onClick={() => decide.mutate({ productId: product.id, id: row.id, approve: true, note: '批准' })} className="inline-flex items-center gap-1 rounded-[6px] bg-[color:var(--success)] px-2 py-1 text-xs text-white"><ShieldCheck size={11} />批准</button><button onClick={() => { const note = window.prompt('请输入拒绝原因'); if (note) decide.mutate({ productId: product.id, id: row.id, approve: false, note }); }} className="rounded-[6px] border border-border px-2 py-1 text-xs">拒绝</button></>}{['approved', 'expired'].includes(row.status) && canMaintain && <><button onClick={() => { const note = window.prompt('请输入闭环说明'); if (note) resolve.mutate({ productId: product.id, id: row.id, resolution: 'closed', note, linkedEcoProjectId: null }); }} className="inline-flex items-center gap-1 rounded-[6px] border border-border px-2 py-1 text-xs"><CheckCircle2 size={11} />关闭</button><button onClick={() => { const linkedEcoProjectId = window.prompt('请输入同一产品的 ECO 项目 ID'); if (!linkedEcoProjectId) return; const note = window.prompt('请输入转 ECO 说明'); if (note) resolve.mutate({ productId: product.id, id: row.id, resolution: 'converted_to_eco', note, linkedEcoProjectId }); }} className="rounded-[6px] border border-border px-2 py-1 text-xs">转 ECO</button></>}</div></div><p className="mt-2 text-xs">{row.deviationDescription}</p></div>)}{rows.data?.length === 0 && <div className="rounded-[8px] border border-dashed border-border p-4 text-center text-xs text-muted-foreground">暂无量产让步记录</div>}</div>
  </div>;
}
