// GateReviewModal: gate review history list + new review form
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Flag, CheckCircle2, AlertCircle, XCircle, Users, Calendar,
  FileText, ClipboardCheck, Plus, Trash2, ChevronDown, ChevronRight, RotateCcw,
} from 'lucide-react';
import { GateReview } from '@/lib/data';
import { GATE_DECISIONS } from '@shared/const';
import { cn, toLocalISODate } from '@/lib/utils';
import { GateReadinessChecklist } from './GateReadinessChecklist';
import type { SOPGateStandard } from '@/lib/sop-templates';
import { GateStandardPanel } from '@/components/shared/GateStandardPanel';
import { nanoid } from 'nanoid';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  GATE_SIGNOFF_REQUIREMENT_LABELS,
  GATE_SIGNOFF_STATUS_LABELS,
  type GateSignoffSlot,
} from '@shared/gate-signoffs';
import { StabilityGatePanel } from './StabilityGatePanel';
import type { ProjectMemberRole } from '@shared/project-roles';
import {
  PRODUCT_MODULES,
  type ProjectExecutionBaseline,
} from '@shared/project-track-tailoring';

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
    : '项目完成后生成';
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
          <span className="text-foreground">输出产品：</span>{productLabel}
        </div>
        {trace.baseRevision && (
          <div>
            <span className="text-foreground">历史基准 Revision：</span>{trace.baseRevision.revisionLabel}
          </div>
        )}
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
  conditionOwnerUserId: number | null;
  conditionDueDate: string;
  conditionItems: Array<{ description: string; ownerUserId: number | null; dueDate: string }>;
  notes: string;
}

