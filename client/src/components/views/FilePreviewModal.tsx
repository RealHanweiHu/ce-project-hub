// 文件在线预览：图片 / PDF / 文本 / 音视频 内联预览，其余类型回退到下载。
// 文件经 /storage/{key} 代理流式返回，带正确 Content-Type 且未强制 attachment，故可直接 inline。
import { useEffect } from 'react';
import type { FileAttachment } from '@/lib/data';
import { formatBytes } from '@/lib/data';
import { X, Download, FileQuestion } from 'lucide-react';

type PreviewKind = 'image' | 'pdf' | 'text' | 'video' | 'audio' | 'none';

export function previewKind(type: string): PreviewKind {
  if (!type) return 'none';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('text/') || type === 'application/json') return 'text';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'none';
}

/** 是否可内联预览（用于决定文件行是否可点开） */
export function canPreview(file: { type: string; storageUrl?: string; dataUrl?: string }): boolean {
  return previewKind(file.type) !== 'none' && !!(file.storageUrl || file.dataUrl);
}

export function FilePreviewModal({ file, onClose }: { file: FileAttachment | null; onClose: () => void }) {
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, onClose]);

  if (!file) return null;
  const url = file.storageUrl || file.dataUrl;
  const kind = previewKind(file.type);

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-900/80 flex flex-col"
      onClick={onClose}
    >
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-5 py-3 text-stone-100" onClick={(e) => e.stopPropagation()}>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{file.name}</div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{file.type || '未知类型'} · {formatBytes(file.size)}</div>
        </div>
        <a href={url} download={file.name} onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-stone-600 text-stone-200 hover:bg-stone-700 transition-colors">
          <Download size={13} />下载
        </a>
        <button onClick={onClose} className="p-1.5 text-stone-300 hover:text-white hover:bg-stone-700 transition-colors">
          <X size={20} />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 md:p-8" onClick={(e) => e.stopPropagation()}>
        {kind === 'image' && (
          <img src={url} alt={file.name} className="max-w-full max-h-full object-contain bg-white shadow-2xl" />
        )}
        {kind === 'pdf' && (
          <iframe src={url} title={file.name} className="w-full h-full bg-white shadow-2xl" />
        )}
        {kind === 'text' && (
          <iframe src={url} title={file.name} className="w-full h-full bg-white shadow-2xl" />
        )}
        {kind === 'video' && (
          <video src={url} controls className="max-w-full max-h-full shadow-2xl" />
        )}
        {kind === 'audio' && (
          <audio src={url} controls className="w-full max-w-md" />
        )}
        {kind === 'none' && (
          <div className="text-center text-stone-300 space-y-3">
            <FileQuestion size={48} className="mx-auto text-stone-500" />
            <div className="text-sm">该文件类型暂不支持在线预览</div>
            <a href={url} download={file.name}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-mono uppercase tracking-wider bg-stone-100 text-stone-800 hover:bg-white transition-colors">
              <Download size={13} />下载查看
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
