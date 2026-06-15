// CE Project Hub - SOP 标准流程数据
// Design: Industrial Precision - stone/amber color system

export interface SOPTask {
  id: string;
  name: string;
  desc: string;
  owner: string;
  guide: string;
  /**
   * Which project-member roles can see this task.
   * Empty array (default) = visible to ALL roles.
   * Non-empty = only listed roles (plus owner/manager/pm who always see everything).
   */
  visibleRoles?: string[];
}

export interface SOPGateStandard {
  entryCriteria: string[];
  exitCriteria: string[];
  requiredDeliverables: string[];
  responsibleRoles: string[];
  evidenceRequirements: string[];
  exceptionStrategy: string[];
}

export interface SOPPhase {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  duration: string;
  desc: string;
  gate: string;
  gateTaskId: string; // ID of the Gate Review task that must be completed before next phase
  deliverables: string[];
  gateStandard: SOPGateStandard;
  tasks: SOPTask[];
  color: string;
}

export interface TaskDetails {
  instructions: string;
  files: FileAttachment[];
  // Task meta fields (from DB project_tasks)
  assigneeUserId?: number | null;
  startDate?: string | null;     // YYYY-MM-DD（自动排期生成）
  dueDate?: string | null;       // YYYY-MM-DD
  taskStatus?: string;           // TaskStatus (renamed to avoid collision with IssueStatus)
  taskPriority?: string;         // TaskPriority
  deliverables?: Record<string, boolean>; // 交付物名称 → 是否完成
}

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadDate: string;
  /** Base64 data URL (legacy) or empty string when storageUrl is set */
  dataUrl: string;
  /** S3-backed URL path (e.g. /storage/{key}). Present for server-uploaded files. */
  storageUrl?: string;
  /** S3 storage key. Present for server-uploaded files. */
  storageKey?: string;
}

// ── Issue Tracking ───────────────────────────────────────────────────────────
export type IssueSeverity = 'P0' | 'P1' | 'P2' | 'P3';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'wont_fix';
export type IssueCategory = 'hardware' | 'software' | 'mechanical' | 'thermal' | 'reliability' | 'safety' | 'performance' | 'other';

export interface Issue {
  id: string;
  title: string;
  desc: string;
  severity: IssueSeverity;     // P0 Critical / P1 Major / P2 Minor / P3 Observation
  status: IssueStatus;
  category: IssueCategory;
  owner: string;               // responsible person
  reporter: string;
  foundDate: string;           // YYYY-MM-DD
  targetDate: string;          // expected close date
  closedDate?: string;
  rootCause?: string;
  solution?: string;
  relatedTaskId?: string;      // link to a SOP task
  attachments?: string[];      // file names
  creatorId?: string;          // userId of the person who created this issue
}

// ── Gate Review Record ──────────────────────────────────────────────────────
export interface GateReview {
  id: string;
  phaseId: string;
  phaseName: string;
  gateName: string;
  reviewDate: string;       // YYYY-MM-DD
  participants: string;     // comma-separated names
  decision: 'approved' | 'conditional' | 'rejected';
  conditions: string;       // conditions if conditional approval
  notes: string;            // meeting notes / decision rationale
  createdAt: string;        // ISO timestamp
  roundNumber?: number;     // review round (1 = first, 2 = re-review, etc.)
}

export interface PhaseData {
  tasks: Record<string, boolean>;
  taskDetails: Record<string, TaskDetails>;
  notes: string;
  issues?: Issue[];            // issue list for this phase
  gateReviews?: GateReview[];  // gate review history (newest last)
  /** @deprecated use gateReviews instead */ gateReview?: GateReview;
}

// ── Change Log / ECR ────────────────────────────────────────────────────────
// ChangeType and ChangeStatus are the single source of truth from drizzle/schema.ts.
// They are re-exported via @shared/const to keep frontend and backend in sync.
import type { ChangeType, ChangeStatus } from '@shared/const';
export type { ChangeType, ChangeStatus };

