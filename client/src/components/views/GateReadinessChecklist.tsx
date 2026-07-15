import { useRef, useState } from "react";
import { resolveTaskName } from '@shared/sop-template-resolution';
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, XCircle, Upload, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { getGateEvidenceState } from "@/lib/gate-evidence-state";

const DIM_LABEL: Record<string, string> = {
  prereq: "前置任务",
  deliverables: "必需交付物",
  test_reports: "测试计划 / 报告",
  critical_issues: "本阶段 P0/P1",
  role_blocks: "QA / PE 阻断",
  review_conditions: "遗留评审条件",
};

type FileRow = { id: number; name: string; deliverableName: string | null; storageUrl: string };
type GateBlockerRow = {
  id: number;
  blockerType: "quality" | "npi";
  title: string;
  description: string | null;
  status: "open" | "resolved";
};
type DeliverableReviewRow = {
  phaseId: string;
  deliverableName: string;
  status: "pending" | "approved" | "rejected";
};

/**
 * Gate 就绪清单（服务端 gateReviews.readiness 驱动，含测试报告与 QA/PE 阻断维度）。
 * 交付物维度可逐项展开上传（多版本），上传/删除自动刷新就绪度。
 */
export function GateReadinessChecklist({
  projectId, phaseId, gateTaskId, canEdit = true, canQualityGateBlock = false, canNpiGateBlock = false,
  onTaskClick,
}: {
  projectId: string;
  phaseId: string;
  gateTaskId: string;
  canEdit?: boolean;
  canQualityGateBlock?: boolean;
  canNpiGateBlock?: boolean;
  /** 缺口行"去处理"跳转（设计4 §4：每行一键动作）。 */
  onTaskClick?: (phaseId: string, taskId: string) => void;
}) {
  const utils = trpc.useUtils();
  const { data: readiness, isLoading } = trpc.gateReviews.readiness.useQuery({ projectId, phaseId });
  // Match server readiness: evidence may be uploaded from the producing task,
  // not only from the Gate task itself.
  const { data: files = [] } = trpc.files.list.useQuery({ projectId, phaseId });
  const { data: deliverableReviews = [] } = trpc.deliverableReviews.list.useQuery({ projectId });
  const { data: gateBlockers = [] } = trpc.gateBlockers.list.useQuery({ projectId, phaseId });
  // §4 缺口清单：前置任务缺口带名称+责任人+跳转，而不是裸 id
  const { data: projectRow } = trpc.projects.get.useQuery({ id: projectId }, { staleTime: 30_000 });
  const { data: phaseTasks = [] } = trpc.tasks.list.useQuery({ projectId, phaseId }, { staleTime: 5_000 });
  const { data: userRows = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const taskRowById = new Map((phaseTasks as Array<{ taskId: string; assigneeUserId: number | null }>)
    .map((task) => [task.taskId, task]));
  const userName = (id: number | null | undefined) => {
    if (id == null) return null;
    const u = (userRows as Array<{ id: number; name?: string | null; username?: string | null }>).find((x) => x.id === id);
    return u ? (u.name || u.username || `#${id}`) : `#${id}`;
  };

  const refresh = async () => {
    await Promise.all([
      utils.gateReviews.readiness.invalidate({ projectId, phaseId }),
      utils.files.list.invalidate({ projectId, phaseId }),
      utils.gateBlockers.list.invalidate({ projectId, phaseId }),
      utils.deliverableReviews.list.invalidate({ projectId }),
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
              reviews={(deliverableReviews as DeliverableReviewRow[])
                .filter(review => review.phaseId === phaseId)}
              canEdit={canEdit}
              onUpload={uploadFor}
              onDelete={(id) => del.mutate({ id, projectId })}
            />
          )}
          {dim.dimension === "prereq" && !dim.ok && dim.blockers.length > 0 && (
            <ul className="ml-6 mt-0.5 text-xs space-y-0.5">
              {dim.blockers.map((taskId) => {
                const row = taskRowById.get(taskId);
                const owner = userName(row?.assigneeUserId);
                return (
                  <li key={taskId} className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-foreground">
                      {projectRow ? resolveTaskName(projectRow as never, taskId, phaseId) : taskId}
                    </span>
                    {owner && <span className="text-[11px]">@{owner}</span>}
                    {!owner && <span className="text-[11px] text-[color:var(--warning)]">待指派</span>}
                    {onTaskClick && (
                      <button
                        type="button"
                        onClick={() => onTaskClick(phaseId, taskId)}
                        className="text-[11px] text-primary hover:underline"
                      >
                        去处理 →
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {dim.dimension !== "deliverables" && dim.dimension !== "prereq" && !dim.ok && dim.blockers.length > 0 && (
            <ul className="ml-6 mt-0.5 text-xs text-muted-foreground list-disc pl-3 space-y-0.5">
              {dim.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          )}
        </div>
      ))}
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
  missing, files, reviews, canEdit, onUpload, onDelete,
}: {
  missing: string[];
  files: FileRow[];
  reviews: DeliverableReviewRow[];
  canEdit: boolean;
  onUpload: (name: string, file: File) => void;
  onDelete: (id: number) => void;
}) {
  // 全集 = 已上传(文件里出现的 deliverableName) ∪ 缺失(missing)
  const uploadedNames = Array.from(new Set(files.map((f) => f.deliverableName).filter((n): n is string => !!n)));
  const names = Array.from(new Set([...uploadedNames, ...missing]));
  const reviewByName = new Map(reviews.map(review => [review.deliverableName, review]));
  if (names.length === 0) return null;
  return (
    <div className="ml-6 mt-1 space-y-1">
      {names.map((name) => {
        const versions = files.filter((f) => f.deliverableName === name).sort((a, b) => b.id - a.id);
        const has = versions.length > 0;
        const state = getGateEvidenceState({
          hasFile: has,
          readinessMissing: missing.includes(name),
          reviewStatus: reviewByName.get(name)?.status ?? null,
        });
        const statusLabel = {
          missing: "缺少文件",
          uploaded: "已上传，待提交审核",
          pending: "审核中",
          rejected: "审核未通过",
          approved: "已通过",
        }[state];
        return (
          <div key={name} className="text-xs">
            <div className="flex items-center gap-2">
              {state === "approved"
                ? <CheckCircle2 size={12} className="shrink-0 text-[color:var(--success)]" />
                : state === "missing"
                  ? <XCircle size={12} className="shrink-0 text-destructive" />
                  : <AlertCircle size={12} className="shrink-0 text-[color:var(--warning)]" />}
              <span className={state === "missing" ? "text-muted-foreground" : "text-foreground"}>{name}</span>
              <span className={state === "approved"
                ? "text-[10px] text-[color:var(--success)]"
                : state === "missing" || state === "rejected"
                  ? "text-[10px] text-destructive"
                  : "text-[10px] text-[color:var(--warning)]"}
              >
                {statusLabel}
              </span>
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
