// Design: Industrial Precision - stone/amber color system
// ProjectDetailView: phase navigation, Gantt chart tab, task checklist, task details, file upload

import { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft, CheckCircle2, Circle, ChevronRight,
  Upload, Download, Trash2, Paperclip, FileText, Image as ImageIcon,
  Edit3, Calendar, AlertTriangle, Target, Zap, BarChart2, ListChecks, Activity,
  Lock, ShieldAlert, Flag, Bug, GitBranch, Filter, Rocket, LayoutDashboard,
  Inbox, LayoutGrid, FolderOpen, Eye, X,
} from 'lucide-react';
import {
  Project, SOP_PHASES, PHASE_MAP, HEALTH_CONFIG,
  computePhaseProgress, computeOverallProgress, getPhaseStatus,
  isPhaseUnlocked, getBlockingGate, getProjectPhases,
  TaskDetails, FileAttachment, formatBytes, SOPTask, SOPPhase,
} from '@/lib/data';
import { CATEGORY_MAP } from '@/lib/sop-templates';
import { ProgressBar } from '@/components/shared/ProgressBar';
import { GateStandardPanel } from '@/components/shared/GateStandardPanel';
import { GanttView } from './GanttView';
import { TaskGanttView } from './TaskGanttView';
import { IssueList } from './IssueList';
import { ChangeLog } from './ChangeLog';
import { Issue, GateReview, ChangeRecord } from '@/lib/data';
import { GateReviewModal, GateReviewBadge } from './GateReviewModal';
import { ReleaseDialog } from './ReleaseDialog';
import { BomPanel } from './BomPanel';
import { OverviewPanel } from './OverviewPanel';
import { RequirementPoolPanel } from './RequirementPoolPanel';
import { KanbanBoard } from './KanbanBoard';
import { FilesPanel } from './FilesPanel';
import { FilePreviewModal, canPreview } from './FilePreviewModal';
import { MetricsView } from './MetricsView';
import { RescheduleConfirmDialog } from './RescheduleConfirmDialog';
import { CommentThread } from '@/components/CommentThread';
import { useProjectPermission } from '@/hooks/useProjectPermission';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { getTaskDeliverables } from '@shared/task-deliverables';
import { Users } from 'lucide-react';

const MAX_FILE_SIZE = 16 * 1024 * 1024;

interface ProjectDetailViewProps {
  project: Project;
  onUpdate: (project: Project) => void;
  onBack: () => void;
  /** Deep-link: open at this phase (defaults to currentPhase). */
  initialPhaseId?: string;
  /** Deep-link: auto-open this task's detail on mount. */
  initialTaskId?: string;
}

type ProjectMainTab = 'overview' | 'metrics' | 'tasks' | 'kanban' | 'requirements' | 'gantt' | 'issues' | 'changelog' | 'bom' | 'files';

const EXECUTION_ROLES = new Set(['rd_hw', 'rd_sw', 'rd_mech', 'qa', 'scm', 'pe', 'mfg', 'sales', 'cert', 'battery_safety']);

function defaultTabForRole(role?: string | null): ProjectMainTab {
  if (role === 'qa') return 'issues';
  if (role === 'scm') return 'bom';
  if (role === 'sales') return 'requirements';
  if (role === 'cert' || role === 'battery_safety') return 'files';
  if (role === 'rd_hw' || role === 'rd_sw' || role === 'rd_mech' || role === 'pe' || role === 'mfg') return 'tasks';
  return 'overview';
}

function isExecutionRole(role?: string | null) {
  return !!role && EXECUTION_ROLES.has(role);
}

function issueStatusLabel(status: string) {
  if (status === 'resolved') return '待复测';
  if (status === 'closed') return '复测通过';
  if (status === 'open') return '待处理';
  if (status === 'in_progress') return '处理中';
  if (status === 'wont_fix') return '不修复';
  return status;
}

function categoryForRole(role?: string | null): Issue['category'] {
  if (role === 'rd_sw') return 'software';
  if (role === 'rd_hw') return 'hardware';
  if (role === 'rd_mech') return 'mechanical';
  if (role === 'qa') return 'reliability';
  if (role === 'cert' || role === 'battery_safety') return 'safety';
  return 'other';
}

function EditableText({
  value, onChange, className = '', placeholder = '点击编辑', inputClassName = '',
}: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
        className={`bg-amber-50 border-b-2 border-amber-500 outline-none px-1 ${inputClassName || className}`}
        placeholder={placeholder}
      />
    );
  }
  return (
    <span
      onClick={() => { setDraft(value || ''); setEditing(true); }}
      className={`${className} cursor-text hover:bg-amber-50/40 rounded px-1 -mx-1 group inline-flex items-center gap-1`}
    >
      {value || <span className="text-stone-400 italic">{placeholder}</span>}
      <Edit3 size={11} className="inline-block ml-1.5 text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity" />
    </span>
  );
}

function EditableSelect({
  value, options, onChange, className = '',
}: {
  value: string; options: string[]; onChange: (v: string) => void; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        value={value}
        onChange={(e) => { onChange(e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
        autoFocus
        className={`bg-amber-50 border-b-2 border-amber-500 outline-none px-1 ${className}`}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`${className} cursor-pointer hover:bg-amber-50/40 rounded px-1 -mx-1`}
    >
      {value}
    </span>
  );
}

function FileUploadArea({
  files, onAdd, onRemove, projectId, phaseId, taskId, readOnly = false,
}: {
  files: FileAttachment[];
  onAdd: (files: FileAttachment[]) => void;
  onRemove: (id: string) => void;
  projectId: string;
  phaseId?: string;
  taskId?: string;
  readOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileAttachment | null>(null);

  const handleFiles = async (fileList: FileList) => {
    if (readOnly) return;
    setError('');
    const newFiles: FileAttachment[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`文件 "${file.name}" 超出 ${formatBytes(MAX_FILE_SIZE)} 限制`);
        continue;
      }
      try {
        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', projectId);
        if (phaseId) formData.append('phaseId', phaseId);
        if (taskId) formData.append('taskId', taskId);
        const resp = await fetch('/api/files/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: resp.statusText }));
          setError(`上传 "${file.name}" 失败: ${(err as any).error || resp.statusText}`);
          continue;
        }
        const result = await resp.json() as {
          id: number; name: string; mimeType: string; size: number;
          storageKey: string; storageUrl: string;
        };
        newFiles.push({
          id: String(result.id),
          name: result.name,
          size: result.size,
          type: result.mimeType,
          uploadDate: new Date().toISOString().slice(0, 10),
          dataUrl: '',
          storageUrl: result.storageUrl,
          storageKey: result.storageKey,
        });
      } catch (e: any) {
        setError(`上传 "${file.name}" 失败: ${e.message || '网络错误'}`);
      } finally {
        setUploading(false);
      }
    }
    if (newFiles.length > 0) onAdd(newFiles);
  };

  const downloadFile = (file: FileAttachment) => {
    const url = file.storageUrl || file.dataUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = file.name; a.click();
  };
  const getIcon = (type: string) => type?.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />;

  return (
    <div>
      <div
        onClick={() => !readOnly && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!readOnly) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`border-2 border-dashed p-4 text-center transition-colors ${
          readOnly ? 'cursor-not-allowed border-stone-200 bg-stone-50 opacity-70' :
          dragOver ? 'cursor-pointer border-amber-500 bg-amber-50' : 'cursor-pointer border-stone-300 hover:border-stone-400'
        }`}
      >
        <input ref={inputRef} type="file" multiple onChange={(e) => handleFiles(e.target.files!)} className="hidden" disabled={uploading || readOnly} />
        <Upload size={18} className={`mx-auto mb-2 ${uploading ? 'text-amber-400 animate-pulse' : 'text-stone-400'}`} />
        <div className="text-sm text-stone-700">
          {readOnly ? '仅可查看附件' : uploading ? '上传中...' : <><span className="font-medium">点击上传</span>或拖拽文件</>}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mt-1">
          单个文件最大 {formatBytes(MAX_FILE_SIZE)} · 支持 PDF / 图片 / Office 文档
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5">{error}</div>}
      {files && files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {files.map((file) => {
            const previewable = canPreview(file);
            return (
            <div key={file.id} className="flex items-center gap-3 p-2.5 bg-white border border-stone-200 group">
              <span className="text-stone-500 shrink-0">{getIcon(file.type)}</span>
              <div
                className={`flex-1 min-w-0 ${previewable ? 'cursor-pointer' : ''}`}
                onClick={(e) => { if (previewable) { e.stopPropagation(); setPreviewFile(file); } }}
              >
                <div className={`text-sm text-stone-900 truncate ${previewable ? 'group-hover:text-amber-700' : ''}`}>{file.name}</div>
                <div className="text-[10px] font-mono text-stone-500">{formatBytes(file.size)}</div>
              </div>
              {previewable && (
                <button onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }} title="预览" className="p-1.5 text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors">
                  <Eye size={13} />
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); downloadFile(file); }} title="下载" className="p-1.5 text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors">
                <Download size={13} />
              </button>
              {!readOnly && (
                <button onClick={(e) => { e.stopPropagation(); if (confirm('删除文件？')) onRemove(file.id); }} className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            );
          })}
        </div>
      )}
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

// Role labels for visibleRoles selector
const ROLE_OPTIONS = [
  { value: 'rd_hw',  label: '硬件研发' },
  { value: 'rd_sw',  label: '软件研发' },
  { value: 'rd_mech', label: '结构/ID' },
  { value: 'qa',     label: '测试/品质' },
  { value: 'scm',    label: '供应链' },
  { value: 'pe',     label: 'PE 工艺' },
  { value: 'mfg',    label: 'MFG 生产' },
  { value: 'sales',  label: '销售/渠道' },
  { value: 'cert',   label: '认证' },
  { value: 'battery_safety', label: '电池安全' },
  { value: 'pm',     label: '产品经理' },
  { value: 'manager', label: '管理层' },
  { value: 'owner',  label: '项目创建者' },
] as const;

function isProductDefinitionTask(taskId: string) {
  return taskId.startsWith('pd_');
}

