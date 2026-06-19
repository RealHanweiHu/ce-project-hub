// Product Library view — 产品库（PLM 轴入口）
// 列出所有产品（按品类分组），支持新建产品。
import { useMemo, useState } from 'react';
import { Package, Plus, Loader2, Cpu, Boxes } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
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

const LIFECYCLE_LABELS: Record<string, string> = {
  concept: '概念',
  development: '开发中',
  mass_production: '量产',
  maintenance: '维护',
  eol: '停产',
};

export function ProductLibraryView() {
  const utils = trpc.useUtils();
  const { data: products = [], isLoading } = trpc.products.list.useQuery();
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
            {products.length} PRODUCTS · PRODUCT ASSET LIBRARY
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
          <p className="text-sm">还没有产品。点「新建产品」开始建立产品主数据。</p>
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
                      <span className="text-[10px] font-mono text-stone-400">{p.productNumber || '—'}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 ${
                        p.type === 'component' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {p.type === 'component' ? '零部件' : '整机'}
                      </span>
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
              <Package size={16} className="text-amber-500" /> 新建产品
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-700">产品名称 <span className="text-rose-500">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：露营充气泵 X1" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm text-stone-700">产品号</Label>
                <Input value={productNumber} onChange={(e) => setProductNumber(e.target.value)} placeholder="CE-PUMP-001" />
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
  const { data: revisions = [], isLoading } = trpc.products.revisions.useQuery({ productId: product.id });
  const { data: usedBy = [] } = trpc.bom.whereUsed.useQuery(
    { componentProductId: product.id },
    { enabled: product.type === 'component' },
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <Boxes size={16} className="text-amber-500" /> {product.name} · 版本时间线
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
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
