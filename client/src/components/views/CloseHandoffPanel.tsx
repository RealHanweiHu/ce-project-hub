import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Handshake, Loader2, Send, ShieldCheck } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { toast } from 'sonner';

const ITEMS = [
  { key: 'controlled_documents', label: '受控资料', description: '量产图纸、BOM、规格、检验/工艺文件已进入受控版本。' },
  { key: 'maintenance_scope', label: '维护边界', description: '产品维护责任、版本决策边界和升级路径已写清。' },
  { key: 'after_sales_process', label: '售后入口', description: '售后问题的登记、分流、响应人与证据保存方式已确认。' },
  { key: 'eco_process', label: 'ECO 入口', description: '量产变更必须基于当前 Revision 发起 ECO，禁止线下改版。' },
] as const;

type ItemKey = typeof ITEMS[number]['key'];
type ItemDraft = { itemKey: ItemKey; completed: boolean; evidenceReference: string | null };

const STATUS_LABELS: Record<string, string> = {
  missing: '未建立',
  draft: '编制中',
  pending_acceptance: '待维护责任人接收',
  accepted: '已接收',
};

export function CloseHandoffPanel({ projectId, canEdit = false, isAdmin = false }: { projectId: string; canEdit?: boolean; isAdmin?: boolean }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const detail = trpc.handoffs.detail.useQuery({ projectId });
  const readiness = trpc.handoffs.readiness.useQuery({ projectId });
  const members = trpc.members.list.useQuery({ projectId }, { staleTime: 60_000 });
  const [maintenanceOwnerUserId, setMaintenanceOwnerUserId] = useState<number | null>(null);
  const [afterSalesOwnerUserId, setAfterSalesOwnerUserId] = useState<number | null>(null);
  const [scopeSummary, setScopeSummary] = useState('');
  const [items, setItems] = useState<ItemDraft[]>(() => ITEMS.map((item) => ({ itemKey: item.key, completed: false, evidenceReference: null })));

  useEffect(() => {
    const bundle = detail.data;
    if (!bundle) return;
    setMaintenanceOwnerUserId(bundle.handoff.maintenanceOwnerUserId);
    setAfterSalesOwnerUserId(bundle.handoff.afterSalesOwnerUserId);
    setScopeSummary(bundle.handoff.scopeSummary);
    const byKey = new Map(bundle.items.map((item) => [item.itemKey, item]));
    setItems(ITEMS.map((item) => {
      const row = byKey.get(item.key);
      return { itemKey: item.key, completed: !!row?.completed, evidenceReference: row?.evidenceReference ?? null };
    }));
  }, [detail.data]);

  const refresh = async () => {
    await Promise.all([
      utils.handoffs.detail.invalidate({ projectId }),
      utils.handoffs.readiness.invalidate({ projectId }),
      utils.products.list.invalidate(),
      utils.workbench.mine.invalidate(),
    ]);
  };
  const save = trpc.handoffs.saveDraft.useMutation({
    onSuccess: async () => { toast.success('关闭移交单已保存'); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const submit = trpc.handoffs.submit.useMutation({
    onSuccess: async () => { toast.success('已提交给产品维护责任人接收'); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const accept = trpc.handoffs.accept.useMutation({
    onSuccess: async () => { toast.success('量产移交已接收，Close Gate 移交硬卡已满足'); await refresh(); },
    onError: (error) => toast.error(error.message),
  });

  const bundle = detail.data;
  const status = bundle?.handoff.status ?? 'missing';
  const editable = canEdit && status !== 'accepted';
  const canAccept = status === 'pending_acceptance' && (!!isAdmin || user?.id === bundle?.handoff.maintenanceOwnerUserId);
  const internalMembers = useMemo(() => (members.data ?? []).filter((member) => !['external_customer', 'supplier'].includes(member.role)), [members.data]);
  const nameById = useMemo(() => new Map((members.data ?? []).map((member) => [member.userId, member.userName || `用户 #${member.userId}`])), [members.data]);

  const updateItem = (itemKey: ItemKey, patch: Partial<ItemDraft>) => {
    setItems((current) => current.map((item) => item.itemKey === itemKey ? { ...item, ...patch } : item));
  };
  const saveDraft = () => {
    if (!maintenanceOwnerUserId || !afterSalesOwnerUserId) { toast.error('请选择产品维护和售后责任人'); return; }
    if (!scopeSummary.trim()) { toast.error('请填写量产维护边界'); return; }
    save.mutate({
      projectId,
      maintenanceOwnerUserId,
      afterSalesOwnerUserId,
      scopeSummary: scopeSummary.trim(),
      items: items.map((item) => ({ ...item, evidenceReference: item.evidenceReference?.trim() || null })),
    });
  };

  if (detail.isLoading || readiness.isLoading) {
    return <div className="flex items-center gap-2 rounded-[11px] border border-border bg-card p-4 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />加载关闭移交…</div>;
  }

  return (
    <div className="rounded-[11px] border border-border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 rounded-[7px] bg-[color:var(--acc-soft)] p-2 text-primary"><Handshake size={16} /></div>
          <div>
            <div className="text-sm font-semibold text-foreground">量产版本 → 产品维护正式移交</div>
            <div className="mt-0.5 text-xs text-muted-foreground">项目团队编制，产品维护责任人本人接收；接收后才能通过 Close Gate。</div>
          </div>
        </div>
        <span className={`rounded-[6px] px-2 py-1 text-[10px] font-semibold ${readiness.data?.ready ? 'bg-[color:var(--success-soft)] text-[color:var(--success)]' : 'bg-[color:var(--warning-soft)] text-[color:var(--warning)]'}`}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </div>

      {(readiness.data?.blockers.length ?? 0) > 0 && (
        <div className="rounded-[8px] border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] p-3 text-xs text-[color:var(--warning)]">
          <div className="font-semibold">Close Gate 尚缺</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">{readiness.data!.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">产品维护责任人</span>
          {editable ? (
            <select value={maintenanceOwnerUserId ?? ''} onChange={(event) => setMaintenanceOwnerUserId(event.target.value ? Number(event.target.value) : null)} className="w-full rounded-[7px] border border-border bg-secondary px-3 py-2 text-sm outline-none focus:border-primary">
              <option value="">请选择</option>
              {internalMembers.map((member) => <option key={member.userId} value={member.userId}>{member.userName || `用户 #${member.userId}`} · {member.role}</option>)}
            </select>
          ) : <div className="text-sm text-foreground">{maintenanceOwnerUserId ? nameById.get(maintenanceOwnerUserId) ?? `用户 #${maintenanceOwnerUserId}` : '—'}</div>}
        </label>
        <label className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">售后责任人</span>
          {editable ? (
            <select value={afterSalesOwnerUserId ?? ''} onChange={(event) => setAfterSalesOwnerUserId(event.target.value ? Number(event.target.value) : null)} className="w-full rounded-[7px] border border-border bg-secondary px-3 py-2 text-sm outline-none focus:border-primary">
              <option value="">请选择</option>
              {internalMembers.map((member) => <option key={member.userId} value={member.userId}>{member.userName || `用户 #${member.userId}`} · {member.role}</option>)}
            </select>
          ) : <div className="text-sm text-foreground">{afterSalesOwnerUserId ? nameById.get(afterSalesOwnerUserId) ?? `用户 #${afterSalesOwnerUserId}` : '—'}</div>}
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">量产维护边界</span>
        {editable ? (
          <textarea value={scopeSummary} onChange={(event) => setScopeSummary(event.target.value)} rows={3} placeholder="说明哪些事项转产品维护、谁决定版本变更、何时必须转 ECO…" className="w-full resize-none rounded-[7px] border border-border bg-secondary px-3 py-2 text-sm outline-none focus:border-primary" />
        ) : <p className="whitespace-pre-wrap text-sm text-foreground">{scopeSummary || '—'}</p>}
      </label>

      <div className="space-y-2">
        {ITEMS.map((definition) => {
          const item = items.find((row) => row.itemKey === definition.key)!;
          return (
            <div key={definition.key} className="rounded-[8px] border border-border p-3">
              <div className="flex items-start gap-2">
                <button type="button" disabled={!editable} onClick={() => updateItem(definition.key, { completed: !item.completed })} className="mt-0.5 shrink-0 disabled:cursor-default">
                  {item.completed ? <CheckCircle2 size={16} className="text-[color:var(--success)]" /> : <Circle size={16} className="text-muted-foreground" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{definition.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{definition.description}</div>
                  {editable ? (
                    <input value={item.evidenceReference ?? ''} onChange={(event) => updateItem(definition.key, { evidenceReference: event.target.value })} placeholder="受控文件号、台账路径或流程说明（必填）" className="mt-2 w-full rounded-[6px] border border-border bg-secondary px-2.5 py-1.5 text-xs outline-none focus:border-primary" />
                  ) : <div className="mt-2 text-xs text-[color:var(--secondary-foreground)]">证据：{item.evidenceReference || '—'}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        {editable && <button onClick={saveDraft} disabled={save.isPending} className="rounded-[7px] border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50">{save.isPending ? '保存中…' : '保存草稿'}</button>}
        {canEdit && status === 'draft' && <button onClick={() => submit.mutate({ projectId })} disabled={submit.isPending} className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"><Send size={13} />{submit.isPending ? '提交中…' : '提交接收'}</button>}
        {canAccept && <button onClick={() => accept.mutate({ projectId })} disabled={accept.isPending} className="inline-flex items-center gap-1.5 rounded-[7px] bg-[color:var(--success)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><ShieldCheck size={13} />{accept.isPending ? '接收中…' : '确认接收移交'}</button>}
      </div>
    </div>
  );
}
