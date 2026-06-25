// 项目工作态 BOM 面板：增/删/改行，可引用零部件产品。
import { useState } from 'react';
import { Plus, Trash2, Loader2, Boxes } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

type BomRow = {
  id: number; partNumber: string; name: string; spec: string; quantity: number;
  refDesignator: string; supplierName: string; unitCost: string;
  componentProductId: string | null;
};

const EMPTY = { partNumber: '', name: '', spec: '', quantity: 1, refDesignator: '', supplierName: '', unitCost: '', componentProductId: '' };

// 模块级定义：避免在父组件渲染体内重建组件类型导致 input 每次渲染重挂载（丢失焦点/未保存内容）。
function BomCell({ r, field, type = 'text', w, disabled, onCommit }: {
  r: BomRow; field: keyof BomRow; type?: string; w: string; disabled: boolean;
  onCommit: (id: number, field: keyof BomRow, value: string | number) => void;
}) {
  return (
    <input
      type={type} defaultValue={String(r[field] ?? '')} disabled={disabled}
      onBlur={(e) => {
        const v: string | number = type === 'number' ? (parseInt(e.target.value) || 0) : e.target.value;
        if (String(v) !== String(r[field] ?? '')) onCommit(r.id, field, v);
      }}
      className={`${w} rounded-md border border-transparent hover:border-border focus:border-[color:var(--acc-border)] outline-none px-1.5 py-1 text-sm bg-transparent`}
    />
  );
}

export function BomPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data: rows = [], isLoading } = trpc.bom.working.useQuery({ projectId });
  const { data: products = [] } = trpc.products.list.useQuery();
  const components = (products as { id: string; name: string; type: string }[]).filter((p) => p.type === 'component');

  const inval = () => utils.bom.working.invalidate({ projectId });
  const addM = trpc.bom.add.useMutation({ onSuccess: inval, onError: (e) => toast.error(e.message) });
  const updM = trpc.bom.update.useMutation({ onSuccess: inval, onError: (e) => toast.error(e.message) });
  const delM = trpc.bom.delete.useMutation({ onSuccess: inval, onError: (e) => toast.error(e.message) });

  const [draft, setDraft] = useState({ ...EMPTY });

  const totalCost = (rows as BomRow[]).reduce((s, r) => s + (parseFloat(r.unitCost) || 0) * r.quantity, 0);

  const commitCell = (id: number, field: keyof BomRow, v: string | number) => updM.mutate({ id, patch: { [field]: v } });

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] num text-muted-foreground">工作态 BOM · {rows.length} 行 · 估算成本 {totalCost.toFixed(2)}</div>
          {!canEdit && <div className="text-[11px] text-muted-foreground mt-1">当前角色仅可查看 BOM，编辑请联系 PM / Manager / SCM。</div>}
        </div>
      </div>
      {rows.length === 0 && (
        <div className="border border-dashed border-border bg-secondary rounded-[11px] p-5 flex items-start gap-3">
          <Boxes size={18} className="text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium text-foreground">暂无 BOM 行</div>
            <div className="text-xs text-muted-foreground mt-1">
              {canEdit ? '先新增关键物料、长交期件或供应风险项。' : '有编辑权限的成员添加后会显示在这里。'}
            </div>
          </div>
        </div>
      )}
      <div className="border border-border rounded-[11px] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] num uppercase tracking-wider text-muted-foreground text-left bg-secondary">
              <th className="px-2 py-2">料号</th><th className="px-2 py-2">名称</th><th className="px-2 py-2">规格</th>
              <th className="px-2 py-2">用量</th><th className="px-2 py-2">位号</th><th className="px-2 py-2">供应商</th>
              <th className="px-2 py-2">单价</th><th className="px-2 py-2">引用零部件</th><th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(rows as BomRow[]).map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td><BomCell r={r} field="partNumber" w="w-24" disabled={!canEdit} onCommit={commitCell} /></td>
                <td><BomCell r={r} field="name" w="w-40" disabled={!canEdit} onCommit={commitCell} /></td>
                <td><BomCell r={r} field="spec" w="w-32" disabled={!canEdit} onCommit={commitCell} /></td>
                <td><BomCell r={r} field="quantity" type="number" w="w-14" disabled={!canEdit} onCommit={commitCell} /></td>
                <td><BomCell r={r} field="refDesignator" w="w-20" disabled={!canEdit} onCommit={commitCell} /></td>
                <td><BomCell r={r} field="supplierName" w="w-24" disabled={!canEdit} onCommit={commitCell} /></td>
                <td><BomCell r={r} field="unitCost" w="w-16" disabled={!canEdit} onCommit={commitCell} /></td>
                <td className="px-2">
                  {r.componentProductId
                    ? <span className="text-[11px] text-primary flex items-center gap-1"><Boxes size={11} />{components.find((c) => c.id === r.componentProductId)?.name || '零部件'}</span>
                    : <span className="text-muted-foreground text-xs">—</span>}
                </td>
                <td className="px-2">
                  {canEdit && (
                    <button onClick={() => { if (confirm('删除此行？')) delM.mutate({ id: r.id }); }} className="text-muted-foreground hover:text-destructive">
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {canEdit && (
              <tr className="border-t border-border bg-secondary">
                <td><input value={draft.partNumber} onChange={(e) => setDraft({ ...draft, partNumber: e.target.value })} placeholder="料号" className="w-24 px-1.5 py-1.5 text-sm bg-transparent" /></td>
                <td><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="名称*" className="w-40 px-1.5 py-1.5 text-sm bg-transparent" /></td>
                <td><input value={draft.spec} onChange={(e) => setDraft({ ...draft, spec: e.target.value })} placeholder="规格" className="w-32 px-1.5 py-1.5 text-sm bg-transparent" /></td>
                <td><input type="number" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: parseInt(e.target.value) || 1 })} className="w-14 px-1.5 py-1.5 text-sm bg-transparent" /></td>
                <td><input value={draft.refDesignator} onChange={(e) => setDraft({ ...draft, refDesignator: e.target.value })} placeholder="位号" className="w-20 px-1.5 py-1.5 text-sm bg-transparent" /></td>
                <td><input value={draft.supplierName} onChange={(e) => setDraft({ ...draft, supplierName: e.target.value })} placeholder="供应商" className="w-24 px-1.5 py-1.5 text-sm bg-transparent" /></td>
                <td><input value={draft.unitCost} onChange={(e) => setDraft({ ...draft, unitCost: e.target.value })} placeholder="单价" className="w-16 px-1.5 py-1.5 text-sm bg-transparent" /></td>
                <td>
                  <select value={draft.componentProductId} onChange={(e) => setDraft({ ...draft, componentProductId: e.target.value })} className="w-28 px-1 py-1.5 text-xs rounded-md bg-card border border-border">
                    <option value="">无</option>
                    {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className="px-2">
                  <button
                    onClick={() => {
                      if (!draft.name.trim()) { toast.error('请输入名称'); return; }
                      addM.mutate({ projectId, line: { ...draft, componentProductId: draft.componentProductId || null } });
                      setDraft({ ...EMPTY });
                    }}
                    className="text-primary hover:opacity-80"
                  ><Plus size={15} /></button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