function NewReviewForm({
  roundNumber,
  allowedDecisions,
  onSubmit,
  onCancel,
  signoffsReady = true,
  projectId,
}: {
  roundNumber: number;
  /** 可选的决议项：管理层三项全开；项目经理（仅召集权）只能记录「不通过」 */
  allowedDecisions: GateReview['decision'][];
  onSubmit: (form: ReviewFormState) => void;
  onCancel: () => void;
  signoffsReady?: boolean;
  projectId?: string;
}) {
  const { data: members = [] } = trpc.members.list.useQuery(
    { projectId: projectId || '' },
    { enabled: !!projectId },
  );
  const today = toLocalISODate();
  const [form, setForm] = useState<ReviewFormState>({
    reviewDate: today,
    participants: '',
    decision: allowedDecisions.includes('approved') ? 'approved' : allowedDecisions[0],
    conditions: '',
    conditionOwnerUserId: null,
    conditionDueDate: '',
    conditionItems: [{ description: '', ownerUserId: null, dueDate: '' }],
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.reviewDate) e.reviewDate = '请填写评审日期';
    if (!form.participants.trim()) e.participants = '请填写参与人员';
    if (form.decision === 'conditional') {
      if (form.conditionItems.length === 0) e.conditions = '至少需要一条通过条件';
      form.conditionItems.forEach((item, index) => {
        if (!item.description.trim() || !item.ownerUserId || !item.dueDate) e[`condition-${index}`] = `条件 ${index + 1} 的内容、负责人和截止日期必须完整`;
      });
    }
    if (form.decision !== 'rejected' && !signoffsReady) {
      e.decision = '必签会签未完成，管理层暂不能拍板';
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
        {errors.decision && <p className="mt-1 text-[11px] text-destructive">{errors.decision}</p>}
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
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-widest text-[color:var(--warning)] flex items-center gap-1.5">
              <AlertCircle size={10} /> 逐项通过条件 <span className="text-destructive">*</span>
            </label>
            <button type="button" onClick={() => setForm((f) => ({ ...f, conditionItems: [...f.conditionItems, { description: '', ownerUserId: null, dueDate: '' }] }))} className="inline-flex items-center gap-1 rounded-[6px] border border-border px-2 py-1 text-[10px]"><Plus size={11} />添加条件</button>
          </div>
          {form.conditionItems.map((item, index) => (
            <div key={index} className={`space-y-2 rounded-[8px] border p-3 ${errors[`condition-${index}`] ? 'border-destructive bg-[color:var(--destructive-soft)]' : 'border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)]'}`}>
              <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-[color:var(--warning)]">条件 {index + 1}</span>{form.conditionItems.length > 1 && <button type="button" onClick={() => setForm((f) => ({ ...f, conditionItems: f.conditionItems.filter((_, itemIndex) => itemIndex !== index) }))} className="text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>}</div>
              <textarea value={item.description} onChange={(event) => setForm((f) => ({ ...f, conditionItems: f.conditionItems.map((row, itemIndex) => itemIndex === index ? { ...row, description: event.target.value } : row) }))} rows={2} placeholder="单条、可验证的关闭条件" className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <select value={item.ownerUserId ?? ''} onChange={(event) => setForm((f) => ({ ...f, conditionItems: f.conditionItems.map((row, itemIndex) => itemIndex === index ? { ...row, ownerUserId: event.target.value ? Number(event.target.value) : null } : row) }))} className="rounded-[7px] border border-border bg-card px-2 py-2 text-xs"><option value="">跟进负责人</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.userName || member.mentionName || `用户 #${member.userId}`}</option>)}</select>
                <input type="date" value={item.dueDate} onChange={(event) => setForm((f) => ({ ...f, conditionItems: f.conditionItems.map((row, itemIndex) => itemIndex === index ? { ...row, dueDate: event.target.value } : row) }))} className="rounded-[7px] border border-border bg-card px-2 py-2 text-xs" />
              </div>
              {errors[`condition-${index}`] && <p className="text-[10px] text-destructive">{errors[`condition-${index}`]}</p>}
            </div>
          ))}
          {errors.conditions && <p className="text-xs text-destructive">{errors.conditions}</p>}
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

      {form.decision !== 'rejected' && !signoffsReady && (
        <div className="text-xs text-amber-600" role="status">
          必签会签未完成或就绪数据未加载，暂不能提交「通过/有条件通过」；可先提交「拒绝」，或完成会签/等待就绪数据后重试。
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-2 text-sm font-medium text-muted-foreground rounded-[7px] border border-border hover:bg-secondary transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          aria-disabled={form.decision !== 'rejected' && !signoffsReady}
          disabled={form.decision !== 'rejected' && !signoffsReady}
          className="flex-1 px-3 py-2 text-sm font-semibold text-white rounded-[7px] transition-colors flex items-center justify-center gap-1.5"
          style={{
            background:
              form.decision === 'approved' ? 'var(--success)' :
              form.decision === 'conditional' ? 'var(--warning)' : 'var(--destructive)',
            opacity: form.decision !== 'rejected' && !signoffsReady ? 0.5 : 1,
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
  projectId: string;
  gateTaskId: string;
  /** Close Gate 硬卡未满足时「去项目设置处理」的跳转（调用方负责关弹窗、开设置抽屉） */
  onOpenSettings?: () => void;
  /** 是否允许在就绪清单里上传/删除交付物证据（viewer 等无权者隐藏按钮） */
  canEditDeliverables?: boolean;
  canQualityGateBlock?: boolean;
  canNpiGateBlock?: boolean;
  onTaskClick?: (phaseId: string, taskId: string) => void;
  onConfirm: (review: GateReview) => void;
  onCancel: () => void;
  readOnly?: boolean;
  /** 决策权（approved/conditional）；false 时仅召集权——只能记录「不通过」的评审 */
  canDecide?: boolean;
  /** JDM P1 Gate 本次将原子冻结的候选基线；仅作只读预览。 */
  jdmDefinitionFreeze?: ProjectExecutionBaseline;
  /** 前端完整性预检；服务端仍会在事务内重复校验。 */
  jdmDefinitionIssues?: string[];
}

export function GateReviewModal({
  open, phaseId, phaseName, gateName, gateStandard, existingReviews = [], projectId, gateTaskId, onOpenSettings, canEditDeliverables = false, canQualityGateBlock = false, canNpiGateBlock = false, onTaskClick, onConfirm, onCancel, readOnly = false, canDecide = true, jdmDefinitionFreeze, jdmDefinitionIssues = [],
}: GateReviewModalProps) {
  // readOnly（无 canGateReview 权限）绝不能进表单：否则用户填完提交被静默丢弃
  const [showForm, setShowForm] = useState(existingReviews.length === 0 && !readOnly);
  const [standardOpen, setStandardOpen] = useState(false);
  const latestReview = existingReviews[existingReviews.length - 1];
  const nextRound = existingReviews.length + 1;
  const utils = trpc.useUtils();
  const signoffsQuery = trpc.gateReviews.signoffs.useQuery(
    { projectId: projectId || '', phaseId },
    { enabled: !!projectId },
  );
  const myRoleQuery = trpc.members.myRole.useQuery(
    { projectId: projectId || '' },
    { enabled: !!projectId },
  );
  const [signoffNotes, setSignoffNotes] = useState<Partial<Record<GateSignoffSlot, string>>>({});
  const [signoffRoles, setSignoffRoles] = useState<Partial<Record<GateSignoffSlot, ProjectMemberRole>>>({});
  const signoffMutation = trpc.gateReviews.sign.useMutation({
    onSuccess: async () => {
      if (projectId) await utils.gateReviews.signoffs.invalidate({ projectId, phaseId });
      toast.success('会签已记录');
    },
    onError: (error) => toast.error(error.message || '会签失败'),
  });
  const addRequirementMutation = trpc.gateReviews.addRequirement.useMutation({
    onSuccess: async () => {
      if (projectId) await utils.gateReviews.signoffs.invalidate({ projectId, phaseId });
      toast.success('项目级加签已生效；如本轮已开启，系统已按新矩阵重开');
    },
    onError: (error) => toast.error(error.message || '加签失败'),
  });
  const signoffSlots = signoffsQuery.data?.slots ?? [];
  const stabilityReadiness = trpc.stability.readiness.useQuery(
    { projectId: projectId || '' },
    { enabled: !!projectId && gateTaskId === 'project_close_review' },
  );
  const certificationCoverage = trpc.certificates.coverage.useQuery(
    { projectId: projectId || '' },
    { enabled: !!projectId && gateTaskId === 'project_close_review' },
  );
  const conditionsReadiness = trpc.conditions.readiness.useQuery(
    { projectId: projectId || '' },
    { enabled: !!projectId && gateTaskId === 'project_close_review' },
  );
  const handoffReadiness = trpc.handoffs.readiness.useQuery(
    { projectId: projectId || '' },
    { enabled: !!projectId && gateTaskId === 'project_close_review' },
  );
  const isJdmDefinitionGate = gateTaskId === 'jdm_product_definition_gate';
  const jdmRiskScope = trpc.projects.riskScope.useQuery(
    { projectId: projectId || '' },
    { enabled: !!projectId && isJdmDefinitionGate },
  );
  // 查询报错/未返回时不得默认"会签就绪"——四眼 UI 的空数据必须按未就绪处理
  const signoffsReady = !!projectId && signoffsQuery.data != null && signoffSlots.every((slot) =>
    slot.requirement !== 'required' || slot.status === 'approved'
  ) && !signoffSlots.some((slot) => slot.status === 'rejected');
  const jdmRiskReady = !isJdmDefinitionGate || (
    !!jdmRiskScope.data?.engineeringConfirmedAt &&
    !!jdmRiskScope.data?.qaOrCertConfirmedAt
  );
  const jdmDefinitionReady = !isJdmDefinitionGate || (
    !!jdmDefinitionFreeze &&
    jdmDefinitionIssues.length === 0 &&
    jdmRiskReady
  );
  const approvalReady = signoffsReady &&
    jdmDefinitionReady &&
    (gateTaskId !== 'project_close_review' || (
      stabilityReadiness.data?.ready === true &&
      certificationCoverage.data?.covered === true &&
      conditionsReadiness.data?.ready === true &&
      handoffReadiness.data?.ready === true
    ));

  const submitSignoff = (slot: GateSignoffSlot, status: 'approved' | 'conditional' | 'rejected') => {
    if (!projectId) return;
    const note = signoffNotes[slot]?.trim() || null;
    if ((status === 'conditional' || status === 'rejected') && !note) {
      toast.error('有条件同意或拒绝必须填写说明');
      return;
    }
    signoffMutation.mutate({ projectId, phaseId, slot, status, note, actedAsRole: signoffRoles[slot] || undefined });
  };

  const addRequiredSignoff = (slot: GateSignoffSlot) => {
    if (!projectId) return;
    const reason = window.prompt('请输入项目级加签原因');
    if (!reason?.trim()) return;
    addRequirementMutation.mutate({ projectId, phaseId, slot, requirement: 'required', reason: reason.trim() });
  };

  const handleSubmit = (form: ReviewFormState) => {
    const conditionItems = form.decision === 'conditional'
      ? form.conditionItems.map((item) => ({ description: item.description.trim(), ownerUserId: item.ownerUserId!, dueDate: item.dueDate }))
      : [];
    const firstCondition = conditionItems[0];
    const review: GateReview = {
      id: `gr_${nanoid(8)}`,
      phaseId,
      phaseName,
      gateName,
      reviewDate: form.reviewDate,
      participants: form.participants,
      decision: form.decision,
      conditions: conditionItems.map((item, index) => `${index + 1}. ${item.description}`).join('\n'),
      conditionOwnerUserId: firstCondition?.ownerUserId ?? null,
      conditionDueDate: firstCondition?.dueDate ?? null,
      conditionItems,
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
                GATE REVIEW HISTORY
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

        <GateReadinessChecklist
          projectId={projectId}
          phaseId={phaseId}
          gateTaskId={gateTaskId}
          canEdit={canEditDeliverables}
          canQualityGateBlock={canQualityGateBlock}
          canNpiGateBlock={canNpiGateBlock}
          onTaskClick={onTaskClick}
        />

        {isJdmDefinitionGate && (
          <div className={cn(
            'mb-4 rounded-[9px] border p-3 text-xs',
            jdmDefinitionReady
              ? 'border-[color:var(--success)] bg-[color:var(--success-soft)]'
              : 'border-[color:var(--warning)] bg-[color:var(--warning-soft)]',
          )}>
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-foreground">本次将冻结的产品定义</div>
              <span className={jdmDefinitionReady ? 'text-[color:var(--success)]' : 'text-[color:var(--warning)]'}>
                {jdmDefinitionReady ? '可冻结' : '尚未就绪'}
              </span>
            </div>
            <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className="text-foreground">产品规格：</span>
                {jdmDefinitionFreeze?.productDefinitionRef || '未填写'}
              </div>
              <div>
                <span className="text-foreground">复用模块：</span>
                {PRODUCT_MODULES
                  .filter(module => jdmDefinitionFreeze?.moduleReuse?.[module.id] === 'reused')
                  .map(module => module.label)
                  .join('、') || '无'}
              </div>
              <div>
                <span className="text-foreground">不复用模块：</span>
                {PRODUCT_MODULES
                  .filter(module => jdmDefinitionFreeze?.moduleReuse?.[module.id] === 'not_reused')
                  .map(module => module.label)
                  .join('、') || '未完整选择'}
              </div>
              <div className="sm:col-span-2">
                <span className="text-foreground">风险声明：</span>
                {jdmRiskScope.data
                  ? `v${jdmRiskScope.data.version} · 研发${jdmRiskScope.data.engineeringConfirmedAt ? '已确认' : '待确认'} · QA/认证${jdmRiskScope.data.qaOrCertConfirmedAt ? '已确认' : '待确认'}`
                  : '未建立或加载中'}
              </div>
            </div>
            {!jdmDefinitionReady && (
              <div className="mt-2 flex items-start gap-1.5 text-[color:var(--warning)]">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>
                  {jdmDefinitionIssues.length > 0
                    ? jdmDefinitionIssues.join('；')
                    : !jdmRiskReady
                      ? '风险声明需要研发与 QA/认证双确认'
                      : '请先完成 JDM 产品定义与六模块基线'}
                </span>
              </div>
            )}
            <div className="mt-2 text-[10px] text-muted-foreground">
              “通过 / 有条件通过”会在同一事务内冻结基线并生成 P2–P6；“未通过”不会冻结。
            </div>
          </div>
        )}

        {projectId && gateTaskId === 'project_close_review' && (
          <>
            <StabilityGatePanel projectId={projectId} canEdit={canEditDeliverables} />
            {/* 增量硬卡（证书/条件项/移交）只显示计数结论；明细与编辑统一在「项目设置 → 风险 / 关闭」分区，
                同一缺口不在弹窗里重列一遍（设计4 §4：同一证据只出现一次） */}
            {(() => {
              const loaded = certificationCoverage.data && conditionsReadiness.data && handoffReadiness.data;
              const certGap = certificationCoverage.data?.missing.length ?? 0;
              const condGap = conditionsReadiness.data?.openCount ?? 0;
              const handoffGap = handoffReadiness.data?.blockers.length ?? 0;
              const parts = [
                certGap > 0 ? `证书缺口 ${certGap}` : null,
                condGap > 0 ? `条件项未闭环 ${condGap}` : null,
                handoffGap > 0 ? `量产移交阻塞 ${handoffGap}` : null,
              ].filter(Boolean);
              const ok = !!loaded && parts.length === 0;
              return (
                <div className={`mb-4 rounded-[9px] border p-3 text-xs ${ok ? 'border-border text-muted-foreground' : 'border-[color:var(--warning)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {!loaded
                        ? '增量硬卡状态加载中…'
                        : ok
                          ? '增量硬卡已满足：证书 / 条件项 / 量产移交 ✓'
                          : `增量硬卡未满足：${parts.join(' · ')}`}
                    </span>
                    {onOpenSettings && loaded && !ok && (
                      <button type="button" onClick={onOpenSettings} className="shrink-0 font-medium text-primary hover:underline">
                        去项目设置处理 →
                      </button>
                    )}
                  </div>
                  {loaded && !ok && <div className="mt-1 font-normal">明细在「项目设置 → 风险 / 关闭」分区维护，缺口清零后可给出通过结论。</div>}
                </div>
              );
            })()}
          </>
        )}

        {projectId && (
          <div className="mb-4 rounded-[9px] border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">风险会签 · 第 {signoffsQuery.data?.roundNumber ?? nextRound} 轮</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{signoffsQuery.data?.roundStatus === 'preview' ? '矩阵预览；首次签字时冻结整轮要求。' : '本轮要求已冻结。'} 必签全部同意后，管理层才能给出通过结论。</div>
              </div>
              <span className={`text-[10px] font-semibold ${signoffsReady ? 'text-[color:var(--success)]' : 'text-[color:var(--warning)]'}`}>
                {signoffsReady ? '会签就绪' : '会签未完成'}
              </span>
            </div>
            {signoffsQuery.isLoading ? (
              <div className="py-3 text-center text-xs text-muted-foreground">加载会签槽位…</div>
            ) : (
              <div className="space-y-2">
                {signoffSlots.map((slot) => (
                  <div key={slot.slot} className="rounded-[7px] border border-border bg-secondary/30 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{slot.label}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[9px] ${slot.requirement === 'required' ? 'bg-[color:var(--destructive-soft)] text-destructive' : 'bg-secondary text-muted-foreground'}`}>
                          {GATE_SIGNOFF_REQUIREMENT_LABELS[slot.requirement]}
                        </span>
                      </div>
                      <span className={`text-[10px] font-medium ${slot.status === 'approved' ? 'text-[color:var(--success)]' : slot.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {GATE_SIGNOFF_STATUS_LABELS[slot.status]}
                        {slot.signerName ? ` · ${slot.signerName}` : ''}
                      </span>
                    </div>
                    {slot.note && <p className="mt-1 text-[11px] text-muted-foreground">{slot.note}</p>}
                    {signoffsQuery.data?.canAddRequirement && slot.requirement !== 'required' && (
                      <button type="button" onClick={() => addRequiredSignoff(slot.slot)} className="mt-1 text-[10px] text-primary hover:underline">设为本项目必签</button>
                    )}
                    {slot.canSign && slot.requirement !== 'not_applicable' && (
                      <div className="mt-2 space-y-2">
                        {(myRoleQuery.data?.roles.length ?? 0) > 1 && (
                          <select
                            value={signoffRoles[slot.slot] ?? ''}
                            onChange={(event) => setSignoffRoles((roles) => ({ ...roles, [slot.slot]: event.target.value as ProjectMemberRole }))}
                            className="w-full rounded-[6px] border border-border bg-card px-2 py-1.5 text-xs"
                          >
                            <option value="">选择本次签字角色</option>
                            {myRoleQuery.data?.roles.map((role) => <option key={role} value={role}>{role}</option>)}
                          </select>
                        )}
                        <input
                          value={signoffNotes[slot.slot] ?? ''}
                          onChange={(event) => setSignoffNotes((notes) => ({ ...notes, [slot.slot]: event.target.value }))}
                          placeholder="会签说明（有条件/拒绝时必填）"
                          className="w-full rounded-[6px] border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-[color:var(--acc-border)]"
                        />
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => submitSignoff(slot.slot, 'approved')} className="rounded-[6px] bg-[color:var(--success-soft)] px-2 py-1 text-[10px] font-medium text-[color:var(--success)]">同意</button>
                          <button type="button" onClick={() => submitSignoff(slot.slot, 'conditional')} className="rounded-[6px] bg-[color:var(--warning-soft)] px-2 py-1 text-[10px] font-medium text-[color:var(--warning)]">有条件</button>
                          <button type="button" onClick={() => submitSignoff(slot.slot, 'rejected')} className="rounded-[6px] bg-[color:var(--destructive-soft)] px-2 py-1 text-[10px] font-medium text-destructive">拒绝</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Gate 标准默认折叠：任务详情已内联展示同一份标准，弹窗里按需展开（设计4 §4） */}
        {gateStandard && (
          <div className="border border-border rounded-[9px] mb-4">
            <button
              type="button"
              onClick={() => setStandardOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>Gate 管理标准</span>
              {standardOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {standardOpen && (
              <div className="px-3 pb-3">
                <GateStandardPanel standard={gateStandard} compact evidenceHint />
              </div>
            )}
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
              signoffsReady={!canDecide || approvalReady}
              projectId={projectId}
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
