import { useRef } from "react";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, XCircle, Upload, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

const DIM_LABEL: Record<string, string> = {
  prereq: "前置任务",
  deliverables: "必需交付物",
  critical_issues: "本阶段 P0/P1",
  review_conditions: "遗留评审条件",
};

type FileRow = { id: number; name: string; deliverableName: string | null; storageUrl: string };

/**
 * Gate 就绪清单（服务端 gateReviews.readiness 驱动，4 维）。
 * 交付物维度可逐项展开上传（多版本），上传/删除自动刷新就绪度。
 */
export function GateReadinessChecklist({
  projectId, phaseId, gateTaskId,
}: { projectId: string; phaseId: string; gateTaskId: string }) {
  const utils = trpc.useUtils();
  const { data: readiness, isLoading } = trpc.gateReviews.readiness.useQuery({ projectId, phaseId });
  const { data: files = [] } = trpc.files.list.useQuery({ projectId, phaseId, taskId: gateTaskId });

  const refresh = async () => {
    await Promise.all([
      utils.gateReviews.readiness.invalidate({ projectId, phaseId }),
      utils.files.list.invalidate({ projectId, phaseId, taskId: gateTaskId }),
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

  const del = trpc.files.delete.useMutation({ onSuccess: refresh, onError: (e) => toast.error(e.message) });

  if (isLoading || !readiness) {
    return <div className="text-xs text-muted-foreground p-3 border border-border rounded-[9px] mb-4">就绪度加载中…</div>;
  }

  const deliverablesDim = readiness.dimensions.find((d) => d.dimension === "deliverables");

  return (
    <div className="border border-border bg-secondary rounded-[9px] p-3 mb-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">GATE 就绪度</span>
        <span className="text-xs font-medium" style={{ color: readiness.ready ? "var(--success)" : "var(--destructive)" }}>
          {readiness.ready ? "已就绪" : `还差 ${readiness.blockerCount} 项不能过会`}
        </span>
      </div>
      {readiness.dimensions.map((dim) => (
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
      ))}
    </div>
  );
}

function DeliverableRows({
  missing, files, onUpload, onDelete,
}: {
  missing: string[];
  files: FileRow[];
  onUpload: (name: string, file: File) => void;
  onDelete: (id: number) => void;
}) {
  // 全集 = 已上传(文件里出现的 deliverableName) ∪ 缺失(missing)
  const uploadedNames = Array.from(new Set(files.map((f) => f.deliverableName).filter((n): n is string => !!n)));
  const names = Array.from(new Set([...uploadedNames, ...missing]));
  if (names.length === 0) return null;
  return (
    <div className="ml-6 mt-1 space-y-1">
      {names.map((name) => {
        const versions = files.filter((f) => f.deliverableName === name).sort((a, b) => b.id - a.id);
        const has = versions.length > 0;
        return (
          <div key={name} className="text-xs">
            <div className="flex items-center gap-2">
              {has ? <CheckCircle2 size={12} className="text-[color:var(--success)] shrink-0" /> : <XCircle size={12} className="text-destructive shrink-0" />}
              <span className={has ? "text-foreground" : "text-muted-foreground"}>{name}</span>
              <UploadButton onPick={(f) => onUpload(name, f)} />
            </div>
            {versions.map((v, idx) => (
              <div key={v.id} className="flex items-center gap-1 ml-5 mt-0.5 text-muted-foreground">
                <FileText size={11} className="shrink-0" />
                <a href={v.storageUrl} target="_blank" rel="noreferrer" className="hover:underline truncate max-w-[180px]">{v.name}</a>
                {idx === 0 && <span className="text-[10px] text-[color:var(--success)]">最新</span>}
                <button onClick={() => onDelete(v.id)} className="text-muted-foreground hover:text-destructive" title="删除该版本">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        );
      })}
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
