// Design: Industrial Precision - stone/amber color system
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
import { nanoid } from 'nanoid';

// ── Decision config ───────────────────────────────────────────────────────────
export const DECISION_CONFIG: Record<GateReview['decision'], {
  label: string; desc: string; color: string; bg: string; border: string; icon: React.ReactNode;
  badgeColor: string; badgeBg: string; badgeBorder: string;
}> = {
  approved: {
    label: '通过', desc: '无条件通过，进入下一阶段',
    color: 'text-emerald-800', bg: 'bg-emerald-50', border: 'border-emerald-500',
    badgeColor: 'text-emerald-700', badgeBg: 'bg-emerald-50', badgeBorder: 'border-emerald-200',
    icon: <CheckCircle2 size={14} className="text-emerald-600" />,
  },
  conditional: {
    label: '有条件通过', desc: '满足指定条件后方可进入下一阶段',
    color: 'text-amber-800', bg: 'bg-amber-50', border: 'border-amber-500',
    badgeColor: 'text-amber-700', badgeBg: 'bg-amber-50', badgeBorder: 'border-amber-200',
    icon: <AlertCircle size={14} className="text-amber-600" />,
  },
  rejected: {
    label: '未通过', desc: '需整改后重新评审',
    color: 'text-rose-800', bg: 'bg-rose-50', border: 'border-rose-500',
    badgeColor: 'text-rose-700', badgeBg: 'bg-rose-50', badgeBorder: 'border-rose-200',
    icon: <XCircle size={14} className="text-rose-600" />,
  },
};

