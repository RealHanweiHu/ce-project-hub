// 全局需求池:一套统一需求池的总入口。可按产品过滤;承接(转化)在各项目的需求池里进行。
import { useMemo, useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { Inbox } from 'lucide-react';
import { PageHeader, Kicker } from '@/components/linear/primitives';
import { RequirementPoolPanel, type RequirementPanelScope } from './RequirementPoolPanel';
import { isSystemAdminRole } from '@shared/system-roles';

type ProductRow = { id: string; name: string; productNumber: string };

export function RequirementsView({ initialProductId }: { initialProductId?: string }) {
  const { user } = useAuth();
  const isAdmin = isSystemAdminRole(user?.role);
  const { data: products = [] } = trpc.products.list.useQuery();
  const productRows = products as ProductRow[];
  const [productId, setProductId] = useState<string>(initialProductId ?? '');
  useEffect(() => { if (initialProductId !== undefined) setProductId(initialProductId); }, [initialProductId]);

  const scope: RequirementPanelScope = productId
    ? { kind: 'product', productId }
    : { kind: 'global' };
  const product = useMemo(() => productRows.find((p) => p.id === productId), [productRows, productId]);

  return (
    <div className="flex flex-col">
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><Inbox size={20} className="text-primary" />需求池</span>}
        sub="长期沉淀、跨项目承接"
        actions={
          <div className="flex items-center gap-2">
            <Kicker>产品</Kicker>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="min-w-[160px] cursor-pointer rounded-[7px] border border-border bg-card px-2.5 py-1.5 text-[12.5px] text-foreground outline-none transition-colors focus:border-[color:var(--acc-border)]"
            >
              <option value="">全部产品</option>
              {productRows.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.productNumber ? ` · ${p.productNumber}` : ''}</option>
              ))}
            </select>
          </div>
        }
      />

      <p className="mb-5 rounded-[9px] border border-border bg-secondary px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
        这里汇总所有产品的长期需求。决定要做时,到对应<strong className="text-foreground">项目的需求池</strong>里「采纳转化」为任务/问题/变更 ——
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