function handoffTaskTitle(taskId: string, details?: TaskDetails) {
  const firstLine = (details?.instructions || '').split('\n').map((line) => line.trim()).find(Boolean);
  if (firstLine?.startsWith('#')) return firstLine.replace(/^#+\s*/, '');
  const role = taskId.replace(/^pd_/, '');
  const label = ROLE_OPTIONS.find((option) => option.value === role)?.label || role;
  return `产品定义交接 - ${label}`;
}

function handoffTaskOwner(taskId: string, roles: string[]) {
  const role = roles.find((item) => !['pm', 'manager', 'owner'].includes(item)) ?? taskId.replace(/^pd_/, '');
  return ROLE_OPTIONS.find((option) => option.value === role)?.label || role;
}

function getPhaseWithHandoffTasks(phase: SOPPhase | undefined, phaseData: { taskDetails?: Record<string, TaskDetails> } | undefined, project: Project): SOPPhase | undefined {
  if (!phase) return phase;
  const existing = new Set(phase.tasks.map((task) => task.id));
  const customTasks: SOPTask[] = Object.entries(phaseData?.taskDetails ?? {})
    .filter(([taskId]) => isProductDefinitionTask(taskId) && !existing.has(taskId))
    .map(([taskId, details]) => {
      const roles = project.taskVisibleRoles?.[taskId] ?? [];
      return {
        id: taskId,
        name: handoffTaskTitle(taskId, details),
        desc: '来自产品定义交接清单，请按已确认 PRD 快照承接本角色规格与变更输入。',
        owner: handoffTaskOwner(taskId, roles),
        guide: details.instructions || '',
        visibleRoles: roles,
      };
    });
  if (customTasks.length === 0) return phase;
  return { ...phase, tasks: [...phase.tasks, ...customTasks] };
}

/** Gate 就绪检查：任务/问题本地聚合，交付物只使用服务端审核通过集合。 */
interface GateReadiness {
  tasksDone: number; tasksTotal: number;
  delivDone: number; delivTotal: number;
  openP0P1: number; fileCount: number;
  signoffRoles: string[]; blockers: string[]; ready: boolean;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeGateReadiness(phase: any, phaseData: any, submittedDeliverables?: string[], satisfiedSet?: string[]): GateReadiness {
  const allTasks: Array<{ id: string }> = phase?.tasks ?? [];
  const tasks = allTasks.filter((t) => t.id !== phase?.gateTaskId);
  const tasksDone = tasks.filter((t) => phaseData?.tasks?.[t.id]).length;
  let delivDone = 0, delivTotal = 0;
  if (submittedDeliverables) {
    delivTotal = submittedDeliverables.length;
    const satisfiedNames = new Set(satisfiedSet ?? []);
    delivDone = submittedDeliverables.filter((name) => satisfiedNames.has(name)).length;
  } else {
    for (const t of tasks) {
      const names = getTaskDeliverables(t.id, phase?.deliverables ?? []);
      const status: Record<string, boolean> = phaseData?.taskDetails?.[t.id]?.deliverables ?? {};
      delivTotal += names.length;
      delivDone += names.filter((n) => status[n]).length;
    }
  }
  const issues = phaseData?.issues ?? [];
  const openP0P1 = issues.filter((i: { severity: string; status: string }) =>
    (i.severity === 'P0' || i.severity === 'P1') && (i.status === 'open' || i.status === 'in_progress')).length;
  let fileCount = 0;
  for (const t of tasks) fileCount += (phaseData?.taskDetails?.[t.id]?.files ?? []).length;
  const blockers: string[] = [];
  if (openP0P1 > 0) blockers.push(`${openP0P1} 个未关闭的 P0/P1 问题`);
  if (tasksDone < tasks.length) blockers.push(`${tasks.length - tasksDone} 项任务未完成`);
  if (delivTotal > 0 && delivDone < delivTotal) blockers.push(`交付物未齐(${delivDone}/${delivTotal})`);
  return { tasksDone, tasksTotal: tasks.length, delivDone, delivTotal, openP0P1, fileCount, signoffRoles: phase?.gateStandard?.responsibleRoles ?? [], blockers, ready: blockers.length === 0 };
}

type GateReadinessSummary = {
  ready: boolean;
  blockerCount: number;
  dimensions: Array<{ dimension: string; ok: boolean; summary: string; blockers: string[] }>;
} | null | undefined;

type ReleasePrecheckSummary = {
  canRelease: boolean;
  canForceRelease: boolean;
  blockers: string[];
  releaseGate: { decision: string | null; gateName?: string | null } | null;
} | null | undefined;

function ProjectFocusBand({
  phaseName,
  activeProgress,
  gateName,
  readiness,
  openIssueCount,
  pendingChangeCount,
  releasePrecheck,
  canReleaseAction,
  onTasks,
  onGate,
  onIssues,
  onChanges,
  onRelease,
}: {
  phaseName: string;
  activeProgress: number;
  gateName: string;
  readiness: GateReadinessSummary;
  openIssueCount: number;
  pendingChangeCount: number;
  releasePrecheck: ReleasePrecheckSummary;
  canReleaseAction: boolean;
  onTasks: () => void;
  onGate: () => void;
  onIssues: () => void;
  onChanges: () => void;
  onRelease: () => void;
}) {
  const gateBlocked = readiness ? !readiness.ready : false;
  const firstGateBlocker = readiness?.dimensions.find((dim) => !dim.ok)?.summary;
  const releaseBlocked = releasePrecheck ? !releasePrecheck.canRelease && !releasePrecheck.canForceRelease : false;
  const releaseLabel = !releasePrecheck
    ? '预检中'
    : releasePrecheck.canRelease
      ? '可发布'
      : releasePrecheck.canForceRelease
        ? '需强制发布'
        : `${releasePrecheck.blockers.length} 项阻断`;
  const releaseTone = !releasePrecheck
    ? 'text-stone-500'
    : releasePrecheck.canRelease
      ? 'text-emerald-700'
      : releasePrecheck.canForceRelease
        ? 'text-amber-700'
        : 'text-rose-700';
  const issueChangeLabel = openIssueCount > 0 || pendingChangeCount > 0
    ? `${openIssueCount} 问题 · ${pendingChangeCount} 变更`
    : '暂无开放项';

  return (
    <div className="ce-panel overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-stone-200">
        <FocusItem
          icon={<Target size={15} />}
          label="当前阶段"
          value={phaseName}
          detail={`${activeProgress}% 完成`}
          tone={activeProgress >= 100 ? 'text-emerald-700' : 'text-stone-800'}
          actionLabel="处理任务"
          onAction={onTasks}
        />
        <FocusItem
          icon={<Flag size={15} />}
          label="Gate"
          value={gateBlocked ? `${readiness?.blockerCount ?? 0} 项未就绪` : readiness?.ready ? '已就绪' : gateName}
          detail={gateBlocked ? firstGateBlocker ?? gateName : gateName}
          tone={gateBlocked ? 'text-amber-700' : readiness?.ready ? 'text-emerald-700' : 'text-stone-800'}
          actionLabel="查看 Gate"
          onAction={onGate}
        />
        <FocusItem
          icon={<Bug size={15} />}
          label="问题与变更"
          value={issueChangeLabel}
          detail={openIssueCount > 0 ? '开放问题需要先收口' : pendingChangeCount > 0 ? '有待决变更' : '无开放问题或待决变更'}
          tone={openIssueCount > 0 ? 'text-rose-700' : pendingChangeCount > 0 ? 'text-amber-700' : 'text-emerald-700'}
          actionLabel={openIssueCount > 0 ? '处理问题' : pendingChangeCount > 0 ? '看变更' : '查看问题'}
          onAction={openIssueCount > 0 ? onIssues : pendingChangeCount > 0 ? onChanges : onIssues}
        />
        <FocusItem
          icon={<Rocket size={15} />}
          label="量产发布"
          value={releaseLabel}
          detail={releaseBlocked ? releasePrecheck?.blockers[0] ?? '发布条件未满足' : releasePrecheck?.releaseGate?.decision === 'conditional' ? '有条件通过需留痕' : '发布前置条件'}
          tone={releaseTone}
          actionLabel={canReleaseAction ? '打开预检' : '仅可查看'}
          onAction={onRelease}
          disabled={!canReleaseAction}
        />
      </div>
    </div>
  );
}

function FocusItem({
  icon,
  label,
  value,
  detail,
  tone,
  actionLabel,
  onAction,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  tone: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="min-h-[116px] p-4 flex flex-col justify-between gap-3 bg-white">
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-stone-400">
          <span className="text-stone-400">{icon}</span>
          {label}
        </div>
        <div className={`mt-2 text-lg font-semibold leading-tight ${tone}`}>{value}</div>
        <div className="mt-1 max-h-8 overflow-hidden text-xs text-stone-500 leading-snug">{detail}</div>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className="self-start text-[11px] font-mono uppercase tracking-wider text-stone-600 border border-stone-200 px-2 py-1 hover:border-stone-400 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function ReadinessRow({ label, ok, detail, soft }: { label: string; ok: boolean; detail: React.ReactNode; soft?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="flex items-center gap-1.5">
        {ok ? <CheckCircle2 size={14} className="text-emerald-600" /> : <AlertTriangle size={14} className={soft ? 'text-amber-500' : 'text-rose-500'} />}
        <span className="text-stone-700">{label}</span>
      </span>
      <span className={`text-xs font-mono ${ok ? 'text-stone-500' : soft ? 'text-amber-600' : 'text-rose-600'}`}>{detail}</span>
    </div>
  );
}

/**
 * Gate 交付物资源库手工增删面板（仅 PM/admin 可见）
 * - 从资源库选择并添加交付物
 * - 对手工添加项提供"移除"，对模板/归集项提供"排除"
 */
// ── DeliverableReviewControls ─────────────────────────────────────────────────
/** 每条 gate 交付物的审核态徽标 + 提交/通过/驳回操作 */
function pickDeliverableReviewer(
  deliverableName: string,
  members: Array<{ userId: number; role: string; isOwner?: boolean | null }>,
) {
  const lower = deliverableName.toLowerCase();
  const rolePreference =
    /电池|battery|bms|cell|pack/.test(lower)
      ? ['battery_safety', 'cert', 'qa']
      : /认证|安规|合规|cert|compliance|emc|fcc|ce\b|ul\b|rohs|safety/.test(lower)
        ? ['cert', 'battery_safety', 'qa']
        : /测试|验证|可靠|报告|检验|品质|test|qa|reliability|evt|dvt|pvt/.test(lower)
          ? ['qa']
          : /bom|物料|供应|采购|成本|替代料|supplier|supply|cost|material/.test(lower)
            ? ['scm']
            : [];
  return rolePreference
    .map((role) => members.find((member) => member.role === role))
    .find(Boolean);
}

function DeliverableReviewControls({
  projectId, phaseId, deliverableNames, canEditTasks, currentUserId, isAdmin,
  gateTaskId, pmUserId,
}: {
  projectId: string;
  phaseId: string;
  deliverableNames: string[];
  canEditTasks: boolean;
  currentUserId: number | undefined;
  isAdmin: boolean;
  gateTaskId?: string;
  pmUserId: number | null;
}) {
  const utils = trpc.useUtils();
  const { data: reviewList = [] } = trpc.deliverableReviews.list.useQuery({ projectId });
  const { data: members = [] } = trpc.members.list.useQuery({ projectId });
  // files for this phase to detect "has file" — no taskId filter, so it matches
  // the server's getReviewSatisfiedSet which scopes by projectId+phaseId only.
  const { data: files = [] } = trpc.files.list.useQuery({ projectId, phaseId });

  const [reviewerSelections, setReviewerSelections] = useState<Record<string, number | ''>>({}); // deliverableName → selected reviewerUserId
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({}); // deliverableName → note draft
  const [rejectOpen, setRejectOpen] = useState<Record<string, boolean>>({}); // deliverableName → note input open

  const submitMut = trpc.deliverableReviews.submit.useMutation({
    onSuccess: () => {
      utils.deliverableReviews.list.invalidate({ projectId });
      utils.deliverableReviews.myPending.invalidate();
      if (gateTaskId) utils.gateReviews.readiness.invalidate({ projectId, phaseId });
    },
    onError: (err) => toast.error(err.message),
  });

  const reviewMut = trpc.deliverableReviews.review.useMutation({
    onSuccess: () => {
      utils.deliverableReviews.list.invalidate({ projectId });
      utils.deliverableReviews.myPending.invalidate();
      if (gateTaskId) utils.gateReviews.readiness.invalidate({ projectId, phaseId });
    },
    onError: (err) => toast.error(err.message),
  });

  if (deliverableNames.length === 0) return null;

  // build a lookup: deliverableName → review record
  const reviewByName = new Map(
    reviewList.filter((r) => r.phaseId === phaseId).map((r) => [r.deliverableName, r])
  );

  // file set for this phase
  const uploadedNames = new Set(files.map((f) => (f as { deliverableName?: string | null }).deliverableName).filter((n): n is string => !!n));

  // Type-aware reviewer default, then PM/Owner fallback.
  const pmMember = members.find((m) => m.userId === pmUserId) ?? members.find((m) => m.role === 'pm' || m.isOwner);

  return (
    <div className="mt-3 pt-3 border-t border-stone-100 space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">审核状态</div>
      {deliverableNames.map((name) => {
        const record = reviewByName.get(name);
        const hasFile = uploadedNames.has(name);

        // reviewer name helper
        const reviewerMember = record ? members.find((m) => m.userId === record.reviewerUserId) : undefined;
        const reviewerName = reviewerMember ? (reviewerMember.userName ?? reviewerMember.userEmail ?? `用户${record!.reviewerUserId}`) : (record ? `用户${record.reviewerUserId}` : '');

        // can the current user act as reviewer?
        const isReviewer = !!record && (isAdmin || record.reviewerUserId === currentUserId);

        // reviewer select state for submit
        const defaultReviewer = pickDeliverableReviewer(name, members) ?? pmMember;
        const selReviewer = reviewerSelections[name] !== undefined ? reviewerSelections[name] : (defaultReviewer?.userId ?? '');

        return (
          <div key={name} className="space-y-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs text-stone-600 min-w-0 truncate">{name}</span>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                {/* Status badge */}
                {!record && hasFile && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 border border-stone-200">
                    已上传
                  </span>
                )}
                {record?.status === 'pending' && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                    待审 · {reviewerName}
                  </span>
                )}
                {record?.status === 'approved' && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                    通过 · {reviewerName}
                  </span>
                )}
                {record?.status === 'rejected' && (
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 cursor-help"
                    title={record.reviewNote ? `驳回意见：${record.reviewNote}` : '驳回'}
                  >
                    驳回{record.reviewNote ? ' ⓘ' : ''}
                  </span>
                )}

                {/* Submit action: canEditTasks && (no record || rejected) */}
                {canEditTasks && (!record || record.status === 'rejected') && (
                  <div className="flex items-center gap-1">
                    <select
                      value={selReviewer}
                      onChange={(e) => setReviewerSelections((prev) => ({ ...prev, [name]: e.target.value === '' ? '' : Number(e.target.value) }))}
                      className="text-[10px] border border-stone-200 bg-white text-stone-600 px-1 py-0.5 focus:outline-none focus:border-amber-400"
                    >
                      <option value="">— 选审核人 —</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.userName ?? m.userEmail ?? `用户${m.userId}`} · {ROLE_OPTIONS.find((role) => role.value === m.role)?.label ?? m.role}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={submitMut.isPending}
                      onClick={() => {
                        const rv = selReviewer === '' ? undefined : Number(selReviewer);
                        submitMut.mutate({ projectId, phaseId, deliverableName: name, reviewerUserId: rv });
                      }}
                      className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                    >
                      提交审核
                    </button>
                  </div>
                )}

                {/* Approve/Reject actions: reviewer & status=pending */}
                {isReviewer && record?.status === 'pending' && (
                  <div className="flex items-center gap-1">
                    <button
                      disabled={reviewMut.isPending}
                      onClick={() => reviewMut.mutate({ projectId, phaseId, deliverableName: name, decision: 'approved' })}
                      className="text-[10px] font-mono px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                    >
                      通过
                    </button>
                    <button
                      disabled={reviewMut.isPending}
                      onClick={() => setRejectOpen((prev) => ({ ...prev, [name]: !prev[name] }))}
                      className="text-[10px] font-mono px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100 disabled:opacity-50 transition-colors"
                    >
                      驳回
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Reject note input */}
            {rejectOpen[name] && isReviewer && record?.status === 'pending' && (
              <div className="flex items-center gap-1.5 pl-2">
                <input
                  type="text"
                  value={rejectNote[name] ?? ''}
                  onChange={(e) => setRejectNote((prev) => ({ ...prev, [name]: e.target.value }))}
                  placeholder="填写驳回意见（可选）"
                  className="flex-1 text-xs border border-rose-200 bg-rose-50 px-2 py-0.5 focus:outline-none focus:border-rose-400"
                />
                <button
                  disabled={reviewMut.isPending}
                  onClick={() => {
                    reviewMut.mutate({
                      projectId, phaseId, deliverableName: name,
                      decision: 'rejected', note: rejectNote[name] || null,
                    });
                    setRejectOpen((prev) => ({ ...prev, [name]: false }));
                  }}
                  className="text-[10px] font-mono px-1.5 py-0.5 bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 transition-colors"
                >
                  确认驳回
                </button>
                <button
                  onClick={() => setRejectOpen((prev) => ({ ...prev, [name]: false }))}
                  className="text-[10px] font-mono text-stone-400 hover:text-stone-700"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GateDeliverableOverridePanel({
  projectId, phaseId, effectiveDeliverables, canEdit,
}: {
  projectId: string;
  phaseId: string;
  /** 当前 gate 的有效交付物列表 */
  effectiveDeliverables: string[];
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [selectValue, setSelectValue] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const { data: library = [] } = trpc.tailoring.deliverableLibrary.useQuery({ projectId });
  const { data: overrides = [] } = trpc.tailoring.deliverableOverrides.useQuery({ projectId });

  const overrideMut = trpc.tailoring.setDeliverableOverride.useMutation({
    onSettled: () => {
      utils.tailoring.effectiveProcess.invalidate({ projectId });
      utils.tailoring.deliverableOverrides.invalidate({ projectId });
      setPending(null);
    },
  });

  if (!canEdit) return null;

  // 当前 gate 阶段的 override 集合（action → Set<deliverableName>）
  const addedNames = new Set(
    overrides
      .filter((o) => o.nodePhaseId === phaseId && o.action === 'add')
      .map((o) => o.deliverableName)
  );
  const removedNames = new Set(
    overrides
      .filter((o) => o.nodePhaseId === phaseId && o.action === 'remove')
      .map((o) => o.deliverableName)
  );

  const effectiveSet = new Set(effectiveDeliverables);

  // 资源库中未在有效集合中的条目（可添加）
  const addableItems = library.filter((name) => !effectiveSet.has(name));

  const handleAdd = (name: string) => {
    if (!name) return;
    setPending(name);
    setSelectValue('');
    overrideMut.mutate({ projectId, nodePhaseId: phaseId, deliverableName: name, action: 'add' });
  };

  const handleRemoveOverride = (name: string, action: 'clear' | 'remove') => {
    setPending(name);
    overrideMut.mutate({ projectId, nodePhaseId: phaseId, deliverableName: name, action });
  };

  // 只要有可添加条目、有手动项或有已排除项，就渲染面板
  const hasContent =
    addableItems.length > 0 ||
    effectiveDeliverables.some((name) => addedNames.has(name)) ||
    removedNames.size > 0;

  if (!hasContent) return null;

  return (
    <div className="mt-3 pt-3 border-t border-stone-100 space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400">资源库管理</div>

      {/* 从资源库添加 */}
      {addableItems.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select
            value={selectValue}
            onChange={(e) => { setSelectValue(e.target.value); handleAdd(e.target.value); }}
            disabled={overrideMut.isPending}
            className="flex-1 text-xs border border-stone-200 bg-white text-stone-700 px-1.5 py-1 focus:outline-none focus:border-amber-400 min-w-0"
          >
            <option value="">＋ 从资源库添加…</option>
            {addableItems.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}

      {/* 手工添加的项（action=add）→ 可移除（clear） */}
      {effectiveDeliverables.filter((name) => addedNames.has(name)).map((name) => (
        <div key={name} className="flex items-center justify-between gap-2 text-xs text-stone-600">
          <span className="flex items-center gap-1 min-w-0">
            <span className="text-[9px] font-mono text-emerald-600 bg-emerald-50 border border-emerald-200 px-1 py-0.5 shrink-0">手动添加</span>
            <span className="truncate">{name}</span>
          </span>
          <button
            disabled={pending === name || overrideMut.isPending}
            onClick={() => handleRemoveOverride(name, 'clear')}
            className="shrink-0 text-[10px] font-mono text-stone-400 hover:text-rose-500 disabled:opacity-40 transition-colors"
            title="撤销添加"
          >
            × 移除
          </button>
        </div>
      ))}

      {/* 模板/归集项（非手动添加）→ 可排除（remove） */}
      {effectiveDeliverables.filter((name) => !addedNames.has(name)).map((name) => (
        <div key={name} className="flex items-center justify-between gap-2 text-xs text-stone-500">
          <span className="truncate min-w-0">{name}</span>
          <button
            disabled={pending === name || overrideMut.isPending}
            onClick={() => handleRemoveOverride(name, 'remove')}
            className="shrink-0 text-[10px] font-mono text-stone-400 hover:text-rose-500 disabled:opacity-40 transition-colors"
            title="从本阶段排除此交付物"
          >
            × 排除
          </button>
        </div>
      ))}

      {/* 已被排除的项（action=remove）→ 显示并提供恢复 */}
      {Array.from(removedNames).map((name) => (
        <div key={name} className="flex items-center justify-between gap-2 text-xs text-stone-400">
          <span className="flex items-center gap-1 min-w-0">
            <span className="text-[9px] font-mono text-stone-400 bg-stone-50 border border-stone-200 px-1 py-0.5 shrink-0">已排除</span>
            <span className="truncate line-through">{name}</span>
          </span>
          <button
            disabled={pending === name || overrideMut.isPending}
            onClick={() => handleRemoveOverride(name, 'clear')}
            className="shrink-0 text-[10px] font-mono text-stone-400 hover:text-amber-600 disabled:opacity-40 transition-colors"
            title="恢复此交付物"
          >
            ↩ 恢复
          </button>
        </div>
      ))}
    </div>
  );
}

/** 任务交付物清单：模板预置交付物 + 完成勾选（持久化到 project_tasks.deliverables） */
function DeliverablesChecklist({
  projectId, phaseId, taskId, items, status, canEdit, carried,
}: {
  projectId: string;
  phaseId: string;
  taskId: string;
  items: string[];
  status: Record<string, boolean>;
  canEdit: boolean;
  /** 归集项映射：deliverableName → 来源阶段名 */
  carried?: Record<string, string>;
}) {
  const utils = trpc.useUtils();
  const [pending, setPending] = useState<string | null>(null);
  const mutation = trpc.tasks.setDeliverable.useMutation({
    onSettled: () => { utils.tasks.list.invalidate({ projectId }); setPending(null); },
  });
  const doneCount = items.filter((d) => status[d]).length;

  if (items.length === 0) return <div className="text-sm text-stone-400">无预置交付物</div>;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-stone-400">{doneCount}/{items.length} 完成</span>
        {doneCount === items.length && <span className="text-[10px] font-mono text-emerald-600">✓ 全部交付</span>}
      </div>
      {items.map((d) => {
        const done = !!status[d];
        const fromPhase = carried?.[d];
        return (
          <button
            key={d}
            disabled={!canEdit || pending === d}
            onClick={() => { setPending(d); mutation.mutate({ projectId, phaseId, taskId, name: d, done: !done }); }}
            className={`w-full flex items-start gap-2 text-left text-sm py-0.5 ${canEdit ? 'hover:bg-stone-50 cursor-pointer' : 'cursor-default'} ${pending === d ? 'opacity-50' : ''}`}
          >
            {done
              ? <CheckCircle2 size={15} className="shrink-0 mt-0.5 text-emerald-600" />
              : <Circle size={15} className="shrink-0 mt-0.5 text-stone-300" />}
            <span className="flex items-center gap-1.5 min-w-0">
              <span className={done ? 'text-stone-400 line-through' : 'text-stone-700'}>{d}</span>
              {fromPhase && (
                <span className="shrink-0 text-[9px] font-mono text-amber-600 bg-amber-50 border border-amber-200 px-1 py-0.5 leading-none">
                  来自 {fromPhase}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TaskDetail({
  taskId, taskDetails, onUpdate, visibleRoles, onVisibleRolesChange, canEditRoles,
  projectId, phaseId, canEdit = true, compact = false,
}: {
  taskId: string;
  taskDetails: TaskDetails;
  onUpdate: (details: TaskDetails) => void;
  visibleRoles?: string[];
  onVisibleRolesChange?: (roles: string[]) => void;
  canEditRoles?: boolean;
  projectId: string;
  phaseId?: string;
  canEdit?: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(taskDetails?.instructions || '');
  const [dirty, setDirty] = useState(false);
  const [pendingReschedule, setPendingReschedule] = useState<{ taskId: string; startDate: string; newDue: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utils = trpc.useUtils();
  const deleteFileMutation = trpc.files.delete.useMutation({
    onSuccess: () => {
      // Invalidate files.list so useProjectData re-fetches the updated list
      utils.files.list.invalidate({ projectId });
    },
  });

  const handleChange = (val: string) => {
    if (!canEdit) return;
    setDraft(val); setDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onUpdate({ ...taskDetails, instructions: val }); setDirty(false);
    }, 800);
  };

  const handleBlur = () => {
    if (!canEdit) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (draft !== taskDetails?.instructions) { onUpdate({ ...taskDetails, instructions: draft }); setDirty(false); }
  };

  const handleRemoveFile = async (id: string) => {
    if (!canEdit) return;
    if (!confirm('确定删除此文件？该操作不可撤销。')) return;
    const numId = parseInt(id, 10);
    if (!isNaN(numId)) {
      // DB-backed file: delete via tRPC (removes DB row + invalidates S3 object)
      await deleteFileMutation.mutateAsync({ id: numId, projectId });
    } else {
      // Legacy local-only file: just remove from local state
      onUpdate({ ...taskDetails, files: (taskDetails?.files || []).filter((f) => f.id !== id) });
    }
  };

  // Task meta: users for assignee dropdown
  const { data: metaUsers = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const TASK_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
    todo: { label: '待开始', className: 'bg-stone-50 text-stone-600 border-stone-200' },
    in_progress: { label: '进行中', className: 'bg-blue-50 text-blue-700 border-blue-200' },
    blocked: { label: '阻塞', className: 'bg-red-50 text-red-700 border-red-200' },
    done: { label: '已完成', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    skipped: { label: '跳过', className: 'bg-stone-50 text-stone-400 border-stone-200' },
  };
  const taskStatus = taskDetails?.taskStatus ?? 'todo';
  const taskStatusCfg = TASK_STATUS_CONFIG[taskStatus] ?? TASK_STATUS_CONFIG.todo;
  const TASK_PRIORITY_OPTIONS = [
    { value: 'critical', label: 'P0 紧急' },
    { value: 'high', label: 'P1 高' },
    { value: 'medium', label: 'P2 中' },
    { value: 'low', label: 'P3 低' },
  ];

  return (
    <div className="mt-3 border-t border-stone-100 pt-3 space-y-3">
      {/* Task Meta Row: assignee / due date / status / priority.
          Execution roles (compact) see these read-only rather than hidden — P0-2. */}
      {compact ? (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">负责人</div>
          <div className="flex h-[30px] items-center border border-stone-200 bg-stone-50 px-2 text-xs text-stone-700">
            {metaUsers.find((u) => u.id === taskDetails?.assigneeUserId)?.name
              ?? metaUsers.find((u) => u.id === taskDetails?.assigneeUserId)?.username
              ?? '— 未指定 —'}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">截止日期</div>
          <div className="flex h-[30px] items-center border border-stone-200 bg-stone-50 px-2 text-xs text-stone-700">
            {taskDetails?.dueDate ?? '— 未排期 —'}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">状态</div>
          <div className={`flex h-[30px] items-center justify-between border px-2 text-xs ${taskStatusCfg.className}`}>
            <span>{taskStatusCfg.label}</span>
            <span className="text-[10px] font-mono opacity-60">自动</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">优先级</div>
          <div className="flex h-[30px] items-center border border-stone-200 bg-stone-50 px-2 text-xs text-stone-700">
            {TASK_PRIORITY_OPTIONS.find((o) => o.value === (taskDetails?.taskPriority ?? 'medium'))?.label ?? '—'}
          </div>
        </div>
      </div>
      ) : (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">负责人</div>
          <select
            value={taskDetails?.assigneeUserId ?? ''}
            disabled={!canEdit}
            onChange={(e) => {
              const val = e.target.value;
              onUpdate({ ...taskDetails, assigneeUserId: val === '' ? null : Number(val) });
            }}
            className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 px-2 py-1 outline-none focus:border-amber-400 transition-colors"
          >
            <option value="">— 未指定 —</option>
            {metaUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.username}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">截止日期</div>
          <input
            type="date"
            value={taskDetails?.dueDate ?? ''}
            disabled={!canEdit}
            onChange={(e) => {
              const nextDue = e.target.value || null;
              if (!nextDue || nextDue === (taskDetails?.dueDate ?? null)) return;
              if (!taskDetails?.startDate) {
                onUpdate({ ...taskDetails, dueDate: nextDue }); // 未排期任务：无起点不可级联，仅记录
                return;
              }
              setPendingReschedule({ taskId, startDate: taskDetails.startDate, newDue: nextDue });
            }}
            className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 px-2 py-1 outline-none focus:border-amber-400 transition-colors"
          />
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">状态</div>
          <div className={`flex h-[30px] items-center justify-between border px-2 text-xs ${taskStatusCfg.className}`}>
            <span>{taskStatusCfg.label}</span>
            <span className="text-[10px] font-mono opacity-60">自动</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">优先级</div>
          <select
            value={taskDetails?.taskPriority ?? 'medium'}
            disabled={!canEdit}
            onChange={(e) => onUpdate({ ...taskDetails, taskPriority: e.target.value })}
            className="w-full text-xs bg-stone-50 border border-stone-200 px-2 py-1 outline-none focus:border-amber-400 transition-colors"
          >
            {TASK_PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      )}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1.5">执行说明</div>
        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
            disabled={!canEdit}
            rows={4}
            placeholder="记录执行说明、注意事项、进展备注..."
            className="w-full px-3 py-2 border border-stone-200 focus:border-stone-400 outline-none text-xs text-stone-700 resize-none transition-colors"
          />
          {dirty && <div className="absolute bottom-2 right-2 text-[9px] font-mono text-stone-400">保存中...</div>}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1.5 flex items-center gap-1.5">
          <Paperclip size={10} />附件
        </div>
        <FileUploadArea
          files={taskDetails?.files || []}
          onAdd={(newFiles) => {
            onUpdate({ ...taskDetails, files: [...(taskDetails?.files || []), ...newFiles] });
            // Invalidate files.list so useProjectData re-fetches the updated list from DB
            utils.files.list.invalidate({ projectId });
          }}
          onRemove={handleRemoveFile}
          projectId={projectId}
          phaseId={phaseId}
          taskId={taskId}
          readOnly={!canEdit}
        />
      </div>
      {/* Visible Roles Selector - only shown to canEditProjectInfo users */}
      {!compact && canEditRoles && onVisibleRolesChange && (
        <div className="border-t border-stone-100 pt-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-2 flex items-center gap-1.5">
            <Lock size={10} />可见岗位（空=所有人可见）
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ROLE_OPTIONS.map(({ value, label }) => {
              const selected = (visibleRoles || []).includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    const current = visibleRoles || [];
                    const next = selected
                      ? current.filter((r) => r !== value)
                      : [...current, value];
                    onVisibleRolesChange(next);
                  }}
                  className={`px-2 py-0.5 text-[10px] font-mono border transition-colors ${
                    selected
                      ? 'bg-amber-500 text-stone-900 border-amber-500'
                      : 'bg-white text-stone-500 border-stone-200 hover:border-amber-400'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {(visibleRoles || []).length === 0 && (
            <p className="text-[10px] text-stone-400 mt-1">未选择岗位时所有成员均可见此任务</p>
          )}
        </div>
      )}
      {pendingReschedule && (
        <RescheduleConfirmDialog
          projectId={projectId}
          taskId={pendingReschedule.taskId}
          startDate={pendingReschedule.startDate}
          newDue={pendingReschedule.newDue}
          onClose={() => setPendingReschedule(null)}
          onDone={() => {
            setPendingReschedule(null);
            void utils.tasks.list.invalidate({ projectId });
            void utils.projects.get.invalidate({ id: projectId });
            void utils.projects.list.invalidate();
            void utils.projects.portfolio.invalidate();
          }}
        />
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
// ── PM Selector ──────────────────────────────────────────────────────────────
function PmSelector({
  pmUserId,
  onChange,
  disabled,
}: {
  pmUserId: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
}) {
  const { data: users = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, {
    staleTime: 60_000,
  });
  const selected = users.find((u) => u.id === pmUserId);
  const displayName = selected ? (selected.name || selected.username) : '—';

  if (disabled) {
    return <span className="text-xs text-stone-700">{displayName}</span>;
  }

  return (
    <select
      value={pmUserId ?? ''}
      onChange={(e) => {
        const val = e.target.value;
        onChange(val === '' ? null : Number(val));
      }}
      className="text-xs text-stone-700 bg-transparent border-none outline-none cursor-pointer hover:text-amber-600 transition-colors"
    >
      <option value="">— 未指定 —</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name || u.username}
        </option>
      ))}
    </select>
  );
}

export function ProjectDetailView({ project, onUpdate, onBack, initialPhaseId, initialTaskId }: ProjectDetailViewProps) {
  const [activePhaseId, setActivePhaseId] = useState(initialPhaseId ?? project.currentPhase);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null);
  // 任务详情子窗口：Esc 关闭
  useEffect(() => {
    if (!selectedTaskId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedTaskId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTaskId]);
  const [mainTab, setMainTab] = useState<ProjectMainTab>(initialTaskId ? 'tasks' : 'overview');
  // Deep-linked into a task → land on the tasks tab; don't let the role-default override it.
  const roleDefaultAppliedRef = useRef(!!initialTaskId);
  const [ganttMode, setGanttMode] = useState<'task' | 'phase'>('task');
  const perms = useProjectPermission(project.id);
  const { user: currentUser } = useAuth();
  const { data: effectiveProcess } = trpc.tailoring.effectiveProcess.useQuery(
    { projectId: project.id },
    { staleTime: 5_000 }
  );

  // Server-side gate readiness (review-aware) for the active phase — used to make
  // the inline gate panel's deliverables dimension consistent with the server.
  const { data: serverGateReadiness } = trpc.gateReviews.readiness.useQuery(
    { projectId: project.id, phaseId: activePhaseId },
    { staleTime: 5_000 }
  );
  const { data: releasePrecheck } = trpc.products.releasePrecheck.useQuery(
    { projectId: project.id },
    { staleTime: 10_000 }
  );

  useEffect(() => {
    if (roleDefaultAppliedRef.current || perms.isLoading) return;
    setMainTab(defaultTabForRole(perms.role));
    roleDefaultAppliedRef.current = true;
  }, [perms.isLoading, perms.role]);

  // Change Log helpers
  const changeLog: ChangeRecord[] = project.changeLog || [];
  const pendingChangeCount = changeLog.filter((r) => r.status === 'proposed').length;
  const updateChangeLog = (records: ChangeRecord[]) => {
    onUpdate({ ...project, changeLog: records });
  };

  // 闭环:由问题一键发起变更(预填来源,跳到变更记录补充决策人/影响)
  const handleRaiseChange = (issue: Issue) => {
    const now = new Date();
    const newRecord: ChangeRecord = {
      id: `tmp-${now.getTime()}`,
      number: '',
      type: 'eco',
      title: `[问题] ${issue.title}`,
      description: issue.desc || '',
      reason: issue.rootCause || `源于问题「${issue.title}」(${issue.severity})`,
      decisionMaker: '',
      affectedPhases: [activePhaseId],
      status: 'proposed',
      createdAt: now.toISOString(),
      createdDate: now.toISOString().slice(0, 10),
      notes: `来源:问题「${issue.title}」(#${issue.id})`,
    };
    updateChangeLog([...(project.changeLog ?? []), newRecord]);
    setMainTab('changelog');
    toast.success('已从问题发起变更,请补充决策人与影响');
  };

  const projectPhases = getProjectPhases(project);
  const phaseMap = Object.fromEntries(projectPhases.map((p) => [p.id, p]));
  const activeBasePhase = phaseMap[activePhaseId] || PHASE_MAP[activePhaseId];
  const activePhaseData = project.phases[activePhaseId];
  const activePhase = getPhaseWithHandoffTasks(activeBasePhase, activePhaseData, project);
  const effectiveActivePhase = effectiveProcess?.phases.find((phase) => phase.id === activePhaseId);
  const activeGateDeliverables =
    effectiveActivePhase?.submittedDeliverables ?? activePhase?.gateStandard?.requiredDeliverables ?? [];
  // Derive satisfied deliverable names from server readiness: required minus the blockers list.
  // While loading, keep a conservative empty set instead of falling back to legacy task checks.
  const serverDelivSatisfiedSet: string[] = (() => {
    const dim = serverGateReadiness?.dimensions.find((d) => d.dimension === 'deliverables');
    if (!dim) return [];
    const missingSet = new Set(dim.blockers);
    return activeGateDeliverables.filter((name) => !missingSet.has(name));
  })();
  // 归集项映射：deliverableName → 来源阶段显示名（用于 DeliverablesChecklist 标注）
  const activeGateCarriedMap: Record<string, string> = Object.fromEntries(
    (effectiveActivePhase?.carriedDeliverables ?? []).map(({ name, fromPhaseId }) => [
      name,
      PHASE_MAP[fromPhaseId]?.name ?? fromPhaseId,
    ])
  );
  const activeProgress = computePhaseProgress(activePhaseData, activePhaseId, activePhase);
  const overallProgress = computeOverallProgress(project);
  const health = HEALTH_CONFIG[project.risk];
  const isCurrentPhaseUnlocked = isPhaseUnlocked(project, activePhaseId);
  const blockingGate = getBlockingGate(project, activePhaseId);
  const catConfig = project.category ? CATEGORY_MAP[project.category] : null;
  const visibleActiveTasks = activePhase?.tasks.filter((task) => {
    const effectiveRoles = project.taskVisibleRoles?.[task.id] ?? (task.visibleRoles || []);
    if (!effectiveRoles || effectiveRoles.length === 0) return true;
    if (perms.role === 'owner') return true;
    return effectiveRoles.includes(perms.role);
  }) || [];
  const selectedTask = selectedTaskId
    ? visibleActiveTasks.find((task) => task.id === selectedTaskId) || null
    : null;
  const selectedTaskDetails = selectedTask ? activePhaseData?.taskDetails?.[selectedTask.id] : undefined;
  const selectedTaskChecked = selectedTask ? Boolean(activePhaseData?.tasks?.[selectedTask.id]) : false;
  const selectedTaskIsGate = !!selectedTask && selectedTask.id === activePhase?.gateTaskId;
  const selectedTaskRoles = selectedTask
    ? project.taskVisibleRoles?.[selectedTask.id] ?? (selectedTask.visibleRoles || [])
    : [];
  const selectedTaskRoleLabels = selectedTaskRoles.length > 0
    ? selectedTaskRoles.map((role) => ROLE_OPTIONS.find((option) => option.value === role)?.label || role).join(' / ')
    : '所有项目成员';
  const compactTaskDetail = isExecutionRole(perms.role) && !selectedTaskIsGate;
  // P2: 执行角色(如结构工程师)收敛项目详情标签——只保留 总览/任务/问题/BOM/文件,
  // 隐藏 PM/管理层导向的 度量/看板/需求池/甘特/变更,减少干扰(内容仍按 mainTab 渲染,不影响深链)。
  const execLens = isExecutionRole(perms.role);

  const updateField = (field: keyof Project, value: string) => onUpdate({ ...project, [field]: value });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateFieldAny = (field: keyof Project, value: any) => onUpdate({ ...project, [field]: value });

  const toggleTask = (taskId: string) => {
    // Gate lock check: if this phase is locked, disallow toggling
    if (!isPhaseUnlocked(project, activePhaseId)) return;
    if (!perms.canEditTasks) return;
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    newProject.phases[activePhaseId] = {
      ...activePhaseData,
      tasks: { ...activePhaseData.tasks, [taskId]: !activePhaseData.tasks[taskId] },
    };
    const becameDone = !activePhaseData.tasks[taskId];
    const newProgress = computePhaseProgress(newProject.phases[activePhaseId], activePhaseId, activePhase);
    let advancedTo: string | null = null;
    if (newProgress === 100) {
      const idx = projectPhases.findIndex((p) => p.id === activePhaseId);
      if (idx < projectPhases.length - 1 && activePhaseId === project.currentPhase) {
        newProject.currentPhase = projectPhases[idx + 1].id;
        advancedTo = projectPhases[idx + 1].name;
      }
    }
    onUpdate(newProject);
    // P1-2: 完成任务后给执行者明确反馈——是否推进阶段 / 还差什么阻塞项。
    if (becameDone) {
      if (advancedTo) {
        toast.success(`本阶段已全部完成，阶段推进至「${advancedTo}」`);
      } else {
        const { blockers } = computeGateReadiness(activePhase, newProject.phases[activePhaseId], activeGateDeliverables, serverDelivSatisfiedSet);
        if (blockers.length > 0) {
          toast(`任务已完成。本阶段距 Gate 放行还差：${blockers.join('、')}`);
        } else {
          toast.success('任务已完成');
        }
      }
    }
  };

  const updateTaskDetails = (taskId: string, details: TaskDetails) => {
    if (!perms.canEditTasks) return;
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    newProject.phases[activePhaseId] = {
      ...activePhaseData,
      taskDetails: { ...activePhaseData.taskDetails, [taskId]: details },
    };
    onUpdate(newProject);
  };

  // When user clicks a phase bar in Gantt, switch to tasks tab and jump to that phase
  const handleGanttPhaseClick = (phaseId: string) => {
    setActivePhaseId(phaseId);
    setSelectedTaskId(null);
    setMainTab('tasks');
  };

  // Issue List helpers
  const activeIssues: Issue[] = activePhaseData?.issues || [];
  const selectedTaskIssues = selectedTask
    ? activeIssues.filter((issue) => issue.relatedTaskId === selectedTask.id)
    : [];
  const openIssueCount = activeIssues.filter((i) => i.status === 'open' || i.status === 'in_progress').length;
  const projectOpenIssueCount = projectPhases.reduce(
    (sum, phase) => sum + (project.phases[phase.id]?.issues ?? []).filter((i) => i.status === 'open' || i.status === 'in_progress').length,
    0,
  );
  const firstOpenIssuePhaseId = projectPhases.find((phase) =>
    (project.phases[phase.id]?.issues ?? []).some((i) => i.status === 'open' || i.status === 'in_progress')
  )?.id;

  const updateIssues = (issues: Issue[]) => {
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    newProject.phases[activePhaseId] = { ...activePhaseData, issues };
    onUpdate(newProject);
  };

  const handleCreateIssueFromSelectedTask = () => {
    if (!selectedTask || !perms.canEditIssues) return;
    const now = new Date();
    const newIssue: Issue = {
      id: `tmp-${now.getTime()}`,
      title: `[任务] ${selectedTask.name}`,
      desc: selectedTask.desc || '',
      severity: 'P2',
      status: 'open',
      category: categoryForRole(perms.role),
      owner: selectedTask.owner || '',
      reporter: currentUser?.name || currentUser?.username || '',
      foundDate: now.toISOString().slice(0, 10),
      targetDate: '',
      rootCause: '',
      solution: '',
      relatedTaskId: selectedTask.id,
      creatorId: currentUser?.id ? String(currentUser.id) : undefined,
    };
    updateIssues([...activeIssues, newIssue]);
    toast.success('已从当前任务创建关联 Issue');
  };

  // Gate Review Modal state
  const [gateReviewPending, setGateReviewPending] = useState<{ phaseId: string } | null>(null);
  // MP Release dialog state
  const [releaseOpen, setReleaseOpen] = useState(false);

  const handleGateTaskToggle = (taskId: string) => {
    // If checking a gate task (not unchecking), show review modal
    const isChecking = !activePhaseData?.tasks[taskId];
    if (isChecking && taskId === activePhase?.gateTaskId) {
      setGateReviewPending({ phaseId: activePhaseId });
      return;
    }
    toggleTask(taskId);
  };

  const handleGateReviewConfirm = (review: GateReview) => {
    // Save review record + mark gate task as done + advance phase
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    const gateTaskId = activePhase?.gateTaskId || '';
    const prevReviews = activePhaseData?.gateReviews || [];
    // Only mark gate task done if decision is approved or conditional
    const shouldMarkDone = review.decision !== 'rejected';
    newProject.phases[activePhaseId] = {
      ...activePhaseData,
      tasks: shouldMarkDone
        ? { ...activePhaseData.tasks, [gateTaskId]: true }
        : activePhaseData.tasks,
      gateReviews: [...prevReviews, review],
    };
    // Advance to next phase if approved/conditional and this was current
    if (shouldMarkDone) {
      const idx = projectPhases.findIndex((p) => p.id === activePhaseId);
      if (idx < projectPhases.length - 1 && activePhaseId === project.currentPhase) {
        newProject.currentPhase = projectPhases[idx + 1].id;
      }
    }
    onUpdate(newProject);
    setGateReviewPending(null);
  };

  return (
    <div className="ce-page">
      {/* Header */}
      <div className="ce-panel p-5 lg:p-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-mono text-stone-500 hover:text-stone-900 transition-colors"
          >
            <ArrowLeft size={14} /> 返回项目列表
          </button>
          {perms.canEditProjectInfo && (
            <button
              onClick={() => setReleaseOpen(true)}
              className="ce-control flex items-center gap-1.5 text-xs font-medium bg-stone-900 hover:bg-stone-800 text-stone-50 px-3 py-1.5 shadow-sm transition-colors"
            >
              <Rocket size={13} /> 量产发布
            </button>
          )}
        </div>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <EditableText value={project.code} onChange={perms.canEditProjectInfo ? (v) => updateField('code', v) : () => {}} className="text-[10px] font-mono uppercase tracking-widest text-stone-400" />
              {catConfig && (
                <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 ${catConfig.color} ${catConfig.textColor} border ${catConfig.borderColor}`}>
                  {catConfig.badge}
                </span>
              )}
            </div>
            <h1 className="font-serif text-3xl lg:text-4xl text-stone-900 leading-tight">
              <EditableText
                value={project.name}
                onChange={perms.canEditProjectInfo ? (v) => updateField('name', v) : () => {}}
                className="font-serif text-3xl lg:text-4xl text-stone-900 leading-tight"
                inputClassName="font-serif text-3xl lg:text-4xl text-stone-900 leading-tight w-full"
              />
            </h1>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-xs text-stone-500">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">类型</span>
                <EditableSelect
                  value={project.type}
                  options={['汽车充气泵', '自行车充气泵', '户外充气泵', '车载吸尘器', '暴力风扇', '胎压计', '机械式打气筒', '组件']}
                  onChange={(v) => updateField('type', v)}
                  className="text-xs text-stone-700"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">PM</span>
                <PmSelector
                  pmUserId={project.pmUserId ?? null}
                  onChange={(id) => updateFieldAny('pmUserId', id)}
                  disabled={!perms.canEditProjectInfo}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar size={12} className="text-stone-400" />
                <EditableText value={project.startDate} onChange={(v) => updateField('startDate', v)} className="text-xs font-mono text-stone-700" placeholder="开始日期" />
                <span className="text-stone-300">→</span>
                <EditableText value={project.targetDate} onChange={(v) => updateField('targetDate', v)} className="text-xs font-mono text-stone-700" placeholder="目标日期" />
              </div>
              <div className="flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-stone-400" />
                <span className={`text-xs font-medium ${health.color}`}>项目健康度：{health.label}</span>
                <span className="text-[10px] font-mono text-stone-400">自动</span>
              </div>
            </div>
          </div>
          {/* Overall Progress */}
          <div className="lg:w-48 shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">整体进度</span>
              <span className="text-lg font-serif font-semibold text-stone-900">{overallProgress}%</span>
            </div>
            <ProgressBar value={overallProgress} color="bg-stone-900" height="h-2" />
          </div>
        </div>
      </div>

      <ProjectFocusBand
        phaseName={activePhase?.name ?? activePhaseId}
        activeProgress={activeProgress}
        gateName={activePhase?.gate ?? 'Gate 评审'}
        readiness={serverGateReadiness}
        openIssueCount={projectOpenIssueCount}
        pendingChangeCount={pendingChangeCount}
        releasePrecheck={releasePrecheck}
        canReleaseAction={perms.canEditProjectInfo}
        onTasks={() => setMainTab('tasks')}
        onGate={() => {
          setMainTab('tasks');
          if (activePhase?.gateTaskId) setSelectedTaskId(activePhase.gateTaskId);
        }}
        onIssues={() => {
          if (firstOpenIssuePhaseId) setActivePhaseId(firstOpenIssuePhaseId);
          setMainTab('issues');
        }}
        onChanges={() => setMainTab('changelog')}
        onRelease={() => setReleaseOpen(true)}
      />

      {/* Main Tab Bar: Overview / Tasks / Issues / Gantt / Members */}
      <div className="ce-panel ce-scroll-x flex items-center gap-0 px-1">
        <button
          onClick={() => setMainTab('overview')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'overview'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <LayoutDashboard size={14} />
          总览
        </button>
        <button
          onClick={() => setMainTab('tasks')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'tasks'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <ListChecks size={14} />
          任务清单
        </button>
        {!execLens && (
        <button
          onClick={() => setMainTab('metrics')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
            mainTab === 'metrics'
              ? 'border-b-teal-600 text-teal-700'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <Activity size={14} />
          度量
        </button>
        )}
        {!execLens && (
        <button
          onClick={() => setMainTab('kanban')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
            mainTab === 'kanban'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <LayoutGrid size={14} />
          看板
        </button>
        )}
        {!execLens && (
        <button
          onClick={() => setMainTab('requirements')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
            mainTab === 'requirements'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <Inbox size={14} />
          需求池
        </button>
        )}
        <button
          onClick={() => setMainTab('issues')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'issues'
              ? 'border-b-rose-600 text-rose-700'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <Bug size={14} />
          问题清单
          {openIssueCount > 0 && (
            <span className="text-[9px] font-mono bg-rose-100 text-rose-700 border border-rose-200 px-1.5 py-0.5 min-w-[18px] text-center">
              {openIssueCount}
            </span>
          )}
        </button>
        {!execLens && (
        <button
          onClick={() => setMainTab('gantt')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'gantt'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <BarChart2 size={14} />
          甘特图
        </button>
        )}
        <button
          onClick={() => setMainTab('bom')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
            mainTab === 'bom'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <ListChecks size={14} />
          BOM
        </button>
        <button
          onClick={() => setMainTab('files')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${
            mainTab === 'files'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <FolderOpen size={14} />
          文件
        </button>
        {!execLens && (
        <button
          onClick={() => setMainTab('changelog')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'changelog'
              ? 'border-b-amber-500 text-amber-700'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <GitBranch size={14} />
          变更记录
          {pendingChangeCount > 0 && (
            <span className="text-[9px] font-mono bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 min-w-[18px] text-center">
              {pendingChangeCount}
            </span>
          )}
        </button>
        )}
      </div>

      {/* ── Issues Tab ────────────────────────────────────────────────────── */}
      {mainTab === 'issues' && (
        <div className="space-y-4">
          {/* Phase Navigation (compact) — 任何阶段都可记录问题 */}
          <div className="ce-panel ce-scroll-x">
            <div className="flex min-w-max">
              {projectPhases.map((phase) => {
                const isActive = phase.id === activePhaseId;
                const phaseIssues = project.phases[phase.id]?.issues || [];
                const openCount = phaseIssues.filter((i) => i.status === 'open' || i.status === 'in_progress').length;
                return (
                  <button
                    key={phase.id}
                    onClick={() => setActivePhaseId(phase.id)}
                    className={`flex-1 min-w-[100px] p-3 text-left transition-all border-b-2 ${
                      isActive ? 'border-b-rose-600 bg-rose-50/30' : 'border-b-transparent hover:bg-stone-50'
                    }`}
                  >
                    <div className="text-[9px] font-mono uppercase tracking-widest text-stone-400 mb-0.5">{phase.code}</div>
                    <div className={`text-xs font-medium ${isActive ? 'text-rose-700' : 'text-stone-500'}`}>{phase.name}</div>
                    <div className="mt-1 flex items-center gap-1">
                      {openCount > 0 ? (
                        <span className="text-[9px] font-mono bg-rose-100 text-rose-700 border border-rose-200 px-1 py-0.5">
                          {openCount} 待处理
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono text-stone-300">{phaseIssues.length} 问题</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <IssueList
            phaseId={activePhaseId}
            phaseName={activePhase?.name || activePhaseId}
            issues={activeIssues}
            onUpdate={updateIssues}
            canEdit={perms.canEditIssues}
            currentUserId={currentUser?.id !== undefined ? String(currentUser.id) : undefined}
            canManage={perms.canManageMembers}
            phaseTasks={(activePhase?.tasks ?? []).map((t) => ({ id: t.id, name: t.name }))}
            onRaiseChange={perms.canEditChangelog ? handleRaiseChange : undefined}
          />
        </div>
      )}

      {mainTab === 'metrics' && (
        <MetricsView project={project} />
      )}

      {/* ── Requirement Pool Tab ─────────────────────────────────────────── */}
      {mainTab === 'kanban' && (
        <div className="p-6">
          <KanbanBoard project={project} onUpdate={onUpdate} canEdit={perms.canEditTasks} />
        </div>
      )}

      {mainTab === 'requirements' && (
        <div className="p-6">
          <RequirementPoolPanel
            scope={{ kind: 'project', projectId: project.id, phases: projectPhases }}
            canEdit={perms.canEditRequirements}
          />
        </div>
      )}

       {/* ── Gantt Tab ─────────────────────────────────────────────────── */}
      {mainTab === 'gantt' && (
        <div className="space-y-3">
          <div className="flex items-center gap-0 border border-stone-200 w-fit">
            {([['task', '任务视图'], ['phase', '阶段视图']] as const).map(([m, label]) => (
              <button key={m} onClick={() => setGanttMode(m)}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors ${ganttMode === m ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-50'}`}>
                {label}
              </button>
            ))}
          </div>
          {ganttMode === 'task' ? (
            <TaskGanttView project={project} onTaskClick={(phaseId, taskId) => { setActivePhaseId(phaseId); setSelectedTaskId(taskId); setMainTab('tasks'); }} />
          ) : (
            <GanttView
              project={project}
              onUpdate={onUpdate}
              onPhaseClick={handleGanttPhaseClick}
              readOnly={!perms.canEditProjectInfo}
            />
          )}
        </div>
      )}

      {/* ── Change Log Tab ──────────────────────────────────────────── */}
      {mainTab === 'changelog' && (
        <div className="p-6">
          <ChangeLog
            projectId={project.id}
            records={changeLog}
            onUpdate={updateChangeLog}
            canEdit={perms.canEditChangelog}
          />
        </div>
      )}

      {mainTab === 'bom' && (
        <div className="p-6">
          <BomPanel projectId={project.id} canEdit={perms.canEditProjectInfo || perms.canEditChangelog} />
        </div>
      )}

      {/* ── Files Tab（权限范围内项目文件汇总）──────────────────────────── */}
      {mainTab === 'files' && (
        <div className="p-6">
          <FilesPanel project={project} role={perms.role} />
        </div>
      )}

      {/* ── Overview Tab（含 成员 / 字段）─────────────────────────────────── */}
      {mainTab === 'overview' && (
        <div className="p-6">
          <OverviewPanel
            project={project}
            onUpdate={onUpdate}
            canEdit={perms.canEditProjectInfo}
            canManageMembers={perms.canManageMembers}
            isAdmin={currentUser?.role === 'admin'}
          />
        </div>
      )}

      {/* ── Tasks Tab ─────────────────────────────────────────────────────── */}
      {mainTab === 'tasks' && (
        <>
          {/* Phase Navigation */}
          <div className="ce-panel ce-scroll-x">
            <div className="flex min-w-max">
              {projectPhases.map((phase) => {
                const status = getPhaseStatus(project, phase.id);
                const isActive = phase.id === activePhaseId;
                const unlocked = isPhaseUnlocked(project, phase.id);
                return (
                  <button
                    key={phase.id}
                    onClick={() => {
                      setActivePhaseId(phase.id);
                      setSelectedTaskId(null);
                    }}
                    className={`flex-1 min-w-[80px] p-3 text-left transition-all border-b-2 relative ${
                      isActive
                        ? 'border-b-stone-900 bg-stone-50'
                        : 'border-b-transparent hover:bg-stone-50'
                    } ${!unlocked ? 'opacity-60' : ''}`}
                  >
                    <div className="text-[9px] font-mono uppercase tracking-widest text-stone-400 mb-0.5">{phase.code}</div>
                    <div className={`text-xs font-medium ${isActive ? 'text-stone-900' : 'text-stone-500'}`}>
                      {phase.nameEn}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      {!unlocked ? (
                        <Lock size={10} className="text-stone-400 shrink-0" />
                      ) : status === 'completed' ? (
                        <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
                      ) : status === 'active' ? (
                        <Zap size={10} className="text-amber-500 shrink-0" />
                      ) : (
                        <Circle size={10} className="text-stone-300 shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Task List */}
            <div className="lg:col-span-2 space-y-3">
              {/* Phase Header */}
              <div className="ce-panel p-5" style={{ borderLeftWidth: 4, borderLeftColor: activePhase?.color }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">{activePhase?.code}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-stone-300">·</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{activePhase?.duration}</span>
                    </div>
                    <h2 className="font-serif text-2xl text-stone-900">{activePhase?.name}</h2>
                    <p className="text-sm text-stone-500 mt-1">{activePhase?.desc}</p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="text-2xl font-serif font-semibold text-stone-900">{activeProgress}%</div>
                    <div className="text-[10px] font-mono text-stone-400">完成</div>
                  </div>
                </div>
                <ProgressBar value={activeProgress} color="bg-amber-500" height="h-1.5" />
                <div className="mt-3 flex items-center gap-1.5">
                  <Target size={12} className="text-amber-600" />
                  <span className="text-xs font-medium text-stone-700">Gate: {activePhase?.gate}</span>
                </div>
              </div>

              {/* Gate Lock Banner */}
              {!isCurrentPhaseUnlocked && blockingGate && (
                <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 border-l-4 border-l-rose-500">
                  <ShieldAlert size={18} className="text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold text-rose-800 mb-0.5">此阶段已锁定</div>
                    <div className="text-xs text-rose-700">
                      请先完成 <span className="font-mono font-semibold">{blockingGate.phaseName}</span> 的
                      Gate 评审任务：<span className="font-medium">「{blockingGate.gateTaskName}」</span>，
                      通过后此阶段将自动解锁。
                    </div>
                  </div>
                </div>
              )}

              {/* Role-based task filter notice */}
              {perms.role !== 'owner' && !perms.isLoading && (() => {
                const totalTasks = activePhase?.tasks.length || 0;
                const hiddenCount = totalTasks - visibleActiveTasks.length;
                if (hiddenCount === 0) return null;
                return (
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 text-xs text-amber-700">
                    <Filter size={11} className="shrink-0" />
                    <span>已按您的岗位角色过滤，当前显示 <strong>{visibleActiveTasks.length}</strong> 项相关任务（共 {totalTasks} 项，隐藏 {hiddenCount} 项非本岗位任务）</span>
                  </div>
                );
              })()}

              {/* Tasks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {visibleActiveTasks.map((task) => {
                  const checked = activePhaseData?.tasks[task.id] || false;
                  const details = activePhaseData?.taskDetails?.[task.id];
                  const hasInstructions = !!(details?.instructions || '').trim();
                  const fileCount = (details?.files || []).length;
                  const isGateTask = task.id === activePhase?.gateTaskId;
                  const locked = !isCurrentPhaseUnlocked;
                  const selected = selectedTaskId === task.id;
                  // status 为主状态;checked 已由 status 派生(done/skipped),直接显示真实状态
                  const status = details?.taskStatus || (checked ? 'done' : 'todo');

                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`rounded-md border transition-all cursor-pointer min-h-[118px] shadow-sm ${
                        locked
                          ? 'border-stone-200 bg-stone-50/30 opacity-60'
                        : isGateTask
                          ? checked
                            ? 'border-l-4 border-l-emerald-500 border-stone-200 bg-emerald-50/30'
                            : 'border-l-4 border-l-amber-500 border-amber-200 bg-amber-50/30'
                          : checked
                          ? 'border-l-2 border-l-stone-900 border-stone-200 bg-stone-50/50'
                          : 'border-stone-200 bg-white'
                      } ${selected ? 'ring-2 ring-amber-300 border-amber-300' : 'hover:border-stone-400 hover:bg-stone-50/50 hover:shadow-md'}`}
                    >
                      {/* Gate Task Label */}
                      {isGateTask && (
                        <div className={`flex items-center gap-1.5 px-3 pt-2 pb-0 ${
                          checked ? 'text-emerald-700' : 'text-amber-700'
                        }`}>
                          <Flag size={10} />
                          <span className="text-[9px] font-mono uppercase tracking-widest font-semibold">
                            Gate 评审 · 通过后解锁下一阶段
                          </span>
                        </div>
                      )}

                      <div className="flex items-start gap-3 p-3 group">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!locked) {
                              isGateTask ? handleGateTaskToggle(task.id) : toggleTask(task.id);
                            }
                          }}
                          className={`mt-0.5 shrink-0 ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                          title={locked ? '此阶段已锁定，请先完成前置 Gate 评审' : isGateTask && !checked ? '点击完成 Gate 评审并填写评审记录' : undefined}
                        >
                          {locked ? (
                            <Lock size={18} className="text-stone-300" />
                          ) : checked ? (
                            <CheckCircle2 size={18} className={isGateTask ? 'text-emerald-600' : 'text-stone-900'} />
                          ) : (
                            <Circle size={18} className={`${isGateTask ? 'text-amber-400 hover:text-amber-600' : 'text-stone-300 hover:text-stone-500'} transition-colors`} />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-medium ${
                              locked ? 'text-stone-400' : checked ? 'text-stone-500 line-through' : isGateTask ? 'text-stone-900 font-semibold' : 'text-stone-900'
                            }`}>
                              {task.name}
                            </span>
                            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{task.id}</span>
                            {!locked && hasInstructions && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-600 flex items-center gap-0.5">
                                <Edit3 size={9} /> 已批注
                              </span>
                            )}
                            {!locked && fileCount > 0 && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 flex items-center gap-0.5">
                                <Paperclip size={9} /> {fileCount}
                              </span>
                            )}
                          </div>
                          <p className={`text-xs mt-1 ${locked || checked ? 'text-stone-400' : 'text-stone-500'}`}>
                            {task.desc}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 border border-stone-200 bg-stone-50 px-1.5 py-0.5">
                              {status === 'done' ? '已完成' :
                                status === 'in_progress' ? '进行中' :
                                status === 'blocked' ? '阻塞' :
                                status === 'skipped' ? '跳过' : '待开始'}
                            </span>
                            {details?.taskPriority && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 border border-stone-200 bg-stone-50 px-1.5 py-0.5">
                                {details.taskPriority}
                              </span>
                            )}
                            {selected && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5">
                                详情已打开
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight size={16} className={`shrink-0 mt-0.5 transition-colors ${selected ? 'text-amber-600' : 'text-stone-300 group-hover:text-stone-500'}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Side Panel: 阶段备注 + 全阶段进度 */}
            <div className="space-y-4 lg:sticky lg:top-24 self-start">
              {/* 任务详情子窗口（点击任务弹出） */}
              {selectedTask && (
                <div
                  className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-stone-900/40 backdrop-blur-sm p-4 sm:p-8"
                  onClick={() => setSelectedTaskId(null)}
                >
                  <div
                    className="relative w-full max-w-2xl h-fit my-auto ce-panel shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => setSelectedTaskId(null)}
                      className="absolute top-3.5 right-3.5 z-10 p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
                      title="关闭 (Esc)"
                    >
                      <X size={18} />
                    </button>
                    <div className="max-h-[86vh] overflow-y-auto p-6">
                    <div className="flex items-start justify-between gap-3 pr-8">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{selectedTask.id}</span>
                          {selectedTaskIsGate && (
                            <span className="text-[9px] font-mono uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5">
                              Gate
                            </span>
                          )}
                          {selectedTaskChecked && (
                            <span className="text-[9px] font-mono uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5">
                              Done
                            </span>
                          )}
                        </div>
                        <h3 className="font-serif text-xl leading-tight text-stone-900">{selectedTask.name}</h3>
                        <p className="text-sm text-stone-500 mt-1 leading-relaxed">{selectedTask.desc}</p>
                      </div>
                    </div>

                    {!isCurrentPhaseUnlocked && (
                      <div className="mt-4 flex items-start gap-2 border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                        <Lock size={13} className="shrink-0 mt-0.5" />
                        <span>
                          {blockingGate ? (
                            <>前置条件未完成：需先通过 <span className="font-mono font-semibold">{blockingGate.phaseName}</span> 的 Gate 评审「{blockingGate.gateTaskName}」。本任务暂仅可查看。</>
                          ) : (
                            <>此阶段被前置 Gate 锁定，当前任务详情仅可查看。</>
                          )}
                        </span>
                      </div>
                    )}

                    <div className="mt-4 border-t border-stone-100 pt-4 space-y-4">
                      <div>
                        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-2">
                          <Users size={11} />
                          职责
                        </div>
                        <div className="space-y-1.5 text-xs text-stone-600">
                          <div className="flex gap-2">
                            <span className="w-16 shrink-0 font-mono text-stone-400">责任角色</span>
                            <span className="text-stone-800">{selectedTask.owner || '未指定'}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="w-16 shrink-0 font-mono text-stone-400">可见岗位</span>
                            <span className="text-stone-800">{selectedTaskRoleLabels}</span>
                          </div>
                          {selectedTaskIsGate && activePhase?.gateStandard?.responsibleRoles?.length > 0 && (
                            <div className="pt-1">
                              <div className="font-mono text-stone-400 mb-1">Gate 责任分工</div>
                              <div className="space-y-1">
                                {activePhase.gateStandard.responsibleRoles.map((role, i) => (
                                  <div key={i} className="flex items-start gap-2 text-stone-700">
                                    <span className="text-stone-300 mt-0.5">▸</span>
                                    <span>{role}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-2">
                          <Target size={11} />
                          交付物
                        </div>
                        <DeliverablesChecklist
                          projectId={project.id}
                          phaseId={activePhaseId}
                          taskId={selectedTask.id}
                          items={
                            selectedTaskIsGate
                              ? activeGateDeliverables
                              : getTaskDeliverables(selectedTask.id, activePhase?.deliverables || [])
                          }
                          status={selectedTaskDetails?.deliverables || {}}
                          canEdit={perms.canEditTasks && isCurrentPhaseUnlocked}
                          carried={selectedTaskIsGate ? activeGateCarriedMap : undefined}
                        />
                        {selectedTaskIsGate && (
                          <GateDeliverableOverridePanel
                            projectId={project.id}
                            phaseId={activePhaseId}
                            effectiveDeliverables={activeGateDeliverables}
                            canEdit={perms.canEditTasks}
                          />
                        )}
                        {selectedTaskIsGate && activeGateDeliverables.length > 0 && (
                          <DeliverableReviewControls
                            projectId={project.id}
                            phaseId={activePhaseId}
                            deliverableNames={activeGateDeliverables}
                            canEditTasks={perms.canEditTasks}
                            currentUserId={currentUser?.id}
                            isAdmin={currentUser?.role === 'admin'}
                            gateTaskId={activePhase?.gateTaskId}
                            pmUserId={project.pmUserId ?? null}
                          />
                        )}
                      </div>
                    </div>

                    {selectedTask.guide && (
                      <div className="mt-4 p-3 border-l-2 border-amber-500 bg-amber-50">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-amber-600 mb-1.5">操作指南</div>
                        <pre className="text-xs text-stone-700 whitespace-pre-wrap font-sans leading-relaxed">{selectedTask.guide}</pre>
                      </div>
                    )}

                    {selectedTaskIsGate && (() => {
                      const r = computeGateReadiness(activePhase, activePhaseData, activeGateDeliverables, serverDelivSatisfiedSet);
                      return (
                        <div className={`mt-4 p-3 border ${r.ready ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500">Gate 就绪检查</div>
                            <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${r.ready ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                              {r.ready ? '已就绪' : '未就绪'}
                            </span>
                          </div>
                          <div className="divide-y divide-stone-100">
                            <ReadinessRow label="阶段任务完成" ok={r.tasksDone === r.tasksTotal} detail={`${r.tasksDone}/${r.tasksTotal}`} />
                            <ReadinessRow label="交付物审核" ok={r.delivTotal === 0 || r.delivDone === r.delivTotal} detail={`${r.delivDone}/${r.delivTotal}`} />
                            <ReadinessRow label="无未关闭 P0/P1" ok={r.openP0P1 === 0} detail={r.openP0P1 === 0 ? '通过' : `${r.openP0P1} 个待关闭`} />
                            <ReadinessRow label="关键文件已上传" ok={r.fileCount > 0} detail={`${r.fileCount} 个`} soft />
                          </div>
                          {r.signoffRoles.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-stone-100">
                              <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mb-1">需会签角色</div>
                              <div className="flex flex-wrap gap-1">
                                {r.signoffRoles.map((role, i) => (
                                  <span key={i} className="text-[10px] text-stone-600 bg-white border border-stone-200 px-1.5 py-0.5">{role}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {!r.ready && (
                            <div className="mt-2 pt-2 border-t border-amber-100 text-xs text-amber-700 leading-relaxed">
                              未就绪:{r.blockers.join('、')}。补齐后再通过;若需放行,请在评审里选「有条件通过」并填写例外项的责任人与截止。
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {selectedTaskIsGate && activePhase?.gateStandard && (
                      <div className="mt-4 p-3 border-l-2 border-l-stone-900 bg-stone-50">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-2">Gate 管理标准</div>
                        <GateStandardPanel standard={activePhase.gateStandard} compact evidenceHint />
                      </div>
                    )}

                    <div className="mt-4 p-3 border border-stone-200 bg-white">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-stone-400">
                          <Bug size={11} />
                          关联问题
                        </div>
                        {perms.canEditIssues && isCurrentPhaseUnlocked && (
                          <button
                            onClick={handleCreateIssueFromSelectedTask}
                            className="text-[10px] font-mono px-2 py-1 border border-stone-300 text-stone-600 hover:border-amber-400 hover:text-amber-700 transition-colors"
                          >
                            从此任务创建 Issue
                          </button>
                        )}
                      </div>
                      {selectedTaskIssues.length === 0 ? (
                        <div className="mt-2 text-xs text-stone-400">暂无关联问题。</div>
                      ) : (
                        <div className="mt-2 divide-y divide-stone-100">
                          {selectedTaskIssues.map((issue) => (
                            <div key={issue.id} className="py-2 flex items-start gap-2">
                              <span className={`mt-0.5 text-[10px] font-mono px-1.5 py-0.5 border ${
                                issue.severity === 'P0' || issue.severity === 'P1'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-stone-50 text-stone-600 border-stone-200'
                              }`}>
                                {issue.severity}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-stone-800 truncate">{issue.title}</div>
                                <div className="text-[11px] text-stone-500">
                                  {issueStatusLabel(issue.status)}{issue.owner ? ` · ${issue.owner}` : ''}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <TaskDetail
                      taskId={selectedTask.id}
                      taskDetails={selectedTaskDetails || { instructions: '', files: [] }}
                      onUpdate={(details) => updateTaskDetails(selectedTask.id, details)}
                      visibleRoles={selectedTaskRoles}
                      onVisibleRolesChange={(roles) => {
                        onUpdate({
                          ...project,
                          taskVisibleRoles: {
                            ...(project.taskVisibleRoles || {}),
                            [selectedTask.id]: roles,
                          },
                        });
                      }}
                      canEditRoles={perms.canEditProjectInfo}
                      canEdit={perms.canEditTasks && isCurrentPhaseUnlocked}
                      compact={compactTaskDetail}
                      projectId={project.id}
                      phaseId={activePhaseId}
                    />

                    <div className="mt-4 border-t border-stone-100 pt-4">
                      <CommentThread
                        entityType="task"
                        entityId={`${project.id}:${selectedTask.id}`}
                        projectId={project.id}
                      />
                    </div>

                    {selectedTaskIsGate && (() => {
                      const reviews = activePhaseData?.gateReviews || [];
                      const latest = reviews[reviews.length - 1];
                      if (selectedTaskChecked && latest) {
                        return (
                          <div className={`mt-4 border p-3 ${
                            latest.decision === 'approved' ? 'border-emerald-200 bg-emerald-50/50' :
                            latest.decision === 'conditional' ? 'border-amber-200 bg-amber-50/50' :
                            'border-rose-200 bg-rose-50/50'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">评审记录</span>
                                {reviews.length > 1 && (
                                  <span className="text-[9px] font-mono text-stone-400 bg-stone-100 px-1.5 py-0.5 border border-stone-200">
                                    共 {reviews.length} 次
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => setGateReviewPending({ phaseId: activePhaseId })}
                                className="text-[10px] font-mono text-stone-400 hover:text-stone-700 transition-colors"
                              >
                                查看历史
                              </button>
                            </div>
                            <GateReviewBadge review={latest} />
                            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-stone-600">
                              <div><span className="font-mono text-stone-400">参与人：</span>{latest.participants}</div>
                              {latest.conditions && (
                                <div className="col-span-2"><span className="font-mono text-stone-400">条件：</span>{latest.conditions}</div>
                              )}
                              {latest.notes && (
                                <div className="col-span-2 mt-1 text-stone-500 italic">{latest.notes}</div>
                              )}
                            </div>
                          </div>
                        );
                      }
                      if (selectedTaskChecked && !latest) {
                        return (
                          <button
                            onClick={() => setGateReviewPending({ phaseId: activePhaseId })}
                            className="mt-4 w-full text-xs font-mono text-amber-600 border border-dashed border-amber-300 py-2 hover:bg-amber-50 transition-colors"
                          >
                            + 补充填写 Gate 评审记录
                          </button>
                        );
                      }
                      return null;
                    })()}
                    </div>{/* /scroll-body */}
                  </div>{/* /modal-panel */}
                </div>
              )}

              {/* Phase Notes */}
              <div className="ce-panel p-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-3">阶段备注</div>
                <textarea
                  value={activePhaseData?.notes || ''}
                  onChange={(e) => {
                    const newProject = { ...project };
                    newProject.phases = { ...project.phases };
                    newProject.phases[activePhaseId] = { ...activePhaseData, notes: e.target.value };
                    onUpdate(newProject);
                  }}
                  rows={5}
                  placeholder="记录阶段备注、决策记录、风险说明..."
                  className="w-full text-xs text-stone-700 border border-stone-200 focus:border-stone-400 outline-none px-3 py-2 resize-none transition-colors"
                />
              </div>

              {/* Phase Progress Summary */}
              <div className="ce-panel p-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-3">全阶段进度</div>
                <div className="space-y-3">
                  {projectPhases.map((phase) => {
                    const pd = project.phases[phase.id];
                    const prog = computePhaseProgress(pd, phase.id);
                    const status = getPhaseStatus(project, phase.id);
                    return (
                      <div
                        key={phase.id}
                        className="cursor-pointer"
                        onClick={() => {
                          setActivePhaseId(phase.id);
                          setSelectedTaskId(null);
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: phase.color }} />
                            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">{phase.code}</span>
                          </div>
                          <span className="text-[10px] font-mono text-stone-500">{prog}%</span>
                        </div>
                        <ProgressBar
                          value={prog}
                          color={status === 'completed' ? 'bg-emerald-500' : status === 'active' ? 'bg-amber-500' : 'bg-stone-200'}
                          height="h-1"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Gate Review Modal ──────────────────────────────────────────────── */}
      {gateReviewPending && (
          <GateReviewModal
          open={!!gateReviewPending}
          phaseId={gateReviewPending.phaseId}
          phaseName={activePhase?.name || gateReviewPending.phaseId}
          gateName={activePhase?.gate || 'Gate 评审'}
          gateStandard={activePhase?.gateStandard}
          existingReviews={activePhaseData?.gateReviews}
          projectId={project.id}
          gateTaskId={activePhase?.gateTaskId}
          blockers={computeGateReadiness(activePhase, activePhaseData, activeGateDeliverables, serverDelivSatisfiedSet).blockers}
          onConfirm={perms.canGateReview ? handleGateReviewConfirm : () => {}}
          onCancel={() => setGateReviewPending(null)}
          readOnly={!perms.canGateReview}
        />
      )}
      {releaseOpen && (
        <ReleaseDialog
          projectId={project.id}
          open={releaseOpen}
          onOpenChange={setReleaseOpen}
          onReleased={() => { setReleaseOpen(false); onBack(); }}
        />
      )}
    </div>
  );
}
