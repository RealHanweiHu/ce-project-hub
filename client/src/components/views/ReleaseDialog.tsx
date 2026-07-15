// 项目完成与产品交付对话框：项目硬卡通过后，生成/交付独立产品；不生成 Revision。
import { useEffect, useState } from 'react';
import { Rocket, CheckCircle2, XCircle, Loader2, AlertTriangle, Send, RefreshCw } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface ReleaseDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReleased: () => void;
}

type ApprovalInstance = {
  id: number;
  status: string;
  processInstanceId: string | null;
  lastError: string | null;
};

// 模块级定义：纯展示组件，避免在父组件渲染体内重建组件类型。
function Check({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok
        ? <CheckCircle2 size={15} className="text-[color:var(--success)] mt-0.5 shrink-0" />
        : warn
          ? <AlertTriangle size={15} className="text-[color:var(--warning)] mt-0.5 shrink-0" />
          : <XCircle size={15} className="text-destructive mt-0.5 shrink-0" />}
      <span className="text-foreground">{children}</span>
    </div>
  );
}

export function ReleaseDialog({ projectId, open, onOpenChange, onReleased }: ReleaseDialogProps) {
  const utils = trpc.useUtils();
  const { data: precheck, isLoading } = trpc.products.releasePrecheck.useQuery(
    { projectId },
    { enabled: open },
  );
  const { data: members = [] } = trpc.members.list.useQuery({ projectId }, { enabled: open });

  const [productDraft, setProductDraft] = useState({ name: '', productNumber: '', category: '' });
  const [notes, setNotes] = useState('');

  // Force-release form state
  const [overrideReason, setOverrideReason] = useState('');
  const [followUpOwner, setFollowUpOwner] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    if (!open || precheck?.hasProduct) return;
    setProductDraft({
      name: precheck?.suggestedProduct.name ?? '',
      productNumber: precheck?.suggestedProduct.productNumber ?? '',
      category: precheck?.suggestedProduct.category ?? '',
    });
  }, [open, projectId, precheck?.hasProduct, precheck?.suggestedProduct.name, precheck?.suggestedProduct.productNumber, precheck?.suggestedProduct.category]);

  const releaseMutation = trpc.products.release.useMutation({
    onSuccess: (res) => {
      toast.success(res.createdProduct ? `已生成产品 ${res.productName}` : `已交付产品 ${res.productName}`);
      utils.products.list.invalidate();
      onReleased();
    },
    onError: (e) => toast.error(e.message),
  });

  const submitApprovalMutation = trpc.products.submitReleaseApproval.useMutation({
    onSuccess: (res) => {
      if (res.approval?.status === 'sync_failed') {
        toast.error(`审批已登记，但钉钉同步失败：${res.approval.lastError ?? '未知原因'}。可稍后重新发起`);
      } else {
        toast.success(res.alreadyPending ? '已有待处理审批' : '完成与产品交付审批已发起');
      }
      utils.products.releasePrecheck.invalidate({ projectId });
    },
    onError: (e) => toast.error(e.message),
  });

  const syncApprovalMutation = trpc.products.syncReleaseApproval.useMutation({
    onSuccess: (res) => {
      utils.products.releasePrecheck.invalidate({ projectId });
      utils.products.list.invalidate();
      const status = res.approval?.status;
      if (status === 'approved') {
        toast.success('审批已通过，产品交付已完成');
        onReleased();
      } else if (status === 'business_blocked') {
        toast.warning(`审批已通过，但完成操作被硬卡拦截：${res.approval?.lastError ?? ''}`);
      } else if (status === 'rejected') {
        toast.error('审批已驳回');
      } else {
        toast.success('审批状态已同步');
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // Derived gate state
  const gateDecision = precheck?.releaseGate?.decision ?? null;
  const gateOk = gateDecision === 'approved';
  const gateConditional = gateDecision === 'conditional';
  const gateWarn = gateConditional; // amber warning
  const gateCheck = gateOk;

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
  const productDraftReady = !!precheck?.hasProduct || productDraft.name.trim().length > 0;
  const outputProduct = precheck?.hasProduct ? undefined : {
    name: productDraft.name.trim(),
    productNumber: productDraft.productNumber.trim() || undefined,
    category: productDraft.category.trim() || undefined,
  };

  const blockers = precheck?.blockers ?? [];
  const blockersText = blockers.join('；');
  const approvalRequired = !!precheck?.approvalRequired;
  const approvalInstances = ((precheck as { approvalInstances?: ApprovalInstance[] } | undefined)?.approvalInstances ?? []);
  const pendingApproval = (precheck as { pendingApproval?: ApprovalInstance | null } | undefined)?.pendingApproval ?? null;
  const latestApproval = approvalInstances[0] ?? null;
  const approvalCanSubmit = approvalRequired && productDraftReady && (precheck?.canRelease || precheck?.canForceRelease) && (!precheck?.canForceRelease || forceFormValid);
  const hardCardsSatisfied =
    (precheck?.openP0P1 ?? 0) === 0 &&
    delOk &&
    gateDecision !== null &&
    gateDecision !== 'rejected';

  const handleNormalRelease = () => {
    releaseMutation.mutate({ projectId, notes: notes.trim() || undefined, product: outputProduct });
  };

  const handleForceRelease = () => {
    if (followUpOwner === '') return;
    releaseMutation.mutate({
      projectId,
      notes: notes.trim() || undefined,
      product: outputProduct,
      override: {
        overrideReason: overrideReason.trim(),
        followUpOwner: followUpOwner as number,
        dueDate,
      },
    });
  };

  const handleSubmitApproval = () => {
    submitApprovalMutation.mutate({
      projectId,
      product: outputProduct,
      override: precheck?.canForceRelease && followUpOwner !== ''
        ? {
            overrideReason: overrideReason.trim(),
            followUpOwner: followUpOwner as number,
            dueDate,
          }
        : undefined,
    });
  };

  const handleSyncApproval = () => {
    if (!pendingApproval?.processInstanceId) return;
    syncApprovalMutation.mutate({ projectId, processInstanceId: pendingApproval.processInstanceId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket size={16} className="text-primary" /> 项目完成与产品交付
          </DialogTitle>
          <DialogDescription className="sr-only">
            完成项目并将成果作为独立产品交付到产品库；此操作不生成 Revision。
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4 py-2">
            <div className={`border rounded-[9px] p-3 ${
              precheck?.canRelease
                ? 'border-[color:var(--success)] bg-[color:var(--success-soft)]'
                : precheck?.canForceRelease
                  ? 'border-[color:var(--warning)] bg-[color:var(--warning-soft)]'
                  : 'border-destructive bg-[color:var(--destructive-soft)]'
            }`}>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">完成结论</div>
              <div className="text-sm font-semibold" style={{
                color: precheck?.canRelease ? 'var(--success)' : precheck?.canForceRelease ? 'var(--warning)' : 'var(--destructive)',
              }}>
                {precheck?.alreadyReleased && '产品交付已完成，项目正在稳定期'}
                {!precheck?.alreadyReleased && precheck?.canRelease && '硬卡已满足，可以完成项目并交付产品'}
                {precheck?.canForceRelease && '硬卡已满足，但 Gate 为有条件通过'}
                {!precheck?.alreadyReleased && !precheck?.canRelease && !precheck?.canForceRelease && '硬卡未满足，暂不可完成并交付'}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground leading-snug">
                {precheck?.alreadyReleased
                  ? '请完成 2–8 周爬坡/稳定验证，并通过 Close Gate 后归档项目。'
                  : hardCardsSatisfied
                  ? gateConditional
                    ? '需要记录例外风险、跟进负责人与截止日，完成与交付责任由批准人承接。'
                    : 'P0/P1、交付物审核和 Gate 决议均已满足。'
                  : '下方红色项是完成硬卡，补齐后再拍板。'}
              </div>
            </div>

            {/* 前置校验 */}
            <div className="space-y-2 border border-border rounded-[9px] p-3 bg-secondary">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">前置校验</div>
              <Check ok={productDraftReady}>
                {precheck?.hasProduct ? `交付到产品：${precheck.productName}` : '独立产品信息已准备'}
              </Check>
              <Check ok={(precheck?.openP0P1 ?? 0) === 0}>
                无未关闭 P0/P1 问题{(precheck?.openP0P1 ?? 0) > 0 ? `（当前 ${precheck?.openP0P1} 个）` : ''}
              </Check>
              {/* 前置 Gate 交付物 */}
              <div>
                <Check ok={delOk}>
                  前置 Gate 交付物审核{!delOk ? `（${delDone}/${delTotal}）` : ''}
                </Check>
                {!delOk && delMissing.length > 0 && (
                  <div className="ml-[23px] mt-0.5 text-[11px] text-destructive leading-snug">
                    未通过：{delMissing.slice(0, 5).join('、')}{delMissing.length > 5 ? `…等 ${delMissing.length} 项` : ''}
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
                  <div className="ml-[23px] mt-0.5 text-[11px] text-[color:var(--warning)] leading-snug bg-[color:var(--warning-soft)] border border-[color:var(--warning)] rounded-[6px] p-1.5">
                    条件：{precheck.releaseGate.conditions}
                  </div>
                )}
              </div>
              {/* 其余未过的硬卡维度（前置任务/本阶段 P0P1 等）也并入本清单，
                  不再在底部用「发布阻断」红框重列一遍（同一阻塞只出现一次） */}
              {(precheck?.releaseGate?.dimensions ?? [])
                .filter((dim) => !dim.ok && dim.dimension !== 'review_conditions' && dim.dimension !== 'deliverables')
                .map((dim) => (
                  <Check key={dim.dimension} ok={false}>{dim.summary}</Check>
                ))}
            </div>

            {approvalRequired && (
              <div className="space-y-2 border border-border rounded-[9px] p-3 bg-card">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">钉钉审批</div>
                {latestApproval ? (
                  <div className="text-sm text-foreground">
                    当前状态：
                    <span className="font-semibold">
                      {latestApproval.status === 'pending' ? '待审批' :
                        latestApproval.status === 'approved' ? '已通过' :
                          latestApproval.status === 'rejected' ? '已驳回' :
                            latestApproval.status === 'business_blocked' ? '业务硬卡阻断' :
                              latestApproval.status === 'sync_failed' ? '同步失败' : latestApproval.status}
                    </span>
                    {latestApproval.processInstanceId && (
                      <span className="text-[11px] text-muted-foreground ml-2 num">{latestApproval.processInstanceId}</span>
                    )}
                    {latestApproval.lastError && (
                      <div className="text-[11px] text-destructive mt-1">{latestApproval.lastError}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">尚未发起完成与产品交付审批</div>
                )}
              </div>
            )}

            <div className="space-y-2 rounded-[9px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">输出产品</div>
              {precheck?.hasProduct ? (
                <div>
                  <div className="text-sm font-medium text-foreground">{precheck.productName}</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">该历史项目已有输出产品，本次只完成产品交付，不生成 Revision。</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="col-span-2 space-y-1">
                      <span className="text-[11px] text-foreground">产品名称 <span className="text-destructive">*</span></span>
                      <input
                        value={productDraft.name}
                        onChange={(e) => setProductDraft({ ...productDraft, name: e.target.value })}
                        className="w-full rounded-[7px] border border-border bg-card px-2 py-2 text-sm"
                        placeholder="项目完成后生成的产品名称"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-foreground">产品编号</span>
                      <input
                        value={productDraft.productNumber}
                        onChange={(e) => setProductDraft({ ...productDraft, productNumber: e.target.value })}
                        className="w-full rounded-[7px] border border-border bg-card px-2 py-2 text-sm"
                        placeholder="可沿用项目编号"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-foreground">产品分类</span>
                      <input
                        value={productDraft.category}
                        onChange={(e) => setProductDraft({ ...productDraft, category: e.target.value })}
                        className="w-full rounded-[7px] border border-border bg-card px-2 py-2 text-sm"
                        placeholder="如：充气泵"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    完成后直接在产品库生成一个独立产品。Revision 不在这里创建，仅用于后续包装、印刷、标签等轻微改版。
                  </p>
                </>
              )}
            </div>

            {/* 强制完成表单（仅 canForceRelease 时渲染） */}
            {precheck?.canForceRelease && (
              <div className="space-y-3 border border-destructive rounded-[9px] p-3 bg-[color:var(--destructive-soft)]">
                <div className="text-[10px] uppercase tracking-widest text-destructive">
                  有条件通过 — 强制完成与交付
                </div>
                {precheck.releaseGate?.conditions && (
                  <div className="text-[11px] text-destructive leading-snug">
                    <span className="font-medium">须跟进条件：</span>{precheck.releaseGate.conditions}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-sm text-foreground">强制完成理由 <span className="text-destructive">*</span></Label>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2}
                    className="w-full border border-destructive rounded-[7px] text-sm px-2 py-2 bg-card"
                    placeholder="说明强制完成与交付的原因…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-foreground">条件跟进负责人 <span className="text-destructive">*</span></Label>
                  <select
                    value={followUpOwner}
                    onChange={(e) => setFollowUpOwner(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full border border-destructive rounded-[7px] text-sm px-2 py-2 bg-card"
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
                  <Label className="text-sm text-foreground">条件跟进截止日 <span className="text-destructive">*</span></Label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full border border-destructive rounded-[7px] text-sm px-2 py-2 bg-card num"
                  />
                </div>
              </div>
            )}

            {/* 完成与产品交付说明 */}
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">完成与交付备注</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full border border-border rounded-[7px] text-sm px-2 py-2 bg-card"
                placeholder="完成说明、遗留风险、量产注意事项…"
              />
            </div>

            {/* 阻断明细已全部体现在「前置校验」逐项清单里，不再单独渲染红框重列（B4 去重） */}

            {!precheck?.alreadyReleased && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                完成操作会生成或交付一个独立产品，不生成 Revision。项目随后进入 2–8 周稳定期，Close Gate 通过后再归档。
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-col items-end gap-1.5">
          {/* 有条件通过但当前用户无权强制完成时的提示 */}
          {!precheck?.canRelease && !precheck?.canForceRelease && gateConditional && (
            <p className="text-[11px] text-muted-foreground w-full text-right">
              需项目创建人/PM/管理者强制完成与交付
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>

            {approvalRequired ? (
              pendingApproval?.processInstanceId ? (
                <Button
                  className="bg-primary hover:opacity-90 text-primary-foreground gap-1.5"
                  disabled={syncApprovalMutation.isPending}
                  onClick={handleSyncApproval}
                >
                  <RefreshCw size={14} />
                  {syncApprovalMutation.isPending ? '同步中…' : '同步审批'}
                </Button>
              ) : (
                <Button
                  className="bg-primary hover:opacity-90 text-primary-foreground gap-1.5"
                  disabled={!approvalCanSubmit || submitApprovalMutation.isPending}
                  onClick={handleSubmitApproval}
                  title={!approvalCanSubmit ? (blockersText || '审批条件未满足') : undefined}
                >
                  <Send size={14} />
                  {submitApprovalMutation.isPending ? '发起中…' : '发起审批'}
                </Button>
              )
            ) : precheck?.canRelease ? (
              <Button
                className="bg-primary hover:opacity-90 text-primary-foreground gap-1.5"
                disabled={!productDraftReady || releaseMutation.isPending}
                onClick={handleNormalRelease}
              >
                <Rocket size={14} />
                {releaseMutation.isPending ? '交付中…' : '完成并交付产品'}
              </Button>
            ) : precheck?.canForceRelease ? (
              <Button
                className="bg-destructive hover:opacity-90 text-white gap-1.5"
                disabled={!productDraftReady || !forceFormValid || releaseMutation.isPending}
                onClick={handleForceRelease}
              >
                <Rocket size={14} />
                {releaseMutation.isPending ? '交付中…' : '强制完成并交付'}
              </Button>
            ) : (
              <Button
                className="bg-secondary text-muted-foreground gap-1.5 cursor-not-allowed"
                disabled
                title={blockersText || '完成条件未满足'}
              >
                <XCircle size={14} />
                暂不可完成
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
