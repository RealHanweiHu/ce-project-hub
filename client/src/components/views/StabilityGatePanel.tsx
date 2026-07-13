import { useState } from 'react';
import { CheckCircle2, Clock3, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { toLocalISODate } from '@/lib/utils';

export function StabilityGatePanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const reports = trpc.stability.list.useQuery({ projectId });
  const readiness = trpc.stability.readiness.useQuery({ projectId });
  const today = toLocalISODate(new Date());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    periodStart: today,
    periodEnd: today,
    outputQuantity: 0,
    targetOutputQuantity: 0,
    fpyPercent: 0,
    targetFpyPercent: 0,
    capacityPercent: 100,
    qualityEvents: '',
    summary: '',
  });
  const refresh = async () => {
    await Promise.all([
      utils.stability.list.invalidate({ projectId }),
      utils.stability.readiness.invalidate({ projectId }),
    ]);
  };
  const create = trpc.stability.create.useMutation({
    onSuccess: async () => { await refresh(); setShowForm(false); toast.success('稳定期记录已保存，等待 QA 确认'); },
    onError: (error) => toast.error(error.message || '稳定期记录保存失败'),
  });
  const confirm = trpc.stability.confirm.useMutation({
    onSuccess: async () => { await refresh(); toast.success('QA 已确认稳定期记录'); },
    onError: (error) => toast.error(error.message || '确认失败'),
  });
  const result = readiness.data;

  return (
    <div className="mb-4 rounded-[9px] border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">发布后稳定证据</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {result ? `${result.confirmedReportCount} 期已确认 · 累计覆盖 ${result.coveredDays} 天` : '加载中…'}
          </div>
        </div>
        <span className={`text-[10px] font-semibold ${result?.ready ? 'text-[color:var(--success)]' : 'text-[color:var(--warning)]'}`}>
          {result?.ready ? '关闭条件已满足' : '关闭条件未满足'}
        </span>
      </div>
      {result && result.blockers.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-[color:var(--warning)]">
          {result.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
        </ul>
      )}
      <div className="mt-3 space-y-2">
        {(reports.data ?? []).map((report) => (
          <div key={report.id} className="flex items-center justify-between gap-2 rounded-[7px] border border-border bg-secondary/30 p-2 text-xs">
            <div>
              <div className="font-medium text-foreground">{report.periodStart} → {report.periodEnd}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">产量 {report.outputQuantity}/{report.targetOutputQuantity} · FPY {(report.fpyBasisPoints / 100).toFixed(2)}% · 产能 {(report.capacityAttainmentBasisPoints / 100).toFixed(2)}%</div>
            </div>
            {report.qaConfirmedAt ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-[color:var(--success)]"><CheckCircle2 size={11} />QA 已确认</span>
            ) : (
              <button type="button" onClick={() => confirm.mutate({ projectId, reportId: report.id })} className="inline-flex items-center gap-1 rounded-[6px] bg-[color:var(--warning-soft)] px-2 py-1 text-[10px] text-[color:var(--warning)]"><Clock3 size={11} />QA 确认</button>
            )}
          </div>
        ))}
      </div>
      {canEdit && !showForm && (
        <button type="button" onClick={() => setShowForm(true)} className="mt-3 inline-flex items-center gap-1 rounded-[6px] border border-border px-2 py-1 text-[10px] text-foreground"><Plus size={11} />新增稳定期周报</button>
      )}
      {showForm && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-[7px] border border-border bg-secondary/20 p-2.5">
          <LabeledInput label="周期开始"><input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs" /></LabeledInput>
          <LabeledInput label="周期结束"><input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs" /></LabeledInput>
          <LabeledInput label="实际产量"><input type="number" min={0} value={form.outputQuantity} onChange={(e) => setForm({ ...form, outputQuantity: Number(e.target.value) })} className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs" /></LabeledInput>
          <LabeledInput label="目标产量（必填）"><input type="number" min={1} value={form.targetOutputQuantity} onChange={(e) => setForm({ ...form, targetOutputQuantity: Number(e.target.value) })} className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs" /></LabeledInput>
          <LabeledInput label="实际 FPY %"><input type="number" min={0} max={100} step="0.01" value={form.fpyPercent} onChange={(e) => setForm({ ...form, fpyPercent: Number(e.target.value) })} className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs" /></LabeledInput>
          <LabeledInput label="目标 FPY %（必填）"><input type="number" min={0.01} max={100} step="0.01" value={form.targetFpyPercent} onChange={(e) => setForm({ ...form, targetFpyPercent: Number(e.target.value) })} className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs" /></LabeledInput>
          <LabeledInput label="产能达成 %" className="col-span-2"><input type="number" min={0} max={100} step="0.01" value={form.capacityPercent} onChange={(e) => setForm({ ...form, capacityPercent: Number(e.target.value) })} className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs" /></LabeledInput>
          <input value={form.qualityEvents} onChange={(e) => setForm({ ...form, qualityEvents: e.target.value })} placeholder="质量事件（没有可填无）" className="col-span-2 rounded border border-border bg-card px-2 py-1.5 text-xs" />
          <textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="本期总结" rows={2} className="col-span-2 rounded border border-border bg-card px-2 py-1.5 text-xs" />
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded px-2 py-1 text-[10px] text-muted-foreground">取消</button>
            <button type="button" disabled={create.isPending} onClick={() => create.mutate({
              projectId,
              periodStart: form.periodStart,
              periodEnd: form.periodEnd,
              outputQuantity: form.outputQuantity,
              targetOutputQuantity: form.targetOutputQuantity,
              fpyBasisPoints: Math.round(form.fpyPercent * 100),
              targetFpyBasisPoints: Math.round(form.targetFpyPercent * 100),
              capacityAttainmentBasisPoints: Math.round(form.capacityPercent * 100),
              qualityEvents: form.qualityEvents || null,
              summary: form.summary || null,
            })} className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground">保存记录</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledInput({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`space-y-1 text-[10px] text-muted-foreground ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
