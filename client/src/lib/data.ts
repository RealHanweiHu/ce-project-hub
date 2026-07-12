// CE Project Hub - SOP 标准流程数据
// Design: Linear-style monochrome-indigo token system

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
  // 逐任务审批闸门（默认 requiresApproval=false → 零回归）
  requiresApproval?: boolean;
  approverUserId?: number | null;
  approvalStatus?: string;       // none/pending/approved/rejected
  approvalNote?: string | null;
  approvalRequestedBy?: number | null;
  approvalRequestedAt?: string | null;
  approvalDecidedBy?: number | null;
  approvalDecidedAt?: string | null;
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
  /** 文件格式类别（见 shared/file-types.ts），可空 */
  fileType?: string | null;
  /** 版本标签，可空 */
  fileVersion?: string | null;
  /** Audience boundary enforced by the server. */
  visibility?: 'internal' | 'customer' | 'supplier' | 'public';
}

// ── Issue Tracking ───────────────────────────────────────────────────────────
// severity 值域以 drizzle/schema.ts 为单一来源（经 @shared/const 转发），前端不再手写字面量数组
import { ISSUE_SEVERITIES, type IssueSeverity } from '@shared/const';
export { ISSUE_SEVERITIES, type IssueSeverity };
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

export interface GateReviewTraceSnapshot {
  capturedAt: string;
  projectId: string;
  phaseId: string;
  gateName: string;
  product: {
    id: string;
    productNumber: string;
    name: string;
    lifecycleState: string;
  } | null;
  baseRevision: {
    id: number;
    revisionLabel: string;
    status: string;
  } | null;
  resultRevision: {
    id: number;
    revisionLabel: string;
    status: string;
  } | null;
  workingBom: {
    lineCount: number;
    rows: Array<{
      partNumber: string;
      name: string;
      spec: string;
      quantity: number;
      refDesignator: string;
      componentProductId: string | null;
      componentRevisionId: number | null;
      sortOrder: number;
    }>;
  };
  customerVariants: Array<{
    id: number;
    variantCode: string;
    customerSku: string | null;
    customerId: string;
    customerName: string;
    baseRevision: string;
    status: string;
    customerBomRevision: string | null;
    customerApproved: boolean;
    goldenSampleRef: string | null;
  }>;
}

// ── Gate Review Record ──────────────────────────────────────────────────────
export interface GateReview {
  id: string;
  phaseId: string;
  phaseName: string;
  gateName: string;
  reviewDate: string;       // YYYY-MM-DD
  participants: string;     // comma-separated names
  decision: GateDecision;
  conditions: string;       // conditions if conditional approval
  notes: string;            // meeting notes / decision rationale
  createdAt: string;        // ISO timestamp
  roundNumber?: number;     // review round (1 = first, 2 = re-review, etc.)
  productId?: string | null;
  baseRevisionId?: number | null;
  resultRevisionId?: number | null;
  traceSnapshot?: GateReviewTraceSnapshot | null;
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
import type { ChangeType, ChangeStatus, GateDecision } from '@shared/const';
export type { ChangeType, ChangeStatus, GateDecision };

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
  accessRole?: string | null;
  canDeleteProject?: boolean;
  canEditProjectInfo?: boolean;
  /** 关联产品(产品库 id) */
  productId?: string | null;
  /** 创建/更新项目时锁定的产品定义快照 */
  productDefinitionSnapshotId?: number | null;
  /** 建项时冻结的 SOP 模板版本。 */
  sopTemplateVersion?: string;
  /** 立项基础信息 */
  description?: string | null;
  customer?: string | null;
  background?: string | null;
  value?: string | null;
  /** 项目专属钉钉群会话 id（只读，建群后回填） */
  dingtalkChatId?: string | null;
  startDate: string;
  targetDate: string;
  currentPhase: string;
  risk: 'low' | 'medium' | 'high';
  riskOverrideRisk?: 'low' | 'medium' | 'high' | null;
  riskOverrideReason?: string | null;
  riskOverrideUpdatedAt?: string | null;
  riskOverrideUpdatedBy?: number | null;
  phases: Record<string, PhaseData>;
  phaseDates?: Record<string, PhaseDate>; // custom per-phase dates
  category?: 'npd' | 'eco' | 'idr' | 'jdm' | 'obt'; // project category determines SOP template
  changeLog?: ChangeRecord[];          // project-level change & decision log
  /** Per-task visibleRoles overrides: taskId -> roles[] (empty = all can see) */
  taskVisibleRoles?: Record<string, string[]>;
  /** 自定义字段值：fieldKey -> value（定义见后端 custom_field_defs） */
  customFields?: Record<string, unknown>;
}

