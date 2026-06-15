// 全局需求池:一套统一需求池的总入口。可按产品过滤;承接(转化)在各项目的需求池里进行。
import { useMemo, useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { Inbox } from 'lucide-react';
import { RequirementPoolPanel, type RequirementPanelScope } from './RequirementPoolPanel';

type ProductRow = { id: string; name: string; productNumber: string };

export function RequirementsView({ initialProductId }: { initialProductId?: string }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: products = [] } = trpc.products.list.useQuery();
  const productRows = products as ProductRow[];
  const [productId, setProductId] = useState<string>(initialProductId ?? '');
  useEffect(() => { if (initialProductId !== undefined) setProductId(initialProductId); }, [initialProductId]);

  const scope: RequirementPanelScope = productId
    ? { kind: 'product', productId }
    : { kind: 'global' };
  const product = useMemo(() => productRows.find((p) => p.id === productId), [productRows, productId]);

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Inbox size={18} className="text-amber-500" />
          <h1 className="font-serif text-xl text-stone-900">需求池</h1>
          <span className="text-[11px] font-mono text-stone-400">长期沉淀、跨项目承接</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">产品</span>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="text-xs border border-stone-300 bg-white px-2 py-1.5 outline-none focus:border-stone-900 min-w-[160px]"
          >
            <option value="">全部产品</option>
            {productRows.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.productNumber ? ` · ${p.productNumber}` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-stone-500 leading-relaxed bg-stone-50 border border-stone-200 px-3 py-2">
        这里汇总所有产品的长期需求。决定要做时,到对应<strong>项目的需求池</strong>里「采纳转化」为任务/问题/变更 ——
        需求池只做收集与澄清,不充当第二套任务清单。
      </p>

      <RequirementPoolPanel
        scope={scope}
        canCreate                                   /* 人人可提需求 */
        canManageRow={(row) => isAdmin || row.creatorId === user?.id}  /* admin 或创建人可改 */
        title={product ? `${product.name} · 需求` : '全部需求'}
        subtitle={product ? 'PRODUCT BACKLOG' : 'GLOBAL REQUIREMENT POOL'}
      />
    </div>
  );
}
