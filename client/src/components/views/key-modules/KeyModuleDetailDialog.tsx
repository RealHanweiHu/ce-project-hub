import { GitBranch, Pencil, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MODULE_STATUS_LABEL, MODULE_TYPE_LABEL, type KeyModuleBundle } from './types';

export function KeyModuleDetailDialog({ open, onOpenChange, detail, loading, canApprove, pending, onEdit, onConfirm, onApprove, onReturn, onDerive, onRestrict, onObsolete }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail?: KeyModuleBundle | null;
  loading: boolean;
  canApprove: boolean;
  pending: boolean;
  onEdit: () => void;
  onConfirm: () => void;
  onApprove: () => void;
  onReturn: () => void;
  onDerive: () => void;
  onRestrict: () => void;
  onObsolete: () => void;
}) {
  const module = detail?.module;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {module?.moduleNumber ?? '关键模块'}
            {module && <Badge variant="outline">{MODULE_STATUS_LABEL[module.status]}</Badge>}
          </DialogTitle>
          <DialogDescription>{module ? `${MODULE_TYPE_LABEL[module.moduleType]} · ${module.name}` : '正在读取模块定义'}</DialogDescription>
        </DialogHeader>
        {loading || !detail ? <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div> : (
          <div className="space-y-5">
            <dl className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-4 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">适用品类</dt><dd className="mt-1 font-medium">{module?.category || '未限定'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">型号</dt><dd className="mt-1 font-medium">{module?.model || '—'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">派生来源</dt><dd className="mt-1 font-medium">{module?.derivedFromModuleId || '原始定义'}</dd></div>
            </dl>
            {module?.restrictionReason && <p className="rounded-lg border border-border bg-secondary p-3 text-sm">{module.restrictionReason}</p>}
            <section aria-labelledby="module-bom-title">
              <h3 id="module-bom-title" className="mb-2 text-sm font-semibold">内部 BOM · {detail.items.length} 项</h3>
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader><TableRow><TableHead>部件编号</TableHead><TableHead>名称</TableHead><TableHead>规格</TableHead><TableHead>数量</TableHead><TableHead>位号</TableHead></TableRow></TableHeader>
                  <TableBody>{detail.items.map(item => <TableRow key={item.id}><TableCell className="font-medium">{item.partNumber}</TableCell><TableCell>{item.name}</TableCell><TableCell className="max-w-[260px] truncate">{item.spec || '—'}</TableCell><TableCell>{item.quantity}</TableCell><TableCell>{item.refDesignator || '—'}</TableCell></TableRow>)}</TableBody>
                </Table>
              </div>
            </section>
          </div>
        )}
        {module && <DialogFooter className="flex-wrap sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {module.status === 'draft' && <><Button variant="outline" onClick={onEdit}><Pencil size={14} /> 编辑</Button><Button onClick={onConfirm} disabled={pending}><ShieldCheck size={14} /> 技术确认</Button></>}
            {module.status === 'technical_confirmed' && canApprove && <><Button variant="outline" onClick={onReturn} disabled={pending}>退回草稿</Button><Button onClick={onApprove} disabled={pending}>批准项目选用</Button></>}
            {(module.status === 'approved' || module.status === 'restricted' || module.status === 'obsolete') && <Button variant="outline" onClick={onDerive}><GitBranch size={14} /> 派生新编号</Button>}
          </div>
          {canApprove && <div className="flex gap-2">{module.status === 'approved' && <Button variant="ghost" onClick={onRestrict}>限制选用</Button>}{module.status === 'restricted' && <Button variant="ghost" onClick={onObsolete}>停用</Button>}</div>}
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

