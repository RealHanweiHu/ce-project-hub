// GateReviewModal: gate review history list + new review form
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Flag, CheckCircle2, AlertCircle, XCircle, Users, Calendar,
  FileText, ClipboardCheck, Plus, ChevronDown, ChevronRight, RotateCcw,
} from 'lucide-react';
import { GateReview } from '@/lib/data';
import { GATE_DECISIONS } from '@shared/const';
import { toLocalISODate } from '@/lib/utils';
import { GateReadinessChecklist } from './GateReadinessChecklist';
import type { SOPGateStandard } from '@/lib/sop-templates';
import { GateStandardPanel } from '@/components/shared/GateStandardPanel';
import { nanoid } from 'nanoid';

// ── Decision config ───────────────────────────────────────────────────────────
export const DECISION_CONFIG: Record<GateReview['decision'], {
  label: string; desc: string; color: string; bg: string; border: string; icon: React.ReactNode;
  badgeColor: string; badgeBg: string; badgeBorder: string;
}> = {
  approved: {
    label: '通过', desc: '无条件通过，进入下一阶段',
    color: 'text-[color:var(--success)]', bg: 'bg-[color:var(--success-soft)]', border: 'border-[color:var(--success)]',
    badgeColor: 'text-[color:var(--success)]', badgeBg: 'bg-[color:var(--success-soft)]', badgeBorder: 'border-border',
    icon: <CheckCircle2 size={14} className="text-[color:var(--success)]" />,
  },
  conditional: {
    label: '有条件通过', desc: '满足指定条件后方可进入下一阶段',
    color: 'text-[color:var(--warning)]', bg: 'bg-[color:var(--warning-soft)]', border: 'border-[color:var(--warning)]',
    badgeColor: 'text-[color:var(--warning)]', badgeBg: 'bg-[color:var(--warning-soft)]', badgeBorder: 'border-border',
    icon: <AlertCircle size={14} className="text-[color:var(--warning)]" />,
  },
  rejected: {
    label: '未通过', desc: '需整改后重新评审',
    color: 'text-destructive', bg: 'bg-[color:var(--destructive-soft)]', border: 'border-destructive',
    badgeColor: 'text-destructive', badgeBg: 'bg-[color:var(--destructive-soft)]', badgeBorder: 'border-border',
    icon: <XCircle size={14} className="text-destructive" />,
  },
};

