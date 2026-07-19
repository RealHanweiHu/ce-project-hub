import { useMemo, useRef, useState } from "react";
import { Download, Eye, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { FileAttachment } from "@/lib/data";
import { formatBytes } from "@/lib/data";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileNameBadges } from "./FileBadges";
import { FilePreviewModal, canPreview } from "./FilePreviewModal";

const MAX_FILE_SIZE = 16 * 1024 * 1024;

export function DeliverableUploadDialog({
  open,
  onOpenChange,
  projectId,
  phaseId,
  taskId,
  deliverableName,
  currentFile,
  canUpload,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  phaseId: string;
  taskId?: string;
  deliverableName: string;
  currentFile?: FileAttachment;
  canUpload: boolean;
  onUploaded: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !canUpload || uploading) return;
    if (file.size > MAX_FILE_SIZE) {
      setError(`文件超出 ${formatBytes(MAX_FILE_SIZE)} 限制`);
      return;
    }
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      formData.append("phaseId", phaseId);
      if (taskId) formData.append("taskId", taskId);
      formData.append("deliverableName", deliverableName);
      formData.append("visibility", "internal");
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const result = (await response
        .json()
        .catch(() => ({ error: response.statusText }))) as {
        error?: string;
        fileVersion?: string | null;
      };
      if (!response.ok) throw new Error(result.error || response.statusText);
      await onUploaded();
      toast.success(`已上传 ${deliverableName}`, {
        description: result.fileVersion
          ? `当前版本 ${result.fileVersion}`
          : undefined,
      });
      onOpenChange(false);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{deliverableName}</DialogTitle>
          <DialogDescription>
            上传新文件时系统自动生成下一版本，并替换当前活动版本。
          </DialogDescription>
        </DialogHeader>

        {currentFile && (
          <div className="rounded-md border border-border bg-secondary/50 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              当前版本
            </div>
            <FileNameBadges
              name={currentFile.name}
              fileVersion={currentFile.fileVersion}
              visibility={currentFile.visibility}
            />
            <div className="mt-1 text-[10px] text-muted-foreground">
              {formatBytes(currentFile.size)}
            </div>
          </div>
        )}

        {canUpload ? (
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-md border border-dashed border-border p-6 text-center transition-colors hover:border-[color:var(--acc-border)] hover:bg-secondary/50 disabled:opacity-60"
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={event => void upload(event.target.files)}
            />
            <Upload size={20} className="mx-auto mb-2 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">
              {uploading
                ? "上传中…"
                : currentFile
                  ? "上传新版本"
                  : "选择文件上传"}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              版本号自动生成 · 单个文件最大 {formatBytes(MAX_FILE_SIZE)}
            </div>
          </button>
        ) : (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            当前仅可查看交付物
          </div>
        )}
        {error && (
          <div className="text-xs text-destructive">上传失败：{error}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function UploadedDeliverablesList({
  files,
  onRemove,
  readOnly,
}: {
  files: FileAttachment[];
  onRemove: (id: string) => void;
  readOnly: boolean;
}) {
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);
  const latestFiles = useMemo(() => {
    const byDeliverable = new Map<string, FileAttachment>();
    for (const file of files) {
      if (file.deliverableName) byDeliverable.set(file.deliverableName, file);
    }
    return Array.from(byDeliverable.values());
  }, [files]);

  if (latestFiles.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">暂无已上传交付物</div>
    );
  }

  return (
    <div className="space-y-1.5">
      {latestFiles.map(file => (
        <div
          key={file.id}
          className="group flex items-center gap-2 rounded-md p-2 hover:bg-secondary/60"
        >
          <FileText size={14} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-foreground">
              {file.deliverableName}
            </div>
            <FileNameBadges
              name={file.name}
              fileVersion={file.fileVersion}
              visibility={file.visibility}
            />
          </div>
          {canPreview(file) && (
            <button
              type="button"
              onClick={() => setPreviewFile(file)}
              title="预览"
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <Eye size={13} />
            </button>
          )}
          <a
            href={file.storageUrl || file.dataUrl}
            download={file.name}
            title="下载"
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <Download size={13} />
          </a>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onRemove(file.id)}
              title="删除"
              className="p-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}
      <FilePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  );
}
