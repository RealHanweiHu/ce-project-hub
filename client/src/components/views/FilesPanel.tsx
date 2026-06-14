// 项目文件总览：列出项目内（当前用户权限范围内）所有文件，可预览/下载。
// 权限范围 = 文件所属任务对当前角色可见（沿用任务 visibleRoles 规则）。
import { useMemo, useState } from 'react';
import { Project, FileAttachment, getProjectPhases, formatBytes } from '@/lib/data';
import { trpc } from '@/lib/trpc';
import { FilePreviewModal, canPreview } from './FilePreviewModal';
import { FileText, Download, Eye, Loader2, FolderOpen } from 'lucide-react';

type FileRow = {
  id: number; name: string; size: number; mimeType: string;
  storageUrl: string | null; storageKey: string | null;
  phaseId: string | null; taskId: string | null; createdAt: string | Date | null;
};

export function FilesPanel({ project, role }: { project: Project; role: string }) {
  const { data: files = [], isLoading } = trpc.files.list.useQuery({ projectId: project.id });
  const [preview, setPreview] = useState<FileAttachment | null>(null);

  // taskId -> { phaseName, taskName, visibleRoles }（SOP + 项目级覆盖）
  const taskMeta = useMemo(() => {
    const m = new Map<string, { phaseName: string; taskName: string; roles: string[] }>();
    for (const phase of getProjectPhases(project)) {
      for (const t of phase.tasks) {
        const roles = project.taskVisibleRoles?.[t.id] ?? (t.visibleRoles || []);
        m.set(t.id, { phaseName: phase.name, taskName: t.name, roles });
      }
    }
    return m;
  }, [project]);

  const visibleFiles = (files as FileRow[]).filter((f) => {
    if (!f.taskId) return true; // 项目级文件
    const meta = taskMeta.get(f.taskId);
    if (!meta || meta.roles.length === 0) return true; // 未限定 = 全员可见
    return role === 'owner' || meta.roles.includes(role);
  });

  const toAttachment = (f: FileRow): FileAttachment => ({
    id: String(f.id), name: f.name, size: f.size, type: f.mimeType,
    uploadDate: f.createdAt ? new Date(f.createdAt).toISOString() : '',
    dataUrl: '', storageUrl: f.storageUrl ?? undefined, storageKey: f.storageKey ?? undefined,
  });

  if (isLoading) return <div className="flex items-center gap-2 text-stone-400 text-sm py-8 justify-center"><Loader2 size={14} className="animate-spin" />加载文件…</div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <FolderOpen size={15} className="text-amber-500" />
        <h3 className="text-sm font-medium text-stone-800">项目文件</h3>
        <span className="text-[11px] font-mono text-stone-400">{visibleFiles.length} 个</span>
      </div>
      {visibleFiles.length === 0 ? (
        <div className="text-sm text-stone-400 border border-dashed border-stone-200 py-10 text-center">
          权限范围内暂无文件。文件在各任务详情里上传后会汇总到这里。
        </div>
      ) : (
        <div className="border border-stone-200 divide-y divide-stone-100 bg-white">
          {visibleFiles.map((f) => {
            const att = toAttachment(f);
            const meta = f.taskId ? taskMeta.get(f.taskId) : undefined;
            return (
              <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50/60">
                <FileText size={15} className="text-stone-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-stone-800 truncate">{f.name}</div>
                  <div className="text-[10px] font-mono text-stone-400">
                    {meta ? `${meta.phaseName} · ${meta.taskName}` : '项目级'} · {formatBytes(f.size)}
                    {f.createdAt ? ` · ${new Date(f.createdAt).toLocaleDateString('zh-CN')}` : ''}
                  </div>
                </div>
                {canPreview(att) && (
                  <button onClick={() => setPreview(att)} className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 px-2 py-1" title="预览">
                    <Eye size={13} />预览
                  </button>
                )}
                <a href={att.storageUrl} download={f.name} className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 px-2 py-1" title="下载">
                  <Download size={13} />下载
                </a>
              </div>
            );
          })}
        </div>
      )}
      <FilePreviewModal file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
