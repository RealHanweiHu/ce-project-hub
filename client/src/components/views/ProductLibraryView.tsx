// Product Library view — 产品库（PLM 轴入口）
// 列出所有产品（按品类分组），支持新建产品。
import { useEffect, useMemo, useState } from 'react';
import {
  Package, Plus, Loader2, Cpu, Boxes, CheckCircle2, ShieldCheck, Save,
  AlertTriangle, History, PlusCircle, FileText, Trash2,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

type ProductRow = {
  id: string;
  productNumber: string;
  name: string;
  type: string;
  category: string;
  platformId: string | null;
  targetMarkets: string[] | null;
  lifecycleState: string;
};

type DefinitionStatus = {
  productId: string;
  status: 'draft' | 'confirmed';
  confirmedAt: string | Date | null;
};

type ProductDefinition = {
  id: number;
  productId: string;
  title: string;
  opportunityName: string;
  opportunitySource: string;
  targetCustomers: string | null;
  targetMarkets: string[];
  applicationScenarios: string | null;
  competitors: Array<{ brand?: string; model?: string; price?: string; channel?: string; strengths?: string; weaknesses?: string; notes?: string }>;
  priceBand: string;
  positioning: string | null;
  sellingPoints: string[];
  differentiationStrategy: string | null;
  prdSummary: string | null;
  specs: Array<{ key: string; label: string; target: string; tolerance?: string; verification?: string; ownerRole?: string }>;
  targetCost: string;
  targetPrice: string;
  targetGrossMargin: string;
  skuPlan: Array<{ name: string; code?: string; targetMarket?: string; price?: string; differences?: string; customerName?: string }>;
  status: 'draft' | 'confirmed';
  confirmedAt: string | Date | null;
};

type CompetitorDraft = { brand: string; model: string; price: string; channel: string; notes: string };
type SpecDraft = { label: string; target: string; tolerance: string; verification: string; ownerRole: string };
type SkuDraft = { name: string; code: string; targetMarket: string; price: string; differences: string };

type ProductDefinitionForm = {
  title: string;
  opportunityName: string;
  opportunitySource: string;
  targetCustomers: string;
  targetMarkets: string;
  applicationScenarios: string;
  competitors: CompetitorDraft[];
  priceBand: string;
  positioning: string;
  sellingPoints: string;
  differentiationStrategy: string;
  prdSummary: string;
  specs: SpecDraft[];
  targetCost: string;
  targetPrice: string;
  targetGrossMargin: string;
  skuPlan: SkuDraft[];
};

type ProductDefinitionSnapshot = {
  id: number;
  productId: string;
  versionNumber: number;
  title: string;
  snapshot: {
    prdSummary?: string | null;
    specs?: Array<{ label: string; target: string; tolerance?: string; verification?: string; ownerRole?: string }>;
    competitors?: Array<{ brand?: string; model?: string; price?: string; channel?: string; notes?: string }>;
    skuPlan?: Array<{ name: string; code?: string; targetMarket?: string; price?: string; differences?: string }>;
    targetCost?: string;
    targetPrice?: string;
    targetGrossMargin?: string;
  };
  confirmedBy: number;
  confirmedAt: string | Date;
  createdAt: string | Date;
};

type ProductDefinitionChangeStatus = 'proposed' | 'approved' | 'rejected' | 'implemented' | 'cancelled';
type ProductDefinitionChangeArea =
  | 'market'
  | 'customer'
  | 'scenario'
  | 'competitor'
  | 'positioning'
  | 'selling_point'
  | 'spec'
  | 'cost'
  | 'price'
  | 'margin'
  | 'sku'
  | 'certification'
  | 'packaging'
  | 'schedule'
  | 'other';

type ProductDefinitionChange = {
  id: number;
  productId: string;
  sourceProjectId: string | null;
  area: ProductDefinitionChangeArea;
  title: string;
  description: string | null;
  reason: string | null;
  requestedByCustomer: string | null;
  baselineValue: string | null;
  requestedValue: string | null;
  impactScope: string[];
  costImpact: string | null;
  priceImpact: string | null;
  scheduleImpact: string | null;
  status: ProductDefinitionChangeStatus;
  decisionNotes: string | null;
  createdAt: string | Date;
};

type ProductDefinitionDeviation = {
  baselineStatus: 'draft' | 'confirmed' | 'missing';
  confirmedAt: string | Date | null;
  deviated: boolean;
  approvedDeviationCount: number;
  pendingChangeCount: number;
  items: ProductDefinitionChange[];
};

type CustomerVariant = {
  id: number;
  variantCode: string;
  customerSku: string | null;
  parentProductId: string;
  baseRevision: string;
  customerId: string;
  customerName: string;
  status: 'draft' | 'active' | 'on_hold' | 'eol' | string;
  deltas: Array<{ dimension: string; baseValue?: string; variantValue: string; note?: string }>;
  customerApproved: boolean;
  approvedDate: string | null;
  introducedAt: string | null;
};

type VariantForm = {
  variantCode: string;
  baseRevision: string;
  customerName: string;
  customerSku: string;
  differences: string;
  status: 'draft' | 'active' | 'on_hold' | 'eol';
};

const LIFECYCLE_LABELS: Record<string, string> = {
  concept: '概念',
  development: '开发中',
  mass_production: '量产',
  maintenance: '维护',
  eol: '停产',
};

const CHANGE_AREA_LABELS: Record<ProductDefinitionChangeArea, string> = {
  market: '目标市场',
  customer: '目标客户',
  scenario: '应用场景',
  competitor: '竞品',
  positioning: '定位',
  selling_point: '卖点',
  spec: '规格',
  cost: '成本',
  price: '售价',
  margin: '毛利',
  sku: 'SKU',
  certification: '认证',
  packaging: '包装',
  schedule: '进度',
  other: '其他',
};

const CHANGE_STATUS_LABELS: Record<ProductDefinitionChangeStatus, string> = {
  proposed: '提议中',
  approved: '已批准',
  rejected: '已拒绝',
  implemented: '已实施',
  cancelled: '已取消',
};

const emptyChangeForm = {
  area: 'spec' as ProductDefinitionChangeArea,
  title: '',
  sourceProjectId: '',
  requestedByCustomer: '',
  baselineValue: '',
  requestedValue: '',
  reason: '',
  costImpact: '',
  priceImpact: '',
  scheduleImpact: '',
  impactScope: '',
};

const emptyVariantForm = (): VariantForm => ({
  variantCode: '',
  baseRevision: '',
  customerName: '',
  customerSku: '',
  differences: '',
  status: 'draft',
});

const emptyCompetitor = (): CompetitorDraft => ({ brand: '', model: '', price: '', channel: '', notes: '' });
const emptySpec = (): SpecDraft => ({ label: '', target: '', tolerance: '', verification: '', ownerRole: '' });
const emptySku = (): SkuDraft => ({ name: '', code: '', targetMarket: '', price: '', differences: '' });

const emptyDefinitionForm: ProductDefinitionForm = {
  title: '',
  opportunityName: '',
  opportunitySource: '',
  targetCustomers: '',
  targetMarkets: '',
  applicationScenarios: '',
  competitors: [],
  priceBand: '',
  positioning: '',
  sellingPoints: '',
  differentiationStrategy: '',
  prdSummary: '',
  specs: [],
  targetCost: '',
  targetPrice: '',
  targetGrossMargin: '',
  skuPlan: [],
};

function splitList(value: string) {
  return value.split(/[,，\n]+/).map((item) => item.trim()).filter(Boolean);
}

function customerIdFromName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "");
}

