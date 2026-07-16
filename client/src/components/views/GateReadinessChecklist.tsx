import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, ChevronRight, XCircle, Upload, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

const DIM_LABEL: Record<string, string> = {
  prereq: "前置任务",
  deliverables: "必需交付物",
  test_reports: "测试计划 / 报告",
  critical_issues: "本阶段 P0/P1",
  role_blocks: "QA / PE 阻断",
  review_conditions: "遗留评审条件",
  npi_readiness: "PE/NPI 就绪",
  sample_signoffs: "样品签样",
};

type FileRow = { id: number; name: string; deliverableName: string | null; storageUrl: string };
type GateBlockerRow = {
  id: number;
  blockerType: "quality" | "npi";
  title: string;
  description: string | null;
  status: "open" | "resolved";
};

/**
 * Gate 就绪清单（服务端 gateReviews.readiness 驱动，含测试报告与 QA/PE 阻断维度）。
 * 交付物维度可逐项展开上传（多版本），上传/删除自动刷新就绪度。
 */
export function GateReadinessChecklist({
  projectId, phaseId, gateTaskId, canEdit = true, canQualityGateBlock = false, canNpiGateBlock = false,
}: {
  projectId: string;
  phaseId: string;
  gateTaskId: string;
  canEdit?: boolean;
  canQualityGateBlock?: boolean;
  canNpiGateBlock?: boolean;
}) {
  const utils = trpc.useUtils();
  const { data: readiness, isLoading } = trpc.gateReviews.readiness.useQuery({ projectId, phaseId });
  const { data: files = [] } = trpc.files.list.useQuery({ projectId, phaseId, taskId: gateTaskId });
  const { data: gateBlockers = [] } = trpc.gateBlockers.list.useQuery({ projectId, phaseId });

  const refresh = async () => {
    await Promise.all([
      utils.gateReviews.readiness.invalidate({ projectId, phaseId }),
      utils.files.list.invalidate({ projectId, phaseId, taskId: gateTaskId }),
      utils.gateBlockers.list.invalidate({ projectId, phaseId }),
    ]);
  };

  const uploadFor = async (deliverableName: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", projectId);
    fd.append("phaseId", phaseId);
    fd.append("taskId", gateTaskId);
    fd.append("deliverableName", deliverableName);
    const resp = await fetch("/api/files/upload", { method: "POST", body: fd, credentials: "include" });
    if (!resp.ok) { toast.error("上传失败"); return; }
    toast.success(`已上传：${deliverableName}`);
    await refresh();
  };

  const del = trpc.files.delete.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.error(e.data?.code === 'FORBIDDEN' ? '没有权限删除该文件' : (e.message || '删除失败')),
  });

  if (isLoading || !readiness) {
    return <div className="text-xs text-muted-foreground p-3 border border-border rounded-[9px] mb-4">就绪度加载中…</div>;
  }

  const deliverablesDim = readiness.dimensions.find((d) => d.dimension === "deliverables");
  // 首屏聚焦（P0-5）：未达成维度展开在首屏，已满足维度折叠成一行
  const blockingDims = readiness.dimensions.filter((d) => !d.ok);
  const passedDims = readiness.dimensions.filter((d) => d.ok);

  const renderDim = (dim: (typeof readiness.dimensions)[number]) => (
    <div key={dim.dimension} className="text-sm">
      <div className="flex items-center gap-2">
        {dim.ok
          ? <CheckCircle2 size={14} className="text-[color:var(--success)] shrink-0" />
          : <XCircle size={14} className="text-destructive shrink-0" />}
        <span className="font-medium text-foreground">{DIM_LABEL[dim.dimension] ?? dim.dimension}</span>
        <span className="text-muted-foreground text-xs">· {dim.summary}</span>
      </div>
      {dim.dimension === "deliverables" && (
        <DeliverableRows
          missing={deliverablesDim?.blockers ?? []}
          files={files as FileRow[]}
          canEdit={canEdit}
          onUpload={uploadFor}
          onDelete={(id) => del.mutate({ id, projectId })}
        />
      )}
      {dim.dimension !== "deliverables" && !dim.ok && dim.blockers.length > 0 && (
        <ul className="ml-6 mt-0.5 text-xs text-muted-foreground list-disc pl-3 space-y-0.5">
          {dim.blockers.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
    </div>
  );

  return (
    <div className="border border-border bg-secondary rounded-[9px] p-3 mb-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">GATE 就绪度</span>
        <span className="text-xs font-medium" style={{ color: readiness.ready ? "var(--success)" : "var(--destructive)" }}>
          {readiness.ready ? "已就绪" : `还差 ${readiness.blockerCount} 项不能过会`}
        </span>
      </div>
      {blockingDims.map(renderDim)}
      {passedDims.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
            <CheckCircle2 size={12} className="shrink-0 text-[color:var(--success)]" />
            已满足 {passedDims.length} 项：{passedDims.map((d) => DIM_LABEL[d.dimension] ?? d.dimension).join('、')}
          </summary>
          <div className="mt-2 space-y-2">{passedDims.map(renderDim)}</div>
        </details>
      )}
      <GateBlockerControls
        projectId={projectId}
        phaseId={phaseId}
        blockers={gateBlockers as GateBlockerRow[]}
        canQualityGateBlock={canQualityGateBlock}
        canNpiGateBlock={canNpiGateBlock}
        onChanged={refresh}
      />
    </div>
  );
}

function GateBlockerControls({
  projectId, phaseId, blockers, canQualityGateBlock, canNpiGateBlock, onChanged,
}: {
  projectId: string;
  phaseId: string;
  blockers: GateBlockerRow[];
  canQualityGateBlock: boolean;
  canNpiGateBlock: boolean;
  onChanged: () => Promise<void>;
}) {
  const [blockerType, setBlockerType] = useState<"quality" | "npi">(canQualityGateBlock ? "quality" : "npi");
  const [title, setTitle] = useState("");
  const canCreate = canQualityGateBlock || canNpiGateBlock;
  const availableTypes = [
    ...(canQualityGateBlock ? [{ value: "quality" as const, label: "质量阻断" }] : []),
    ...(canNpiGateBlock ? [{ value: "npi" as const, label: "NPI/工艺阻断" }] : []),
  ];
  const create = trpc.gateBlockers.create.useMutation({
    onSuccess: async () => { setTitle(""); await onChanged(); toast.success("已添加 Gate 阻断项"); },
    onError: (e) => toast.error(e.message || "添加失败"),
  });
  const resolve = trpc.gateBlockers.resolve.useMutation({
    onSuccess: async () => { await onChanged(); toast.success("已解除 Gate 阻断项"); },
    onError: (e) => toast.error(e.message || "解除失败"),
  });
  const canResolve = (row: GateBlockerRow) =>
    row.status === "open" && (row.blockerType === "quality" ? canQualityGateBlock : canNpiGateBlock);

  if (blockers.length === 0 && !canCreate) return null;

  return (
    <div className="mt-3 border-t border-border pt-3 space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">QA / PE Gate 阻断</div>
      {blockers.length > 0 && (
        <div className="space-y-1">
          {blockers.map((row) => (
            <div key={row.id} className="flex items-start justify-between gap-2 rounded-[7px] border border-border bg-card px-2 py-1.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">
                    {row.blockerType === "quality" ? "QA" : "PE/NPI"}
                  </span>
                  <span className={row.status === "open" ? "text-xs font-medium text-foreground" : "text-xs text-muted-foreground line-through"}>
                    {row.title}
                  </span>
                </div>
                {row.description && <div className="mt-0.5 text-xs text-muted-foreground">{row.description}</div>}
              </div>
              {canResolve(row) && (
                <button
                  type="button"
                  onClick={() => resolve.mutate({ id: row.id })}
                  disabled={resolve.isPending}
                  className="shrink-0 text-xs text-primary hover:opacity-80 disabled:opacity-40"
                >
                  解除
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canCreate && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {availableTypes.length > 1 && (
            <select
              value={blockerType}
              onChange={(event) => setBlockerType(event.target.value as "quality" | "npi")}
              className="h-8 rounded-[7px] border border-border bg-card px-2 text-xs"
            >
              {availableTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          )}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="输入阻断原因，如 EVT 跌落失效未复测"
            className="h-8 min-w-0 flex-1 rounded-[7px] border border-border bg-card px-2 text-xs"
          />
          <button
            type="button"
            disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate({ projectId, phaseId, blockerType, title: title.trim() })}
            className="h-8 rounded-[7px] bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            阻断 Gate
          </button>
        </div>
      )}
    </div>
  );
}

function DeliverableRows({
  missing, files, canEdit, onUpload, onDelete,
}: {
  missing: string[];
  files: FileRow[];
  canEdit: boolean;
  onUpload: (name: string, file: File) => void;
  onDelete: (id: number) => void;
}) {
  // 全集 = 已上传(文件里出现的 deliverableName) ∪ 缺失(missing)
  const uploadedNames = Array.from(new Set(files.map((f) => f.deliverableName).filter((n): n is string => !!n)));
  const names = Array.from(new Set([...uploadedNames, ...missing]));
  if (names.length === 0) return null;

  const row = (name: string) => {
    const versions = files.filter((f) => f.deliverableName === name).sort((a, b) => b.id - a.id);
    const has = versions.length > 0;
    return (
      <div key={name} className="text-xs">
        <div className="flex items-center gap-2">
          {has ? <CheckCircle2 size={12} className="text-[color:var(--success)] shrink-0" /> : <XCircle size={12} className="text-destructive shrink-0" />}
          <span className={has ? "text-foreground" : "text-muted-foreground"}>{name}</span>
          {canEdit && <UploadButton onPick={(f) => onUpload(name, f)} />}
        </div>
        {versions.map((v, idx) => (
          <div key={v.id} className="flex items-center gap-1 ml-5 mt-0.5 text-muted-foreground">
            <FileText size={11} className="shrink-0" />
            <a href={v.storageUrl} target="_blank" rel="noreferrer" className="hover:underline truncate max-w-[180px]">{v.name}</a>
            {idx === 0 && <span className="text-[10px] text-[color:var(--success)]">最新</span>}
            {canEdit && (
              <button onClick={() => onDelete(v.id)} className="text-muted-foreground hover:text-destructive" title="删除该版本">
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  // 首屏聚焦：缺失项展开在外，已上传项折叠
  const missingNames = names.filter((n) => !files.some((f) => f.deliverableName === n));
  const doneNames = names.filter((n) => files.some((f) => f.deliverableName === n));
  return (
    <div className="ml-6 mt-1 space-y-1">
      {missingNames.map(row)}
      {doneNames.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight size={11} className="shrink-0 transition-transform group-open:rotate-90" />
            已上传 {doneNames.length} 项交付物
          </summary>
          <div className="mt-1 space-y-1">{doneNames.map(row)}</div>
        </details>
      )}
    </div>
  );
}

function UploadButton({ onPick }: { onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }}
      />
      <button onClick={() => ref.current?.click()} className="inline-flex items-center gap-0.5 text-primary hover:opacity-80">
        <Upload size={11} /> 上传
      </button>
    </>
  );
}
