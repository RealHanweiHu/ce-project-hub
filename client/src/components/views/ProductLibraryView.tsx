// Product Library view — 产品库（PLM 轴入口）
// Linear redesign — Phase 1 VISUAL ONLY. Product card grid with placeholder thumbnails,
// specs, active-project counts and current stage; category filter + search.
// All data wiring + mutations (create / definition / variants / revisions / changes) preserved.
import { useEffect, useMemo, useState } from 'react';
import {
  Package, Plus, Loader2, Cpu, Boxes, CheckCircle2, ShieldCheck, Save,
  AlertTriangle, History, PlusCircle, FileText, Trash2, Search,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { LinearCard, PageHeader, SegToggle } from '@/components/linear/primitives';
import { cn } from '@/lib/utils';

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
  sourceType: string;
  sourceRefId: string | null;
  customerApproved: boolean;
  approvedDate: string | null;
  introducedAt: string | null;
};

type VariantForm = {
  variantCode: string;
  baseRevision: string;
  customerName: string;
  customerSku: string;
  customerBomRevision: string;
  changeType: 'eco' | 'ecn';
  changeRef: string;
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

// Map a linked-project currentPhase id to a short stage label for the product card.
const PHASE_SHORT_LABELS: Record<string, string> = {
  planning: '立项',
  concept: '概念',
  design: '设计',
  evt: 'EVT',
  dvt: 'DVT',
  pvt: 'PVT',
  mp: '量产',
};

function phaseShortLabel(phaseId: string) {
  return PHASE_SHORT_LABELS[phaseId] ?? phaseId;
}

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
  customerBomRevision: '',
  changeType: 'eco',
  changeRef: '',
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

function productModelCode(product: ProductRow) {
  return product.productNumber?.trim() || product.name;
}

function formatMainRevisionLabel(product: ProductRow, revisionLabel: string) {
  const modelCode = productModelCode(product);
  return revisionLabel.includes(modelCode) ? revisionLabel : `${modelCode} ${revisionLabel}`;
}

function customerBomRevisionOf(variant: CustomerVariant) {
  return variant.deltas.find((delta) => delta.note === 'customer_bom_revision')?.variantValue ?? '';
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
  // Linked projects: count active (non-archived) projects per product + their current stage.
  const { data: projectRows = [] } = trpc.projects.list.useQuery();
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

  // ── Filter + search presentation state (local only) ──
  const [catFilter, setCatFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const definitionStatusByProduct = useMemo(() => {
    const map = new Map<string, DefinitionStatus>();
    for (const status of definitionStatuses as DefinitionStatus[]) map.set(status.productId, status);
    return map;
  }, [definitionStatuses]);

  // Map productId → { count of active projects, latest project's current stage label }
  const linkedByProduct = useMemo(() => {
    const map = new Map<string, { count: number; stage: string | null }>();
    for (const row of projectRows as Array<{ productId?: string | null; currentPhase?: string }>) {
      if (!row.productId) continue;
      const prev = map.get(row.productId);
      if (prev) {
        prev.count += 1;
      } else {
        map.set(row.productId, {
          count: 1,
          stage: row.currentPhase ? phaseShortLabel(row.currentPhase) : null,
        });
      }
    }
    return map;
  }, [projectRows]);

  const resetForm = () => {
    setName(''); setProductNumber(''); setType('finished'); setCategory(''); setMarkets('');
  };

  // Category filter options derived from the product set.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products as ProductRow[]) set.add(p.category || '未分类');
    return Array.from(set);
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (products as ProductRow[]).filter((p) => {
      const cat = p.category || '未分类';
      if (catFilter !== 'all' && cat !== catFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.productNumber} ${cat} ${(p.targetMarkets || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, catFilter, search]);

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
    <div className="flex flex-col">
      {/* Header */}
      <PageHeader
        title="产品库"
        sub={<><span className="num">{products.length}</span> 个产品型号 · 版本主轴</>}
        actions={
          <button
            onClick={() => setOpen(true)}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            <Plus size={15} /> 新建产品
          </button>
        }
      />

      {/* Filter + search */}
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-border pb-4">
        <SegToggle<string>
          value={catFilter}
          onChange={setCatFilter}
          options={[{ value: 'all', label: '全部' }, ...categories.map((c) => ({ value: c, label: c }))]}
        />
        <div className="flex h-[32px] w-[240px] items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:border-[color:var(--acc-border)] focus-within:ring-2 focus-within:ring-[color:var(--acc-soft)]">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索产品…"
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="ml-auto text-[12px] text-muted-foreground num">共 {filtered.length} 款产品</div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={22} className="animate-spin text-primary" />
        </div>
      ) : products.length === 0 ? (
        <LinearCard className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Package size={28} className="text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">还没有产品型号。点「新建产品」建立 DG01 这类型号主数据。</p>
        </LinearCard>
      ) : filtered.length === 0 ? (
        <LinearCard className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Package size={26} className="text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">无匹配的产品</p>
        </LinearCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => {
            const linked = linkedByProduct.get(p.id);
            const defConfirmed = definitionStatusByProduct.get(p.id)?.status === 'confirmed';
            const isMp = p.lifecycleState === 'mass_production';
            const stage = linked?.stage ?? (LIFECYCLE_LABELS[p.lifecycleState] || p.lifecycleState);
            const codeLabel = p.productNumber ? p.productNumber : '未填型号';
            return (
              <LinearCard
                key={p.id}
                hover
                onClick={() => setRevProduct(p)}
                className="cursor-pointer overflow-hidden"
              >
                {/* Placeholder thumbnail — striped indigo-on-zinc block */}
                <div
                  className="relative flex h-[130px] items-center justify-center border-b border-border bg-secondary"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(135deg, var(--acc-soft) 0 10px, transparent 10px 20px)',
                  }}
                >
                  <span className="absolute left-2.5 top-2.5 inline-flex h-[22px] items-center gap-1.5 rounded-[6px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] px-2 text-[11px] font-semibold text-primary">
                    {p.type === 'component' ? <Cpu size={12} /> : <Package size={12} />}
                    {p.category || '未分类'}
                  </span>
                  {defConfirmed && (
                    <span className="absolute right-2.5 top-2.5 inline-flex h-[20px] items-center rounded-[6px] border border-[color:var(--acc-border)] bg-card/80 px-2 text-[10px] font-semibold text-primary">
                      定义已确认
                    </span>
                  )}
                  <span className="rounded-[5px] bg-card/70 px-2 py-[3px] text-[10.5px] tracking-wide text-muted-foreground num">
                    产品照片 · {codeLabel}
                  </span>
                </div>
                {/* Body */}
                <div className="px-3.5 py-3.5">
                  <div className="text-[14.5px] font-bold tracking-[-0.2px] truncate">{p.name}</div>
                  <div className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                    {p.type === 'component' ? '零部件' : '整机'}
                    {p.productNumber ? <> · 型号 <span className="num">{p.productNumber}</span></> : null}
                    {(p.targetMarkets || []).length > 0 ? ` · ${(p.targetMarkets || []).slice(0, 4).join(' / ')}` : ''}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      在研 <b className="text-foreground num">{linked?.count ?? 0}</b> 个项目
                    </span>
                    <span
                      className={cn(
                        'rounded-[6px] px-2 py-0.5 text-[10.5px] font-semibold',
                        isMp
                          ? 'bg-[color:var(--success-soft)] text-[color:var(--success)]'
                          : 'bg-[color:var(--acc-soft)] text-primary',
                      )}
                    >
                      {stage}
                    </span>
                  </div>
                </div>
              </LinearCard>
            );
          })}
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
            <DialogTitle className="flex items-center gap-2">
              <Package size={16} className="text-primary" /> 新建产品型号
            </DialogTitle>
            <DialogDescription className="sr-only">
              建立产品型号主数据。项目立项不要求先创建产品型号。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">产品名称 <span className="text-[color:var(--destructive)]">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：高端车载泵 DG01" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm text-foreground">产品型号</Label>
                <Input value={productNumber} onChange={(e) => setProductNumber(e.target.value)} placeholder="DG01" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-foreground">类型</Label>
                <div className="flex overflow-hidden rounded-[7px] border border-border">
                  <button
                    type="button"
                    onClick={() => setType('finished')}
                    className={cn('flex-1 py-2 text-xs', type === 'finished' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
                  >整机</button>
                  <button
                    type="button"
                    onClick={() => setType('component')}
                    className={cn('flex-1 py-2 text-xs', type === 'component' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
                  >零部件</button>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">品类</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="充气泵 / 风扇 …" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">目标市场</Label>
              <Input value={markets} onChange={(e) => setMarkets(e.target.value)} placeholder="EU, US, JP（逗号分隔）" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button
              className="bg-primary text-primary-foreground hover:opacity-90"
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
      toast.error('请输入客户版本号，例如 DG01 Rev A - Walmart');
      return;
    }
    const baseRevision = variantForm.baseRevision.trim();
    if (!baseRevision) {
      toast.error('客户版本必须基于主产品 Revision，例如 DG01 Rev A');
      return;
    }
    const customerBomRevision = variantForm.customerBomRevision.trim();
    if (!customerBomRevision) {
      toast.error('请输入客户 BOM Revision，例如 DG01 Rev A - Walmart BOM Rev 1');
      return;
    }
    const changeRef = variantForm.changeRef.trim();
    if (!changeRef) {
      toast.error('客户版本和客户 BOM Revision 必须填写 ECO/ECN 编号');
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
      baseRevision,
      status: variantForm.status,
      deltas: [
        {
          dimension: 'other',
          variantValue: customerBomRevision,
          note: 'customer_bom_revision',
        },
        ...differences.map((item) => ({
          dimension: 'other' as const,
          variantValue: item,
        })),
      ],
      certReuseParent: true,
      certAffectedMarks: [],
      customerApproved: false,
      sourceType: variantForm.changeType,
      sourceRefId: changeRef,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes size={16} className="text-primary" /> {product.name} · 产品定义
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

          <div className="border border-border bg-secondary p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg text-foreground">产品定义基线</h3>
                  <span className={`text-[10px] px-2 py-0.5 ${
                    confirmed ? 'bg-[color:var(--success-soft)] text-[color:var(--success)] border border-[color:var(--success)]/30' : 'bg-[color:var(--acc-soft)] text-primary border border-[color:var(--acc-border)]'
                  }`}>
                    {confirmed ? '已确认' : '草稿'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
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
                  className="bg-[color:var(--success)] hover:opacity-90 text-white gap-1.5"
                >
                  {confirmDefinition.isPending ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  确认定义
                </Button>
              </div>
            </div>

            {definitionLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />加载产品定义…</div>
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

          <div className="border border-border bg-white p-4 space-y-4">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-muted-foreground" />
              <h3 className="text-base text-foreground">PRD 快照历史</h3>
            </div>
            {snapshotsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />加载 PRD 快照…</div>
            ) : snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">确认产品定义后会生成 PRD v1 快照。</p>
            ) : (
              <div className="space-y-2">
                {snapshots.map((snapshot) => (
                  <details key={snapshot.id} className="border border-border px-3 py-2 bg-secondary">
                    <summary className="cursor-pointer select-none">
                      <div className="inline-flex flex-wrap items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 bg-primary text-primary-foreground">
                          PRD v{snapshot.versionNumber}
                        </span>
                        <span className="text-sm text-foreground">{snapshot.title || product.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(snapshot.confirmedAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                    </summary>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                      <div className="border border-border bg-white px-2 py-2">
                        <div className="text-muted-foreground">SPEC</div>
                        <div className="text-foreground mt-1">{snapshot.snapshot.specs?.length ?? 0}</div>
                      </div>
                      <div className="border border-border bg-white px-2 py-2">
                        <div className="text-muted-foreground">SKU</div>
                        <div className="text-foreground mt-1">{snapshot.snapshot.skuPlan?.length ?? 0}</div>
                      </div>
                      <div className="border border-border bg-white px-2 py-2">
                        <div className="text-muted-foreground">COMPETITOR</div>
                        <div className="text-foreground mt-1">{snapshot.snapshot.competitors?.length ?? 0}</div>
                      </div>
                      <div className="border border-border bg-white px-2 py-2">
                        <div className="text-muted-foreground">TARGET</div>
                        <div className="text-foreground mt-1 truncate">
                          {[snapshot.snapshot.targetCost, snapshot.snapshot.targetPrice, snapshot.snapshot.targetGrossMargin].filter(Boolean).join(' / ') || '—'}
                        </div>
                      </div>
                    </div>
                    {snapshot.snapshot.prdSummary ? (
                      <p className="text-xs text-[color:var(--secondary-foreground)] mt-3 whitespace-pre-wrap">{snapshot.snapshot.prdSummary}</p>
                    ) : null}
                    {(snapshot.snapshot.specs?.length ?? 0) > 0 ? (
                      <div className="mt-3 space-y-1">
                        {snapshot.snapshot.specs!.slice(0, 5).map((spec, index) => (
                          <div key={`${spec.label}-${index}`} className="text-xs text-[color:var(--secondary-foreground)] flex gap-2">
                            <span className="text-muted-foreground shrink-0">{index + 1}</span>
                            <span className="min-w-0">
                              <span className="text-foreground">{spec.label}</span>
                              <span className="text-muted-foreground"> · </span>
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

          <div className="border border-border bg-white p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className={deviationReport?.deviated ? 'text-[color:var(--destructive)]' : 'text-muted-foreground'} />
                  <h3 className="text-base text-foreground">产品定义偏离检查</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  基于已确认定义和已批准/已实施的产品定义变更判断当前产品是否偏离最初定义。
                </p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 border ${
                deviationReport?.deviated
                  ? 'bg-[color:var(--destructive)]/8 text-[color:var(--destructive)] border-[color:var(--destructive)]/30'
                  : 'bg-[color:var(--success-soft)] text-[color:var(--success)] border-[color:var(--success)]/30'
              }`}>
                {deviationReport?.deviated ? '存在偏离' : '未发现确认偏离'}
              </span>
            </div>

            {!deviationReport || deviationReport.baselineStatus !== 'confirmed' ? (
              <p className="text-sm text-primary bg-[color:var(--acc-soft)] border border-[color:var(--acc-border)] px-3 py-2">
                产品定义尚未确认，无法形成可比对的开发基线。
              </p>
            ) : deviationReport.approvedDeviationCount === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="border border-border px-3 py-2">
                  <div className="text-muted-foreground">BASELINE</div>
                  <div className="text-foreground mt-1">
                    {deviationReport.confirmedAt ? new Date(deviationReport.confirmedAt).toLocaleString('zh-CN') : '已确认'}
                  </div>
                </div>
                <div className="border border-border px-3 py-2">
                  <div className="text-muted-foreground">APPROVED DEVIATION</div>
                  <div className="text-foreground mt-1">{deviationReport.approvedDeviationCount}</div>
                </div>
                <div className="border border-border px-3 py-2">
                  <div className="text-muted-foreground">PENDING CHANGE</div>
                  <div className="text-foreground mt-1">{deviationReport.pendingChangeCount}</div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {deviationReport.items.map((item) => (
                  <div key={item.id} className="border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/8 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] px-1.5 py-0.5 bg-white text-[color:var(--destructive)] border border-[color:var(--destructive)]/30 shrink-0">
                          {CHANGE_AREA_LABELS[item.area]}
                        </span>
                        <span className="text-sm text-foreground truncate">{item.title}</span>
                      </div>
                      <span className="text-[10px] text-[color:var(--destructive)] shrink-0">{CHANGE_STATUS_LABELS[item.status]}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs text-[color:var(--secondary-foreground)]">
                      <div><span className="text-muted-foreground">原定义：</span>{item.baselineValue || '—'}</div>
                      <div><span className="text-muted-foreground">新要求：</span>{item.requestedValue || '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-border bg-secondary p-4 space-y-4">
            <div className="flex items-center gap-2">
              <History size={15} className="text-muted-foreground" />
              <h3 className="text-base text-foreground">产品需求变更</h3>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-6 gap-3">
              <label className="block space-y-1.5 lg:col-span-1">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">范围</span>
                <select
                  value={changeForm.area}
                  onChange={(e) => setChangeForm({ ...changeForm, area: e.target.value as ProductDefinitionChangeArea })}
                  className="w-full border border-border px-3 py-2 text-sm outline-none focus:border-primary bg-white"
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
                className="bg-primary hover:opacity-90 text-primary-foreground gap-1.5"
              >
                {createDefinitionChange.isPending ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
                登记变更
              </Button>
            </div>

            {changesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />加载变更记录…</div>
            ) : changes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">暂无产品定义变更。</p>
            ) : (
              <div className="space-y-2">
                {changes.map((change) => (
                  <div key={change.id} className="border border-border bg-white px-3 py-3">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] px-1.5 py-0.5 bg-secondary text-[color:var(--secondary-foreground)]">
                            {CHANGE_AREA_LABELS[change.area]}
                          </span>
                          <span className="text-sm font-medium text-foreground">{change.title}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1">
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
                            className={`text-[10px] px-2 py-1 border ${
                              change.status === status
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-white text-muted-foreground border-border hover:border-[color:var(--acc-border)]'
                            }`}
                          >
                            {CHANGE_STATUS_LABELS[status]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-xs text-[color:var(--secondary-foreground)]">
                      <div><span className="text-muted-foreground">原定义：</span>{change.baselineValue || '—'}</div>
                      <div><span className="text-muted-foreground">新要求：</span>{change.requestedValue || '—'}</div>
                      <div><span className="text-muted-foreground">成本：</span>{change.costImpact || '—'}</div>
                      <div><span className="text-muted-foreground">进度：</span>{change.scheduleImpact || '—'}</div>
                    </div>
                    {change.reason ? <p className="text-xs text-muted-foreground mt-2">原因：{change.reason}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={15} className="text-muted-foreground" />
              <h3 className="text-base text-foreground">版本时间线</h3>
            </div>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" /></div>
          ) : revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">还没有主版本。项目「量产发布」后会在这里出现 {productModelCode(product)} Rev A。</p>
          ) : (
            <div className="space-y-0">
              {(revisions as { id: number; revisionLabel: string; status: string; releasedAt: string | null; createdByProjectId: string | null; snapshotChangelog?: { number: string; type: string; title: string; reason: string | null }[] }[]).map((r, i) => (
                <div key={r.id} className="flex items-start gap-3 pb-4 relative">
                  <div className="flex flex-col items-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    {i < revisions.length - 1 && <div className="w-px flex-1 bg-secondary mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base text-foreground">{formatMainRevisionLabel(product, r.revisionLabel)}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 ${
                        r.status === 'released' ? 'bg-[color:var(--success-soft)] text-[color:var(--success)]' :
                        r.status === 'superseded' ? 'bg-secondary text-muted-foreground' : 'bg-[color:var(--acc-soft)] text-primary'
                      }`}>{r.status}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {r.releasedAt ? new Date(r.releasedAt).toLocaleString('zh-CN') : '—'}
                      {r.createdByProjectId ? ` · 来源项目 ${r.createdByProjectId}` : ''}
                    </div>
                    {r.status === 'released' && (
                      <details className="mt-1.5">
                        <summary className="text-[11px] text-muted-foreground cursor-pointer select-none hover:text-foreground">
                          本版本变更（{r.snapshotChangelog?.length ?? 0}）
                        </summary>
                        {(r.snapshotChangelog?.length ?? 0) === 0 ? (
                          <p className="text-[11px] text-muted-foreground mt-1 pl-2">无登记变更</p>
                        ) : (
                          <ul className="mt-1 pl-2 space-y-1">
                            {r.snapshotChangelog!.map((c, ci) => (
                              <li key={ci} className="text-[11px] text-[color:var(--secondary-foreground)] flex gap-1.5">
                                <span className="px-1 bg-secondary text-muted-foreground shrink-0">{c.type}</span>
                                <span className="min-w-0">
                                  <span className="text-foreground">{c.title}</span>
                                  {c.reason ? <span className="text-muted-foreground"> — {c.reason}</span> : null}
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
            <div className="mt-4 pt-3 border-t border-border">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">被以下整机引用 (where-used)</div>
              {usedBy.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无整机引用此零部件。</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(usedBy as { productId: string; productName: string; revisionLabel: string }[]).map((u, i) => (
                    <span key={i} className="text-[11px] px-2 py-0.5 bg-[color:var(--acc-soft)] text-primary">{u.productName} · {u.revisionLabel}</span>
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
    <div className="border border-border bg-white p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Package size={15} className="text-muted-foreground" />
            <h3 className="text-base text-foreground">客户版本 / SKU</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            客户版本不是独立产品，必须基于主产品 Revision；客户 BOM Revision 是标准 BOM 的受控派生。所有客户版本和 BOM 版本变化都必须挂 ECO/ECN 编号留痕。
          </p>
        </div>
        <span className="text-[10px] px-2 py-0.5 border border-border bg-secondary text-muted-foreground">
          {variants.length} CUSTOMER REVISIONS
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-9 gap-3">
        <div className="lg:col-span-1">
          <Field label="客户版本号" value={form.variantCode} onChange={(value) => onChange({ variantCode: value })} placeholder="DG01 Rev A - Walmart" />
        </div>
        <div className="lg:col-span-1">
          <Field label="基于主版本" value={form.baseRevision} onChange={(value) => onChange({ baseRevision: value })} placeholder="DG01 Rev A" />
        </div>
        <div className="lg:col-span-1">
          <Field label="客户名称" value={form.customerName} onChange={(value) => onChange({ customerName: value })} placeholder="Walmart" />
        </div>
        <div className="lg:col-span-1">
          <Field label="SKU" value={form.customerSku} onChange={(value) => onChange({ customerSku: value })} placeholder="DG01-US-BLK" />
        </div>
        <div className="lg:col-span-1">
          <Field label="客户 BOM Revision" value={form.customerBomRevision} onChange={(value) => onChange({ customerBomRevision: value })} placeholder="Walmart BOM Rev 1" />
        </div>
        <label className="block space-y-1.5 lg:col-span-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">变更类型</span>
          <select
            value={form.changeType}
            onChange={(event) => onChange({ changeType: event.target.value as VariantForm['changeType'] })}
            className="w-full border border-border px-3 py-2 text-sm outline-none focus:border-primary bg-white"
          >
            <option value="eco">ECO</option>
            <option value="ecn">ECN</option>
          </select>
        </label>
        <div className="lg:col-span-1">
          <Field label="ECO/ECN 编号" value={form.changeRef} onChange={(value) => onChange({ changeRef: value })} placeholder="ECO-2026-001" />
        </div>
        <label className="block space-y-1.5 lg:col-span-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">状态</span>
          <select
            value={form.status}
            onChange={(event) => onChange({ status: event.target.value as VariantForm['status'] })}
            className="w-full border border-border px-3 py-2 text-sm outline-none focus:border-primary bg-white"
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
          className="bg-primary hover:opacity-90 text-primary-foreground gap-1.5"
        >
          {isCreating ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
          登记客户版本
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />加载客户版本…</div>
      ) : variants.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">暂无客户版本。</p>
      ) : (
        <div className="space-y-2">
          {variants.map((variant) => (
            <div key={variant.id} className="border border-border bg-secondary px-3 py-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{variant.variantCode}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-white text-[color:var(--secondary-foreground)] border border-border">
                      {statusLabel[variant.status] ?? variant.status}
                    </span>
                    {variant.customerApproved ? (
                      <span className="text-[10px] px-1.5 py-0.5 bg-[color:var(--success-soft)] text-[color:var(--success)] border border-[color:var(--success)]/30">客户已确认</span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {variant.customerName || '未填客户'}
                    {variant.baseRevision ? ` · 主版本 ${variant.baseRevision}` : ' · 主版本未指定'}
                    {variant.customerSku ? ` · SKU ${variant.customerSku}` : ' · SKU 未填'}
                    {customerBomRevisionOf(variant) ? ` · 客户 BOM ${customerBomRevisionOf(variant)}` : ' · 客户 BOM 未填'}
                    {variant.sourceRefId ? ` · ${variant.sourceType.toUpperCase()} ${variant.sourceRefId}` : ' · 未关联 ECO/ECN'}
                  </div>
                </div>
              </div>
              {(variant.deltas?.length ?? 0) > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {variant.deltas.slice(0, 6).map((delta, index) => (
                    <span key={index} className="text-[11px] px-2 py-0.5 bg-white border border-border text-[color:var(--secondary-foreground)]">
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
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Area({
  label, value, onChange, placeholder = '',
}: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full border border-border px-3 py-2 text-sm outline-none focus:border-primary resize-y bg-white"
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
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1 text-[11px] text-foreground border border-border px-2 py-1 hover:border-primary bg-white"
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
      className="h-9 w-9 inline-flex items-center justify-center border border-border text-muted-foreground hover:text-[color:var(--destructive)] hover:border-[color:var(--destructive)]/30 bg-white"
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
        <p className="text-xs text-muted-foreground border border-dashed border-border px-3 py-3 bg-white">暂无竞品资料。</p>
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
        <p className="text-xs text-muted-foreground border border-dashed border-border px-3 py-3 bg-white">至少添加 1 条规格后才能确认产品定义。</p>
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
        <p className="text-xs text-muted-foreground border border-dashed border-border px-3 py-3 bg-white">暂无目标 SKU 计划。</p>
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
