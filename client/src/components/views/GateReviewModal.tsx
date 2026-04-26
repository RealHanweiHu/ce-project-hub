// Design: Industrial Precision - stone/amber color system
// GateReviewModal: formal gate review confirmation dialog with archival

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Flag, CheckCircle2, AlertCircle, XCircle, Users, Calendar, FileText, ClipboardCheck } from 'lucide-react';
import { GateReview } from '@/lib/data';
import { nanoid } from 'nanoid';

interface GateReviewModalProps {
  open: boolean;
  phaseId: string;
  phaseName: string;
  gateName: string;
  existingReview?: GateReview;
  onConfirm: (review: GateReview) => void;
  onCancel: () => void;
}

const DECISION_OPTIONS: { value: GateReview['decision']; label: string; desc: string; color: string; icon: React.ReactNode }[] = [
  {
    value: 'approved',
    label: '通过',
    desc: '无条件通过，进入下一阶段',
    color: 'border-emerald-500 bg-emerald-50 text-emerald-800',
    icon: <CheckCircle2 size={16} className="text-emerald-600" />,
  },
  {
    value: 'conditional',
    label: '有条件通过',
    desc: '满足指定条件后方可进入下一阶段',
    color: 'border-amber-500 bg-amber-50 text-amber-800',
    icon: <AlertCircle size={16} className="text-amber-600" />,
  },
  {
    value: 'rejected',
    label: '未通过',
    desc: '需整改后重新评审',
    color: 'border-rose-500 bg-rose-50 text-rose-800',
    icon: <XCircle size={16} className="text-rose-600" />,
  },
];

export function GateReviewModal({
  open, phaseId, phaseName, gateName, existingReview, onConfirm, onCancel,
}: GateReviewModalProps) {
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState<{
    reviewDate: string;
    participants: string;
    decision: GateReview['decision'];
    conditions: string;
    notes: string;
  }>({
    reviewDate: existingReview?.reviewDate || today,
    participants: existingReview?.participants || '',
    decision: existingReview?.decision || 'approved',
    conditions: existingReview?.conditions || '',
    notes: existingReview?.notes || '',
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
    if (!validate()) return;
    const review: GateReview = {
      id: existingReview?.id || `gr_${nanoid(8)}`,
      phaseId,
      phaseName,
      gateName,
      reviewDate: form.reviewDate,
      participants: form.participants,
      decision: form.decision,
      conditions: form.conditions,
      notes: form.notes,
      createdAt: existingReview?.createdAt || new Date().toISOString(),
    };
    onConfirm(review);
  };

  const selectedDecision = DECISION_OPTIONS.find((d) => d.value === form.decision)!;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 bg-amber-500 flex items-center justify-center shrink-0">
              <Flag size={16} className="text-white" />
            </div>
            <div>
              <DialogTitle className="font-serif text-xl text-stone-900">Gate 评审记录</DialogTitle>
              <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">GATE REVIEW ARCHIVAL</p>
            </div>
          </div>
        </DialogHeader>

        {/* Phase & Gate Info */}
        <div className="bg-stone-50 border border-stone-200 p-4 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <ClipboardCheck size={14} className="text-stone-400" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">评审节点</span>
          </div>
          <div className="text-sm font-medium text-stone-900">{phaseName}</div>
          <div className="text-xs text-stone-500 mt-0.5 font-mono">{gateName}</div>
        </div>

        <div className="space-y-5">
          {/* Decision */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-2 block">
              评审决议 <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DECISION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, decision: opt.value }))}
                  className={`flex flex-col items-center gap-1.5 p-3 border-2 transition-all text-center ${
                    form.decision === opt.value
                      ? opt.color + ' border-current'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                  }`}
                >
                  {opt.icon}
                  <span className="text-xs font-semibold">{opt.label}</span>
                  <span className="text-[10px] leading-tight text-current opacity-70">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Review Date */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1.5 flex items-center gap-1.5">
              <Calendar size={11} /> 评审日期 <span className="text-rose-500">*</span>
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
              <Users size={11} /> 参与人员 <span className="text-rose-500">*</span>
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

          {/* Conditions (only for conditional) */}
          {form.decision === 'conditional' && (
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-amber-600 mb-1.5 flex items-center gap-1.5">
                <AlertCircle size={11} /> 通过条件 <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={form.conditions}
                onChange={(e) => setForm((f) => ({ ...f, conditions: e.target.value }))}
                rows={3}
                placeholder="请列明需满足的具体条件，例：1) 完成散热测试 2) 修复 P0 问题 #001"
                className={`w-full text-sm border px-3 py-2 outline-none resize-none transition-colors ${
                  errors.conditions ? 'border-rose-400 bg-rose-50' : 'border-amber-300 bg-amber-50 focus:border-amber-500'
                }`}
              />
              {errors.conditions && <p className="text-xs text-rose-600 mt-1">{errors.conditions}</p>}
            </div>
          )}

          {/* Meeting Notes */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1.5 flex items-center gap-1.5">
              <FileText size={11} /> 会议记录 / 决策说明
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={4}
              placeholder="记录评审讨论要点、风险识别、后续行动项..."
              className="w-full text-sm border border-stone-300 px-3 py-2 outline-none resize-none focus:border-stone-500 transition-colors"
            />
          </div>
        </div>

        <DialogFooter className="mt-6 flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-stone-600 border border-stone-300 hover:bg-stone-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2 ${
              form.decision === 'approved'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : form.decision === 'conditional'
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-rose-600 hover:bg-rose-700'
            }`}
          >
            {selectedDecision.icon}
            确认记录 · {selectedDecision.label}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Gate Review Badge (display only) ─────────────────────────────────────────
export function GateReviewBadge({ review }: { review: GateReview }) {
  const decisionConfig = {
    approved:    { label: '已通过', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: <CheckCircle2 size={11} /> },
    conditional: { label: '有条件通过', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', icon: <AlertCircle size={11} /> },
    rejected:    { label: '未通过', color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200', icon: <XCircle size={11} /> },
  };
  const cfg = decisionConfig[review.decision];
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 border text-[10px] font-mono ${cfg.bg} ${cfg.border} ${cfg.color}`}>
      {cfg.icon}
      <span className="font-semibold">{cfg.label}</span>
      <span className="text-current opacity-60">· {review.reviewDate}</span>
    </div>
  );
}
