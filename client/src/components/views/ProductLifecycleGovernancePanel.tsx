import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, GitCommit, Loader2, Power, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { isSystemAdminRole } from '@shared/system-roles';
import { toast } from 'sonner';

const EOL_ITEMS = [
  ['customer_notice', '客户停产通知'],
  ['last_time_buy', '末次采购（LTB）计划'],
  ['inventory_disposition', '库存/在制品处置'],
  ['supplier_shutdown', '供应商退出与工装处置'],
  ['service_spares_commitment', '售后备件与服务年限承诺'],
  ['certificate_records', '证书与合规档案留存'],
  ['replacement_strategy', '替代产品与迁移策略'],
] as const;
type EolItemKey = typeof EOL_ITEMS[number][0];

type GovernanceProduct = {
  id: string;
  name: string;
  productNumber: string;
  lifecycleState: string;
  currentRevisionId: number | null;
  createdBy: number;
  productManagerUserId: number | null;
  maintenanceOwnerUserId: number | null;
};

const softwareEmpty = () => ({ id: null as number | null, version: '', scopeSummary: '', releaseNotes: '', compatibilityNotes: '', regressionEvidenceReference: '', rolloutPlan: '', rollbackPlan: '', qaOwnerUserId: null as number | null, safetyRelated: false, bomOrManufacturingImpact: false });
const eolEmpty = () => ({ reason: '', lastOrderDate: '', lastShipDate: '', serviceEndDate: '', sparePartsYears: '5', inventoryDisposition: '', customerCommunicationPlan: '', supplierExitPlan: '', replacementProductId: '', ownerUserId: null as number | null, approverUserId: null as number | null });
const emptyEolItems = () => EOL_ITEMS.map(([itemKey]) => ({ itemKey, completed: false, evidenceReference: null as string | null }));

const SW_STATUS: Record<string, string> = { draft: '草稿', pending_validation: '待验证', validated: '验证通过', staged: '灰度中', released: '已发布', rolled_back: '已回滚', cancelled: '已取消' };
const EOL_STATUS: Record<string, string> = { missing: '未建立', draft: '草稿', pending_approval: '待审批', approved: '已批准/执行中', completed: '已停产', cancelled: '已取消' };