export interface ChangeRecord {
  id: string;
  number: string;           // ECR-001, ECN-002, etc. (auto or manual)
  type: ChangeType;
  title: string;
  description: string;      // what changed
  reason: string;           // why it changed (老板拍板/技术原因/成本压力等)
  decisionMaker: string;    // 拍板人
  affectedPhases: string[]; // which phases are affected
  status: ChangeStatus;
  costImpact?: string;      // e.g. "+$2/unit", "BOM +5%"
  scheduleImpact?: string;  // e.g. "+2 weeks", "no impact"
  createdAt: string;        // ISO timestamp
  createdDate: string;      // YYYY-MM-DD
  implementedDate?: string; // YYYY-MM-DD
  notes?: string;           // additional context
}

export interface PhaseDate {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface Project {
  id: string;
  code: string;
  name: string;
  type: string;
  pm: string;
  pmUserId?: number | null;
  startDate: string;
  targetDate: string;
  currentPhase: string;
  risk: 'low' | 'medium' | 'high';
  phases: Record<string, PhaseData>;
  phaseDates?: Record<string, PhaseDate>; // custom per-phase dates
  category?: 'npd' | 'eco' | 'idr'; // project category determines SOP template
  changeLog?: ChangeRecord[];          // project-level change & decision log
  /** Per-task visibleRoles overrides: taskId -> roles[] (empty = all can see) */
  taskVisibleRoles?: Record<string, string[]>;
  /** 自定义字段值：fieldKey -> value（定义见后端 custom_field_defs） */
  customFields?: Record<string, unknown>;
}

import { NPD_PHASES } from '@shared/sop-templates';

export const SOP_PHASES: SOPPhase[] = NPD_PHASES;

export const PHASE_MAP: Record<string, SOPPhase> = SOP_PHASES.reduce(
  (acc, p) => ({ ...acc, [p.id]: p }),
  {}
);

export const buildPhasesData = (
  currentPhaseId: string,
  completedPhases: string[] = []
): Record<string, PhaseData> => {
  const data: Record<string, PhaseData> = {};
  SOP_PHASES.forEach((phase) => {
    const isCompleted = completedPhases.includes(phase.id);
    const tasks: Record<string, boolean> = {};
    const taskDetails: Record<string, TaskDetails> = {};
    phase.tasks.forEach((t) => {
      tasks[t.id] = isCompleted;
      taskDetails[t.id] = { instructions: '', files: [] };
    });
    data[phase.id] = { tasks, taskDetails, notes: '' };
  });
  return data;
};

export const normalizeProject = (project: Project): Project => {
  const phases = { ...project.phases };
  const projectPhases = getProjectPhases(project);
  projectPhases.forEach((phase) => {
    if (!phases[phase.id]) phases[phase.id] = { tasks: {}, taskDetails: {}, notes: '' };
    if (!phases[phase.id].taskDetails) phases[phase.id].taskDetails = {};
    phase.tasks.forEach((t) => {
      if (phases[phase.id].tasks[t.id] === undefined) phases[phase.id].tasks[t.id] = false;
      if (!phases[phase.id].taskDetails[t.id])
        phases[phase.id].taskDetails[t.id] = { instructions: '', files: [] };
    });
  });
  return { ...project, phases, phaseDates: project.phaseDates || {} };
};

export const computePhaseProgress = (
  phaseData: PhaseData | undefined,
  phaseId: string,
  phaseObj?: SOPPhase
): number => {
  const phase = phaseObj || PHASE_MAP[phaseId];
  if (!phase || !phaseData?.tasks) return 0;
  const total = phase.tasks.length;
  if (total === 0) return 0;
  const done = phase.tasks.filter((t) => phaseData.tasks[t.id]).length;
  return Math.round((done / total) * 100);
};

export const computeOverallProgress = (project: Project): number => {
  const phases = getProjectPhases(project);
  let totalTasks = 0;
  let doneTasks = 0;
  phases.forEach((phase) => {
    const pd = project.phases[phase.id];
    totalTasks += phase.tasks.length;
    if (pd?.tasks) doneTasks += phase.tasks.filter((t) => pd.tasks[t.id]).length;
  });
  if (totalTasks === 0) return 0;
  return Math.round((doneTasks / totalTasks) * 100);
};

export const getPhaseStatus = (
  project: Project,
  phaseId: string
): 'completed' | 'active' | 'pending' => {
  const phases = getProjectPhases(project);
  const idx = phases.findIndex((p) => p.id === phaseId);
  const currIdx = phases.findIndex((p) => p.id === project.currentPhase);
  const phaseObj = phases[idx];
  const progress = computePhaseProgress(project.phases[phaseId], phaseId, phaseObj);
  if (idx < currIdx) return 'completed';
  if (idx === currIdx) return progress === 100 ? 'completed' : 'active';
  return 'pending';
};

// ── Category-aware phase helpers ─────────────────────────────────────────────
// Import lazily to avoid circular deps; use dynamic require pattern
let _getPhasesForCategory: ((cat?: string) => SOPPhase[]) | null = null;
export const registerGetPhasesForCategory = (fn: (cat?: string) => SOPPhase[]) => {
  _getPhasesForCategory = fn;
};
export const getProjectPhases = (project: Project): SOPPhase[] => {
  if (_getPhasesForCategory) return _getPhasesForCategory(project.category as string | undefined);
  return SOP_PHASES;
};

/**
 * Returns true if the Gate Review task of the given phase is completed.
 * Uses the project's category-specific SOP phases.
 */
export const isPhaseGatePassed = (project: Project, phaseId: string): boolean => {
  const phases = getProjectPhases(project);
  const phase = phases.find((p) => p.id === phaseId);
  if (!phase) return true;
  const phaseData = project.phases[phaseId];
  if (!phaseData?.tasks) return false;
  return phaseData.tasks[phase.gateTaskId] === true;
};

/**
 * Returns true if a phase is unlocked (i.e., all previous phases' Gate tasks are done).
 * The first phase (P1) is always unlocked.
 */
export const isPhaseUnlocked = (project: Project, phaseId: string): boolean => {
  const phases = getProjectPhases(project);
  const idx = phases.findIndex((p) => p.id === phaseId);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i++) {
    if (!isPhaseGatePassed(project, phases[i].id)) return false;
  }
  return true;
};

