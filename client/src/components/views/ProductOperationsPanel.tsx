import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitBranch, Headphones, Loader2, Plus } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

const SCOPE_FIELDS = [
  ['batteryCellChange', '电芯变化'],
  ['batteryPackOrBmsChange', '电池包 / BMS / 保护板变化'],
  ['protectionParameterChange', '保护参数变化'],
  ['powerOrThermalBoundaryChange', '功率 / 温升边界变化'],
  ['pressurizedStructureChange', '受压结构变化'],
  ['targetMarketExpansion', '新增目标市场'],
  ['criticalSafetySupplierChange', '安全件供应商 / 二供变化'],
  ['safetyRelatedSoftwareChange', '安全相关软件变化'],
  ['eolTestChange', 'EOL 测试变化'],
  ['otherSafetyOrRegulatoryChange', '其他安全或法规变化'],
] as const;

type ScopeKey = typeof SCOPE_FIELDS[number][0];

type OperationsProduct = {
  id: string;
  name: string;
  productNumber: string;
  targetMarkets: string[] | null;
  currentRevisionId: number | null;
  maintenanceOwnerUserId: number | null;
  afterSalesOwnerUserId: number | null;
};

export function ProductOperationsPanel({ product }: { product: OperationsProduct }) {
  const utils = trpc.useUtils();
  const users = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const cases = trpc.handoffs.serviceCases.useQuery({ productId: product.id });
  const [caseTitle, setCaseTitle] = useState('');
  const [caseDescription, setCaseDescription] = useState('');
  const [caseSeverity, setCaseSeverity] = useState<'P0' | 'P1' | 'P2' | 'P3'>('P2');
  const [ecoName, setEcoName] = useState('');
  const [ecoReason, setEcoReason] = useState('');
  const [serviceCaseId, setServiceCaseId] = useState<number | null>(null);
  const [scope, setScope] = useState<Record<ScopeKey, boolean>>(() => Object.fromEntries(SCOPE_FIELDS.map(([key]) => [key, false])) as Record<ScopeKey, boolean>);
  const nameById = useMemo(() => new Map((users.data ?? []).map((user) => [user.id, user.name || user.username || `用户 #${user.id}`])), [users.data]);

  const createCase = trpc.handoffs.createServiceCase.useMutation({
    onSuccess: async () => {
      setCaseTitle(''); setCaseDescription(''); setCaseSeverity('P2');
      toast.success('售后问题已登记并分派');
      await utils.handoffs.serviceCases.invalidate({ productId: product.id });
    },
    onError: (error) => toast.error(error.message),
  });
  const updateCase = trpc.handoffs.updateServiceCase.useMutation({
    onSuccess: async () => { await utils.handoffs.serviceCases.invalidate({ productId: product.id }); },
    onError: (error) => toast.error(error.message),
  });
  const createEco = trpc.handoffs.createEco.useMutation({
    onSuccess: async ({ id }) => {
      toast.success('ECO 项目已基于当前量产版本建立');
      setEcoName(''); setEcoReason(''); setServiceCaseId(null);
      setScope(Object.fromEntries(SCOPE_FIELDS.map(([key]) => [key, false])) as Record<ScopeKey, boolean>);
      await Promise.all([
        utils.handoffs.serviceCases.invalidate({ productId: product.id }),
        utils.projects.list.invalidate(),
      ]);
      window.history.pushState({}, '', `/?view=projects&projectId=${encodeURIComponent(id)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    onError: (error) => toast.error(error.message),
  });

  const submitCase = () => {
    if (!caseTitle.trim() || !caseDescription.trim()) { toast.error('请填写售后问题标题和描述'); return; }
    createCase.mutate({ productId: product.id, title: caseTitle.trim(), description: caseDescription.trim(), severity: caseSeverity });
  };
  const submitEco = () => {
    if (!ecoName.trim() || !ecoReason.trim()) { toast.error('请填写 ECO 名称和变更原因'); return; }
    createEco.mutate({
      productId: product.id,
      serviceCaseId,
      name: ecoName.trim(),
      reason: ecoReason.trim(),
      changeScopeDeclaration: {
        ...scope,
        targetMarkets: product.targetMarkets ?? [],
        notes: ecoReason.trim(),
      },
    });
  };

  const ownersReady = !!product.maintenanceOwnerUserId && !!product.afterSalesOwnerUserId;
  return (
    <div className="space-y-5">
      <div className={`rounded-[8px] border p-3 text-xs ${ownersReady ? 'border-[color:var(--success)]/30 bg-[color:var(--success-soft)] text-[color:var(--success)]' : 'border-[color:var(--warning)]/30 bg-[color:var(--warning-soft)] text-[color:var(--warning)]'}`}>
        <div className="flex items-center gap-2 font-semibold">{ownersReady ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{ownersReady ? '产品维护责任已接收' : '尚未完成项目关闭移交'}</div>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          <span>维护责任人：{product.maintenanceOwnerUserId ? nameById.get(product.maintenanceOwnerUserId) ?? `用户 #${product.maintenanceOwnerUserId}` : '未配置'}</span>
          <span>售后责任人：{product.afterSalesOwnerUserId ? nameById.get(product.afterSalesOwnerUserId) ?? `用户 #${product.afterSalesOwnerUserId}` : '未配置'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[9px] border border-border bg-secondary p-4 space-y-3">
          <div className="flex items-center gap-2"><Headphones size={15} className="text-primary" /><span className="text-sm font-semibold text-foreground">售后问题入口</span></div>
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <input value={caseTitle} onChange={(event) => setCaseTitle(event.target.value)} placeholder="问题标题" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary" />
            <select value={caseSeverity} onChange={(event) => setCaseSeverity(event.target.value as typeof caseSeverity)} className="rounded-[7px] border border-border bg-card px-2 py-2 text-sm outline-none focus:border-primary">
              {(['P0', 'P1', 'P2', 'P3'] as const).map((severity) => <option key={severity} value={severity}>{severity}</option>)}
            </select>
          </div>
          <textarea value={caseDescription} onChange={(event) => setCaseDescription(event.target.value)} rows={3} placeholder="现象、批次/序列号、客户影响和已有证据…" className="w-full resize-none rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary" />
          <button disabled={!ownersReady || createCase.isPending} onClick={submitCase} className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{createCase.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}登记并分派</button>
        </div>

        <div className="rounded-[9px] border border-border bg-secondary p-4 space-y-3">
          <div className="flex items-center gap-2"><GitBranch size={15} className="text-primary" /><span className="text-sm font-semibold text-foreground">ECO 入口</span></div>
          <input value={ecoName} onChange={(event) => setEcoName(event.target.value)} placeholder="ECO 项目名称" className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary" />
          <textarea value={ecoReason} onChange={(event) => setEcoReason(event.target.value)} rows={2} placeholder="变更原因和预期结果…" className="w-full resize-none rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary" />
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {SCOPE_FIELDS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-[color:var(--secondary-foreground)]">
                <input type="checkbox" checked={scope[key]} onChange={(event) => setScope((current) => ({ ...current, [key]: event.target.checked }))} />{label}
              </label>
            ))}
          </div>
          {serviceCaseId && <div className="text-xs text-primary">将关联售后记录 #{serviceCaseId}</div>}
          <button disabled={!ownersReady || !product.currentRevisionId || createEco.isPending} onClick={submitEco} className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{createEco.isPending ? <Loader2 size={13} className="animate-spin" /> : <GitBranch size={13} />}基于当前 Revision 发起 ECO</button>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">售后记录</div>
        {cases.isLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />加载中…</div> : (cases.data ?? []).length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-border p-4 text-center text-xs text-muted-foreground">暂无售后记录</div>
        ) : (
          <div className="space-y-2">{(cases.data ?? []).map((item) => (
            <div key={item.id} className="rounded-[8px] border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-foreground"><span className="mr-2 text-xs text-muted-foreground">{item.caseNumber}</span>{item.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.severity} · 负责人 {nameById.get(item.ownerUserId) ?? `#${item.ownerUserId}`}{item.linkedEcoProjectId ? ` · ECO ${item.linkedEcoProjectId}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <select value={item.status} onChange={(event) => updateCase.mutate({ productId: product.id, id: item.id, status: event.target.value as 'open' | 'in_progress' | 'resolved' | 'closed' })} className="rounded-[6px] border border-border bg-secondary px-2 py-1 text-xs">
                    <option value="open">待处理</option><option value="in_progress">处理中</option><option value="resolved">已解决</option><option value="closed">已关闭</option>
                  </select>
                  {!item.linkedEcoProjectId && <button onClick={() => { setServiceCaseId(item.id); setEcoName(`${product.productNumber || product.name} · ${item.title}`); setEcoReason(`来源售后 ${item.caseNumber}：${item.description}`); }} className="rounded-[6px] border border-border px-2 py-1 text-xs text-primary hover:bg-[color:var(--acc-soft)]">转 ECO</button>}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs text-[color:var(--secondary-foreground)]">{item.description}</p>
            </div>
          ))}</div>
        )}
      </div>
    </div>
  );
}
