// 量产发布对话框：前置校验（产品关联 + 无开放 P0/P1）→ 发布生成 Rev。
import { useState } from 'react';
import { Rocket, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
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
  const { data: members = [] } = trpc.members.list.useQuery({ projectId }, { enabled: open });

  const [selectedProductId, setSelectedProductId] = useState('');
  const [notes, setNotes] = useState('');

  // Force-release form state
  const [overrideReason, setOverrideReason] = useState('');
  const [followUpOwner, setFollowUpOwner] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');

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

  const Check = ({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) => (
    <div className="flex items-start gap-2 text-sm">
      {ok
        ? <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 shrink-0" />
        : warn
          ? <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
          : <XCircle size={15} className="text-rose-500 mt-0.5 shrink-0" />}
      <span className="text-stone-700">{children}</span>
    </div>
  );

  // Derived gate state
  const gateDecision = precheck?.releaseGate?.decision ?? null;
  const gateOk = gateDecision === 'approved';
  const gateConditional = gateDecision === 'conditional';
  const gateWarn = gateConditional; // amber warning
  const gateCheck = gateOk ? true : false;

  // Deliverables check
  const delMissing = precheck?.deliverables?.missing ?? [];
  const delDone = precheck?.deliverables?.done ?? 0;
  const delTotal = precheck?.deliverables?.total ?? 0;
  const delOk = delMissing.length === 0;

  // Force-release form validity
  const forceFormValid =
    overrideReason.trim().length > 0 &&
    followUpOwner !== '' &&
    dueDate.length > 0;

  const blockers = precheck?.blockers ?? [];
  const blockersText = blockers.join('；');

  const handleNormalRelease = () => {
    releaseMutation.mutate({ projectId, notes: notes.trim() || undefined });
  };

  const handleForceRelease = () => {
    if (followUpOwner === '') return;
    releaseMutation.mutate({
      projectId,
      notes: notes.trim() || undefined,
      override: {
        overrideReason: overrideReason.trim(),
        followUpOwner: followUpOwner as number,
        dueDate,
      },
    });
  };

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
              {/* 前置 Gate 交付物 */}
              <div>
                <Check ok={delOk}>
                  前置 Gate 交付物{!delOk ? `（${delDone}/${delTotal}）` : ''}
                </Check>
                {!delOk && delMissing.length > 0 && (
                  <div className="ml-[23px] mt-0.5 text-[11px] text-rose-500 leading-snug">
                    缺：{delMissing.slice(0, 5).join('、')}{delMissing.length > 5 ? `…等 ${delMissing.length} 项` : ''}
                  </div>
                )}
              </div>
              {/* 前置 Gate 决议 */}
              <div>
                <Check ok={gateCheck} warn={gateWarn}>
                  {gateDecision === 'approved' && `前置 Gate 已通过（${precheck?.releaseGate?.gateName ?? ''}）`}
                  {gateDecision === 'conditional' && `前置 Gate 有条件通过（${precheck?.releaseGate?.gateName ?? ''}）`}
                  {gateDecision === 'rejected' && `前置 Gate 被拒绝（${precheck?.releaseGate?.gateName ?? ''}）`}
                  {gateDecision === null && '无前置 Gate 评审记录'}
                </Check>
                {gateConditional && precheck?.releaseGate?.conditions && (
                  <div className="ml-[23px] mt-0.5 text-[11px] text-amber-700 leading-snug bg-amber-50 border border-amber-200 p-1.5">
                    条件：{precheck.releaseGate.conditions}
                  </div>
                )}
              </div>
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

            {/* 强制发布表单（仅 canForceRelease 时渲染） */}
            {precheck?.canForceRelease && (
              <div className="space-y-3 border border-rose-200 p-3 bg-rose-50">
                <div className="text-[10px] font-mono uppercase tracking-widest text-rose-400">
                  有条件通过 — 强制发布
                </div>
                {precheck.releaseGate?.conditions && (
                  <div className="text-[11px] text-rose-700 leading-snug">
                    <span className="font-medium">须跟进条件：</span>{precheck.releaseGate.conditions}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-sm text-stone-700">强制发布理由 <span className="text-rose-500">*</span></Label>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2}
                    className="w-full border border-rose-300 text-sm px-2 py-2 bg-white"
                    placeholder="说明强制发布的原因…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-stone-700">条件跟进负责人 <span className="text-rose-500">*</span></Label>
                  <select
                    value={followUpOwner}
                    onChange={(e) => setFollowUpOwner(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full border border-rose-300 text-sm px-2 py-2 bg-white"
                  >
                    <option value="">选择负责人…</option>
                    {(members as { userId: number; userName: string | null; userEmail: string | null }[]).map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.userName || m.userEmail || `用户 #${m.userId}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-stone-700">条件跟进截止日 <span className="text-rose-500">*</span></Label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full border border-rose-300 text-sm px-2 py-2 bg-white"
                  />
                </div>
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

            {/* 阻断原因列表 */}
            {blockers.length > 0 && (
              <div className="space-y-1 border border-rose-100 p-2.5 bg-rose-50">
                <div className="text-[10px] font-mono uppercase tracking-widest text-rose-400">发布阻断</div>
                {blockers.map((b, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-rose-600">
                    <XCircle size={12} className="mt-0.5 shrink-0" />
                    {b}
                  </div>
                ))}
              </div>
            )}

            <p className="text-[11px] text-stone-400 leading-relaxed">
              发布将生成新版本（Rev）、把产品转为「量产」状态、并归档本项目。此动作不可撤销。
            </p>
          </div>
        )}

        <DialogFooter className="flex-col items-end gap-1.5">
          {/* 有条件通过但当前用户无权强制发布时的提示 */}
          {!precheck?.canRelease && !precheck?.canForceRelease && gateConditional && (
            <p className="text-[11px] text-stone-400 w-full text-right">
              需项目创建人/PM/管理者强制发布
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>

            {/* 三态按钮：普通发布 / 强制发布 / 不可发布 */}
            {precheck?.canRelease ? (
              <Button
                className="bg-amber-500 hover:bg-amber-600 text-stone-900 gap-1.5"
                disabled={releaseMutation.isPending}
                onClick={handleNormalRelease}
              >
                <Rocket size={14} />
                {releaseMutation.isPending ? '发布中…' : '确认发布'}
              </Button>
            ) : precheck?.canForceRelease ? (
              <Button
                className="bg-rose-600 hover:bg-rose-700 text-white gap-1.5"
                disabled={!forceFormValid || releaseMutation.isPending}
                onClick={handleForceRelease}
              >
                <Rocket size={14} />
                {releaseMutation.isPending ? '发布中…' : '强制发布'}
              </Button>
            ) : (
              <Button
                className="bg-stone-300 text-stone-500 gap-1.5 cursor-not-allowed"
                disabled
                title={blockersText || '发布条件未满足'}
              >
                <XCircle size={14} />
                不可发布
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