function definitionToForm(definition: ProductDefinition | null | undefined, product: ProductRow) {
  if (!definition) {
    return {
      ...emptyDefinitionForm,
      title: `${product.name} 产品定义`,
      targetMarkets: (product.targetMarkets ?? []).join(', '),
    };
  }
  return {
    title: definition.title ?? '',
    opportunityName: definition.opportunityName ?? '',
    opportunitySource: definition.opportunitySource ?? '',
    targetCustomers: definition.targetCustomers ?? '',
    targetMarkets: (definition.targetMarkets ?? []).join(', '),
    applicationScenarios: definition.applicationScenarios ?? '',
    competitors: (definition.competitors ?? []).map((row) => ({
      brand: row.brand ?? '',
      model: row.model ?? '',
      price: row.price ?? '',
      channel: row.channel ?? '',
      notes: row.notes ?? '',
    })),
    priceBand: definition.priceBand ?? '',
    positioning: definition.positioning ?? '',
    sellingPoints: (definition.sellingPoints ?? []).join('\n'),
    differentiationStrategy: definition.differentiationStrategy ?? '',
    prdSummary: definition.prdSummary ?? '',
    specs: (definition.specs ?? []).map((row) => ({
      label: row.label ?? '',
      target: row.target ?? '',
      tolerance: row.tolerance ?? '',
      verification: row.verification ?? '',
      ownerRole: row.ownerRole ?? '',
    })),
    targetCost: definition.targetCost ?? '',
    targetPrice: definition.targetPrice ?? '',
    targetGrossMargin: definition.targetGrossMargin ?? '',
    skuPlan: (definition.skuPlan ?? []).map((row) => ({
      name: row.name ?? '',
      code: row.code ?? '',
      targetMarket: row.targetMarket ?? '',
      price: row.price ?? '',
      differences: row.differences ?? '',
    })),
  };
}

