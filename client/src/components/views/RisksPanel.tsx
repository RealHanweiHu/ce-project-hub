import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Edit3, Loader2, Plus, Save, ShieldAlert, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';

type RiskSeverity = 'low' | 'medium' | 'high';
type RiskStatus = 'open' | 'mitigating' | 'watching' | 'closed';

type RiskForm = {
  title: string;
  severity: RiskSeverity;
  status: RiskStatus;
  owner: string;
  targetDate: string;
  description: string;
  mitigationPlan: string;
  contingencyPlan: string;
};

const EMPTY_FORM: RiskForm = {
  title: '',
  severity: 'medium',
  status: 'open',
  owner: '',
  targetDate: '',
  description: '',
  mitigationPlan: '',
  contingencyPlan: '',
};

const SEVERITY_CONFIG: Record<RiskSeverity, { label: string; className: string }> = {
  high: { label: '高', className: 'bg-[color:var(--destructive-soft)] text-destructive border-destructive/30' },
  medium: { label: '中', className: 'bg-[color:var(--warning-soft)] text-[color:var(--warning)] border-[color:var(--warning)]/30' },
  low: { label: '低', className: 'bg-[color:var(--success-soft)] text-[color:var(--success)] border-[color:var(--success)]/30' },
};

const STATUS_CONFIG: Record<RiskStatus, { label: string; className: string }> = {
  open: { label: '识别', className: 'bg-[color:var(--destructive-soft)] text-destructive border-destructive/30' },
  mitigating: { label: '缓解中', className: 'bg-[color:var(--warning-soft)] text-[color:var(--warning)] border-[color:var(--warning)]/30' },
  watching: { label: '观察中', className: 'bg-[color:var(--acc-soft)] text-primary border-[color:var(--acc-border)]' },
  closed: { label: '已关闭', className: 'bg-secondary text-muted-foreground border-border' },
};

const clean = (value: string) => value.trim() || null;

