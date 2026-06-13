// 量产发布对话框：前置校验（产品关联 + 无开放 P0/P1）→ 发布生成 Rev。
import { useState } from 'react';
import { Rocket, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface ReleaseDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReleased: () => void;
}

export function ReleaseDialog({ projectId, open, onOpenChange, onReleased }: ReleaseDialogProps) {
  const utils = trpc.useUtils();
  const { data: precheck, isLoading } = trpc.products.releasePrecheck.useQuery(
    { projectId },
    { enabled: open },
  );
  const { data: products = [] } = trpc.products.list.useQuery(undefined, { enabled: open });

  const [selectedProductId, setSelectedProductId] = useState('');
  const [notes, setNotes] = useState('');

  const setProjectMutation = trpc.products.setProject.useMutation({
    onSuccess: () => {
      utils.products.releasePrecheck.invalidate({ projectId });
      toast.success('已关联产品');
    },
    onError: (e) => toast.error(e.message),
  });

  const releaseMutation = trpc.products.release.useMutation({
    onSuccess: (res) => {
      toast.success(`已发布 ${res.revisionLabel}`);
      utils.products.list.invalidate();
      onReleased();
    },
    onError: (e) => toast.error(e.message),
  });

  const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 size={15} className="text-emerald-500" /> : <XCircle size={15} className="text-rose-500" />}
      <span className={ok ? 'text-stone-700' : 'text-stone-700'}>{children}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <Rocket size={16} className="text-amber-500" /> 量产发布
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-amber-500" /></div>
        ) : (
          <div className="space-y-4 py-2">
            {/* 前置校验 */}
            <div className="space-y-2 border border-stone-200 p-3 bg-stone-50">
              <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400">前置校验</div>
              <Check ok={!!precheck?.hasProduct}>已关联产品</Check>
              <Check ok={(precheck?.openP0P1 ?? 0) === 0}>
                无未关闭 P0/P1 问题{(precheck?.openP0P1 ?? 0) > 0 ? `（当前 ${precheck?.openP0P1} 个）` : ''}
              </Check>
            </div>

            {/* 未关联产品 → 关联 */}
            {!precheck?.hasProduct && (
              <div className="space-y-1.5">
                <Label className="text-sm text-stone-700">关联产品</Label>
                <div className="flex gap-2">
                  <select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="flex-1 border border-stone-300 text-sm px-2 py-2 bg-white"
                  >
                    <option value="">选择产品…</option>
                    {(products as { id: string; name: string; category: string }[]).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}（{p.category || '未分类'}）</option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    disabled={!selectedProductId || setProjectMutation.isPending}
                    onClick={() => setProjectMutation.mutate({ projectId, productId: selectedProductId })}
                  >关联</Button>
                </div>
                <p className="text-[11px] text-stone-400">产品库里没有？先去「产品库」新建。</p>
              </div>
            )}

            {/* 发布说明 */}
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-700">量产注意事项 / 备注</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full border border-stone-300 text-sm px-2 py-2 bg-white"
                placeholder="发布说明、风险、量产注意事项…"
              />
            </div>

            <p className="text-[11px] text-stone-400 leading-relaxed">
              发布将生成新版本（Rev）、把产品转为「量产」状态、并归档本项目。此动作不可撤销。
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            className="bg-amber-500 hover:bg-amber-600 text-stone-900 gap-1.5"
            disabled={!precheck?.canRelease || releaseMutation.isPending}
            onClick={() => releaseMutation.mutate({ projectId, notes: notes.trim() || undefined })}
          >
            <Rocket size={14} />
            {releaseMutation.isPending ? '发布中…' : '确认发布'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
