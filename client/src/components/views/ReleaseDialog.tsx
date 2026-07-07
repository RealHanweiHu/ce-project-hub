// 量产发布对话框：前置校验（产品关联 + 无开放 P0/P1）→ 发布生成 Rev。
import { useState } from 'react';
import { Rocket, CheckCircle2, XCircle, Loader2, AlertTriangle, Send, RefreshCw } from 'lucide-react';
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

  const submitApprovalMutation = trpc.products.submitReleaseApproval.useMutation({
    onSuccess: (res) => {
      if (res.approval?.status === 'sync_failed') {
        toast.error(`审批已登记，但钉钉同步失败：${res.approval.lastError ?? '未知原因'}。可稍后重新发起`);
      } else {
        toast.success(res.alreadyPending ? '已有待处理审批' : '发布审批已发起');
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
        toast.success('审批已通过，发布已完成');
        onReleased();
      } else if (status === 'business_blocked') {
        toast.warning(`审批已通过，但发布被硬卡拦截：${res.approval?.lastError ?? ''}`);
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

  const blockers = precheck?.blockers ?? [];
  const blockersText = blockers.join('；');
  const approvalRequired = !!precheck?.approvalRequired;
  const approvalInstances = ((precheck as { approvalInstances?: ApprovalInstance[] } | undefined)?.approvalInstances ?? []);
  const pendingApproval = (precheck as { pendingApproval?: ApprovalInstance | null } | undefined)?.pendingApproval ?? null;
  const latestApproval = approvalInstances[0] ?? null;
  const approvalCanSubmit = approvalRequired && (precheck?.canRelease || precheck?.canForceRelease) && (!precheck?.canForceRelease || forceFormValid);
  const hardCardsSatisfied =
    !!precheck?.hasProduct &&
    (precheck?.openP0P1 ?? 0) === 0 &&
    delOk &&
    gateDecision !== null &&
    gateDecision !== 'rejected';

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

  const handleSubmitApproval = () => {
    submitApprovalMutation.mutate({
      projectId,
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
            <Rocket size={16} className="text-primary" /> 量产发布
          </DialogTitle>
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
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">发布结论</div>
              <div className="text-sm font-semibold" style={{
                color: precheck?.canRelease ? 'var(--success)' : precheck?.canForceRelease ? 'var(--warning)' : 'var(--destructive)',
              }}>
                {precheck?.canRelease && '硬卡已满足，可以正常发布'}
                {precheck?.canForceRelease && '硬卡已满足，但 Gate 为有条件通过'}
                {!precheck?.canRelease && !precheck?.canForceRelease && '硬卡未满足，暂不可发布'}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground leading-snug">
                {hardCardsSatisfied
                  ? gateConditional
                    ? '需要记录例外风险、跟进负责人与截止日，发布责任由批准人承接。'
                    : '产品、P0/P1、交付物审核、Gate 决议均已满足。'
                  : '下方红色项是发布硬卡，补齐后再拍板。'}
              </div>
            </div>

            {/* 前置校验 */}
            <div className="space-y-2 border border-border rounded-[9px] p-3 bg-secondary">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">前置校验</div>
              <Check ok={!!precheck?.hasProduct}>已关联产品</Check>
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
                  <div className="text-sm text-muted-foreground">尚未发起发布审批</div>
                )}
              </div>
            )}

            {/* 未关联产品 → 关联 */}
            {!precheck?.hasProduct && (
              <div className="space-y-1.5">
                <Label className="text-sm text-foreground">关联产品</Label>
                <div className="flex gap-2">
                  <select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="flex-1 border border-border rounded-[7px] text-sm px-2 py-2 bg-card"
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
                <p className="text-[11px] text-muted-foreground">产品库里没有？先去「产品库」新建。</p>
              </div>
            )}

            {/* 强制发布表单（仅 canForceRelease 时渲染） */}
            {precheck?.canForceRelease && (
              <div className="space-y-3 border border-destructive rounded-[9px] p-3 bg-[color:var(--destructive-soft)]">
                <div className="text-[10px] uppercase tracking-widest text-destructive">
                  有条件通过 — 强制发布
                </div>
                {precheck.releaseGate?.conditions && (
                  <div className="text-[11px] text-destructive leading-snug">
                    <span className="font-medium">须跟进条件：</span>{precheck.releaseGate.conditions}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-sm text-foreground">强制发布理由 <span className="text-destructive">*</span></Label>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2}
                    className="w-full border border-destructive rounded-[7px] text-sm px-2 py-2 bg-card"
                    placeholder="说明强制发布的原因…"
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

            {/* 发布说明 */}
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">量产注意事项 / 备注</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full border border-border rounded-[7px] text-sm px-2 py-2 bg-card"
                placeholder="发布说明、风险、量产注意事项…"
              />
            </div>

            {/* 阻断原因列表（可强制发布时由上方强制表单替代，避免红框与表单并存） */}
            {blockers.length > 0 && !precheck?.canForceRelease && (
              <div className="space-y-1 border border-destructive rounded-[9px] p-2.5 bg-[color:var(--destructive-soft)]">
                <div className="text-[10px] uppercase tracking-widest text-destructive">发布阻断</div>
                {blockers.map((b, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-destructive">
                    <XCircle size={12} className="mt-0.5 shrink-0" />
                    {b}
                  </div>
                ))}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              发布将生成新版本（Rev）、把产品转为「量产」状态、并归档本项目。此动作不可撤销。
            </p>
          </div>
        )}

        <DialogFooter className="flex-col items-end gap-1.5">
          {/* 有条件通过但当前用户无权强制发布时的提示 */}
          {!precheck?.canRelease && !precheck?.canForceRelease && gateConditional && (
            <p className="text-[11px] text-muted-foreground w-full text-right">
              需项目创建人/PM/管理者强制发布
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
                disabled={releaseMutation.isPending}
                onClick={handleNormalRelease}
              >
                <Rocket size={14} />
                {releaseMutation.isPending ? '发布中…' : '确认发布'}
              </Button>
            ) : precheck?.canForceRelease ? (
              <Button
                className="bg-destructive hover:opacity-90 text-white gap-1.5"
                disabled={!forceFormValid || releaseMutation.isPending}
                onClick={handleForceRelease}
              >
                <Rocket size={14} />
                {releaseMutation.isPending ? '发布中…' : '强制发布'}
              </Button>
            ) : (
              <Button
                className="bg-secondary text-muted-foreground gap-1.5 cursor-not-allowed"
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