export function ProductLifecycleGovernancePanel({ product }: { product: GovernanceProduct }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const users = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const products = trpc.products.list.useQuery(undefined, { staleTime: 60_000 });
  const releases = trpc.productGovernance.softwareReleases.useQuery({ productId: product.id });
  const eolPlan = trpc.productGovernance.eolPlan.useQuery({ productId: product.id });
  const eolReadiness = trpc.productGovernance.eolReadiness.useQuery({ productId: product.id });
  const [software, setSoftware] = useState(softwareEmpty);
  const [eol, setEol] = useState(eolEmpty);
  const [eolItems, setEolItems] = useState(emptyEolItems);
  const userById = useMemo(() => new Map((users.data ?? []).map((item) => [item.id, item.name || item.username || `用户 #${item.id}`])), [users.data]);
  const isAdmin = isSystemAdminRole(user?.role);
  const canMaintain = !!user && (isAdmin || [product.createdBy, product.productManagerUserId, product.maintenanceOwnerUserId].includes(user.id));

  useEffect(() => {
    const bundle = eolPlan.data;
    if (!bundle) return;
    const p = bundle.plan;
    setEol({ reason: p.reason, lastOrderDate: p.lastOrderDate, lastShipDate: p.lastShipDate, serviceEndDate: p.serviceEndDate, sparePartsYears: String(p.sparePartsYears), inventoryDisposition: p.inventoryDisposition, customerCommunicationPlan: p.customerCommunicationPlan, supplierExitPlan: p.supplierExitPlan, replacementProductId: p.replacementProductId ?? '', ownerUserId: p.ownerUserId, approverUserId: p.approverUserId });
    const itemByKey = new Map(bundle.items.map((item) => [item.itemKey, item]));
    setEolItems(EOL_ITEMS.map(([itemKey]) => ({ itemKey, completed: !!itemByKey.get(itemKey)?.completed, evidenceReference: itemByKey.get(itemKey)?.evidenceReference ?? null })));
  }, [eolPlan.data]);

  const refreshSoftware = async () => { await Promise.all([utils.productGovernance.softwareReleases.invalidate({ productId: product.id }), utils.productGovernance.events.invalidate({ productId: product.id })]); };
  const refreshEol = async () => { await Promise.all([utils.productGovernance.eolPlan.invalidate({ productId: product.id }), utils.productGovernance.eolReadiness.invalidate({ productId: product.id }), utils.productGovernance.events.invalidate({ productId: product.id }), utils.products.list.invalidate()]); };
  const saveSoftware = trpc.productGovernance.saveSoftwareDraft.useMutation({ onSuccess: async () => { toast.success('软件发版草稿已保存'); setSoftware(softwareEmpty()); await refreshSoftware(); }, onError: (error) => toast.error(error.message) });
  const submitSoftware = trpc.productGovernance.submitSoftware.useMutation({ onSuccess: async () => { toast.success('已提交独立验证'); await refreshSoftware(); }, onError: (error) => toast.error(error.message) });
  const validateSoftware = trpc.productGovernance.validateSoftware.useMutation({ onSuccess: async () => { toast.success('回归验证已确认'); await refreshSoftware(); }, onError: (error) => toast.error(error.message) });
  const rolloutSoftware = trpc.productGovernance.rolloutSoftware.useMutation({ onSuccess: async () => { toast.success('灰度比例已推进'); await refreshSoftware(); }, onError: (error) => toast.error(error.message) });
  const rollbackSoftware = trpc.productGovernance.rollbackSoftware.useMutation({ onSuccess: async () => { toast.success('版本已记录回滚'); await refreshSoftware(); }, onError: (error) => toast.error(error.message) });
  const cancelSoftware = trpc.productGovernance.cancelSoftware.useMutation({ onSuccess: async () => { toast.success('发版单已取消'); await refreshSoftware(); }, onError: (error) => toast.error(error.message) });
  const saveEolDraft = trpc.productGovernance.saveEolDraft.useMutation({ onSuccess: async () => { toast.success('EOL 方案草稿已保存'); await refreshEol(); }, onError: (error) => toast.error(error.message) });
  const saveEolItems = trpc.productGovernance.saveEolItems.useMutation({ onSuccess: async () => { toast.success('EOL 执行清单已保存'); await refreshEol(); }, onError: (error) => toast.error(error.message) });
  const submitEol = trpc.productGovernance.submitEol.useMutation({ onSuccess: async () => { toast.success('EOL 方案已提交审批'); await refreshEol(); }, onError: (error) => toast.error(error.message) });
  const approveEol = trpc.productGovernance.approveEol.useMutation({ onSuccess: async () => { toast.success('EOL 方案已批准'); await refreshEol(); }, onError: (error) => toast.error(error.message) });
  const completeEol = trpc.productGovernance.completeEol.useMutation({ onSuccess: async () => { toast.success('产品已正式转入停产状态'); await refreshEol(); }, onError: (error) => toast.error(error.message) });
  const cancelEol = trpc.productGovernance.cancelEol.useMutation({ onSuccess: async () => { toast.success('EOL 方案已取消'); await refreshEol(); }, onError: (error) => toast.error(error.message) });

  const softwareRequiresEco = software.safetyRelated || software.bomOrManufacturingImpact;
  const submitSoftwareDraft = () => {
    const qaOwnerUserId = software.qaOwnerUserId;
    if (!qaOwnerUserId) { toast.error('请选择独立验证责任人'); return; }
    saveSoftware.mutate({ productId: product.id, ...software, qaOwnerUserId });
  };
  const editRelease = (row: NonNullable<typeof releases.data>[number]) => setSoftware({ id: row.id, version: row.version, scopeSummary: row.scopeSummary, releaseNotes: row.releaseNotes, compatibilityNotes: row.compatibilityNotes, regressionEvidenceReference: row.regressionEvidenceReference, rolloutPlan: row.rolloutPlan, rollbackPlan: row.rollbackPlan, qaOwnerUserId: row.qaOwnerUserId, safetyRelated: row.safetyRelated, bomOrManufacturingImpact: row.bomOrManufacturingImpact });
  const rollout = (id: number, current: number) => {
    const raw = window.prompt(`当前灰度 ${current}%，请输入新的灰度比例（必须提高，100=正式发布）`, current < 10 ? '10' : current < 50 ? '50' : '100');
    if (!raw) return;
    const percent = Number(raw);
    if (!Number.isInteger(percent)) { toast.error('灰度比例必须是整数'); return; }
    rolloutSoftware.mutate({ productId: product.id, id, rolloutPercent: percent });
  };

  const planStatus = eolPlan.data?.plan.status ?? 'missing';
  const eolCoreEditable = canMaintain && ['missing', 'draft', 'cancelled'].includes(planStatus) && product.lifecycleState !== 'eol';
  const eolChecklistEditable = planStatus === 'approved' && !!user && (canMaintain || eolPlan.data?.plan.ownerUserId === user.id);
  const canApproveEol = planStatus === 'pending_approval' && !!user && (isAdmin || eolPlan.data?.plan.approverUserId === user.id);
  const saveEol = () => {
    if (planStatus === 'approved') { saveEolItems.mutate({ productId: product.id, items: eolItems }); return; }
    if (!eol.ownerUserId || !eol.approverUserId) { toast.error('请选择 EOL 责任人与独立审批人'); return; }
    saveEolDraft.mutate({ productId: product.id, ...eol, sparePartsYears: Number(eol.sparePartsYears), replacementProductId: eol.replacementProductId || null, ownerUserId: eol.ownerUserId, approverUserId: eol.approverUserId, items: eolItems });
  };
  const updateEolItem = (itemKey: EolItemKey, patch: Partial<(typeof eolItems)[number]>) => setEolItems((rows) => rows.map((row) => row.itemKey === itemKey ? { ...row, ...patch } : row));

  return (
    <div className="space-y-7">
      <section className="space-y-4">
        <div className="flex items-start gap-2.5"><div className="rounded-[8px] bg-[color:var(--acc-soft)] p-2 text-primary"><GitCommit size={16} /></div><div><div className="text-sm font-semibold text-foreground">轻量软件 / OTA 发版</div><div className="text-xs text-muted-foreground">保留版本、回归、兼容、灰度和回滚证据；安全/BOM/产线影响自动升级到 ECO。</div></div></div>
        {canMaintain && product.lifecycleState !== 'eol' && (
          <div className="rounded-[10px] border border-border bg-secondary p-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input value={software.version} onChange={(e) => setSoftware({ ...software, version: e.target.value })} placeholder="版本号，如 FW 2.3.1" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
              <select value={software.qaOwnerUserId ?? ''} onChange={(e) => setSoftware({ ...software, qaOwnerUserId: e.target.value ? Number(e.target.value) : null })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm"><option value="">独立验证责任人</option>{(users.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name || item.username || `用户 #${item.id}`}</option>)}</select>
              <div className="flex flex-wrap items-center gap-3 text-xs"><label className="flex items-center gap-1.5"><input type="checkbox" checked={software.safetyRelated} onChange={(e) => setSoftware({ ...software, safetyRelated: e.target.checked })} />涉及安全保护</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={software.bomOrManufacturingImpact} onChange={(e) => setSoftware({ ...software, bomOrManufacturingImpact: e.target.checked })} />影响 BOM/烧录/产线</label></div>
              <textarea value={software.scopeSummary} onChange={(e) => setSoftware({ ...software, scopeSummary: e.target.value })} placeholder="变更范围" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
              <textarea value={software.releaseNotes} onChange={(e) => setSoftware({ ...software, releaseNotes: e.target.value })} placeholder="发布说明" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
              <textarea value={software.compatibilityNotes} onChange={(e) => setSoftware({ ...software, compatibilityNotes: e.target.value })} placeholder="兼容范围/设备批次" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
              <textarea value={software.regressionEvidenceReference} onChange={(e) => setSoftware({ ...software, regressionEvidenceReference: e.target.value })} placeholder="回归测试证据引用" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
              <textarea value={software.rolloutPlan} onChange={(e) => setSoftware({ ...software, rolloutPlan: e.target.value })} placeholder="灰度计划与观测指标" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
              <textarea value={software.rollbackPlan} onChange={(e) => setSoftware({ ...software, rollbackPlan: e.target.value })} placeholder="回滚触发条件与步骤" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
            </div>
            {softwareRequiresEco && <div className="rounded-[7px] border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] p-2 text-xs text-[color:var(--warning)]">该变更超出轻量发版边界，必须到“量产维护 · 售后 / ECO”中发起 ECO。</div>}
            <div className="flex justify-end gap-2">{software.id && <button onClick={() => setSoftware(softwareEmpty())} className="rounded-[7px] border border-border px-3 py-2 text-xs">取消编辑</button>}<button disabled={softwareRequiresEco || saveSoftware.isPending} onClick={submitSoftwareDraft} className="rounded-[7px] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{software.id ? '保存草稿更新' : '建立发版草稿'}</button></div>
          </div>
        )}
        <div className="space-y-2">{(releases.data ?? []).map((row) => (
          <div key={row.id} className="rounded-[9px] border border-border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold text-foreground">{row.version}<span className="ml-2 text-[10px] text-muted-foreground">{row.releaseNumber} · {SW_STATUS[row.status]}</span></div><div className="mt-1 text-xs text-muted-foreground">基线 Revision #{row.baseRevisionId} · 验证人 {userById.get(row.qaOwnerUserId) ?? `#${row.qaOwnerUserId}`} · 灰度 {row.rolloutPercent}%</div><p className="mt-2 text-xs text-[color:var(--secondary-foreground)]">{row.scopeSummary}</p></div><div className="flex flex-wrap gap-2">{row.status === 'draft' && canMaintain && <><button onClick={() => editRelease(row)} className="rounded-[6px] border border-border px-2 py-1 text-xs">编辑</button><button onClick={() => submitSoftware.mutate({ productId: product.id, id: row.id })} className="rounded-[6px] bg-primary px-2 py-1 text-xs text-primary-foreground">提交验证</button></>}{row.status === 'pending_validation' && user && (isAdmin || row.qaOwnerUserId === user.id) && <button onClick={() => validateSoftware.mutate({ productId: product.id, id: row.id })} className="rounded-[6px] bg-[color:var(--success)] px-2 py-1 text-xs text-white">确认验证通过</button>}{['validated', 'staged'].includes(row.status) && canMaintain && <button onClick={() => rollout(row.id, row.rolloutPercent)} className="rounded-[6px] bg-primary px-2 py-1 text-xs text-primary-foreground">推进灰度</button>}{['staged', 'released'].includes(row.status) && canMaintain && <button onClick={() => { const reason = window.prompt('请输入回滚原因'); if (reason?.trim()) rollbackSoftware.mutate({ productId: product.id, id: row.id, reason: reason.trim() }); }} className="inline-flex items-center gap-1 rounded-[6px] border border-[color:var(--destructive)]/30 px-2 py-1 text-xs text-[color:var(--destructive)]"><RotateCcw size={11} />回滚</button>}{['draft', 'pending_validation', 'validated'].includes(row.status) && canMaintain && <button onClick={() => { const reason = window.prompt('请输入取消原因'); if (reason?.trim()) cancelSoftware.mutate({ productId: product.id, id: row.id, reason: reason.trim() }); }} className="rounded-[6px] border border-border px-2 py-1 text-xs text-muted-foreground">取消</button>}</div></div>
          </div>
        ))}{!releases.isLoading && (releases.data ?? []).length === 0 && <div className="rounded-[8px] border border-dashed border-border p-4 text-center text-xs text-muted-foreground">暂无软件发版记录</div>}</div>
      </section>

      <section className="space-y-4 border-t border-border pt-6">
        <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2.5"><div className="rounded-[8px] bg-[color:var(--warning-soft)] p-2 text-[color:var(--warning)]"><Power size={16} /></div><div><div className="text-sm font-semibold text-foreground">产品停产（EOL）</div><div className="text-xs text-muted-foreground">停产通知、末次采购、库存处置、供应商退出与售后备件承诺。</div></div></div><span className="rounded-[6px] bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">{EOL_STATUS[planStatus] ?? planStatus}</span></div>
        {(eolReadiness.data?.blockers.length ?? 0) > 0 && planStatus !== 'missing' && <div className="rounded-[8px] border border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] p-3 text-xs text-[color:var(--warning)]"><div className="font-semibold">尚不能完成停产</div><ul className="mt-1 list-disc space-y-1 pl-4">{eolReadiness.data!.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        {(eolCoreEditable || eolPlan.data) && (
          <div className="rounded-[10px] border border-border bg-secondary p-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <textarea disabled={!eolCoreEditable} value={eol.reason} onChange={(event) => setEol({ ...eol, reason: event.target.value })} placeholder="停产原因" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm disabled:opacity-70" />
              <textarea disabled={!eolCoreEditable} value={eol.inventoryDisposition} onChange={(event) => setEol({ ...eol, inventoryDisposition: event.target.value })} placeholder="库存/在制品处置方案" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm disabled:opacity-70" />
              <textarea disabled={!eolCoreEditable} value={eol.customerCommunicationPlan} onChange={(event) => setEol({ ...eol, customerCommunicationPlan: event.target.value })} placeholder="客户通知方案" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm disabled:opacity-70" />
              <textarea disabled={!eolCoreEditable} value={eol.supplierExitPlan} onChange={(event) => setEol({ ...eol, supplierExitPlan: event.target.value })} placeholder="供应商退出与工装处置" rows={2} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm disabled:opacity-70" />
              <label className="text-xs text-muted-foreground">末次下单<input disabled={!eolCoreEditable} type="date" value={eol.lastOrderDate} onChange={(event) => setEol({ ...eol, lastOrderDate: event.target.value })} className="mt-1 w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm text-foreground" /></label>
              <label className="text-xs text-muted-foreground">末次出货<input disabled={!eolCoreEditable} type="date" value={eol.lastShipDate} onChange={(event) => setEol({ ...eol, lastShipDate: event.target.value })} className="mt-1 w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm text-foreground" /></label>
              <label className="text-xs text-muted-foreground">服务终止<input disabled={!eolCoreEditable} type="date" value={eol.serviceEndDate} onChange={(event) => setEol({ ...eol, serviceEndDate: event.target.value })} className="mt-1 w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm text-foreground" /></label>
              <label className="text-xs text-muted-foreground">备件承诺年限<input disabled={!eolCoreEditable} type="number" min="0" max="20" value={eol.sparePartsYears} onChange={(event) => setEol({ ...eol, sparePartsYears: event.target.value })} className="mt-1 w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm text-foreground" /></label>
              <select disabled={!eolCoreEditable} value={eol.replacementProductId} onChange={(event) => setEol({ ...eol, replacementProductId: event.target.value })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm"><option value="">无替代产品</option>{(products.data ?? []).filter((item) => item.id !== product.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              <select disabled={!eolCoreEditable} value={eol.ownerUserId ?? ''} onChange={(event) => setEol({ ...eol, ownerUserId: event.target.value ? Number(event.target.value) : null })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm"><option value="">EOL 责任人</option>{(users.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name || item.username || `用户 #${item.id}`}</option>)}</select>
              <select disabled={!eolCoreEditable} value={eol.approverUserId ?? ''} onChange={(event) => setEol({ ...eol, approverUserId: event.target.value ? Number(event.target.value) : null })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm"><option value="">独立审批人</option>{(users.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name || item.username || `用户 #${item.id}`}</option>)}</select>
            </div>
            <div className="space-y-2">{EOL_ITEMS.map(([itemKey, label]) => { const item = eolItems.find((row) => row.itemKey === itemKey)!; const editable = eolCoreEditable || eolChecklistEditable; return <div key={itemKey} className="flex items-start gap-2 rounded-[8px] border border-border bg-card p-3"><button disabled={!editable} onClick={() => updateEolItem(itemKey, { completed: !item.completed })} className="mt-0.5">{item.completed ? <CheckCircle2 size={16} className="text-[color:var(--success)]" /> : <Circle size={16} className="text-muted-foreground" />}</button><div className="flex-1"><div className="text-sm font-medium text-foreground">{label}</div>{editable ? <input value={item.evidenceReference ?? ''} onChange={(event) => updateEolItem(itemKey, { evidenceReference: event.target.value })} placeholder="受控证据引用" className="mt-2 w-full rounded-[6px] border border-border bg-secondary px-2.5 py-1.5 text-xs" /> : <div className="mt-1 text-xs text-muted-foreground">证据：{item.evidenceReference || '—'}</div>}</div></div>; })}</div>
            <div className="flex flex-wrap justify-end gap-2">{(eolCoreEditable || eolChecklistEditable) && <button onClick={saveEol} disabled={saveEolDraft.isPending || saveEolItems.isPending} className="rounded-[7px] border border-border px-3 py-2 text-xs">{planStatus === 'approved' ? '保存执行清单' : '保存 EOL 草稿'}</button>}{planStatus === 'draft' && canMaintain && <button onClick={() => submitEol.mutate({ productId: product.id })} className="inline-flex items-center gap-1 rounded-[7px] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"><Send size={12} />提交审批</button>}{canApproveEol && <button onClick={() => approveEol.mutate({ productId: product.id })} className="inline-flex items-center gap-1 rounded-[7px] bg-[color:var(--success)] px-3 py-2 text-xs font-semibold text-white"><ShieldCheck size={12} />批准方案</button>}{planStatus === 'approved' && eolReadiness.data?.ready && (canMaintain || eolPlan.data?.plan.ownerUserId === user?.id) && <button onClick={() => completeEol.mutate({ productId: product.id })} className="inline-flex items-center gap-1 rounded-[7px] bg-[color:var(--destructive)] px-3 py-2 text-xs font-semibold text-white"><Power size={12} />确认正式停产</button>}{['draft', 'pending_approval', 'approved'].includes(planStatus) && canMaintain && <button onClick={() => { const reason = window.prompt('请输入取消 EOL 方案的原因'); if (reason?.trim()) cancelEol.mutate({ productId: product.id, reason: reason.trim() }); }} className="rounded-[7px] border border-border px-3 py-2 text-xs text-muted-foreground">取消方案</button>}</div>
          </div>
        )}
        {planStatus === 'missing' && !canMaintain && <div className="rounded-[8px] border border-dashed border-border p-4 text-center text-xs text-muted-foreground">尚未建立 EOL 方案</div>}
      </section>
      {(releases.isLoading || eolPlan.isLoading) && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />加载产品治理记录…</div>}
    </div>
  );
}
