import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Factory, FileCheck2, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { LinearCard } from "@/components/linear/primitives";
import { trpc } from "@/lib/trpc";

type NpiReadinessPanelProps = {
  projectId: string;
  phaseId: string;
  phaseName: string;
  canManage: boolean;
};

type NpiCategory =
  | "dfm"
  | "process_flow"
  | "sop_wi"
  | "fixture"
  | "test_program"
  | "trial_run"
  | "yield"
  | "packaging"
  | "other";

type NpiStatus = "pending" | "ready" | "blocked" | "waived";

const NPI_PHASES = new Set(["dvt", "pvt", "mp"]);

const CATEGORY_OPTIONS: { value: NpiCategory; label: string }[] = [
  { value: "dfm", label: "DFM" },
  { value: "process_flow", label: "工艺流程" },
  { value: "sop_wi", label: "SOP/WI" },
  { value: "fixture", label: "治具" },
  { value: "test_program", label: "测试程序" },
  { value: "trial_run", label: "试产" },
  { value: "yield", label: "良率" },
  { value: "packaging", label: "包装" },
  { value: "other", label: "其他" },
];

const STATUS_LABEL: Record<NpiStatus, string> = {
  pending: "待确认",
  ready: "Ready",
  blocked: "Blocked",
  waived: "Waived",
};

