import { GitBranch, History, Pencil, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MODULE_STATUS_LABEL, MODULE_TYPE_LABEL, type KeyModuleBundle, type KeyModuleStatus } from './types';

type KeyModuleHistoryRow = {
  id: number;
  action: string;
  fromStatus: KeyModuleStatus | null;
  toStatus: KeyModuleStatus | null;
  actorId: number;
  actorName: string | null;
  actorUsername: string | null;
  reason: string | null;
  createdAt: Date | string;
};

const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: '创建模块',
  update_draft: '更新草稿',
  technical_confirm: '完成技术确认',
  return_to_draft: '退回草稿',
  approve: '批准项目选用',
  restrict: '限制新项目选用',
  obsolete: '停用模块',
  derive: '派生新模块编号',
};

export function KeyModuleDetailDialog({ open, onOpenChange, detail, loading, history, historyLoading, canApprove, pending, onEdit, onConfirm, onApprove, onReturn, onDerive, onRestrict, onObsolete }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail?: KeyModuleBundle | null;
  loading: boolean;
  history: KeyModuleHistoryRow[];
  historyLoading: boolean;
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
            <section aria-labelledby="module-history-title">
              <h3 id="module-history-title" className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <History size={14} className="text-muted-foreground" /> 审批与变更记录
              </h3>
              <div className="rounded-lg border border-border bg-secondary/20">
                {historyLoading ? (
                  <div className="px-4 py-5 text-center text-xs text-muted-foreground">读取审计记录…</div>
                ) : history.length === 0 ? (
                  <div className="px-4 py-5 text-center text-xs text-muted-foreground">暂无审计记录</div>
                ) : (
                  <ol className="divide-y divide-border">
                    {history.map(event => (
                      <li key={event.id} className="grid gap-1 px-4 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">
                            {AUDIT_ACTION_LABEL[event.action] ?? event.action}
                            {event.fromStatus && event.toStatus && event.fromStatus !== event.toStatus ? (
                              <span className="ml-2 font-normal text-muted-foreground">
                                {MODULE_STATUS_LABEL[event.fromStatus]} → {MODULE_STATUS_LABEL[event.toStatus]}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            操作人：{event.actorName || event.actorUsername || `用户 ${event.actorId}`}
                            {event.reason ? ` · ${event.reason}` : ''}
                          </div>
                        </div>
                        <time className="text-[10px] text-muted-foreground" dateTime={new Date(event.createdAt).toISOString()}>
                          {new Date(event.createdAt).toLocaleString('zh-CN')}
                        </time>
                      </li>
                    ))}
                  </ol>
                )}
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
