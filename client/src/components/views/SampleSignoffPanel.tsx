import { useMemo, useState } from "react";
import { CheckCircle2, Handshake, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { LinearCard } from "@/components/linear/primitives";
import { trpc } from "@/lib/trpc";

type SampleSignoffPanelProps = {
  projectId: string;
  phaseId: string;
  phaseName: string;
  role: string;
  canManage: boolean;
};

type SignoffType = "evt_sample" | "dvt_sample" | "pvt_sample" | "golden_sample" | "first_article" | "other";
type SignoffAudience = "customer" | "supplier" | "internal";
type SignoffStatus = "pending" | "approved" | "rejected" | "waived";

const SIGNOFF_PHASES = new Set(["sample", "evt", "dvt", "pvt", "mp"]);

const TYPE_OPTIONS: { value: SignoffType; label: string }[] = [
  { value: "evt_sample", label: "EVT 样品" },
  { value: "dvt_sample", label: "DVT 样品" },
  { value: "pvt_sample", label: "PVT 样品" },
  { value: "golden_sample", label: "Golden Sample" },
  { value: "first_article", label: "FAI/首件" },
  { value: "other", label: "其他" },
];

const AUDIENCE_OPTIONS: { value: SignoffAudience; label: string }[] = [
  { value: "customer", label: "客户" },
  { value: "supplier", label: "供应商" },
  { value: "internal", label: "内部" },
];

const STATUS_LABEL: Record<SignoffStatus, string> = {
  pending: "待确认",
  approved: "已确认",
  rejected: "已拒绝",
  waived: "已豁免",
};

function statusTone(status: SignoffStatus) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "waived") return "border-zinc-200 bg-zinc-50 text-zinc-600";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function audienceMatchesFile(visibility: string | null | undefined, audience: SignoffAudience) {
  if (visibility === "public") return true;
  if (audience === "customer") return visibility === "customer";
  if (audience === "supplier") return visibility === "supplier";
  return visibility === "internal";
}