function statusTone(status: NpiStatus) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "waived") return "border-zinc-200 bg-zinc-50 text-zinc-600";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function NpiReadinessPanel({ projectId, phaseId, phaseName, canManage }: NpiReadinessPanelProps) {
  const isNpiPhase = NPI_PHASES.has(phaseId);
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState(`${phaseName} NPI readiness`);
  const [category, setCategory] = useState<NpiCategory>("process_flow");
  const [dueDate, setDueDate] = useState("");
  const [evidenceFileId, setEvidenceFileId] = useState("");
  const [notes, setNotes] = useState("");

  const { data: checks = [] } = trpc.npiReadiness.list.useQuery(
    { projectId, phaseId },
    { enabled: isNpiPhase }
  );
  const { data: files = [] } = trpc.files.list.useQuery(
    { projectId, phaseId },
    { enabled: isNpiPhase && canManage }
  );

  const refresh = async () => {
    await Promise.all([
      utils.npiReadiness.list.invalidate({ projectId, phaseId }),
      utils.gateReviews.readiness.invalidate({ projectId, phaseId }),
      utils.issues.list.invalidate({ projectId, phaseId }),
    ]);
  };

  const createCheck = trpc.npiReadiness.create.useMutation({
    onSuccess: async () => {
      setShowForm(false);
      setTitle(`${phaseName} NPI readiness`);
      setDueDate("");
      setEvidenceFileId("");
      setNotes("");
      toast.success("NPI readiness 已创建");
      await refresh();
    },
    onError: (e) => toast.error(e.message || "创建 NPI readiness 失败"),
  });

  const updateCheck = trpc.npiReadiness.update.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.error(e.message || "更新 NPI readiness 失败"),
  });

  const createIssue = trpc.npiReadiness.createIssueFromCheck.useMutation({
    onSuccess: async (result) => {
      toast.success(result.existed ? "NPI readiness 已有关联 Issue" : "已从 NPI 阻断创建 Issue");
      await refresh();
    },
    onError: (e) => toast.error(e.message || "创建 Issue 失败"),
  });

  const stats = useMemo(() => ({
    ready: checks.filter((item) => item.status === "ready" || item.status === "waived").length,
    blocked: checks.filter((item) => item.status === "blocked").length,
    pending: checks.filter((item) => item.status === "pending").length,
  }), [checks]);

  if (!isNpiPhase) return null;

  const disabled = !canManage || createCheck.isPending || updateCheck.isPending || createIssue.isPending;

  return (
    <LinearCard className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Factory size={14} className="text-primary" />
            <span className="text-sm font-medium text-foreground">{phaseName} PE/NPI readiness</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            PVT/MP Gate 要求 PE/NPI 确认工艺流程、SOP/WI、治具、测试程序、试产与良率闭环。
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[color:var(--acc-border)] px-2.5 py-1.5 text-xs text-primary hover:bg-[color:var(--acc-soft)]"
          >
            <Plus size={12} /> readiness
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border border-border bg-secondary/50 p-2">
          <div className="text-muted-foreground">Ready/Waived</div>
          <div className="num mt-1 text-base font-semibold text-foreground">{stats.ready}</div>
        </div>
        <div className="rounded-md border border-border bg-secondary/50 p-2">
          <div className="text-muted-foreground">Blocked</div>
          <div className="num mt-1 text-base font-semibold text-foreground">{stats.blocked}</div>
        </div>
        <div className="rounded-md border border-border bg-secondary/50 p-2">
          <div className="text-muted-foreground">Pending</div>
          <div className="num mt-1 text-base font-semibold text-foreground">{stats.pending}</div>
        </div>
      </div>

      {showForm && canManage && (
        <div className="grid gap-2 rounded-md border border-border bg-secondary/30 p-3 text-xs md:grid-cols-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="检查项名称"
            className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary md:col-span-2"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as NpiCategory)}
            className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <input
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            type="date"
            className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary"
          />
          <select
            value={evidenceFileId}
            onChange={(e) => setEvidenceFileId(e.target.value)}
            className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary md:col-span-2"
          >
            <option value="">证据文件（可后补）</option>
            {files.map((file) => (
              <option key={file.id} value={file.id}>{file.name}</option>
            ))}
          </select>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="说明 / 风险 / 需要协助事项"
            className="min-h-[72px] rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary md:col-span-2"
          />
          <div className="flex justify-end gap-2 md:col-span-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-secondary">
              取消
            </button>
            <button
              type="button"
              disabled={disabled || !title.trim()}
              onClick={() => createCheck.mutate({
                projectId,
                phaseId,
                title: title.trim(),
                category,
                dueDate: dueDate || null,
                evidenceFileId: evidenceFileId ? Number(evidenceFileId) : null,
                notes: notes.trim() || null,
              })}
              className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </div>
      )}

      {checks.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
          暂无 NPI readiness。PVT/MP Gate 会要求 PE/NPI readiness 至少有一项并完成确认。
        </div>
      ) : (
        <div className="divide-y divide-border">
          {checks.map((check) => (
            <div key={check.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{check.title}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusTone(check.status as NpiStatus)}`}>
                      {STATUS_LABEL[check.status as NpiStatus]}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {CATEGORY_OPTIONS.find((option) => option.value === check.category)?.label || check.category}
                    {check.dueDate ? ` · due ${formatDate(check.dueDate)}` : ""}
                    {check.evidenceFileId ? ` · file #${check.evidenceFileId}` : ""}
                    {check.relatedIssueId ? ` · issue #${check.relatedIssueId}` : ""}
                  </div>
                  {check.notes && <div className="mt-1 text-xs text-muted-foreground">{check.notes}</div>}
                </div>
                {canManage && (
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => updateCheck.mutate({ id: check.id, projectId, status: "ready" })}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      <CheckCircle2 size={12} /> Ready
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => updateCheck.mutate({ id: check.id, projectId, status: "blocked" })}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <XCircle size={12} /> Block
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => updateCheck.mutate({ id: check.id, projectId, status: "waived" })}
                      className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary disabled:opacity-50"
                    >
                      Waive
                    </button>
                    {check.status === "blocked" && !check.relatedIssueId && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => createIssue.mutate({ id: check.id })}
                        className="inline-flex items-center gap-1 rounded-md border border-[color:var(--acc-border)] px-2 py-1 text-[11px] text-primary hover:bg-[color:var(--acc-soft)] disabled:opacity-50"
                      >
                        <AlertTriangle size={12} /> Issue
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </LinearCard>
  );
}