/** 新建项目向导专用字段；不进入持久化 Project 聚合。 */
export type ProjectCreateDraft = Omit<Project, 'id' | 'phases'> & {
  npdTemplate?: import('@shared/npd-v3').NpdTemplateConfig;
  npdAttributes?: import('@shared/npd-v3').NpdProjectAttributes;
  npdTemplateDowngradeReason?: string;
};

import { NPD_PHASES } from '@shared/sop-templates';
import { getEffectivePhasesForProjectLike } from '@shared/npd-v3';

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
  const effectiveTasks = phase.tasks.filter((t) => phaseData.taskDetails?.[t.id]?.taskStatus !== 'skipped');
  const total = effectiveTasks.length;
  if (total === 0) return phase.tasks.length > 0 ? 100 : 0;
  const done = effectiveTasks.filter((t) => phaseData.tasks[t.id]).length;
  return Math.round((done / total) * 100);
};

export const computeOverallProgress = (project: Project): number => {
  const phases = getProjectPhases(project);
  let totalTasks = 0;
  let doneTasks = 0;
  let rawTasks = 0;
  phases.forEach((phase) => {
    const pd = project.phases[phase.id];
    rawTasks += phase.tasks.length;
    const effectiveTasks = phase.tasks.filter((t) => pd?.taskDetails?.[t.id]?.taskStatus !== 'skipped');
    totalTasks += effectiveTasks.length;
    if (pd?.tasks) doneTasks += effectiveTasks.filter((t) => pd.tasks[t.id]).length;
  });
  if (totalTasks === 0) return rawTasks > 0 ? 100 : 0;
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
  if (project.category === 'npd' && project.sopTemplateVersion === '2026-07-v3') {
    return getEffectivePhasesForProjectLike(project);
  }
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

export const HEALTH_CONFIG = {
  low: { label: '绿灯', shortLabel: '绿', color: 'text-[color:var(--success)]', bg: 'bg-[color:var(--success-soft)]', border: 'border-[color:var(--success)]', dot: 'bg-[color:var(--success)]' },
  medium: { label: '黄灯', shortLabel: '黄', color: 'text-[color:var(--warning)]', bg: 'bg-[color:var(--warning-soft)]', border: 'border-[color:var(--warning)]', dot: 'bg-[color:var(--warning)]' },
  high: { label: '红灯', shortLabel: '红', color: 'text-[color:var(--destructive)]', bg: 'bg-[color:var(--destructive-soft)]', border: 'border-[color:var(--destructive)]', dot: 'bg-[color:var(--destructive)]' },
};

export const RISK_CONFIG = HEALTH_CONFIG;

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
  P0: { label: 'P0', desc: '严重缺陷', color: 'text-[color:var(--destructive)]', bg: 'bg-[color:var(--destructive-soft)]', border: 'border-[color:var(--destructive)]', dot: 'bg-[color:var(--destructive)]', textColor: 'text-[color:var(--destructive)]' },
  P1: { label: 'P1', desc: '重要缺陷', color: 'text-[color:var(--destructive)]', bg: 'bg-[color:var(--destructive-soft)]', border: 'border-[color:var(--destructive)]', dot: 'bg-[color:var(--destructive)]', textColor: 'text-[color:var(--destructive)]' },
  P2: { label: 'P2', desc: '一般缺陷', color: 'text-[color:var(--warning)]', bg: 'bg-[color:var(--warning-soft)]', border: 'border-[color:var(--warning)]', dot: 'bg-[color:var(--warning)]', textColor: 'text-[color:var(--warning)]' },
  P3: { label: 'P3', desc: '观察项', color: 'text-muted-foreground', bg: 'bg-secondary', border: 'border-border', dot: 'bg-muted-foreground', textColor: 'text-muted-foreground' },
};

export const STATUS_CONFIG: Record<IssueStatus, {
  label: string; color: string; bg: string; border: string;
}> = {
  open:        { label: '待处理', color: 'text-[color:var(--destructive)]', bg: 'bg-[color:var(--destructive-soft)]', border: 'border-[color:var(--destructive)]' },
  in_progress: { label: '修复中', color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]' },
  resolved:    { label: '待复测', color: 'text-[color:var(--warning)]', bg: 'bg-[color:var(--warning-soft)]', border: 'border-[color:var(--warning)]' },
  closed:      { label: '复测通过', color: 'text-muted-foreground', bg: 'bg-secondary', border: 'border-border' },
  wont_fix:    { label: '不修复', color: 'text-muted-foreground', bg: 'bg-secondary', border: 'border-border' },
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