// ── GateReviewBadge (compact display) ────────────────────────────────────────
export function GateReviewBadge({ review, size = 'sm' }: { review: GateReview; size?: 'sm' | 'xs' }) {
  const cfg = DECISION_CONFIG[review.decision];
  const isXs = size === 'xs';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border font-mono ${cfg.badgeBg} ${cfg.badgeBorder} ${cfg.badgeColor} ${isXs ? 'text-[9px]' : 'text-[10px]'}`}>
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
      <div className={`absolute -left-[5px] top-0 w-2 h-2 rounded-full border-2 border-white ${
        review.decision === 'approved' ? 'bg-emerald-500' :
        review.decision === 'conditional' ? 'bg-amber-500' : 'bg-rose-500'
      }`} />

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-stone-400 uppercase tracking-widest">
            第 {round} 次评审{isLatest ? ' · 最新' : ''}
          </span>
          <GateReviewBadge review={review} />
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-stone-400 hover:text-stone-600 transition-colors"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      <div className="mt-1 flex items-center gap-3 text-xs text-stone-500">
        <span className="font-mono">{review.reviewDate}</span>
        <span>·</span>
        <span>{review.participants}</span>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {review.conditions && (
            <div className="text-xs">
              <span className="font-mono text-stone-400">通过条件：</span>
              <span className="text-amber-700">{review.conditions}</span>
            </div>
          )}
          {review.notes && (
            <div className="text-xs text-stone-600 italic border-l border-stone-200 pl-2">{review.notes}</div>
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
  const today = new Date().toISOString().slice(0, 10);
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
      <div className="flex items-center gap-2 pb-2 border-b border-stone-200">
        <RotateCcw size={13} className="text-amber-600" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500">
          第 {roundNumber} 次评审
        </span>
      </div>

      {/* Decision */}
      <div>
        <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-2 block">
          评审决议 <span className="text-rose-500">*</span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.entries(DECISION_CONFIG) as [GateReview['decision'], typeof DECISION_CONFIG[GateReview['decision']]][]).map(([val, cfg]) => (
            <button
              key={val}
              type="button"
              onClick={() => setForm((f) => ({ ...f, decision: val }))}
              className={`flex flex-col items-center gap-1 p-2.5 border-2 transition-all text-center ${
                form.decision === val
                  ? `${cfg.border} ${cfg.bg} ${cfg.color}`
                  : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
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
        <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1.5 flex items-center gap-1.5">
          <Calendar size={10} /> 评审日期 <span className="text-rose-500">*</span>
        </label>
        <input
          type="date"
          value={form.reviewDate}
          onChange={(e) => setForm((f) => ({ ...f, reviewDate: e.target.value }))}
          className={`w-full text-sm border px-3 py-2 outline-none font-mono transition-colors ${
            errors.reviewDate ? 'border-rose-400 bg-rose-50' : 'border-stone-300 focus:border-stone-500'
          }`}
        />
        {errors.reviewDate && <p className="text-xs text-rose-600 mt-1">{errors.reviewDate}</p>}
      </div>

      {/* Participants */}
      <div>
        <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1.5 flex items-center gap-1.5">
          <Users size={10} /> 参与人员 <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          value={form.participants}
          onChange={(e) => setForm((f) => ({ ...f, participants: e.target.value }))}
          placeholder="例：张伟、李明、王芳（主持人）"
          className={`w-full text-sm border px-3 py-2 outline-none transition-colors ${
            errors.participants ? 'border-rose-400 bg-rose-50' : 'border-stone-300 focus:border-stone-500'
          }`}
        />
        {errors.participants && <p className="text-xs text-rose-600 mt-1">{errors.participants}</p>}
      </div>

      {/* Conditions */}
      {form.decision === 'conditional' && (
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-amber-600 mb-1.5 flex items-center gap-1.5">
            <AlertCircle size={10} /> 通过条件 <span className="text-rose-500">*</span>
          </label>
          <textarea
            value={form.conditions}
            onChange={(e) => setForm((f) => ({ ...f, conditions: e.target.value }))}
            rows={3}
            placeholder="请列明需满足的具体条件..."
            className={`w-full text-sm border px-3 py-2 outline-none resize-none transition-colors ${
              errors.conditions ? 'border-rose-400 bg-rose-50' : 'border-amber-300 bg-amber-50 focus:border-amber-500'
            }`}
          />
          {errors.conditions && <p className="text-xs text-rose-600 mt-1">{errors.conditions}</p>}
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1.5 flex items-center gap-1.5">
          <FileText size={10} /> 会议记录 / 决策说明
        </label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={3}
          placeholder="记录评审讨论要点、风险识别、后续行动项..."
          className="w-full text-sm border border-stone-300 px-3 py-2 outline-none resize-none focus:border-stone-500 transition-colors"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-2 text-sm font-medium text-stone-600 border border-stone-300 hover:bg-stone-50 transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          className={`flex-1 px-3 py-2 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-1.5 ${
            form.decision === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' :
            form.decision === 'conditional' ? 'bg-amber-600 hover:bg-amber-700' :
            'bg-rose-600 hover:bg-rose-700'
          }`}
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
  existingReviews?: GateReview[];
  onConfirm: (review: GateReview) => void;
  onCancel: () => void;
}

export function GateReviewModal({
  open, phaseId, phaseName, gateName, existingReviews = [], onConfirm, onCancel,
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
            <div className="w-8 h-8 bg-amber-500 flex items-center justify-center shrink-0">
              <Flag size={16} className="text-white" />
            </div>
            <div>
              <DialogTitle className="font-serif text-xl text-stone-900">Gate 评审记录</DialogTitle>
              <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">GATE REVIEW HISTORY</p>
            </div>
          </div>
        </DialogHeader>

        {/* Phase Info */}
        <div className="bg-stone-50 border border-stone-200 p-3 mb-4">
          <div className="flex items-center gap-2 mb-0.5">
            <ClipboardCheck size={12} className="text-stone-400" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">评审节点</span>
          </div>
          <div className="text-sm font-medium text-stone-900">{phaseName}</div>
          <div className="text-xs text-stone-500 font-mono">{gateName}</div>
        </div>

        {/* History */}
        {existingReviews.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-3">
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
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <RotateCcw size={13} className="shrink-0 mt-0.5 text-amber-600" />
                <span>上次评审未通过，整改完成后可发起重新评审。</span>
              </div>
            )}
            <button
              onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium border border-dashed border-amber-400 text-amber-700 hover:bg-amber-50 transition-colors"
            >
              <Plus size={14} />
              {latestReview?.decision === 'rejected' ? '发起重新评审' : '新增评审记录'}
            </button>
            <button
              onClick={onCancel}
              className="w-full px-4 py-2 text-sm text-stone-500 hover:text-stone-700 transition-colors"
            >
              关闭
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
