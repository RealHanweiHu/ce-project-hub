// Design: Industrial Precision - stone/amber color system
// BackupPanel: export/import project data as JSON backup

import { useRef, useState } from 'react';
import {
  Download, Upload, AlertTriangle, CheckCircle2, FileJson,
  HardDrive, RefreshCw, Trash2, Clock,
} from 'lucide-react';
import { Project } from '@/lib/data';

interface BackupMeta {
  version: string;
  exportedAt: string;
  projectCount: number;
  appName: string;
}

interface BackupFile {
  meta: BackupMeta;
  projects: Project[];
}

const BACKUP_VERSION = '1.0';
const APP_NAME = 'CE Project Hub';

interface BackupPanelProps {
  projects: Project[];
  onImport: (projects: Project[]) => void;
  onClearAll: () => void;
}

export function BackupPanel({ projects, onImport, onClearAll }: BackupPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<
    'idle' | 'parsing' | 'preview' | 'success' | 'error'
  >('idle');
  const [importPreview, setImportPreview] = useState<BackupFile | null>(null);
  const [importError, setImportError] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const backup: BackupFile = {
      meta: {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        projectCount: projects.length,
        appName: APP_NAME,
      },
      projects,
    };
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `ce-project-hub-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportState('parsing');
    setImportError('');

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = ev.target?.result as string;
        const parsed = JSON.parse(raw) as BackupFile;

        // Validate structure
        if (!parsed.meta || !Array.isArray(parsed.projects)) {
          throw new Error('文件格式不正确：缺少 meta 或 projects 字段');
        }
        if (parsed.meta.appName !== APP_NAME) {
          throw new Error(`文件来源不匹配：期望 "${APP_NAME}"，实际 "${parsed.meta.appName}"`);
        }
        if (!parsed.projects.every((p) => p.id && p.name && p.code)) {
          throw new Error('项目数据格式异常，请检查备份文件完整性');
        }

        setImportPreview(parsed);
        setImportState('preview');
      } catch (err) {
        setImportError(err instanceof Error ? err.message : '解析失败，请确认文件格式正确');
        setImportState('error');
      }
    };
    reader.onerror = () => {
      setImportError('文件读取失败');
      setImportState('error');
    };
    reader.readAsText(file);

    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleConfirmImport = () => {
    if (!importPreview) return;
    onImport(importPreview.projects);
    setImportState('success');
    setImportPreview(null);
    setTimeout(() => setImportState('idle'), 3000);
  };

  const handleCancelImport = () => {
    setImportState('idle');
    setImportPreview(null);
  };

  const handleClearAll = () => {
    onClearAll();
    setShowClearConfirm(false);
  };

  // ── Storage estimate ──────────────────────────────────────────────────────
  const dataSize = (() => {
    try {
      const raw = JSON.stringify(projects);
      const bytes = new TextEncoder().encode(raw).length;
      return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
    } catch {
      return '—';
    }
  })();

  const lastExportKey = 'ce_hub_last_export';
  const lastExport = localStorage.getItem(lastExportKey);

  const recordExport = () => {
    localStorage.setItem(lastExportKey, new Date().toISOString());
    handleExport();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-serif text-2xl text-stone-900">数据备份与恢复</h2>
        <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">DATA BACKUP & RESTORE</p>
      </div>

      {/* Storage Info */}
      <div className="bg-stone-50 border border-stone-200 p-4 flex items-center gap-4">
        <div className="w-10 h-10 bg-stone-200 flex items-center justify-center shrink-0">
          <HardDrive size={18} className="text-stone-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-stone-900">本地存储</div>
          <div className="text-[10px] font-mono text-stone-400 mt-0.5">BROWSER LOCAL STORAGE</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-mono font-bold text-stone-900">{dataSize}</div>
          <div className="text-[10px] font-mono text-stone-400">{projects.length} 个项目</div>
        </div>
      </div>

      {/* Export */}
      <div className="bg-white border border-stone-200 p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 bg-amber-500 flex items-center justify-center shrink-0 mt-0.5">
            <Download size={15} className="text-white" />
          </div>
          <div>
            <h3 className="font-medium text-stone-900">导出备份</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              将所有项目数据（含任务进度、问题清单、Gate 评审历史、甘特图日期）导出为 JSON 文件保存到本地。
            </p>
          </div>
        </div>

        {lastExport && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-stone-400 mb-3">
            <Clock size={10} />
            上次导出：{new Date(lastExport).toLocaleString('zh-CN')}
          </div>
        )}

        <button
          onClick={recordExport}
          disabled={projects.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-200 disabled:text-stone-400 text-white text-sm font-medium transition-colors"
        >
          <Download size={14} />
          导出 {projects.length} 个项目
        </button>
        {projects.length === 0 && (
          <p className="text-xs text-stone-400 mt-2">暂无项目数据可导出</p>
        )}
      </div>

      {/* Import */}
      <div className="bg-white border border-stone-200 p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 bg-stone-700 flex items-center justify-center shrink-0 mt-0.5">
            <Upload size={15} className="text-white" />
          </div>
          <div>
            <h3 className="font-medium text-stone-900">导入备份</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              从 JSON 备份文件恢复数据。导入前请确认，<span className="text-amber-700 font-medium">当前数据将被完全替换</span>。
            </p>
          </div>
        </div>

        {/* Import states */}
        {importState === 'idle' && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 border border-stone-300 hover:border-stone-500 text-stone-700 text-sm font-medium transition-colors"
          >
            <FileJson size={14} />
            选择备份文件
          </button>
        )}

        {importState === 'parsing' && (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <RefreshCw size={14} className="animate-spin" />
            正在解析文件...
          </div>
        )}

        {importState === 'error' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200">
              <AlertTriangle size={14} className="text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-rose-800">导入失败</div>
                <div className="text-xs text-rose-600 mt-0.5">{importError}</div>
              </div>
            </div>
            <button
              onClick={() => { setImportState('idle'); fileInputRef.current?.click(); }}
              className="flex items-center gap-2 px-4 py-2 border border-stone-300 hover:border-stone-500 text-stone-700 text-sm transition-colors"
            >
              <FileJson size={13} />
              重新选择文件
            </button>
          </div>
        )}

        {importState === 'preview' && importPreview && (
          <div className="space-y-3">
            <div className="p-4 bg-amber-50 border border-amber-200">
              <div className="text-[10px] font-mono uppercase tracking-widest text-amber-600 mb-2">备份文件预览</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                <div>
                  <span className="font-mono text-stone-400">导出时间：</span>
                  <span className="text-stone-700">{new Date(importPreview.meta.exportedAt).toLocaleString('zh-CN')}</span>
                </div>
                <div>
                  <span className="font-mono text-stone-400">项目数量：</span>
                  <span className="text-stone-700 font-semibold">{importPreview.meta.projectCount} 个</span>
                </div>
                <div>
                  <span className="font-mono text-stone-400">备份版本：</span>
                  <span className="text-stone-700 font-mono">v{importPreview.meta.version}</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-amber-200">
                <div className="text-[10px] font-mono text-amber-700 mb-1.5">包含项目：</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {importPreview.projects.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-xs text-stone-700">
                      <span className="font-mono text-stone-400 shrink-0">{p.code}</span>
                      <span className="truncate">{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200">
              <AlertTriangle size={13} className="text-rose-600 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-700">
                确认导入后，当前 <strong>{projects.length} 个项目</strong>的所有数据将被替换为备份文件中的 <strong>{importPreview.meta.projectCount} 个项目</strong>。此操作不可撤销。
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCancelImport}
                className="flex-1 px-3 py-2 text-sm text-stone-600 border border-stone-300 hover:bg-stone-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmImport}
                className="flex-1 px-3 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors flex items-center justify-center gap-1.5"
              >
                <Upload size={13} />
                确认替换导入
              </button>
            </div>
          </div>
        )}

        {importState === 'success' && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200">
            <CheckCircle2 size={14} className="text-emerald-600" />
            <span className="text-sm text-emerald-800 font-medium">导入成功！数据已恢复。</span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Danger Zone */}
      <div className="bg-white border border-rose-200 p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 bg-rose-100 flex items-center justify-center shrink-0 mt-0.5">
            <Trash2 size={15} className="text-rose-600" />
          </div>
          <div>
            <h3 className="font-medium text-rose-900">清除所有数据</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              删除本地存储中的全部项目数据。<span className="text-rose-700 font-medium">操作不可撤销，请先导出备份。</span>
            </p>
          </div>
        </div>

        {!showClearConfirm ? (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 border border-rose-300 text-rose-600 hover:bg-rose-50 text-sm transition-colors"
          >
            <Trash2 size={13} />
            清除所有数据
          </button>
        ) : (
          <div className="space-y-3">
            <div className="p-3 bg-rose-50 border border-rose-300 text-sm text-rose-800">
              确认要删除全部 <strong>{projects.length} 个项目</strong>的所有数据吗？
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 px-3 py-2 text-sm text-stone-600 border border-stone-300 hover:bg-stone-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleClearAll}
                className="flex-1 px-3 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors"
              >
                确认清除
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="bg-stone-50 border border-stone-200 p-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-2">备份建议</div>
        <ul className="space-y-1.5 text-xs text-stone-600">
          <li className="flex items-start gap-2">
            <span className="font-mono text-amber-600 shrink-0">01</span>
            定期导出备份，建议每周一次或每次完成重要 Gate 评审后
          </li>
          <li className="flex items-start gap-2">
            <span className="font-mono text-amber-600 shrink-0">02</span>
            清除浏览器缓存前务必先导出备份，否则数据将永久丢失
          </li>
          <li className="flex items-start gap-2">
            <span className="font-mono text-amber-600 shrink-0">03</span>
            可将备份文件发送给团队成员，在其他设备上导入以同步数据
          </li>
          <li className="flex items-start gap-2">
            <span className="font-mono text-amber-600 shrink-0">04</span>
            备份文件包含所有项目的完整数据，包括问题清单和 Gate 评审历史
          </li>
        </ul>
      </div>
    </div>
  );
}