// ── GateReviewBadge (compact display) ────────────────────────────────────────
export function GateReviewBadge({ review, size = 'sm' }: { review: GateReview; size?: 'sm' | 'xs' }) {
  const cfg = DECISION_CONFIG[review.decision];
  const isXs = size === 'xs';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] border num ${cfg.badgeBg} ${cfg.badgeBorder} ${cfg.badgeColor} ${isXs ? 'text-[9px]' : 'text-[10px]'}`}>
      {cfg.icon}
      <span className="font-semibold">{cfg.label}</span>
      {!isXs && <span className="opacity-60">· {review.reviewDate}</span>}
    </span>
  );
}

function ReviewTraceSummary({ review }: { review: GateReview }) {
  const trace = review.traceSnapshot;
  if (!trace) return null;
  const productLabel = trace.product
    ? `${trace.product.productNumber || trace.product.id} · ${trace.product.name}`
    : '未关联产品';
  const baseRevision = trace.baseRevision?.revisionLabel || '无基准版本';
  const customerLabels = trace.customerVariants
    .slice(0, 3)
    .map((variant) => `${variant.customerName || variant.customerId || variant.variantCode}${variant.customerBomRevision ? ` ${variant.customerBomRevision}` : ''}`);
  return (
    <div className="rounded-[7px] border border-border bg-secondary/40 p-2 text-xs">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        <ClipboardCheck size={11} />
        Gate Trace
      </div>
      <div className="mt-1 grid gap-1 text-muted-foreground sm:grid-cols-2">
        <div className="truncate">
          <span className="text-foreground">产品：</span>{productLabel}
        </div>
        <div>
          <span className="text-foreground">基准版本：</span>{baseRevision}
        </div>
        <div>
          <span className="text-foreground">工作 BOM：</span>{trace.workingBom.lineCount} 行
        </div>
        <div className="truncate">
          <span className="text-foreground">客户版本：</span>
          {trace.customerVariants.length > 0 ? `${trace.customerVariants.length} 个${customerLabels.length ? ` · ${customerLabels.join(' / ')}` : ''}` : '无'}
        </div>
      </div>
    </div>
  );
}

// ── Review History Item ───────────────────────────────────────────────────────
function ReviewHistoryItem({ review, index, total }: { review: GateReview; index: number; total: number }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = DECISION_CONFIG[review.decision];
  const round = review.roundNumber ?? (index + 1);
  const isLatest = index === total - 1;

  return (
    <div className={`border-l-2 pl-4 pb-4 relative ${cfg.border}`}>
      {/* Timeline dot */}
      <div
        className="absolute -left-[5px] top-0 w-2 h-2 rounded-full border-2 border-card"
        style={{
          background:
            review.decision === 'approved' ? 'var(--success)' :
            review.decision === 'conditional' ? 'var(--warning)' : 'var(--destructive)',
        }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] num text-muted-foreground uppercase tracking-widest">
            第 {round} 次评审{isLatest ? ' · 最新' : ''}
          </span>
          <GateReviewBadge review={review} />
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="num">{review.reviewDate}</span>
        <span>·</span>
        <span>{review.participants}</span>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {review.conditions && (
            <div className="text-xs">
              <span className="text-muted-foreground">通过条件：</span>
              <span className="text-[color:var(--warning)]">{review.conditions}</span>
            </div>
          )}
          {review.notes && (
            <div className="text-xs text-muted-foreground italic border-l border-border pl-2">{review.notes}</div>
          )}
          <ReviewTraceSummary review={review} />
        </div>
      )}
    </div>
  );
}

// ── New Review Form ───────────────────────────────────────────────────────────
interface ReviewFormState {
  reviewDate: string;
  participants: string;
  decision: GateReview['decision'];
  conditions: string;
  notes: string;
}

function NewReviewForm({
  roundNumber,
  allowedDecisions,
  onSubmit,
  onCancel,
}: {
  roundNumber: number;
  /** 可选的决议项：管理层三项全开；项目经理（仅召集权）只能记录「不通过」 */
  allowedDecisions: GateReview['decision'][];
  onSubmit: (form: ReviewFormState) => void;
  onCancel: () => void;
}) {
  const today = toLocalISODate();
  const [form, setForm] = useState<ReviewFormState>({
    reviewDate: today,
    participants: '',
    decision: allowedDecisions.includes('approved') ? 'approved' : allowedDecisions[0],
    conditions: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.reviewDate) e.reviewDate = '请填写评审日期';
    if (!form.participants.trim()) e.participants = '请填写参与人员';
    if (form.decision === 'conditional' && !form.conditions.trim()) {
      e.conditions = '有条件通过需填写具体条件';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) onSubmit(form);
  };

  const selectedCfg = DECISION_CONFIG[form.decision];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <RotateCcw size={13} className="text-primary" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          第 {roundNumber} 次评审
        </span>
      </div>

      {/* Decision */}
      <div>
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 block">
          评审决议 <span className="text-destructive">*</span>
        </label>
        <div className={allowedDecisions.length === 3 ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-1 gap-2'}>
          {(Object.entries(DECISION_CONFIG) as [GateReview['decision'], typeof DECISION_CONFIG[GateReview['decision']]][])
            .filter(([val]) => allowedDecisions.includes(val))
            .map(([val, cfg]) => (
            <button
              key={val}
              type="button"
              onClick={() => setForm((f) => ({ ...f, decision: val }))}
              className={`flex flex-col items-center gap-1 p-2.5 rounded-[7px] border-2 transition-all text-center ${
                form.decision === val
                  ? `${cfg.border} ${cfg.bg} ${cfg.color}`
                  : 'border-border bg-card text-muted-foreground hover:border-[color:var(--acc-border)]'
              }`}
            >
              {cfg.icon}
              <span className="text-xs font-semibold">{cfg.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Date */}
      <div>
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <Calendar size={10} /> 评审日期 <span className="text-destructive">*</span>
        </label>
        <input
          type="date"
          value={form.reviewDate}
          onChange={(e) => setForm((f) => ({ ...f, reviewDate: e.target.value }))}
          className={`w-full text-sm rounded-[7px] border px-3 py-2 outline-none num transition-colors ${
            errors.reviewDate ? 'border-destructive bg-[color:var(--destructive-soft)]' : 'border-border focus:border-primary'
          }`}
        />
        {errors.reviewDate && <p className="text-xs text-destructive mt-1">{errors.reviewDate}</p>}
      </div>

      {/* Participants */}
      <div>
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <Users size={10} /> 参与人员 <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={form.participants}
          onChange={(e) => setForm((f) => ({ ...f, participants: e.target.value }))}
          placeholder="例：张伟、李明、王芳（主持人）"
          className={`w-full text-sm rounded-[7px] border px-3 py-2 outline-none transition-colors ${
            errors.participants ? 'border-destructive bg-[color:var(--destructive-soft)]' : 'border-border focus:border-primary'
          }`}
        />
        {errors.participants && <p className="text-xs text-destructive mt-1">{errors.participants}</p>}
      </div>

      {/* Conditions */}
      {form.decision === 'conditional' && (
        <div>
          <label className="text-[10px] uppercase tracking-widest text-[color:var(--warning)] mb-1.5 flex items-center gap-1.5">
            <AlertCircle size={10} /> 通过条件 <span className="text-destructive">*</span>
          </label>
          <textarea
            value={form.conditions}
            onChange={(e) => setForm((f) => ({ ...f, conditions: e.target.value }))}
            rows={3}
            placeholder="请列明需满足的具体条件..."
            className={`w-full text-sm rounded-[7px] border px-3 py-2 outline-none resize-none transition-colors ${
              errors.conditions ? 'border-destructive bg-[color:var(--destructive-soft)]' : 'border-[color:var(--warning)] bg-[color:var(--warning-soft)] focus:border-[color:var(--warning)]'
            }`}
          />
          {errors.conditions && <p className="text-xs text-destructive mt-1">{errors.conditions}</p>}
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <FileText size={10} /> 会议记录 / 决策说明
        </label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={3}
          placeholder="记录评审讨论要点、风险识别、后续行动项..."
          className="w-full text-sm rounded-[7px] border border-border px-3 py-2 outline-none resize-none focus:border-primary transition-colors"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-2 text-sm font-medium text-muted-foreground rounded-[7px] border border-border hover:bg-secondary transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="flex-1 px-3 py-2 text-sm font-semibold text-white rounded-[7px] transition-colors flex items-center justify-center gap-1.5"
          style={{
            background:
              form.decision === 'approved' ? 'var(--success)' :
              form.decision === 'conditional' ? 'var(--warning)' : 'var(--destructive)',
          }}
        >
          {selectedCfg.icon}
          确认 · {selectedCfg.label}
        </button>
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
interface GateReviewModalProps {
  open: boolean;
  phaseId: string;
  phaseName: string;
  gateName: string;
  gateStandard?: SOPGateStandard;
  existingReviews?: GateReview[];
  /** 就绪检查未通过项;非空时提示评审改走「有条件通过」并记录例外（projectId+gateTaskId 缺省时的回退展示） */
  blockers?: string[];
  /** 提供 projectId + gateTaskId 时，改用服务端就绪度清单，取代源错的客户端 blockers 展示 */
  projectId?: string;
  gateTaskId?: string;
  /** 是否允许在就绪清单里上传/删除交付物证据（viewer 等无权者隐藏按钮） */
  canEditDeliverables?: boolean;
  canQualityGateBlock?: boolean;
  canNpiGateBlock?: boolean;
  onConfirm: (review: GateReview) => void;
  onCancel: () => void;
  readOnly?: boolean;
  /** 决策权（approved/conditional）；false 时仅召集权——只能记录「不通过」的评审 */
  canDecide?: boolean;
}

export function GateReviewModal({
  open, phaseId, phaseName, gateName, gateStandard, existingReviews = [], blockers = [], projectId, gateTaskId, canEditDeliverables = false, canQualityGateBlock = false, canNpiGateBlock = false, onConfirm, onCancel, readOnly = false, canDecide = true,
}: GateReviewModalProps) {
  // readOnly（无 canGateReview 权限）绝不能进表单：否则用户填完提交被静默丢弃
  const [showForm, setShowForm] = useState(existingReviews.length === 0 && !readOnly);
  const latestReview = existingReviews[existingReviews.length - 1];
  const nextRound = existingReviews.length + 1;

  const handleSubmit = (form: ReviewFormState) => {
    const review: GateReview = {
      id: `gr_${nanoid(8)}`,
      phaseId,
      phaseName,
      gateName,
      reviewDate: form.reviewDate,
      participants: form.participants,
      decision: form.decision,
      conditions: form.conditions,
      notes: form.notes,
      createdAt: new Date().toISOString(),
      roundNumber: nextRound,
    };
    onConfirm(review);
    setShowForm(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-[7px] bg-primary flex items-center justify-center shrink-0">
              <Flag size={16} className="text-white" />
            </div>
            <div>
              <DialogTitle className="text-xl text-foreground">Gate 评审记录</DialogTitle>
              <DialogDescription className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
                查看就绪度、补齐证据并记录评审结论
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Phase Info */}
        <div className="bg-secondary border border-border rounded-[9px] p-3 mb-4">
          <div className="flex items-center gap-2 mb-0.5">
            <ClipboardCheck size={12} className="text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">评审节点</span>
          </div>
          <div className="text-sm font-medium text-foreground">{phaseName}</div>
          <div className="text-xs text-muted-foreground num">{gateName}</div>
        </div>

        {/* 就绪度：有 projectId+gateTaskId 时用服务端清单，否则回退到传入的 blockers */}
        {projectId && gateTaskId ? (
          <GateReadinessChecklist
            projectId={projectId}
            phaseId={phaseId}
            gateTaskId={gateTaskId}
            canEdit={canEditDeliverables}
            canQualityGateBlock={canQualityGateBlock}
            canNpiGateBlock={canNpiGateBlock}
          />
        ) : blockers.length > 0 ? (
          <div className="border border-[color:var(--warning)] bg-[color:var(--warning-soft)] rounded-[9px] p-3 mb-4">
            <div className="text-[11px] font-semibold text-[color:var(--warning)] mb-1">⚠ 就绪检查未通过</div>
            <ul className="text-xs text-[color:var(--warning)] list-disc pl-4 space-y-0.5">
              {blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
            <div className="text-[11px] text-[color:var(--warning)] mt-1.5">建议补齐后通过;如需放行,请选「有条件通过」并在条件里写明例外项的责任人与截止日期。</div>
          </div>
        ) : null}

        {/* 首屏聚焦（P0-5）：完整标准与历史记录默认折叠，首屏只留未达成项与评审操作 */}
        {gateStandard && (
          <details className="group border border-border rounded-[9px] mb-4">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
              Gate 管理标准（准入 / 准出条件）
            </summary>
            <div className="px-3 pb-3">
              <GateStandardPanel standard={gateStandard} compact evidenceHint />
            </div>
          </details>
        )}

        {/* History：默认折叠，摘要行保留最近一次结论 */}
        {existingReviews.length > 0 && (
          <details className="group border border-border rounded-[9px] mb-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
              评审历史 · {existingReviews.length} 次
              <span className="ml-auto normal-case tracking-normal">
                <GateReviewBadge review={existingReviews[existingReviews.length - 1]} size="xs" />
              </span>
            </summary>
            <div className="space-y-0 px-3 pb-3">
              {existingReviews.map((r, i) => (
                <ReviewHistoryItem key={r.id} review={r} index={i} total={existingReviews.length} />
              ))}
            </div>
          </details>
        )}

        {/* Add new review or show button */}
        {showForm && !readOnly ? (
          <div className="space-y-3">
            {!canDecide && (
              <div className="flex items-start gap-2 p-3 rounded-[9px] bg-secondary border border-border text-xs text-muted-foreground">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <span>你有评审召集权：可记录「不通过」的评审会议；「通过 / 有条件通过」需由管理层（manager/owner）签署。</span>
              </div>
            )}
            <NewReviewForm
              roundNumber={nextRound}
              allowedDecisions={canDecide ? [...GATE_DECISIONS] : ['rejected']}
              onSubmit={handleSubmit}
              onCancel={() => existingReviews.length > 0 ? setShowForm(false) : onCancel()}
            />
          </div>
        ) : (
          <div className="space-y-2">
            {latestReview?.decision === 'rejected' && (
              <div className="flex items-start gap-2 p-3 rounded-[9px] bg-[color:var(--warning-soft)] border border-[color:var(--warning)] text-xs text-[color:var(--warning)]">
                <RotateCcw size={13} className="shrink-0 mt-0.5 text-[color:var(--warning)]" />
                <span>上次评审未通过，整改完成后可发起重新评审。</span>
              </div>
            )}
            {!readOnly && (
              <button
                onClick={() => setShowForm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-[7px] border border-dashed border-[color:var(--acc-border)] text-primary hover:bg-[color:var(--acc-soft)] transition-colors"
              >
                <Plus size={14} />
                {latestReview?.decision === 'rejected' ? '发起重新评审' : '新增评审记录'}
              </button>
            )}
            {readOnly && (
              <div className="flex items-start gap-2 p-3 rounded-[9px] bg-secondary border border-border text-xs text-muted-foreground">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <span>
                  仅管理层（manager/owner/管理员）可填写 Gate 评审结论。
                  {existingReviews.length === 0 ? '暂无评审记录——' : ''}
                  请准备好就绪度与交付物后，通知管理层进行评审。
                </span>
              </div>
            )}
            <button
              onClick={onCancel}
              className="w-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              关闭
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