export function ProductLibraryView() {
  const utils = trpc.useUtils();
  const { data: products = [], isLoading } = trpc.products.list.useQuery();
  const { data: definitionStatuses = [] } = trpc.products.definitionStatuses.useQuery();
  const createMutation = trpc.products.create.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
      toast.success('产品已创建');
      setOpen(false);
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [revProduct, setRevProduct] = useState<ProductRow | null>(null);
  const [name, setName] = useState('');
  const [productNumber, setProductNumber] = useState('');
  const [type, setType] = useState<'finished' | 'component'>('finished');
  const [category, setCategory] = useState('');
  const [markets, setMarkets] = useState('');

  const definitionStatusByProduct = useMemo(() => {
    const map = new Map<string, DefinitionStatus>();
    for (const status of definitionStatuses as DefinitionStatus[]) map.set(status.productId, status);
    return map;
  }, [definitionStatuses]);

  const resetForm = () => {
    setName(''); setProductNumber(''); setType('finished'); setCategory(''); setMarkets('');
  };

  // 按品类分组
  const grouped = useMemo(() => {
    const map = new Map<string, ProductRow[]>();
    for (const p of products as ProductRow[]) {
      const key = p.category || '未分类';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries());
  }, [products]);

  const handleCreate = () => {
    if (!name.trim()) { toast.error('请输入产品名称'); return; }
    createMutation.mutate({
      name: name.trim(),
      productNumber: productNumber.trim(),
      type,
      category: category.trim(),
      targetMarkets: markets.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
    });
  };

  return (
    <div className="ce-page">
      {/* Header */}
      <div className="ce-page-header">
        <div>
          <h2 className="font-serif text-2xl text-stone-900">产品库</h2>
          <p className="ce-kicker mt-1">
            {products.length} PRODUCT MODELS · REVISION SPINE
          </p>
        </div>
        <Button
          onClick={() => setOpen(true)}
          className="bg-stone-900 hover:bg-stone-800 text-stone-50 gap-2"
        >
          <Plus size={16} /> 新建产品
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={22} className="animate-spin text-amber-500" />
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-stone-400 gap-2">
          <Package size={28} />
          <p className="text-sm">还没有产品型号。点「新建产品」建立 DG01 这类型号主数据。</p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([cat, rows]) => (
            <div key={cat}>
              <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-3 flex items-center gap-2">
                <Boxes size={12} /> {cat} · {rows.length}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {rows.map((p) => (
                  <div key={p.id} onClick={() => setRevProduct(p)} className="ce-card cursor-pointer p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono text-stone-400">{p.productNumber ? `型号 ${p.productNumber}` : '未填型号'}</span>
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 ${
                          definitionStatusByProduct.get(p.id)?.status === 'confirmed'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-stone-100 text-stone-500'
                        }`}>
                          {definitionStatusByProduct.get(p.id)?.status === 'confirmed' ? '定义已确认' : '定义草稿'}
                        </span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 ${
                          p.type === 'component' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {p.type === 'component' ? '零部件' : '整机'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      {p.type === 'component' ? <Cpu size={14} className="text-stone-400" /> : <Package size={14} className="text-stone-400" />}
                      <h3 className="font-medium text-stone-900 text-sm truncate">{p.name}</h3>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                        {LIFECYCLE_LABELS[p.lifecycleState] || p.lifecycleState}
                      </span>
                      <div className="flex gap-1">
                        {(p.targetMarkets || []).slice(0, 4).map((m) => (
                          <span key={m} className="text-[9px] font-mono px-1 py-0.5 bg-stone-100 text-stone-500">{m}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Revision timeline dialog */}
      {revProduct && (
        <RevisionsDialog product={revProduct} onClose={() => setRevProduct(null)} />
      )}

      {/* New product dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif flex items-center gap-2">
              <Package size={16} className="text-amber-500" /> 新建产品型号
            </DialogTitle>
            <DialogDescription className="sr-only">
              建立产品型号主数据。项目立项不要求先创建产品型号。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-700">产品名称 <span className="text-rose-500">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：高端车载泵 DG01" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm text-stone-700">产品型号</Label>
                <Input value={productNumber} onChange={(e) => setProductNumber(e.target.value)} placeholder="DG01" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-stone-700">类型</Label>
                <div className="flex border border-stone-300">
                  <button
                    type="button"
                    onClick={() => setType('finished')}
                    className={`flex-1 py-2 text-xs ${type === 'finished' ? 'bg-stone-900 text-stone-50' : 'text-stone-500'}`}
                  >整机</button>
                  <button
                    type="button"
                    onClick={() => setType('component')}
                    className={`flex-1 py-2 text-xs ${type === 'component' ? 'bg-stone-900 text-stone-50' : 'text-stone-500'}`}
                  >零部件</button>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-700">品类</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="充气泵 / 风扇 …" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-700">目标市场</Label>
              <Input value={markets} onChange={(e) => setMarkets(e.target.value)} placeholder="EU, US, JP（逗号分隔）" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-stone-900"
              disabled={createMutation.isPending}
              onClick={handleCreate}
            >
              {createMutation.isPending ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 版本时间线弹窗
function RevisionsDialog({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: definition, isLoading: definitionLoading } = trpc.products.definition.useQuery({ productId: product.id });
  const { data: definitionSnapshots = [], isLoading: snapshotsLoading } = trpc.products.definitionSnapshots.useQuery({ productId: product.id });
  const { data: definitionChanges = [], isLoading: changesLoading } = trpc.products.definitionChanges.useQuery({ productId: product.id });
  const { data: deviation } = trpc.products.definitionDeviation.useQuery({ productId: product.id });
  const { data: revisions = [], isLoading } = trpc.products.revisions.useQuery({ productId: product.id });
  const { data: variants = [], isLoading: variantsLoading } = trpc.products.variantsByProduct.useQuery({ parentProductId: product.id });
  const { data: usedBy = [] } = trpc.bom.whereUsed.useQuery(
    { componentProductId: product.id },
    { enabled: product.type === 'component' },
  );
  const [form, setForm] = useState(() => definitionToForm(null, product));
  const [changeForm, setChangeForm] = useState(emptyChangeForm);
  const [variantForm, setVariantForm] = useState(() => emptyVariantForm());

  useEffect(() => {
    setForm(definitionToForm((definition as ProductDefinition | null | undefined) ?? null, product));
  }, [definition, product]);

  const refreshDefinition = async () => {
    await Promise.all([
      utils.products.definition.invalidate({ productId: product.id }),
      utils.products.definitionStatuses.invalidate(),
      utils.products.definitionDeviation.invalidate({ productId: product.id }),
      utils.products.definitionSnapshots.invalidate({ productId: product.id }),
    ]);
  };

  const refreshChanges = async () => {
    await Promise.all([
      utils.products.definitionChanges.invalidate({ productId: product.id }),
      utils.products.definitionDeviation.invalidate({ productId: product.id }),
    ]);
  };

  const saveDefinition = trpc.products.saveDefinition.useMutation({
    onSuccess: async () => {
      toast.success('产品定义草稿已保存');
      await refreshDefinition();
    },
    onError: (e) => toast.error(e.message),
  });

  const confirmDefinition = trpc.products.confirmDefinition.useMutation({
    onSuccess: async () => {
      toast.success('产品定义已确认');
      await refreshDefinition();
    },
    onError: (e) => toast.error(e.message),
  });

  const createDefinitionChange = trpc.products.createDefinitionChange.useMutation({
    onSuccess: async () => {
      toast.success('产品定义变更已登记');
      setChangeForm(emptyChangeForm);
      await refreshChanges();
    },
    onError: (e) => toast.error(e.message),
  });

  const createVariant = trpc.products.createVariant.useMutation({
    onSuccess: async () => {
      toast.success('客户版本已登记');
      setVariantForm(emptyVariantForm());
      await utils.products.variantsByProduct.invalidate({ parentProductId: product.id });
    },
    onError: (e) => toast.error(e.message),
  });

  const updateDefinitionChange = trpc.products.updateDefinitionChange.useMutation({
    onSuccess: async () => {
      toast.success('变更状态已更新');
      await refreshChanges();
    },
    onError: (e) => toast.error(e.message),
  });

  const buildPatch = () => ({
    title: form.title.trim(),
    opportunityName: form.opportunityName.trim(),
    opportunitySource: form.opportunitySource.trim(),
    targetCustomers: form.targetCustomers.trim() || null,
    targetMarkets: splitList(form.targetMarkets),
    applicationScenarios: form.applicationScenarios.trim() || null,
    competitors: form.competitors
      .map((row) => ({
        brand: row.brand.trim(),
        model: row.model.trim(),
        price: row.price.trim(),
        channel: row.channel.trim(),
        notes: row.notes.trim(),
      }))
      .filter((row) => Object.values(row).some(Boolean)),
    priceBand: form.priceBand.trim(),
    positioning: form.positioning.trim() || null,
    sellingPoints: splitList(form.sellingPoints),
    differentiationStrategy: form.differentiationStrategy.trim() || null,
    prdSummary: form.prdSummary.trim() || null,
    specs: form.specs
      .map((row) => ({
        label: row.label.trim(),
        target: row.target.trim(),
        tolerance: row.tolerance.trim(),
        verification: row.verification.trim(),
        ownerRole: row.ownerRole.trim(),
      }))
      .map((row, index) => ({ key: `spec_${index + 1}`, ...row }))
      .filter((row) => row.label && row.target),
    targetCost: form.targetCost.trim(),
    targetPrice: form.targetPrice.trim(),
    targetGrossMargin: form.targetGrossMargin.trim(),
    skuPlan: form.skuPlan
      .map((row) => ({
        name: row.name.trim(),
        code: row.code.trim(),
        targetMarket: row.targetMarket.trim(),
        price: row.price.trim(),
        differences: row.differences.trim(),
      }))
      .filter((row) => row.name),
  });

  const save = () => saveDefinition.mutate({ productId: product.id, patch: buildPatch() });
  const confirmed = (definition as ProductDefinition | undefined)?.status === 'confirmed';
  const snapshots = definitionSnapshots as ProductDefinitionSnapshot[];
  const changes = definitionChanges as ProductDefinitionChange[];
  const customerVariants = variants as CustomerVariant[];
  const deviationReport = deviation as ProductDefinitionDeviation | undefined;

  const updateCompetitor = (index: number, patch: Partial<CompetitorDraft>) => {
    const rows = [...form.competitors];
    rows[index] = { ...rows[index], ...patch };
    setForm({ ...form, competitors: rows });
  };

  const updateSpec = (index: number, patch: Partial<SpecDraft>) => {
    const rows = [...form.specs];
    rows[index] = { ...rows[index], ...patch };
    setForm({ ...form, specs: rows });
  };

  const updateSku = (index: number, patch: Partial<SkuDraft>) => {
    const rows = [...form.skuPlan];
    rows[index] = { ...rows[index], ...patch };
    setForm({ ...form, skuPlan: rows });
  };

  const createChange = () => {
    if (!changeForm.title.trim()) {
      toast.error('请输入变更标题');
      return;
    }
    createDefinitionChange.mutate({
      productId: product.id,
      area: changeForm.area,
      title: changeForm.title.trim(),
      sourceProjectId: changeForm.sourceProjectId.trim() || null,
      requestedByCustomer: changeForm.requestedByCustomer.trim() || null,
      baselineValue: changeForm.baselineValue.trim() || null,
      requestedValue: changeForm.requestedValue.trim() || null,
      reason: changeForm.reason.trim() || null,
      costImpact: changeForm.costImpact.trim() || null,
      priceImpact: changeForm.priceImpact.trim() || null,
      scheduleImpact: changeForm.scheduleImpact.trim() || null,
      impactScope: splitList(changeForm.impactScope),
      status: 'proposed',
    });
  };

  const changeStatus = (change: ProductDefinitionChange, status: ProductDefinitionChangeStatus) => {
    updateDefinitionChange.mutate({
      id: change.id,
      productId: product.id,
      status,
    });
  };

  const createCustomerVariant = () => {
    const variantCode = variantForm.variantCode.trim();
    if (!variantCode) {
      toast.error('请输入客户版本号，例如 DG01-CUSTA-R1');
      return;
    }
    const customerName = variantForm.customerName.trim();
    const differences = splitList(variantForm.differences);
    createVariant.mutate({
      variantCode,
      customerName,
      customerId: customerIdFromName(customerName || variantCode),
      customerSku: variantForm.customerSku.trim() || null,
      parentProductId: product.id,
      baseRevision: variantForm.baseRevision.trim(),
      status: variantForm.status,
      deltas: differences.map((item) => ({
        dimension: 'other',
        variantValue: item,
      })),
      certReuseParent: true,
      certAffectedMarks: [],
      customerApproved: false,
      sourceType: 'plm_change',
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <Boxes size={16} className="text-amber-500" /> {product.name} · 产品定义
          </DialogTitle>
          <DialogDescription className="sr-only">
            维护产品型号、主版本、客户版本、SKU 与产品定义基线。
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-6">
          <CustomerVariantSection
            product={product}
            variants={customerVariants}
            isLoading={variantsLoading}
            form={variantForm}
            onChange={(patch) => setVariantForm((prev) => ({ ...prev, ...patch }))}
            onCreate={createCustomerVariant}
            isCreating={createVariant.isPending}
          />

          <div className="border border-stone-200 bg-stone-50/60 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-serif text-lg text-stone-900">产品定义基线</h3>
                  <span className={`text-[10px] font-mono px-2 py-0.5 ${
                    confirmed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    {confirmed ? '已确认' : '草稿'}
                  </span>
                </div>
                <p className="text-xs text-stone-500 mt-1">
                  作为 PLM 侧可复用的定义基线；项目立项不依赖这里先确认。再次保存会回到草稿，需重新确认。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={save}
                  disabled={saveDefinition.isPending || definitionLoading}
                  className="gap-1.5"
                >
                  {saveDefinition.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  保存草稿
                </Button>
                <Button
                  onClick={() => confirmDefinition.mutate({ productId: product.id })}
                  disabled={confirmDefinition.isPending || !definition}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                >
                  {confirmDefinition.isPending ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  确认定义
                </Button>
              </div>
            </div>

            {definitionLoading ? (
              <div className="flex items-center gap-2 text-sm text-stone-400"><Loader2 size={14} className="animate-spin" />加载产品定义…</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Field label="定义标题" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
                <Field label="产品机会" value={form.opportunityName} onChange={(value) => setForm({ ...form, opportunityName: value })} placeholder="例：高端精致型便携车载泵" />
                <Field label="机会来源" value={form.opportunitySource} onChange={(value) => setForm({ ...form, opportunitySource: value })} placeholder="客户 / 市场 / 内部策略" />
                <Field label="目标市场" value={form.targetMarkets} onChange={(value) => setForm({ ...form, targetMarkets: value })} placeholder="US, EU, CN" />
                <Area label="目标客户" value={form.targetCustomers} onChange={(value) => setForm({ ...form, targetCustomers: value })} placeholder="用户画像、渠道、客户类型" />
                <Area label="应用场景" value={form.applicationScenarios} onChange={(value) => setForm({ ...form, applicationScenarios: value })} placeholder="车胎补气、户外装备、应急救援..." />
                <div className="lg:col-span-2">
                  <CompetitorRows
                    rows={form.competitors}
                    onAdd={() => setForm({ ...form, competitors: [...form.competitors, emptyCompetitor()] })}
                    onUpdate={updateCompetitor}
                    onRemove={(index) => setForm({ ...form, competitors: form.competitors.filter((_, rowIndex) => rowIndex !== index) })}
                  />
                </div>
                <Area label="定位与差异化" value={form.positioning} onChange={(value) => setForm({ ...form, positioning: value })} placeholder="一句话定位；确认定义必填" />
                <Area label="核心卖点" value={form.sellingPoints} onChange={(value) => setForm({ ...form, sellingPoints: value })} placeholder="每行一个卖点" />
                <Area label="差异化策略" value={form.differentiationStrategy} onChange={(value) => setForm({ ...form, differentiationStrategy: value })} />
                <Area label="PRD 摘要" value={form.prdSummary} onChange={(value) => setForm({ ...form, prdSummary: value })} placeholder="范围、核心需求、不可妥协项；确认定义必填" />
                <div className="lg:col-span-2">
                  <SpecRows
                    rows={form.specs}
                    onAdd={() => setForm({ ...form, specs: [...form.specs, emptySpec()] })}
                    onUpdate={updateSpec}
                    onRemove={(index) => setForm({ ...form, specs: form.specs.filter((_, rowIndex) => rowIndex !== index) })}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:col-span-2">
                  <Field label="目标成本" value={form.targetCost} onChange={(value) => setForm({ ...form, targetCost: value })} placeholder="USD 22 BOM" />
                  <Field label="目标售价" value={form.targetPrice} onChange={(value) => setForm({ ...form, targetPrice: value })} placeholder="USD 69 MSRP" />
                  <Field label="毛利要求" value={form.targetGrossMargin} onChange={(value) => setForm({ ...form, targetGrossMargin: value })} placeholder=">= 35%" />
                </div>
                <Field label="价格带" value={form.priceBand} onChange={(value) => setForm({ ...form, priceBand: value })} placeholder="USD 49-79" />
                <div className="lg:col-span-2">
                  <SkuRows
                    rows={form.skuPlan}
                    onAdd={() => setForm({ ...form, skuPlan: [...form.skuPlan, emptySku()] })}
                    onUpdate={updateSku}
                    onRemove={(index) => setForm({ ...form, skuPlan: form.skuPlan.filter((_, rowIndex) => rowIndex !== index) })}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="border border-stone-200 bg-white p-4 space-y-4">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-stone-400" />
              <h3 className="font-serif text-base text-stone-900">PRD 快照历史</h3>
            </div>
            {snapshotsLoading ? (
              <div className="flex items-center gap-2 text-sm text-stone-400"><Loader2 size={14} className="animate-spin" />加载 PRD 快照…</div>
            ) : snapshots.length === 0 ? (
              <p className="text-sm text-stone-400 py-2">确认产品定义后会生成 PRD v1 快照。</p>
            ) : (
              <div className="space-y-2">
                {snapshots.map((snapshot) => (
                  <details key={snapshot.id} className="border border-stone-200 px-3 py-2 bg-stone-50/40">
                    <summary className="cursor-pointer select-none">
                      <div className="inline-flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-stone-900 text-stone-50">
                          PRD v{snapshot.versionNumber}
                        </span>
                        <span className="text-sm text-stone-900">{snapshot.title || product.name}</span>
                        <span className="text-[11px] font-mono text-stone-400">
                          {new Date(snapshot.confirmedAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                    </summary>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                      <div className="border border-stone-200 bg-white px-2 py-2">
                        <div className="text-stone-400 font-mono">SPEC</div>
                        <div className="text-stone-800 mt-1">{snapshot.snapshot.specs?.length ?? 0}</div>
                      </div>
                      <div className="border border-stone-200 bg-white px-2 py-2">
                        <div className="text-stone-400 font-mono">SKU</div>
                        <div className="text-stone-800 mt-1">{snapshot.snapshot.skuPlan?.length ?? 0}</div>
                      </div>
                      <div className="border border-stone-200 bg-white px-2 py-2">
                        <div className="text-stone-400 font-mono">COMPETITOR</div>
                        <div className="text-stone-800 mt-1">{snapshot.snapshot.competitors?.length ?? 0}</div>
                      </div>
                      <div className="border border-stone-200 bg-white px-2 py-2">
                        <div className="text-stone-400 font-mono">TARGET</div>
                        <div className="text-stone-800 mt-1 truncate">
                          {[snapshot.snapshot.targetCost, snapshot.snapshot.targetPrice, snapshot.snapshot.targetGrossMargin].filter(Boolean).join(' / ') || '—'}
                        </div>
                      </div>
                    </div>
                    {snapshot.snapshot.prdSummary ? (
                      <p className="text-xs text-stone-600 mt-3 whitespace-pre-wrap">{snapshot.snapshot.prdSummary}</p>
                    ) : null}
                    {(snapshot.snapshot.specs?.length ?? 0) > 0 ? (
                      <div className="mt-3 space-y-1">
                        {snapshot.snapshot.specs!.slice(0, 5).map((spec, index) => (
                          <div key={`${spec.label}-${index}`} className="text-xs text-stone-600 flex gap-2">
                            <span className="font-mono text-stone-400 shrink-0">{index + 1}</span>
                            <span className="min-w-0">
                              <span className="text-stone-800">{spec.label}</span>
                              <span className="text-stone-400"> · </span>
                              {spec.target}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </details>
                ))}
              </div>
            )}
          </div>

          <div className="border border-stone-200 bg-white p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className={deviationReport?.deviated ? 'text-rose-500' : 'text-stone-400'} />
                  <h3 className="font-serif text-base text-stone-900">产品定义偏离检查</h3>
                </div>
                <p className="text-xs text-stone-500 mt-1">
                  基于已确认定义和已批准/已实施的产品定义变更判断当前产品是否偏离最初定义。
                </p>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 border ${
                deviationReport?.deviated
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {deviationReport?.deviated ? '存在偏离' : '未发现确认偏离'}
              </span>
            </div>

            {!deviationReport || deviationReport.baselineStatus !== 'confirmed' ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2">
                产品定义尚未确认，无法形成可比对的开发基线。
              </p>
            ) : deviationReport.approvedDeviationCount === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="border border-stone-200 px-3 py-2">
                  <div className="text-stone-400 font-mono">BASELINE</div>
                  <div className="text-stone-800 mt-1">
                    {deviationReport.confirmedAt ? new Date(deviationReport.confirmedAt).toLocaleString('zh-CN') : '已确认'}
                  </div>
                </div>
                <div className="border border-stone-200 px-3 py-2">
                  <div className="text-stone-400 font-mono">APPROVED DEVIATION</div>
                  <div className="text-stone-800 mt-1">{deviationReport.approvedDeviationCount}</div>
                </div>
                <div className="border border-stone-200 px-3 py-2">
                  <div className="text-stone-400 font-mono">PENDING CHANGE</div>
                  <div className="text-stone-800 mt-1">{deviationReport.pendingChangeCount}</div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {deviationReport.items.map((item) => (
                  <div key={item.id} className="border border-rose-100 bg-rose-50/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-white text-rose-700 border border-rose-100 shrink-0">
                          {CHANGE_AREA_LABELS[item.area]}
                        </span>
                        <span className="text-sm text-stone-900 truncate">{item.title}</span>
                      </div>
                      <span className="text-[10px] font-mono text-rose-700 shrink-0">{CHANGE_STATUS_LABELS[item.status]}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs text-stone-600">
                      <div><span className="text-stone-400">原定义：</span>{item.baselineValue || '—'}</div>
                      <div><span className="text-stone-400">新要求：</span>{item.requestedValue || '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-stone-200 bg-stone-50/40 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <History size={15} className="text-stone-400" />
              <h3 className="font-serif text-base text-stone-900">产品需求变更</h3>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-6 gap-3">
              <label className="block space-y-1.5 lg:col-span-1">
                <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500">范围</span>
                <select
                  value={changeForm.area}
                  onChange={(e) => setChangeForm({ ...changeForm, area: e.target.value as ProductDefinitionChangeArea })}
                  className="w-full border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900 bg-white"
                >
                  {(Object.entries(CHANGE_AREA_LABELS) as Array<[ProductDefinitionChangeArea, string]>).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <div className="lg:col-span-3">
                <Field label="变更标题" value={changeForm.title} onChange={(value) => setChangeForm({ ...changeForm, title: value })} placeholder="例：删除照明功能以降低 BOM 成本" />
              </div>
              <div className="lg:col-span-2">
                <Field label="来源项目" value={changeForm.sourceProjectId} onChange={(value) => setChangeForm({ ...changeForm, sourceProjectId: value })} placeholder="可选，项目 ID" />
              </div>
              <div className="lg:col-span-3">
                <Area label="原定义" value={changeForm.baselineValue} onChange={(value) => setChangeForm({ ...changeForm, baselineValue: value })} placeholder="从已确认 PRD / 规格 / SKU 中摘录" />
              </div>
              <div className="lg:col-span-3">
                <Area label="新要求" value={changeForm.requestedValue} onChange={(value) => setChangeForm({ ...changeForm, requestedValue: value })} placeholder="客户新增要求、删减范围或优化后的目标" />
              </div>
              <div className="lg:col-span-2">
                <Field label="客户/来源" value={changeForm.requestedByCustomer} onChange={(value) => setChangeForm({ ...changeForm, requestedByCustomer: value })} placeholder="客户名或内部来源" />
              </div>
              <div className="lg:col-span-2">
                <Field label="成本影响" value={changeForm.costImpact} onChange={(value) => setChangeForm({ ...changeForm, costImpact: value })} placeholder="例：BOM -USD 1.2" />
              </div>
              <div className="lg:col-span-2">
                <Field label="进度影响" value={changeForm.scheduleImpact} onChange={(value) => setChangeForm({ ...changeForm, scheduleImpact: value })} placeholder="例：P2 +5 天" />
              </div>
              <div className="lg:col-span-2">
                <Field label="售价影响" value={changeForm.priceImpact} onChange={(value) => setChangeForm({ ...changeForm, priceImpact: value })} placeholder="例：MSRP 不变" />
              </div>
              <div className="lg:col-span-2">
                <Field label="影响范围" value={changeForm.impactScope} onChange={(value) => setChangeForm({ ...changeForm, impactScope: value })} placeholder="结构, 电子, 采购, 品质" />
              </div>
              <div className="lg:col-span-2">
                <Field label="原因" value={changeForm.reason} onChange={(value) => setChangeForm({ ...changeForm, reason: value })} placeholder="成本优化 / 客户新增 / 技术不可达" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={createChange}
                disabled={createDefinitionChange.isPending}
                className="bg-stone-900 hover:bg-stone-800 text-stone-50 gap-1.5"
              >
                {createDefinitionChange.isPending ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
                登记变更
              </Button>
            </div>

            {changesLoading ? (
              <div className="flex items-center gap-2 text-sm text-stone-400"><Loader2 size={14} className="animate-spin" />加载变更记录…</div>
            ) : changes.length === 0 ? (
              <p className="text-sm text-stone-400 py-2">暂无产品定义变更。</p>
            ) : (
              <div className="space-y-2">
                {changes.map((change) => (
                  <div key={change.id} className="border border-stone-200 bg-white px-3 py-3">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-stone-100 text-stone-600">
                            {CHANGE_AREA_LABELS[change.area]}
                          </span>
                          <span className="text-sm font-medium text-stone-900">{change.title}</span>
                        </div>
                        <div className="text-[11px] font-mono text-stone-400 mt-1">
                          {new Date(change.createdAt).toLocaleString('zh-CN')}
                          {change.sourceProjectId ? ` · 来源项目 ${change.sourceProjectId}` : ''}
                          {change.requestedByCustomer ? ` · ${change.requestedByCustomer}` : ''}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(['proposed', 'approved', 'implemented', 'rejected'] as ProductDefinitionChangeStatus[]).map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => changeStatus(change, status)}
                            disabled={updateDefinitionChange.isPending || change.status === status}
                            className={`text-[10px] font-mono px-2 py-1 border ${
                              change.status === status
                                ? 'bg-stone-900 text-stone-50 border-stone-900'
                                : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
                            }`}
                          >
                            {CHANGE_STATUS_LABELS[status]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-xs text-stone-600">
                      <div><span className="text-stone-400">原定义：</span>{change.baselineValue || '—'}</div>
                      <div><span className="text-stone-400">新要求：</span>{change.requestedValue || '—'}</div>
                      <div><span className="text-stone-400">成本：</span>{change.costImpact || '—'}</div>
                      <div><span className="text-stone-400">进度：</span>{change.scheduleImpact || '—'}</div>
                    </div>
                    {change.reason ? <p className="text-xs text-stone-500 mt-2">原因：{change.reason}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={15} className="text-stone-400" />
              <h3 className="font-serif text-base text-stone-900">版本时间线</h3>
            </div>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin text-amber-500" /></div>
          ) : revisions.length === 0 ? (
            <p className="text-sm text-stone-400 py-6 text-center">还没有版本。项目「量产发布」后会在这里出现 Rev A。</p>
          ) : (
            <div className="space-y-0">
              {(revisions as { id: number; revisionLabel: string; status: string; releasedAt: string | null; createdByProjectId: string | null; snapshotChangelog?: { number: string; type: string; title: string; reason: string | null }[] }[]).map((r, i) => (
                <div key={r.id} className="flex items-start gap-3 pb-4 relative">
                  <div className="flex flex-col items-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    {i < revisions.length - 1 && <div className="w-px flex-1 bg-stone-200 mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-serif text-base text-stone-900">{r.revisionLabel}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 ${
                        r.status === 'released' ? 'bg-emerald-50 text-emerald-600' :
                        r.status === 'superseded' ? 'bg-stone-100 text-stone-400' : 'bg-amber-50 text-amber-600'
                      }`}>{r.status}</span>
                    </div>
                    <div className="text-[11px] font-mono text-stone-400 mt-0.5">
                      {r.releasedAt ? new Date(r.releasedAt).toLocaleString('zh-CN') : '—'}
                      {r.createdByProjectId ? ` · 来源项目 ${r.createdByProjectId}` : ''}
                    </div>
                    {r.status === 'released' && (
                      <details className="mt-1.5">
                        <summary className="text-[11px] text-stone-500 cursor-pointer select-none hover:text-stone-700">
                          本版本变更（{r.snapshotChangelog?.length ?? 0}）
                        </summary>
                        {(r.snapshotChangelog?.length ?? 0) === 0 ? (
                          <p className="text-[11px] text-stone-400 mt-1 pl-2">无登记变更</p>
                        ) : (
                          <ul className="mt-1 pl-2 space-y-1">
                            {r.snapshotChangelog!.map((c, ci) => (
                              <li key={ci} className="text-[11px] text-stone-600 flex gap-1.5">
                                <span className="font-mono px-1 bg-stone-100 text-stone-500 shrink-0">{c.type}</span>
                                <span className="min-w-0">
                                  <span className="text-stone-800">{c.title}</span>
                                  {c.reason ? <span className="text-stone-400"> — {c.reason}</span> : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
          {product.type === 'component' && (
            <div className="mt-4 pt-3 border-t border-stone-100">
              <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-2">被以下整机引用 (where-used)</div>
              {usedBy.length === 0 ? (
                <p className="text-xs text-stone-400">暂无整机引用此零部件。</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(usedBy as { productId: string; productName: string; revisionLabel: string }[]).map((u, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 bg-blue-50 text-blue-600">{u.productName} · {u.revisionLabel}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CustomerVariantSection({
  product,
  variants,
  isLoading,
  form,
  onChange,
  onCreate,
  isCreating,
}: {
  product: ProductRow;
  variants: CustomerVariant[];
  isLoading: boolean;
  form: VariantForm;
  onChange: (patch: Partial<VariantForm>) => void;
  onCreate: () => void;
  isCreating: boolean;
}) {
  const statusLabel: Record<string, string> = {
    draft: '草稿',
    active: '有效',
    on_hold: '暂停',
    eol: '停用',
  };

  return (
    <div className="border border-stone-200 bg-white p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Package size={15} className="text-stone-400" />
            <h3 className="font-serif text-base text-stone-900">客户版本 / SKU</h3>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            产品型号 {product.productNumber || product.name} 下先形成主版本（Product Revision），客户版本基于某个主版本登记差异；SKU 是可销售版本，BOM Revision 由发布版本冻结。
          </p>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 border border-stone-200 bg-stone-50 text-stone-500">
          {variants.length} CUSTOMER REVISIONS
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
        <div className="lg:col-span-1">
          <Field label="客户版本号" value={form.variantCode} onChange={(value) => onChange({ variantCode: value })} placeholder="DG01-CUSTA-R1" />
        </div>
        <div className="lg:col-span-1">
          <Field label="基于主版本" value={form.baseRevision} onChange={(value) => onChange({ baseRevision: value })} placeholder="Rev A" />
        </div>
        <div className="lg:col-span-1">
          <Field label="客户名称" value={form.customerName} onChange={(value) => onChange({ customerName: value })} placeholder="客户 A" />
        </div>
        <div className="lg:col-span-1">
          <Field label="SKU" value={form.customerSku} onChange={(value) => onChange({ customerSku: value })} placeholder="DG01-US-BLK" />
        </div>
        <label className="block space-y-1.5 lg:col-span-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500">状态</span>
          <select
            value={form.status}
            onChange={(event) => onChange({ status: event.target.value as VariantForm['status'] })}
            className="w-full border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900 bg-white"
          >
            <option value="draft">草稿</option>
            <option value="active">有效</option>
            <option value="on_hold">暂停</option>
            <option value="eol">停用</option>
          </select>
        </label>
        <div className="lg:col-span-2">
          <Field label="客户差异" value={form.differences} onChange={(value) => onChange({ differences: value })} placeholder="颜色黑色, 客户 logo, 附件包 A" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={onCreate}
          disabled={isCreating}
          className="bg-stone-900 hover:bg-stone-800 text-stone-50 gap-1.5"
        >
          {isCreating ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
          登记客户版本
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-stone-400"><Loader2 size={14} className="animate-spin" />加载客户版本…</div>
      ) : variants.length === 0 ? (
        <p className="text-sm text-stone-400 py-2">暂无客户版本。</p>
      ) : (
        <div className="space-y-2">
          {variants.map((variant) => (
            <div key={variant.id} className="border border-stone-200 bg-stone-50/40 px-3 py-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-stone-900">{variant.variantCode}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-white text-stone-600 border border-stone-200">
                      {statusLabel[variant.status] ?? variant.status}
                    </span>
                    {variant.customerApproved ? (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100">客户已确认</span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-stone-400">
                    {variant.customerName || '未填客户'}
                    {variant.baseRevision ? ` · 主版本 ${variant.baseRevision}` : ' · 主版本未指定'}
                    {variant.customerSku ? ` · SKU ${variant.customerSku}` : ' · SKU 未填'}
                  </div>
                </div>
              </div>
              {(variant.deltas?.length ?? 0) > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {variant.deltas.slice(0, 6).map((delta, index) => (
                    <span key={index} className="text-[11px] px-2 py-0.5 bg-white border border-stone-200 text-stone-600">
                      {delta.variantValue}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, placeholder = '',
}: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Area({
  label, value, onChange, placeholder = '',
}: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900 resize-y bg-white"
      />
    </label>
  );
}

function RowInput({
  value, onChange, placeholder,
}: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-9 text-xs"
    />
  );
}

function RowsHeader({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500">{label}</span>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1 text-[11px] text-stone-700 border border-stone-300 px-2 py-1 hover:border-stone-900 bg-white"
      >
        <PlusCircle size={12} /> 新增
      </button>
    </div>
  );
}

function DeleteRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="删除行"
      className="h-9 w-9 inline-flex items-center justify-center border border-stone-300 text-stone-500 hover:text-rose-600 hover:border-rose-200 bg-white"
    >
      <Trash2 size={14} />
    </button>
  );
}

function CompetitorRows({
  rows, onAdd, onUpdate, onRemove,
}: {
  rows: CompetitorDraft[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<CompetitorDraft>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <RowsHeader label="竞品资料" onAdd={onAdd} />
      {rows.length === 0 ? (
        <p className="text-xs text-stone-400 border border-dashed border-stone-300 px-3 py-3 bg-white">暂无竞品资料。</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_0.8fr_0.9fr_1.5fr_36px] gap-2">
              <RowInput value={row.brand} onChange={(value) => onUpdate(index, { brand: value })} placeholder="品牌" />
              <RowInput value={row.model} onChange={(value) => onUpdate(index, { model: value })} placeholder="型号" />
              <RowInput value={row.price} onChange={(value) => onUpdate(index, { price: value })} placeholder="价格" />
              <RowInput value={row.channel} onChange={(value) => onUpdate(index, { channel: value })} placeholder="渠道" />
              <RowInput value={row.notes} onChange={(value) => onUpdate(index, { notes: value })} placeholder="优势/弱点/备注" />
              <DeleteRowButton onClick={() => onRemove(index)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SpecRows({
  rows, onAdd, onUpdate, onRemove,
}: {
  rows: SpecDraft[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<SpecDraft>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <RowsHeader label="目标规格" onAdd={onAdd} />
      {rows.length === 0 ? (
        <p className="text-xs text-stone-400 border border-dashed border-stone-300 px-3 py-3 bg-white">至少添加 1 条规格后才能确认产品定义。</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_0.9fr_1fr_0.9fr_36px] gap-2">
              <RowInput value={row.label} onChange={(value) => onUpdate(index, { label: value })} placeholder="指标" />
              <RowInput value={row.target} onChange={(value) => onUpdate(index, { target: value })} placeholder="目标值" />
              <RowInput value={row.tolerance} onChange={(value) => onUpdate(index, { tolerance: value })} placeholder="公差/范围" />
              <RowInput value={row.verification} onChange={(value) => onUpdate(index, { verification: value })} placeholder="验证方法" />
              <RowInput value={row.ownerRole} onChange={(value) => onUpdate(index, { ownerRole: value })} placeholder="责任角色" />
              <DeleteRowButton onClick={() => onRemove(index)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkuRows({
  rows, onAdd, onUpdate, onRemove,
}: {
  rows: SkuDraft[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<SkuDraft>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <RowsHeader label="SKU 计划" onAdd={onAdd} />
      {rows.length === 0 ? (
        <p className="text-xs text-stone-400 border border-dashed border-stone-300 px-3 py-3 bg-white">暂无目标 SKU 计划。</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_0.8fr_0.9fr_0.8fr_1.5fr_36px] gap-2">
              <RowInput value={row.name} onChange={(value) => onUpdate(index, { name: value })} placeholder="SKU 名称" />
              <RowInput value={row.code} onChange={(value) => onUpdate(index, { code: value })} placeholder="SKU 编码" />
              <RowInput value={row.targetMarket} onChange={(value) => onUpdate(index, { targetMarket: value })} placeholder="市场" />
              <RowInput value={row.price} onChange={(value) => onUpdate(index, { price: value })} placeholder="价格" />
              <RowInput value={row.differences} onChange={(value) => onUpdate(index, { differences: value })} placeholder="差异" />
              <DeleteRowButton onClick={() => onRemove(index)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