export function RisksPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data: risks = [], isLoading } = trpc.risks.list.useQuery({ projectId });
  const [form, setForm] = useState<RiskForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);

  const summary = useMemo(() => {
    const active = risks.filter((risk) => risk.status !== 'closed');
    return {
      active: active.length,
      high: active.filter((risk) => risk.severity === 'high').length,
      medium: active.filter((risk) => risk.severity === 'medium').length,
      closed: risks.filter((risk) => risk.status === 'closed').length,
    };
  }, [risks]);

  const refresh = async () => {
    await Promise.all([
      utils.risks.list.invalidate({ projectId }),
      utils.projects.get.invalidate({ id: projectId }),
    ]);
  };

  const createRisk = trpc.risks.create.useMutation({
    onSuccess: async () => {
      setForm(EMPTY_FORM);
      await refresh();
      toast.success('风险项已创建');
    },
    onError: (error) => toast.error(error.message),
  });

  const updateRisk = trpc.risks.update.useMutation({
    onSuccess: async () => {
      setEditingId(null);
      setForm(EMPTY_FORM);
      await refresh();
      toast.success('风险项已更新');
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteRisk = trpc.risks.delete.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success('风险项已删除');
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = () => {
    const payload = {
      title: form.title.trim(),
      severity: form.severity,
      status: form.status,
      owner: clean(form.owner),
      targetDate: clean(form.targetDate),
      description: clean(form.description),
      mitigationPlan: clean(form.mitigationPlan),
      contingencyPlan: clean(form.contingencyPlan),
    };
    if (!payload.title) {
      toast.error('请输入风险标题');
      return;
    }
    if (editingId) {
      updateRisk.mutate({ id: editingId, patch: payload });
    } else {
      createRisk.mutate({ projectId, ...payload });
    }
  };

  const startEdit = (risk: (typeof risks)[number]) => {
    setEditingId(risk.id);
    setForm({
      title: risk.title,
      severity: risk.severity,
      status: risk.status,
      owner: risk.owner ?? '',
      targetDate: risk.targetDate ?? '',
      description: risk.description ?? '',
      mitigationPlan: risk.mitigationPlan ?? '',
      contingencyPlan: risk.contingencyPlan ?? '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const isSaving = createRisk.isPending || updateRisk.isPending;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <RiskMetric label="有效风险" value={summary.active} />
        <RiskMetric label="高风险" value={summary.high} accent={summary.high > 0 ? 'text-destructive' : undefined} />
        <RiskMetric label="中风险" value={summary.medium} accent={summary.medium > 0 ? 'text-[color:var(--warning)]' : undefined} />
        <RiskMetric label="已关闭" value={summary.closed} />
      </div>

      {canEdit && (
        <div className="border border-border bg-card rounded-[11px] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldAlert size={15} className="text-muted-foreground" />
              {editingId ? '编辑风险' : '新增风险'}
            </div>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="inline-flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:bg-secondary"
                title="取消编辑"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="风险标题"
              className="lg:col-span-4 border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <select
              value={form.severity}
              onChange={(event) => setForm((prev) => ({ ...prev, severity: event.target.value as RiskSeverity }))}
              className="lg:col-span-2 border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="high">高风险</option>
              <option value="medium">中风险</option>
              <option value="low">低风险</option>
            </select>
            <select
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as RiskStatus }))}
              className="lg:col-span-2 border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="open">识别</option>
              <option value="mitigating">缓解中</option>
              <option value="watching">观察中</option>
              <option value="closed">已关闭</option>
            </select>
            <input
              value={form.owner}
              onChange={(event) => setForm((prev) => ({ ...prev, owner: event.target.value }))}
              placeholder="负责人"
              className="lg:col-span-2 border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              type="date"
              value={form.targetDate}
              onChange={(event) => setForm((prev) => ({ ...prev, targetDate: event.target.value }))}
              className="lg:col-span-2 border border-border px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <RiskTextarea label="风险描述" value={form.description} onChange={(value) => setForm((prev) => ({ ...prev, description: value }))} />
            <RiskTextarea label="缓解措施" value={form.mitigationPlan} onChange={(value) => setForm((prev) => ({ ...prev, mitigationPlan: value }))} />
            <RiskTextarea label="兜底预案" value={form.contingencyPlan} onChange={(value) => setForm((prev) => ({ ...prev, contingencyPlan: value }))} />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : editingId ? <Save size={13} /> : <Plus size={13} />}
              {editingId ? '保存' : '新增'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {isLoading ? (
          <div className="border border-border bg-card rounded-[11px] p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />加载风险项…
          </div>
        ) : risks.length === 0 ? (
          <div className="border border-border bg-card rounded-[11px] p-5 text-sm text-muted-foreground">暂无风险项</div>
        ) : (
          risks.map((risk) => {
            const severity = SEVERITY_CONFIG[risk.severity];
            const status = STATUS_CONFIG[risk.status];
            const closed = risk.status === 'closed';
            return (
              <div key={risk.id} className={`border border-border bg-card rounded-[11px] p-4 ${closed ? 'opacity-70' : ''}`}>
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border text-[10px] ${severity.className}`}>
                        <AlertTriangle size={11} />{severity.label}
                      </span>
                      <span className={`px-1.5 py-0.5 border text-[10px] ${status.className}`}>{status.label}</span>
                      {risk.owner && <span className="text-[11px] text-muted-foreground">负责人：{risk.owner}</span>}
                      {risk.targetDate && <span className="text-[11px] num text-muted-foreground">目标：{risk.targetDate}</span>}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground break-words">{risk.title}</h4>
                      {risk.description && <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{risk.description}</p>}
                    </div>
                    {(risk.mitigationPlan || risk.contingencyPlan) && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs">
                        {risk.mitigationPlan && (
                          <div className="bg-secondary border border-border p-2">
                            <div className="text-[10px] text-muted-foreground mb-1">缓解措施</div>
                            <div className="text-foreground whitespace-pre-wrap">{risk.mitigationPlan}</div>
                          </div>
                        )}
                        {risk.contingencyPlan && (
                          <div className="bg-secondary border border-border p-2">
                            <div className="text-[10px] text-muted-foreground mb-1">兜底预案</div>
                            <div className="text-foreground whitespace-pre-wrap">{risk.contingencyPlan}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      {!closed && (
                        <button
                          type="button"
                          onClick={() => updateRisk.mutate({ id: risk.id, patch: { status: 'closed' } })}
                          disabled={updateRisk.isPending}
                          className="inline-flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:bg-secondary disabled:opacity-50"
                          title="关闭风险"
                        >
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startEdit(risk)}
                        className="inline-flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:bg-secondary"
                        title="编辑风险"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('删除该风险项？')) deleteRisk.mutate({ id: risk.id });
                        }}
                        disabled={deleteRisk.isPending}
                        className="inline-flex h-8 w-8 items-center justify-center border border-border text-muted-foreground hover:bg-secondary disabled:opacity-50"
                        title="删除风险"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function RiskMetric({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="border border-border bg-card rounded-[11px] p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold num ${accent ?? 'text-foreground'}`}>{value}</div>
    </div>
  );
}

function RiskTextarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="w-full border border-border px-3 py-2 text-sm outline-none resize-none focus:border-primary"
      />
    </label>
  );
}
