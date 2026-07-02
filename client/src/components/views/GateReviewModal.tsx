// GateReviewModal: gate review history list + new review form
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Flag, CheckCircle2, AlertCircle, XCircle, Users, Calendar,
  FileText, ClipboardCheck, Plus, ChevronDown, ChevronRight, RotateCcw,
} from 'lucide-react';
import { GateReview } from '@/lib/data';
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
  onSubmit,
  onCancel,
}: {
  roundNumber: number;
  onSubmit: (form: ReviewFormState) => void;
  onCancel: () => void;
}) {
  const today = toLocalISODate();
  const [form, setForm] = useState<ReviewFormState>({
    reviewDate: today,
    participants: '',
    decision: 'approved',
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
        <div className="grid grid-cols-3 gap-2">
          {(Object.entries(DECISION_CONFIG) as [GateReview['decision'], typeof DECISION_CONFIG[GateReview['decision']]][]).map(([val, cfg]) => (
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
  /** 提供 projectId + gateTaskId 时，改用服务端就绪度清单（4 维 + 交付物上传），取代源错的客户端 blockers 展示 */
  projectId?: string;
  gateTaskId?: string;
  onConfirm: (review: GateReview) => void;
  onCancel: () => void;
  readOnly?: boolean;
}

export function GateReviewModal({
  open, phaseId, phaseName, gateName, gateStandard, existingReviews = [], blockers = [], projectId, gateTaskId, onConfirm, onCancel, readOnly = false,
}: GateReviewModalProps) {
  const [showForm, setShowForm] = useState(existingReviews.length === 0);
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
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">GATE REVIEW HISTORY</p>
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

        {/* 就绪度：有 projectId+gateTaskId 时用服务端清单（4 维 + 交付物上传），否则回退到传入的 blockers */}
        {projectId && gateTaskId ? (
          <GateReadinessChecklist projectId={projectId} phaseId={phaseId} gateTaskId={gateTaskId} />
        ) : blockers.length > 0 ? (
          <div className="border border-[color:var(--warning)] bg-[color:var(--warning-soft)] rounded-[9px] p-3 mb-4">
            <div className="text-[11px] font-semibold text-[color:var(--warning)] mb-1">⚠ 就绪检查未通过</div>
            <ul className="text-xs text-[color:var(--warning)] list-disc pl-4 space-y-0.5">
              {blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
            <div className="text-[11px] text-[color:var(--warning)] mt-1.5">建议补齐后通过;如需放行,请选「有条件通过」并在条件里写明例外项的责任人与截止日期。</div>
          </div>
        ) : null}

        {gateStandard && (
          <div className="border border-border rounded-[9px] p-3 mb-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              Gate 管理标准
            </div>
            <GateStandardPanel standard={gateStandard} compact evidenceHint />
          </div>
        )}

        {/* History */}
        {existingReviews.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
              评审历史 · {existingReviews.length} 次
            </div>
            <div className="space-y-0">
              {existingReviews.map((r, i) => (
                <ReviewHistoryItem key={r.id} review={r} index={i} total={existingReviews.length} />
              ))}
            </div>
          </div>
        )}

        {/* Add new review or show button */}
        {showForm ? (
          <NewReviewForm
            roundNumber={nextRound}
            onSubmit={handleSubmit}
            onCancel={() => existingReviews.length > 0 ? setShowForm(false) : onCancel()}
          />
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
            {readOnly && existingReviews.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">暂无评审记录</p>
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