/**
 * Returns the blocking phase name if a phase is locked, or null if unlocked.
 */
export const getBlockingGate = (project: Project, phaseId: string): { phaseName: string; gateTaskName: string } | null => {
  const phases = getProjectPhases(project);
  const idx = phases.findIndex((p) => p.id === phaseId);
  if (idx <= 0) return null;
  for (let i = 0; i < idx; i++) {
    const prev = phases[i];
    if (!isPhaseGatePassed(project, prev.id)) {
      const gateTask = prev.tasks.find((t) => t.id === prev.gateTaskId);
      return { phaseName: prev.name, gateTaskName: gateTask?.name || prev.gate };
    }
  }
  return null;
};

export const RISK_CONFIG = {
  low: { label: '低', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  medium: { label: '中', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
  high: { label: '高', color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200', dot: 'bg-rose-500' },
};

export const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export const SAMPLE_PROJECTS: Project[] = [
  {
    id: 'p001',
    code: 'CE-2026-001',
    name: 'AuraWatch Pro 智能手表',
    type: '可穿戴',
    pm: '张伟',
    startDate: '2026-01-08',
    targetDate: '2026-09-30',
    currentPhase: 'evt',
    risk: 'medium',
    phases: (() => {
      const d = buildPhasesData('evt', ['concept', 'planning', 'design']);
      d.evt.tasks = { e1: true, e2: true, e3: true, e4: true, e5: false, e6: false, e7: false };
      d.evt.taskDetails.e3 = {
        instructions: '本次 EVT 重点验证:\n• 续航目标 ≥ 7 天（典型使用场景）\n• 心率传感器精度 ±2bpm\n• 防水 5ATM 验证',
        files: [],
      };
      return d;
    })(),
  },
  {
    id: 'p002',
    code: 'CE-2026-002',
    name: 'PulseBuds 真无线耳机',
    type: '音频',
    pm: '李明',
    startDate: '2025-11-15',
    targetDate: '2026-06-15',
    currentPhase: 'dvt',
    risk: 'low',
    phases: (() => {
      const d = buildPhasesData('dvt', ['concept', 'planning', 'design', 'evt']);
      d.dvt.tasks = { v1: true, v2: true, v3: true, v4: true, v5: true, v6: false, v7: false, v8: false };
      return d;
    })(),
  },
  {
    id: 'p003',
    code: 'CE-2026-003',
    name: 'NovaCam 4K运动相机',
    type: '影像',
    pm: '王芳',
    startDate: '2026-02-20',
    targetDate: '2026-12-15',
    currentPhase: 'design',
    risk: 'high',
    phases: (() => {
      const d = buildPhasesData('design', ['concept', 'planning']);
      d.design.tasks = { d1: true, d2: true, d3: true, d4: false, d5: true, d6: false, d7: false, d8: false };
      return d;
    })(),
  },
  {
    id: 'p004',
    code: 'CE-2026-004',
    name: 'EcoSense 智能家居网关',
    type: 'IoT',
    pm: '陈静',
    startDate: '2025-08-01',
    targetDate: '2026-05-30',
    currentPhase: 'pvt',
    risk: 'medium',
    phases: (() => {
      const d = buildPhasesData('pvt', ['concept', 'planning', 'design', 'evt', 'dvt']);
      d.pvt.tasks = { pv1: true, pv2: true, pv3: true, pv4: true, pv5: false, pv6: false, pv7: false, pv8: false };
      return d;
    })(),
  },
  {
    id: 'p005',
    code: 'CE-2025-019',
    name: 'BeamSpeaker 智能音箱 Gen2',
    type: '音频',
    pm: '刘洋',
    startDate: '2025-03-10',
    targetDate: '2025-12-01',
    currentPhase: 'mp',
    risk: 'low',
    phases: (() => {
      const d = buildPhasesData('mp', ['concept', 'planning', 'design', 'evt', 'dvt', 'pvt']);
      d.mp.tasks = { mp1: true, mp2: true, mp3: true, mp4: false, mp5: false, mp6: false };
      return d;
    })(),
  },
];

// ── Issue Config ─────────────────────────────────────────────────────────────
export const SEVERITY_CONFIG: Record<IssueSeverity, {
  label: string; desc: string; color: string; bg: string; border: string; dot: string; textColor: string;
}> = {
  P0: { label: 'P0', desc: '严重缺陷', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300', dot: 'bg-red-500', textColor: 'text-red-700' },
  P1: { label: 'P1', desc: '重要缺陷', color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-300', dot: 'bg-orange-500', textColor: 'text-orange-700' },
  P2: { label: 'P2', desc: '一般缺陷', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', dot: 'bg-amber-500', textColor: 'text-amber-700' },
  P3: { label: 'P3', desc: '观察项', color: 'text-stone-600', bg: 'bg-stone-50', border: 'border-stone-300', dot: 'bg-stone-400', textColor: 'text-stone-600' },
};

export const STATUS_CONFIG: Record<IssueStatus, {
  label: string; color: string; bg: string; border: string;
}> = {
  open:        { label: '待处理', color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200' },
  in_progress: { label: '处理中', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  resolved:    { label: '已解决', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  closed:      { label: '已关闭', color: 'text-stone-500', bg: 'bg-stone-100', border: 'border-stone-200' },
  wont_fix:    { label: '不修复', color: 'text-stone-400', bg: 'bg-stone-50', border: 'border-stone-200' },
};

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  hardware:    '硬件',
  software:    '软件',
  mechanical:  '结构',
  thermal:     '散热',
  reliability: '可靠性',
  safety:      '安规',
  performance: '性能',
  other:       '其他',
};

// Phases where Issue List is shown (validation phases)
export const ISSUE_PHASES = new Set(['evt', 'dvt', 'pvt', 'mp', 'design']);
