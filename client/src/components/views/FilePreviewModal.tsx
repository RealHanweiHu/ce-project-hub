// 文件在线预览：图片 / PDF / 文本 / 音视频 浏览器原生预览；
// Excel(SheetJS) / Word(docx-preview) 前端动态加载渲染（数据不出网，库不进主包）；
// 其余类型（PPT、旧 .doc 等）回退到下载。
// 文件经 /storage/{key} 代理流式返回，带正确 Content-Type 且未强制 attachment。
import { useEffect, useRef, useState } from 'react';
import type { FileAttachment } from '@/lib/data';
import { formatBytes } from '@/lib/data';
import { X, Download, FileQuestion, Loader2 } from 'lucide-react';

type PreviewKind = 'image' | 'pdf' | 'text' | 'video' | 'audio' | 'xlsx' | 'docx' | 'none';

export function previewKind(type: string, name = ''): PreviewKind {
  const ext = name.toLowerCase().split('.').pop() || '';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  // Office：优先按扩展名（mimeType 有时是 octet-stream）
  if (ext === 'xlsx' || ext === 'xls' || type.includes('spreadsheetml') || type === 'application/vnd.ms-excel') return 'xlsx';
  if (ext === 'docx' || type.includes('wordprocessingml')) return 'docx';
  if (type.startsWith('text/') || type === 'application/json' || ['txt', 'csv', 'json', 'md', 'log'].includes(ext)) return 'text';
  return 'none';
}

/** 是否可内联预览（用于决定文件行是否可点开） */
export function canPreview(file: { type: string; name?: string; storageUrl?: string; dataUrl?: string }): boolean {
  return previewKind(file.type, file.name).valueOf() !== 'none' && !!(file.storageUrl || file.dataUrl);
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
  const kind = previewKind(file.type, file.name);

  return (
    <div className="fixed inset-0 z-50 bg-foreground/80 flex flex-col" onClick={onClose}>
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-5 py-3 text-background" onClick={(e) => e.stopPropagation()}>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{file.name}</div>
          <div className="text-[10px] uppercase tracking-wider text-background/60">{file.type || '未知类型'} · {formatBytes(file.size)}</div>
        </div>
        <a href={url} download={file.name} onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs uppercase tracking-wider border border-background/30 text-background/80 hover:bg-background/10 transition-colors">
          <Download size={13} />下载
        </a>
        <button onClick={onClose} className="p-1.5 rounded-md text-background/70 hover:text-background hover:bg-background/10 transition-colors">
          <X size={20} />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 md:p-8" onClick={(e) => e.stopPropagation()}>
        {kind === 'image' && <img src={url} alt={file.name} className="max-w-full max-h-full object-contain bg-white shadow-2xl" />}
        {(kind === 'pdf' || kind === 'text') && <iframe src={url} title={file.name} className="w-full h-full bg-white shadow-2xl" />}
        {kind === 'video' && <video src={url} controls className="max-w-full max-h-full shadow-2xl" />}
        {kind === 'audio' && <audio src={url} controls className="w-full max-w-md" />}
        {(kind === 'xlsx' || kind === 'docx') && <OfficePreview url={url!} kind={kind} name={file.name} />}
        {kind === 'none' && <UnsupportedFallback url={url!} name={file.name} />}
      </div>
    </div>
  );
}

function UnsupportedFallback({ url, name }: { url: string; name: string }) {
  return (
    <div className="text-center text-background/70 space-y-3">
      <FileQuestion size={48} className="mx-auto text-background/40" />
      <div className="text-sm">该文件类型暂不支持在线预览</div>
      <a href={url} download={name}
        className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs uppercase tracking-wider bg-background text-foreground hover:opacity-90 transition-opacity">
        <Download size={13} />下载查看
      </a>
    </div>
  );
}

// ── Office 预览：xlsx(SheetJS) / docx(docx-preview)，全部前端解析、库动态加载 ──
function OfficePreview({ url, kind, name }: { url: string; kind: 'xlsx' | 'docx'; name: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sheets, setSheets] = useState<{ name: string; html: string }[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        if (kind === 'xlsx') {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(buf, { type: 'array' });
          const parsed = wb.SheetNames.map((n) => ({ name: n, html: XLSX.utils.sheet_to_html(wb.Sheets[n]) }));
          if (!cancelled) { setSheets(parsed); setActive(0); setStatus('ready'); }
        } else {
          const docx = await import('docx-preview');
          if (cancelled || !containerRef.current) return;
          containerRef.current.innerHTML = '';
          await docx.renderAsync(buf, containerRef.current, undefined, {
            className: 'docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false,
          });
          if (!cancelled) setStatus('ready');
        }
      } catch (e) {
        console.error('[OfficePreview] failed:', e);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [url, kind]);

  if (status === 'loading') {
    return <div className="flex items-center gap-2 text-background/80 text-sm"><Loader2 size={16} className="animate-spin" />正在解析 {kind === 'xlsx' ? 'Excel' : 'Word'} 文档…</div>;
  }
  if (status === 'error') {
    return <UnsupportedFallback url={url} name={name} />;
  }

  // docx：渲染到容器
  if (kind === 'docx') {
    return (
      <div className="w-full h-full overflow-auto bg-secondary shadow-2xl">
        <div ref={containerRef} className="docx-host" />
      </div>
    );
  }

  // xlsx：sheet 选项卡 + 表格
  return (
    <div className="w-full h-full flex flex-col bg-white shadow-2xl overflow-hidden">
      {sheets.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-background overflow-x-auto shrink-0">
          {sheets.map((s, i) => (
            <button key={s.name} onClick={() => setActive(i)}
              className={`rounded px-3 py-1 text-xs whitespace-nowrap transition-colors ${i === active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto p-2 xlsx-host" dangerouslySetInnerHTML={{ __html: sheets[active]?.html || '' }} />
    </div>
  );
}
