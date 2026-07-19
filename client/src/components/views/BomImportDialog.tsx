import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  BOM_IMPORT_TEMPLATE_HEADERS,
  parseBomImportRows,
  type BomImportResult,
} from "@shared/bom-import";

type ImportMode = "merge" | "replace";

type LoadedFile = {
  name: string;
  result: BomImportResult;
};

export function BomImportDialog({
  projectId,
  open,
  onOpenChange,
  canEditCommercials,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEditCommercials: boolean;
}) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [isReading, setIsReading] = useState(false);

  const previewMutation = trpc.bom.bulkUpsert.useMutation({
    onError: (error) => toast.error(`校验失败：${error.message}`),
  });
  const importMutation = trpc.bom.bulkUpsert.useMutation({
    onSuccess: async (result) => {
      await utils.bom.working.invalidate({ projectId });
      toast.success(
        `BOM 已导入：新增 ${result.inserted} 行，更新 ${result.updated} 行${result.deleted ? `，移除 ${result.deleted} 行` : ""}`,
      );
      handleOpenChange(false);
    },
    onError: (error) => {
      toast.error(`导入失败：${error.message}`);
      // The preview token is single-snapshot evidence. Any failed apply must
      // obtain a fresh token before the user can confirm again.
      previewMutation.reset();
      if (loaded) void validateOnServer(loaded, mode);
    },
  });

  const payloadLines = loaded?.result.lines.map((line, index) => ({
    ...line,
    lineNumber: index + 2,
  })) ?? [];
  const containsRestrictedCommercials = Boolean(
    !canEditCommercials
      && loaded?.result.lines.some((line) => line.supplierName || line.unitCost),
  );
  const canSubmit = Boolean(
    loaded
      && loaded.result.lines.length > 0
      && loaded.result.errors.length === 0
      && !containsRestrictedCommercials,
  );

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setLoaded(null);
      setMode("merge");
      previewMutation.reset();
      importMutation.reset();
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function validateOnServer(nextLoaded: LoadedFile, nextMode: ImportMode) {
    if (
      nextLoaded.result.lines.length === 0
      || nextLoaded.result.errors.length > 0
      || (!canEditCommercials
        && nextLoaded.result.lines.some((line) => line.supplierName || line.unitCost))
    ) {
      previewMutation.reset();
      return;
    }
    previewMutation.reset();
    try {
      await previewMutation.mutateAsync({
        projectId,
        mode: nextMode,
        dryRun: true,
        lines: nextLoaded.result.lines.map((line, index) => ({
          ...line,
          lineNumber: index + 2,
        })),
      });
    } catch {
      // onError keeps the file and local row errors visible so the user can
      // correct the source instead of having to select it again.
    }
  }

  async function handleFile(file: File) {
    setIsReading(true);
    previewMutation.reset();
    try {
      if (file.size > 10 * 1024 * 1024) {
        throw new Error("单个 BOM 文件不能超过 10 MB");
      }
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error("文件里没有可读取的工作表");
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[firstSheetName],
        { defval: "", raw: false },
      );
      const nextLoaded = { name: file.name, result: parseBomImportRows(rawRows) };
      setLoaded(nextLoaded);
      await validateOnServer(nextLoaded, mode);
    } catch (error) {
      setLoaded(null);
      toast.error(error instanceof Error ? error.message : "无法读取 BOM 文件");
    } finally {
      setIsReading(false);
    }
  }

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const worksheet = XLSX.utils.aoa_to_sheet([
      [...BOM_IMPORT_TEMPLATE_HEADERS],
      ["PN-001", "示例物料", "规格 / 型号", 1, "REF1", "", ""],
    ]);
    worksheet["!cols"] = [
      { wch: 18 }, { wch: 24 }, { wch: 22 }, { wch: 10 },
      { wch: 16 }, { wch: 20 }, { wch: 12 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "BOM");
    XLSX.writeFile(workbook, "BOM批量导入模板.xlsx");
  }

  async function changeMode(nextMode: ImportMode) {
    setMode(nextMode);
    if (loaded) await validateOnServer(loaded, nextMode);
  }

  const preview = previewMutation.data;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-primary" />
            批量导入工作态 BOM
          </DialogTitle>
          <DialogDescription>
            支持 Excel 与 CSV。系统会先校验并预览，确认后才写入项目 BOM。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
          <div className="space-y-4">
            <section className="rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">1. 准备数据</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    名称、料号（或位号）为必填，用量留空时按 1 处理。
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
                  <Download />下载模板
                </Button>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={isReading}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-8 text-sm transition-colors hover:border-primary/40 hover:bg-secondary disabled:opacity-60"
              >
                {isReading ? <Loader2 className="animate-spin" /> : <Upload />}
                <span>{loaded ? loaded.name : "选择 Excel 或 CSV 文件"}</span>
              </button>
            </section>

            <section className="rounded-xl border border-border p-4">
              <div className="text-sm font-medium">2. 写入方式</div>
              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  onClick={() => void changeMode("merge")}
                  className={`rounded-lg border p-3 text-left transition-colors ${mode === "merge" ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"}`}
                >
                  <div className="text-sm font-medium">合并更新</div>
                  <div className="mt-1 text-xs text-muted-foreground">相同料号更新，其他行保留；适合日常增补。</div>
                </button>
                <button
                  type="button"
                  onClick={() => void changeMode("replace")}
                  className={`rounded-lg border p-3 text-left transition-colors ${mode === "replace" ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"}`}
                >
                  <div className="text-sm font-medium">替换普通物料</div>
                  <div className="mt-1 text-xs text-muted-foreground">以文件替换普通 BOM 行，受控关键模块始终保留。</div>
                </button>
              </div>
            </section>

            <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>电池、电机 / 机芯、PCBA 等受控模块不能被普通 BOM 导入覆盖或删除，必须通过模块库生成新编号并审批。</span>
            </div>
          </div>

          <section className="min-h-[380px] rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">3. 校验与预览</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {loaded ? `${loaded.result.lines.length} 行可导入，${loaded.result.errors.length} 项需要修正` : "选择文件后显示结果"}
                </div>
              </div>
              {previewMutation.isPending && <Loader2 className="size-4 animate-spin text-primary" />}
              {preview && !previewMutation.isPending && (
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 className="size-4" />服务端校验通过
                </span>
              )}
            </div>

            {containsRestrictedCommercials && (
              <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <AlertCircle className="size-4 shrink-0" />
                当前权限不能导入供应商或单价。请清空这两列，或由 SCM / 项目经理完成导入。
              </div>
            )}

            {loaded && loaded.result.errors.length > 0 && (
              <div className="mt-4 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                {loaded.result.errors.map((error) => (
                  <div key={`${error.row}-${error.message}`} className="flex gap-2 text-xs text-destructive">
                    <AlertCircle className="size-3.5 shrink-0" />
                    第 {error.row} 行：{error.message}
                  </div>
                ))}
              </div>
            )}

            {preview && (
              <div className="mt-4 space-y-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["新增", preview.inserted],
                    ["更新", preview.updated],
                    ["移除", preview.deleted],
                    ["保留受控模块", preview.preservedControlled],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-secondary p-3 text-center">
                      <div className="text-lg font-semibold tabular-nums">{value}</div>
                      <div className="text-[11px] text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="text-right font-mono text-[10px] text-muted-foreground">
                  BOM 预览基线 v{preview.bomDigestVersion} · {preview.bomDigest.slice(0, 12)}
                </div>
              </div>
            )}

            {loaded && loaded.result.lines.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[620px] text-xs">
                  <thead className="bg-secondary text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">料号</th>
                      <th className="px-3 py-2">名称</th>
                      <th className="px-3 py-2">规格</th>
                      <th className="px-3 py-2">用量</th>
                      <th className="px-3 py-2">位号</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaded.result.lines.slice(0, 10).map((line, index) => (
                      <tr key={`${line.partNumber}-${line.refDesignator}-${index}`} className="border-t border-border">
                        <td className="px-3 py-2 font-mono">{line.partNumber || "—"}</td>
                        <td className="px-3 py-2">{line.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{line.spec || "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{line.quantity}</td>
                        <td className="px-3 py-2">{line.refDesignator || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {loaded.result.lines.length > 10 && (
                  <div className="border-t border-border px-3 py-2 text-center text-xs text-muted-foreground">
                    另有 {loaded.result.lines.length - 10} 行，将在导入时一并处理
                  </div>
                )}
              </div>
            ) : !loaded ? (
              <div className="flex min-h-[280px] items-center justify-center text-center text-sm text-muted-foreground">
                上传文件后，这里会显示字段映射、错误行和写入影响。
              </div>
            ) : null}
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || previewMutation.isPending || importMutation.isPending || !preview}
            onClick={() => importMutation.mutate({
              projectId,
              mode,
              dryRun: false,
              expectedBomDigest: preview!.bomDigest,
              expectedBomDigestVersion: preview!.bomDigestVersion,
              lines: payloadLines,
            })}
          >
            {importMutation.isPending && <Loader2 className="animate-spin" />}
            确认导入 {loaded?.result.lines.length ?? 0} 行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