export function SampleSignoffPanel({ projectId, phaseId, phaseName, role, canManage }: SampleSignoffPanelProps) {
  const isSignoffPhase = SIGNOFF_PHASES.has(phaseId);
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState(`${phaseName} 样品确认`);
  const [signoffType, setSignoffType] = useState<SignoffType>(phaseId === "pvt" ? "golden_sample" : "other");
  const [audience, setAudience] = useState<SignoffAudience>("customer");
  const [sampleSerials, setSampleSerials] = useState("");
  const [fileId, setFileId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: signoffs = [] } = trpc.sampleSignoffs.list.useQuery(
    { projectId, phaseId },
    { enabled: isSignoffPhase }
  );
  const { data: files = [] } = trpc.files.list.useQuery(
    { projectId, phaseId },
    { enabled: isSignoffPhase && canManage }
  );

  const refresh = async () => {
    await Promise.all([
      utils.sampleSignoffs.list.invalidate({ projectId, phaseId }),
      utils.gateReviews.readiness.invalidate({ projectId, phaseId }),
    ]);
  };

  const createSignoff = trpc.sampleSignoffs.create.useMutation({
    onSuccess: async () => {
      setShowForm(false);
      setTitle(`${phaseName} 样品确认`);
      setSampleSerials("");
      setFileId("");
      setDueDate("");
      setNotes("");
      toast.success("样品签样项已创建");
      await refresh();
    },
    onError: (e) => toast.error(e.message || "创建样品签样失败"),
  });

  const respond = trpc.sampleSignoffs.respond.useMutation({
    onSuccess: async () => {
      toast.success("签样回应已记录");
      await refresh();
    },
    onError: (e) => toast.error(e.message || "签样回应失败"),
  });

  const stats = useMemo(() => ({
    approved: signoffs.filter((item) => item.status === "approved" || item.status === "waived").length,
    pending: signoffs.filter((item) => item.status === "pending").length,
    rejected: signoffs.filter((item) => item.status === "rejected").length,
  }), [signoffs]);
  const candidateFiles = useMemo(
    () => files.filter((file) => audienceMatchesFile(file.visibility, audience)),
    [files, audience]
  );
  const canRespond = canManage || role === "external_customer" || role === "supplier";

  if (!isSignoffPhase) return null;

  const disabled = createSignoff.isPending || respond.isPending;

  return (
    <LinearCard className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Handshake size={14} className="text-primary" />
            <span className="text-sm font-medium text-foreground">{phaseName} 样品 / 客户签样</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            客户、供应商或内部确认项独立管理；PVT 客户项目进入 MP 前需要 Golden Sample 签样闭环。
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[color:var(--acc-border)] px-2.5 py-1.5 text-xs text-primary hover:bg-[color:var(--acc-soft)]"
          >
            <Plus size={12} /> 签样项
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border border-border bg-secondary/50 p-2">
          <div className="text-muted-foreground">已确认</div>
          <div className="num mt-1 text-base font-semibold text-foreground">{stats.approved}</div>
        </div>
        <div className="rounded-md border border-border bg-secondary/50 p-2">
          <div className="text-muted-foreground">待确认</div>
          <div className="num mt-1 text-base font-semibold text-foreground">{stats.pending}</div>
        </div>
        <div className="rounded-md border border-border bg-secondary/50 p-2">
          <div className="text-muted-foreground">已拒绝</div>
          <div className="num mt-1 text-base font-semibold text-foreground">{stats.rejected}</div>
        </div>
      </div>

      {showForm && canManage && (
        <div className="grid gap-2 rounded-md border border-border bg-secondary/30 p-3 text-xs md:grid-cols-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="签样项名称"
            className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary md:col-span-2"
          />
          <select
            value={signoffType}
            onChange={(e) => setSignoffType(e.target.value as SignoffType)}
            className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary"
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value as SignoffAudience);
              setFileId("");
            }}
            className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary"
          >
            {AUDIENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <input
            value={sampleSerials}
            onChange={(e) => setSampleSerials(e.target.value)}
            placeholder="样机/SN，逗号分隔"
            className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary"
          />
          <input
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            type="date"
            className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary"
          />
          <select
            value={fileId}
            onChange={(e) => setFileId(e.target.value)}
            className="rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary md:col-span-2"
          >
            <option value="">客户/供应商可见文件（可后补）</option>
            {candidateFiles.map((file) => (
              <option key={file.id} value={file.id}>{file.name}</option>
            ))}
          </select>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="确认要求 / 验收口径 / 样品寄送说明"
            className="min-h-[72px] rounded-md border border-border bg-card px-2.5 py-2 text-foreground outline-none focus:border-primary md:col-span-2"
          />
          <div className="flex justify-end gap-2 md:col-span-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-secondary">
              取消
            </button>
            <button
              type="button"
              disabled={disabled || !title.trim()}
              onClick={() => createSignoff.mutate({
                projectId,
                phaseId,
                title: title.trim(),
                signoffType,
                audience,
                sampleSerials: sampleSerials.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
                fileId: fileId ? Number(fileId) : null,
                dueDate: dueDate || null,
                notes: notes.trim() || null,
              })}
              className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </div>
      )}

      {signoffs.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
          暂无样品签样项。客户项目的 PVT → MP 放行应建立 Golden Sample 签样项。
        </div>
      ) : (
        <div className="divide-y divide-border">
          {signoffs.map((signoff) => (
            <div key={signoff.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{signoff.title}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusTone(signoff.status as SignoffStatus)}`}>
                      {STATUS_LABEL[signoff.status as SignoffStatus]}
                    </span>
                    <span className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {AUDIENCE_OPTIONS.find((option) => option.value === signoff.audience)?.label || signoff.audience}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {TYPE_OPTIONS.find((option) => option.value === signoff.signoffType)?.label || signoff.signoffType}
                    {signoff.dueDate ? ` · due ${formatDate(signoff.dueDate)}` : ""}
                    {signoff.fileId ? ` · file #${signoff.fileId}` : ""}
                    {signoff.sampleSerials?.length ? ` · SN ${signoff.sampleSerials.join(", ")}` : ""}
                  </div>
                  {signoff.notes && <div className="mt-1 text-xs text-muted-foreground">{signoff.notes}</div>}
                  {signoff.responseNote && <div className="mt-1 text-xs text-muted-foreground">回应：{signoff.responseNote}</div>}
                </div>
                {canRespond && (
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => respond.mutate({ id: signoff.id, status: "approved" })}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      <CheckCircle2 size={12} /> Approve
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => respond.mutate({ id: signoff.id, status: "rejected" })}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <XCircle size={12} /> Reject
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => respond.mutate({ id: signoff.id, status: "waived" })}
                        className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary disabled:opacity-50"
                      >
                        Waive
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
