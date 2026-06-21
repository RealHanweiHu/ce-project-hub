// Design: Industrial Precision - stone/amber color system
// Main application with sidebar navigation and view routing
// Font: Playfair Display (serif) + JetBrains Mono (mono) + Source Sans 3 (body)
// Colors: stone-900 sidebar, stone-50 background, amber-500 accent

import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import {
  LayoutDashboard, FolderKanban, BookOpen, Save, CheckCircle2,
  ChevronRight, Menu, X, Cpu, Search, LogIn, Loader2, Cloud, Shield, KeyRound,
  LogOut, Package, Inbox, CalendarDays, ListChecks,
} from 'lucide-react';
import type { TaskFocus } from '@/components/views/TaskListView';
import { nanoid } from 'nanoid';
import {
  Project, normalizeProject, Issue, GateReview, ChangeRecord, PhaseData,
} from '@/lib/data';
import { buildPhasesDataForCategory, getPhasesForCategory } from '@/lib/sop-templates';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { useAuth } from '@/_core/hooks/useAuth';
import { getLoginUrl } from '@/const';
import { useQueryClient } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';
import { useProjectData } from '@/hooks/useProjectData';
import { NotificationBell } from '@/components/NotificationBell';

type View = 'overview' | 'mytasks' | 'projects' | 'calendar' | 'products' | 'requirements' | 'sop';

const VIEW_IDS = new Set<View>(['overview', 'mytasks', 'projects', 'calendar', 'products', 'requirements', 'sop']);
const PROJECT_DETAIL_TABS = new Set<NonNullable<TaskFocus['tab']>>([
  'overview', 'metrics', 'tasks', 'kanban', 'requirements', 'gantt', 'issues', 'changelog', 'bom', 'files',
]);

function readWorkbenchLocation(): { view: View; selectedProjectId: string | null; focus: TaskFocus | null } {
  if (typeof window === 'undefined') {
    return { view: 'overview', selectedProjectId: null, focus: null };
  }
  const params = new URLSearchParams(window.location.search);
  const selectedProjectId = params.get('projectId');
  const phaseId = params.get('phaseId');
  const taskId = params.get('taskId');
  const tabParam = params.get('tab') as TaskFocus['tab'] | null;
  const tab = tabParam && PROJECT_DETAIL_TABS.has(tabParam) ? tabParam : undefined;
  const viewParam = params.get('view');
  const view = selectedProjectId
    ? 'projects'
    : VIEW_IDS.has(viewParam as View)
      ? (viewParam as View)
      : 'overview';

  return {
    view,
    selectedProjectId,
    focus: tab || phaseId || taskId ? { tab, phaseId: phaseId ?? undefined, taskId: taskId ?? undefined } : null,
  };
}

function buildWorkbenchUrl(view: View, selectedProjectId: string | null, focus?: TaskFocus | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete('view');
  url.searchParams.delete('projectId');
  url.searchParams.delete('phaseId');
  url.searchParams.delete('taskId');
  url.searchParams.delete('tab');

  if (selectedProjectId) {
    url.searchParams.set('view', 'projects');
    url.searchParams.set('projectId', selectedProjectId);
    if (focus?.tab) {
      url.searchParams.set('tab', focus.tab);
    }
    if (focus?.phaseId && focus.taskId) {
      url.searchParams.set('phaseId', focus.phaseId);
      url.searchParams.set('taskId', focus.taskId);
    }
  } else if (view !== 'overview') {
    url.searchParams.set('view', view);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function syncWorkbenchUrl(view: View, selectedProjectId: string | null, focus?: TaskFocus | null, mode: 'push' | 'replace' = 'push') {
  if (typeof window === 'undefined') return;
  const nextUrl = buildWorkbenchUrl(view, selectedProjectId, focus);
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  window.history[mode === 'replace' ? 'replaceState' : 'pushState']({}, '', nextUrl);
}

const OverviewPage = lazy(() =>
  import('@/components/views/overview/OverviewPage').then((module) => ({ default: module.OverviewPage }))
);
const MyTasksView = lazy(() =>
  import('@/components/views/MyTasksView').then((module) => ({ default: module.MyTasksView }))
);
const ProjectListView = lazy(() =>
  import('@/components/views/ProjectListView').then((module) => ({ default: module.ProjectListView }))
);
const ProjectDetailView = lazy(() =>
  import('@/components/views/ProjectDetailView').then((module) => ({ default: module.ProjectDetailView }))
);
const SOPLibraryView = lazy(() =>
  import('@/components/views/SOPLibraryView').then((module) => ({ default: module.SOPLibraryView }))
);
const RequirementsView = lazy(() =>
  import('@/components/views/RequirementsView').then((module) => ({ default: module.RequirementsView }))
);
const ProductLibraryView = lazy(() =>
  import('@/components/views/ProductLibraryView').then((module) => ({ default: module.ProductLibraryView }))
);
const CalendarPage = lazy(() =>
  import('@/components/views/CalendarPage').then((module) => ({ default: module.CalendarPage }))
);
const KickoffWizard = lazy(() =>
  import('@/components/views/KickoffWizard').then((module) => ({ default: module.KickoffWizard }))
);
const GlobalSearch = lazy(() =>
  import('@/components/GlobalSearch').then((module) => ({ default: module.GlobalSearch }))
);
const ChangePasswordDialog = lazy(() =>
  import('@/components/ChangePasswordDialog').then((module) => ({ default: module.ChangePasswordDialog }))
);

function ViewLoading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={24} className="animate-spin text-amber-500" />
        <p className="text-sm font-mono text-stone-400 uppercase tracking-widest">加载中...</p>
      </div>
    </div>
  );
}

// Helper: convert Project to API input shape (meta fields only)
function projectToApiInput(p: Project) {
  const { id, name, code, category, pmUserId, risk, currentPhase, startDate, targetDate } = p;
  return {
    id,
    name: name || '',
    projectNumber: code || '',
    category: category || 'npd',
    pmUserId: pmUserId ?? null,
    productId: p.productId ?? null,
    description: p.description ?? null,
    customer: p.customer ?? null,
    background: p.background ?? null,
    value: p.value ?? null,
    risk: (risk || 'low') as 'low' | 'medium' | 'high',
    riskOverrideRisk: p.riskOverrideRisk ?? null,
    riskOverrideReason: p.riskOverrideRisk ? (p.riskOverrideReason ?? '') : null,
    currentPhase: currentPhase || 'concept',
    progress: 0,
    startDate: startDate || null,
    targetDate: targetDate || null,
    customFields: p.customFields ?? {},
  };
}

// Helper: convert API row (new schema) back to lightweight Project shape for list views
function rowToProject(row: {
  id: string; name: string; projectNumber: string; category: string;
  productId?: string | null; productDefinitionSnapshotId?: number | null;
  pmUserId?: number | null; risk: string; currentPhase: string; progress: number;
  accessRole?: string | null; canDeleteProject?: boolean; canEditProjectInfo?: boolean;
  riskOverrideRisk?: 'low' | 'medium' | 'high' | null;
  riskOverrideReason?: string | null;
  riskOverrideUpdatedAt?: string | Date | null;
  riskOverrideUpdatedBy?: number | null;
  startDate: string | null; targetDate: string | null;
}): Project {
  return normalizeProject({
    id: row.id,
    name: row.name,
    code: row.projectNumber || '',
    category: (row.category as 'npd' | 'eco' | 'idr' | 'jdm' | 'obt') || 'npd',
    pm: '',
    pmUserId: row.pmUserId ?? null,
    accessRole: row.accessRole ?? null,
    canDeleteProject: !!row.canDeleteProject,
    canEditProjectInfo: !!row.canEditProjectInfo,
    productId: row.productId ?? null,
    productDefinitionSnapshotId: row.productDefinitionSnapshotId ?? null,
    risk: (row.risk as 'low' | 'medium' | 'high') || 'low',
    riskOverrideRisk: row.riskOverrideRisk ?? null,
    riskOverrideReason: row.riskOverrideReason ?? null,
    riskOverrideUpdatedAt: row.riskOverrideUpdatedAt ? new Date(row.riskOverrideUpdatedAt).toISOString() : null,
    riskOverrideUpdatedBy: row.riskOverrideUpdatedBy ?? null,
    currentPhase: row.currentPhase || 'concept',
    startDate: row.startDate || '',
    targetDate: row.targetDate || '',
    type: '',
    phases: {},
  } as Project);
}

// ── ProjectDetailWrapper ─────────────────────────────────────────────────────
// Loads full relational data for the selected project and handles all writes.
function ProjectDetailWrapper({
  projectId,
  focus,
  onBack,
  onSaveStatus,
}: {
  projectId: string;
  focus?: TaskFocus | null;
  onBack: () => void;
  onSaveStatus: (status: 'saved' | 'saving' | 'error', at?: Date) => void;
}) {
  const queryClient = useQueryClient();
  const { project, isLoading } = useProjectData(projectId);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const updateProjectMutation = trpc.projects.update.useMutation();
  const setTaskCompletedMutation = trpc.tasks.setCompleted.useMutation();
  const setTaskInstructionsMutation = trpc.tasks.setInstructions.useMutation();
  const setTaskVisibleRolesMutation = trpc.tasks.setVisibleRoles.useMutation();
  const setTaskMetaMutation = trpc.tasks.setMeta.useMutation();
  const createIssueMutation = trpc.issues.create.useMutation();
  const updateIssueMutation = trpc.issues.update.useMutation();
  const deleteIssueMutation = trpc.issues.delete.useMutation();
  const createGateReviewMutation = trpc.gateReviews.create.useMutation();
  const updateGateReviewMutation = trpc.gateReviews.update.useMutation();
  const createChangelogMutation = trpc.changelog.create.useMutation();
  const updateChangelogMutation = trpc.changelog.update.useMutation();
  const deleteChangelogMutation = trpc.changelog.delete.useMutation();
  const upsertPhaseMutation = trpc.phases.upsert.useMutation();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.tasks.list, { projectId }) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.issues.list, { projectId }) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.gateReviews.list, { projectId }) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.changelog.list, { projectId }) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.phases.list, { projectId }) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.projects.get, { id: projectId }) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.projects.list) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.projects.portfolio) });
  }, [queryClient, projectId]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * handleUpdate is called by ProjectDetailView with the full updated Project.
   * We diff it against the current project and call the appropriate tRPC mutations.
   */
  const handleUpdate = useCallback(async (updated: Project) => {
    if (!project) return;
    onSaveStatus('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      try {
        const ops: Promise<unknown>[] = [];

        // ── 1. Project meta (name, pm, risk, dates, currentPhase) ─────────────
        const metaChanged =
          updated.name !== project.name ||
          updated.code !== project.code ||
          updated.pmUserId !== project.pmUserId ||
          updated.currentPhase !== project.currentPhase ||
          updated.startDate !== project.startDate ||
          updated.targetDate !== project.targetDate ||
          updated.category !== project.category ||
          (updated.productId ?? '') !== (project.productId ?? '') ||
          (updated.description ?? '') !== (project.description ?? '') ||
          (updated.customer ?? '') !== (project.customer ?? '') ||
          (updated.background ?? '') !== (project.background ?? '') ||
          (updated.value ?? '') !== (project.value ?? '') ||
          (updated.riskOverrideRisk ?? '') !== (project.riskOverrideRisk ?? '') ||
          (updated.riskOverrideReason ?? '') !== (project.riskOverrideReason ?? '') ||
          JSON.stringify(updated.customFields ?? {}) !== JSON.stringify(project.customFields ?? {});

        if (metaChanged) {
          ops.push(updateProjectMutation.mutateAsync(projectToApiInput(updated)));
        }

        // ── 2. Tasks ──────────────────────────────────────────────────────────
        for (const [phaseId, phaseData] of Object.entries(updated.phases || {})) {
          const oldPhaseData: PhaseData | undefined = project.phases?.[phaseId];

          // Task completion
          for (const [taskId, completed] of Object.entries(phaseData.tasks || {})) {
            if (completed !== (oldPhaseData?.tasks?.[taskId] ?? false)) {
              ops.push(
                setTaskCompletedMutation.mutateAsync({
                  projectId, phaseId, taskId, completed: !!completed,
                })
              );
            }
          }

          // Task instructions
          for (const [taskId, details] of Object.entries(phaseData.taskDetails || {})) {
            const oldInstructions = oldPhaseData?.taskDetails?.[taskId]?.instructions ?? null;
            if (details.instructions !== oldInstructions) {
              ops.push(
                setTaskInstructionsMutation.mutateAsync({
                  projectId, phaseId, taskId,
                  instructions: details.instructions || null,
                })
              );
            }
            // Task meta (assignee, dueDate, priority). Status is automatic.
            const oldMeta = oldPhaseData?.taskDetails?.[taskId];
            const metaChanged =
              details.assigneeUserId !== (oldMeta?.assigneeUserId ?? null) ||
              details.dueDate !== (oldMeta?.dueDate ?? null) ||
              details.taskPriority !== (oldMeta?.taskPriority ?? 'medium');
            if (metaChanged) {
              ops.push(
                setTaskMetaMutation.mutateAsync({
                  projectId, phaseId, taskId,
                  assigneeUserId: details.assigneeUserId ?? null,
                  dueDate: details.dueDate ?? null,
                  priority: (details.taskPriority as any) ?? undefined,
                })
              );
            }
          }

          // Task visibleRoles (stored in project.taskVisibleRoles, keyed by taskId)
          // We check all tasks in this phase for role changes
          for (const taskId of Object.keys(phaseData.tasks || {})) {
            const newRoles: string[] = updated.taskVisibleRoles?.[taskId] ?? [];
            const oldRoles: string[] = project.taskVisibleRoles?.[taskId] ?? [];
            if (JSON.stringify([...newRoles].sort()) !== JSON.stringify([...oldRoles].sort())) {
              ops.push(
                setTaskVisibleRolesMutation.mutateAsync({
                  projectId, phaseId, taskId,
                  visibleRoles: newRoles,
                })
              );
            }
          }

          // ── 3. Issues ─────────────────────────────────────────────────────
          const newIssues: Issue[] = phaseData.issues || [];
          const oldIssues: Issue[] = oldPhaseData?.issues || [];

          // Deleted issues (in old but not in new)
          for (const oldIssue of oldIssues) {
            if (!newIssues.find((i) => i.id === oldIssue.id)) {
              const numId = parseInt(oldIssue.id, 10);
              if (!isNaN(numId)) {
                ops.push(deleteIssueMutation.mutateAsync({ id: numId, projectId }));
              }
            }
          }

          // New or updated issues
          for (const issue of newIssues) {
            const numId = parseInt(issue.id, 10);
            const isNew = isNaN(numId) || !oldIssues.find((i) => i.id === issue.id);
            if (isNew) {
              ops.push(
                createIssueMutation.mutateAsync({
                  projectId, phaseId,
                  title: issue.title,
                  description: issue.desc || null,
                  severity: issue.severity as 'P0' | 'P1' | 'P2' | 'P3',
                  status: issue.status as 'open' | 'in_progress' | 'resolved' | 'closed' | 'wont_fix',
                  category: issue.category as 'hardware' | 'software' | 'mechanical' | 'thermal' | 'reliability' | 'safety' | 'performance' | 'other',
                  owner: issue.owner || null,
                  reporter: issue.reporter || null,
                  foundDate: issue.foundDate || null,
                  targetDate: issue.targetDate || null,
                  rootCause: issue.rootCause || null,
                  solution: issue.solution || null,
                  relatedTaskId: issue.relatedTaskId || null,
                })
              );
            } else {
              const old = oldIssues.find((i) => i.id === issue.id);
              if (old && JSON.stringify(old) !== JSON.stringify(issue)) {
                ops.push(
                  updateIssueMutation.mutateAsync({
                    id: numId, projectId,
                    title: issue.title,
                    description: issue.desc || null,
                    severity: issue.severity as 'P0' | 'P1' | 'P2' | 'P3',
                    status: issue.status as 'open' | 'in_progress' | 'resolved' | 'closed' | 'wont_fix',
                    category: issue.category as 'hardware' | 'software' | 'mechanical' | 'thermal' | 'reliability' | 'safety' | 'performance' | 'other',
                    owner: issue.owner || null,
                    reporter: issue.reporter || null,
                    foundDate: issue.foundDate || null,
                    targetDate: issue.targetDate || null,
                    closedDate: issue.closedDate || null,
                    rootCause: issue.rootCause || null,
                    solution: issue.solution || null,
                    relatedTaskId: issue.relatedTaskId || null,
                  })
                );
              }
            }
          }

          // ── 4. Gate Reviews ───────────────────────────────────────────────
          const newGates: GateReview[] = phaseData.gateReviews || [];
          const oldGates: GateReview[] = oldPhaseData?.gateReviews || [];

          for (const gate of newGates) {
            const numId = parseInt(gate.id, 10);
            const isNew = isNaN(numId) || !oldGates.find((g) => g.id === gate.id);
            if (isNew) {
              ops.push(
                createGateReviewMutation.mutateAsync({
                  projectId, phaseId,
                  phaseName: gate.phaseName || '',
                  gateName: gate.gateName || '',
                  reviewDate: gate.reviewDate,
                  participants: gate.participants || null,
                  decision: gate.decision as 'approved' | 'conditional' | 'rejected',
                  conditions: gate.conditions || null,
                  notes: gate.notes || null,
                })
              );
            } else {
              const old = oldGates.find((g) => g.id === gate.id);
              if (old && JSON.stringify(old) !== JSON.stringify(gate)) {
                ops.push(
                  updateGateReviewMutation.mutateAsync({
                    id: numId, projectId,
                    reviewDate: gate.reviewDate,
                    participants: gate.participants || null,
                    decision: gate.decision as 'approved' | 'conditional' | 'rejected',
                    conditions: gate.conditions || null,
                    notes: gate.notes || null,
                  })
                );
              }
            }
          }

          // ── 5. Phase dates / notes ─────────────────────────────────────────
          const newPhaseDates = updated.phaseDates?.[phaseId];
          const oldPhaseDates = project.phaseDates?.[phaseId];
          const newNotes = phaseData.notes;
          const oldNotes = oldPhaseData?.notes;

          if (
            newPhaseDates?.startDate !== oldPhaseDates?.startDate ||
            newPhaseDates?.endDate !== oldPhaseDates?.endDate ||
            newNotes !== oldNotes
          ) {
            ops.push(
              upsertPhaseMutation.mutateAsync({
                projectId, phaseId,
                startDate: newPhaseDates?.startDate ?? null,
                endDate: newPhaseDates?.endDate ?? null,
                notes: newNotes ?? null,
              })
            );
          }
        }

        // ── 6. Changelog ──────────────────────────────────────────────────────
        const newChangelog: ChangeRecord[] = updated.changeLog || [];
        const oldChangelog: ChangeRecord[] = project.changeLog || [];

        // Deleted records
        for (const old of oldChangelog) {
          if (!newChangelog.find((c) => c.id === old.id)) {
            const numId = parseInt(old.id, 10);
            if (!isNaN(numId)) {
              ops.push(deleteChangelogMutation.mutateAsync({ id: numId, projectId }));
            }
          }
        }

        // New or updated records
        for (const record of newChangelog) {
          const numId = parseInt(record.id, 10);
          const isNew = isNaN(numId) || !oldChangelog.find((c) => c.id === record.id);
          if (isNew) {
            ops.push(
              createChangelogMutation.mutateAsync({
                projectId,
                number: record.number || '',
                type: (['decision','tradeoff','eco','ecn','spec','cost','schedule','supplier','other'].includes(record.type) ? record.type : 'other') as 'decision' | 'tradeoff' | 'eco' | 'ecn' | 'spec' | 'cost' | 'schedule' | 'supplier' | 'other',
                title: record.title,
                description: record.description || null,
                reason: record.reason || null,
                decisionMaker: record.decisionMaker || null,
                affectedPhases: record.affectedPhases || [],
                status: (['proposed','approved','rejected','implemented','cancelled'].includes(record.status) ? record.status : 'proposed') as 'proposed' | 'approved' | 'rejected' | 'implemented' | 'cancelled',
                costImpact: record.costImpact || null,
                scheduleImpact: record.scheduleImpact || null,
                notes: record.notes || null,
                createdDate: record.createdDate || null,
                implementedDate: record.implementedDate || null,
              })
            );
          } else {
            const old = oldChangelog.find((c) => c.id === record.id);
            if (old && JSON.stringify(old) !== JSON.stringify(record)) {
              ops.push(
                updateChangelogMutation.mutateAsync({
                  id: numId, projectId,
                  number: record.number || '',
                  type: (['decision','tradeoff','eco','ecn','spec','cost','schedule','supplier','other'].includes(record.type) ? record.type : 'other') as 'decision' | 'tradeoff' | 'eco' | 'ecn' | 'spec' | 'cost' | 'schedule' | 'supplier' | 'other',
                  title: record.title,
                  description: record.description || null,
                  reason: record.reason || null,
                  decisionMaker: record.decisionMaker || null,
                  affectedPhases: record.affectedPhases || [],
                  status: (['proposed','approved','rejected','implemented','cancelled'].includes(record.status) ? record.status : 'proposed') as 'proposed' | 'approved' | 'rejected' | 'implemented' | 'cancelled',
                  costImpact: record.costImpact || null,
                  scheduleImpact: record.scheduleImpact || null,
                  notes: record.notes || null,
                  createdDate: record.createdDate || null,
                  implementedDate: record.implementedDate || null,
                })
              );
            }
          }
        }

        await Promise.all(ops);
        invalidate();
        onSaveStatus('saved', new Date());
      } catch (err) {
        console.error('[handleUpdate] error:', err);
        onSaveStatus('error');
        // 明确告知用户保存失败（旧版仅侧栏一行小字，窄屏不可见、易误以为已存）。
        const msg = err instanceof Error ? err.message : String(err);
        const status = (err as { data?: { httpStatus?: number }; shape?: { data?: { httpStatus?: number } } })?.data?.httpStatus
          ?? (err as { shape?: { data?: { httpStatus?: number } } })?.shape?.data?.httpStatus;
        const isAuth = status === 401 || status === 403 || /unauthorized|forbidden|401|403|登录|session|未授权|过期/i.test(msg);
        toast.error(
          isAuth ? '登录已过期，请重新登录后重试（你填的内容仍在页面上，未丢失）' : '保存失败，请检查网络后重试（你填的内容仍在页面上，未丢失）',
          { duration: 8000 },
        );
      }
    }, 600);
  }, [
    project, projectId, onSaveStatus, invalidate,
    updateProjectMutation, setTaskCompletedMutation, setTaskInstructionsMutation, setTaskVisibleRolesMutation,
    createIssueMutation, updateIssueMutation, deleteIssueMutation,
    createGateReviewMutation, updateGateReviewMutation,
    createChangelogMutation, updateChangelogMutation, deleteChangelogMutation,
    upsertPhaseMutation,
  ]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-amber-500" />
          <p className="text-sm font-mono text-stone-400 uppercase tracking-widest">加载项目详情...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm font-mono text-stone-400">项目不存在或无权访问</p>
      </div>
    );
  }

  return (
    <ProjectDetailView
      project={project}
      onUpdate={handleUpdate}
      onBack={onBack}
      initialPhaseId={focus?.phaseId}
      initialTaskId={focus?.taskId}
      initialTab={focus?.tab}
    />
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const { user, loading: authLoading, logout } = useAuth();
  const [, navigate] = useLocation();
  const isAdmin = (user as (typeof user & { role?: string }) | null)?.role === 'admin';
  const canCreateProject = !!(user as (typeof user & { canCreateProject?: boolean }) | null)?.canCreateProject;
  const queryClient = useQueryClient();
  const initialLocationRef = useRef(readWorkbenchLocation());

  const [view, setView] = useState<View>(initialLocationRef.current.view);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialLocationRef.current.selectedProjectId);
  const [pendingFocus, setPendingFocus] = useState<TaskFocus | null>(initialLocationRef.current.focus);
  const [kickoffProject, setKickoffProject] = useState<{ id: string; name: string; category: string; pmUserId: number | null; startDate: string | null } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  // ── tRPC queries & mutations ─────────────────────────────────────────────
  const { data: projectRows = [], isLoading: projectsLoading } = trpc.projects.list.useQuery(
    undefined,
    { enabled: !!user }
  );

  const projects: Project[] = projectRows.map(rowToProject);

  // 首屏落点：非 admin、非任何项目 PM 的执行者(如结构工程师)默认进「我的任务」。
  const { data: portfolioRows } = trpc.projects.portfolio.useQuery(undefined, { enabled: !!user });
  const portfolioProjectCount = portfolioRows?.length ?? projects.length;
  const landingAppliedRef = useRef(false);
  useEffect(() => {
    if (landingAppliedRef.current || !user || portfolioRows === undefined || selectedProjectId || view !== 'overview') return;
    landingAppliedRef.current = true;
    const isPM = (portfolioRows as Array<{ pmUserId: number | null }>).some((r) => r.pmUserId === user.id);
    if (!isAdmin && !isPM) {
      setView('mytasks');
      syncWorkbenchUrl('mytasks', null, null, 'replace');
    }
  }, [user, portfolioRows, isAdmin, selectedProjectId, view]);

  const createMutation = trpc.projects.create.useMutation();
  const deleteMutation = trpc.projects.delete.useMutation();
  const invalidateProjects = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.projects.list) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.projects.portfolio) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.projects.calendar) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.workbench.mine) });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.automation.listRuns) });
  }, [queryClient]);
  // ── Ctrl+K global shortcut ───────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const next = readWorkbenchLocation();
      setView(next.view);
      setSelectedProjectId(next.selectedProjectId);
      setPendingFocus(next.focus);
      setSidebarOpen(false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSearchNavigate = useCallback((result: { type: string; projectId?: string }) => {
    if (result.projectId) {
      setSelectedProjectId(result.projectId);
      setPendingFocus(null);
      setView('projects');
      syncWorkbenchUrl('projects', result.projectId);
    } else if (result.type === 'sop') {
      setView('sop');
      setSelectedProjectId(null);
      setPendingFocus(null);
      syncWorkbenchUrl('sop', null);
    }
  }, []);

  // ── Project CRUD ─────────────────────────────────────────────────────────
  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId) || null
    : null;

  const handleSelectProject = (id: string, focus?: TaskFocus) => {
    setSelectedProjectId(id);
    setPendingFocus(focus ?? null);
    setView('projects');
    setSidebarOpen(false);
    syncWorkbenchUrl('projects', id, focus ?? null);
  };

  const handleSaveStatus = useCallback((status: 'saved' | 'saving' | 'error', at?: Date) => {
    setSaveStatus(status);
    if (at) setLastSavedAt(at);
  }, []);

  const handleAddProject = async (data: Omit<Project, 'id' | 'phases'>) => {
    const newProject = normalizeProject({
      ...data,
      id: nanoid(8),
      phases: {},
    } as Project);
    try {
      await createMutation.mutateAsync(projectToApiInput(newProject));
      invalidateProjects();
      // 立项即引导:跳到新项目并自动打开立项向导(开始日/PM 已预填,补齐各角色 → 派任务+通知)
      setSelectedProjectId(newProject.id);
      setView('projects');
      setPendingFocus(null);
      syncWorkbenchUrl('projects', newProject.id);
      setKickoffProject({
        id: newProject.id,
        name: newProject.name,
        category: newProject.category ?? 'npd',
        pmUserId: newProject.pmUserId ?? null,
        startDate: newProject.startDate || null,
      });
    } catch {
      setSaveStatus('error');
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.removeQueries({
        predicate: (query) => JSON.stringify(query.queryKey).includes(id),
      });
      invalidateProjects();
      setPendingFocus(null);
      if (selectedProjectId === id) {
        setSelectedProjectId(null);
        setView('projects');
        syncWorkbenchUrl('projects', null, null, 'replace');
      }
    } catch {
      setSaveStatus('error');
    }
  };

  const handleCloneProject = async (sourceId: string, overrides: Partial<Omit<Project, 'id' | 'phases'>>) => {
    const source = projects.find((p) => p.id === sourceId);
    if (!source) return;
    const category = source.category || 'npd';
    const phases = getPhasesForCategory(category);
    const firstPhaseId = phases[0]?.id || 'concept';
    const freshPhases = buildPhasesDataForCategory(category, firstPhaseId);
    const cloned = normalizeProject({
      ...source,
      ...overrides,
      id: nanoid(8),
      currentPhase: firstPhaseId,
      phases: freshPhases,
      phaseDates: undefined,
    } as Project);
    try {
      await createMutation.mutateAsync(projectToApiInput(cloned));
      invalidateProjects();
      setSelectedProjectId(cloned.id);
      setView('projects');
      setPendingFocus(null);
      syncWorkbenchUrl('projects', cloned.id);
    } catch {
      setSaveStatus('error');
    }
  };

  // ── Navigation ───────────────────────────────────────────────────────────
  const navItems = [
    { id: 'mytasks' as View, label: '我的任务', labelEn: 'My Tasks', icon: ListChecks },
    { id: 'overview' as View, label: '总览', labelEn: 'Overview', icon: LayoutDashboard },
    { id: 'projects' as View, label: '项目管理', labelEn: 'Projects', icon: FolderKanban },
    { id: 'calendar' as View, label: '日历', labelEn: 'Calendar', icon: CalendarDays },
    { id: 'products' as View, label: '产品库', labelEn: 'Products', icon: Package },
    { id: 'requirements' as View, label: '需求池', labelEn: 'Requirements', icon: Inbox },
  ];

  const handleNavClick = (v: View) => {
    setView(v);
    if (v !== 'projects') {
      setSelectedProjectId(null);
      setPendingFocus(null);
      syncWorkbenchUrl(v, null);
    } else if (selectedProjectId) {
      syncWorkbenchUrl('projects', selectedProjectId, pendingFocus);
    } else if (!selectedProjectId) {
      syncWorkbenchUrl('projects', null);
    }
    setSidebarOpen(false);
  };

  const viewLabels: Record<View, string> = {
    overview: 'Overview',
    mytasks: 'My Tasks',
    projects: 'Projects',
    calendar: 'Calendar',
    products: 'Products',
    requirements: 'Requirements',
    sop: 'SOP Library',
  };

  // ── Auth loading / login gate ────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 bg-amber-500 flex items-center justify-center">
            <Cpu size={20} className="text-stone-900" />
          </div>
          <Loader2 size={20} className="animate-spin text-stone-400" />
          <p className="text-sm font-mono text-stone-400 uppercase tracking-widest">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center space-y-6 max-w-sm px-6">
          <div className="flex justify-center">
            <div className="w-14 h-14 bg-amber-500 flex items-center justify-center">
              <Cpu size={26} className="text-stone-900" />
            </div>
          </div>
          <div>
            <h1 className="font-serif text-2xl text-stone-900 mb-2">CE Project Hub</h1>
            <p className="text-[11px] font-mono uppercase tracking-widest text-stone-400">
              Consumer Electronics · Product Development
            </p>
          </div>
          <p className="text-sm text-stone-500">
            请登录以访问您的项目数据，支持多人多设备实时同步。
          </p>
          <a
            href={getLoginUrl()}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-stone-900 font-medium px-6 py-3 transition-colors text-sm"
          >
            <LogIn size={16} />
            登录 / 注册
          </a>
        </div>
      </div>
    );
  }

  // ── Main App ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex text-stone-900">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-stone-900/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-64 bg-[#171513] flex flex-col z-40 shrink-0 transition-transform duration-300 shadow-[8px_0_32px_rgba(28,25,23,0.12)] ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-amber-500 flex items-center justify-center shrink-0 shadow-[0_10px_24px_rgba(245,158,11,0.24)]">
                <Cpu size={16} className="text-stone-900" />
              </div>
              <div>
                <h1 className="font-serif text-base text-stone-50 leading-tight">CE Project Hub</h1>
                <p className="text-[9px] font-mono uppercase tracking-widest text-stone-500 mt-0.5">
                  Product Dev
                </p>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-stone-500 hover:text-stone-300 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(({ id, label, labelEn, icon: Icon }) => {
            const isActive = view === id;
            return (
              <button
                key={id}
                onClick={() => handleNavClick(id)}
                className={`w-full flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-all group ${
                  isActive
                    ? 'border-amber-400/30 bg-white/[0.07] text-stone-50 shadow-inner'
                    : 'border-transparent text-stone-400 hover:bg-white/[0.045] hover:text-stone-200'
                }`}
              >
                <Icon size={15} className={isActive ? 'text-amber-400' : 'text-stone-500 group-hover:text-stone-400'} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-tight">{label}</div>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-stone-600 leading-tight mt-0.5">{labelEn}</div>
                </div>
                {isActive && <ChevronRight size={13} className="text-amber-400 shrink-0" />}
              </button>
            );
          })}

          {/* Recent Projects */}
          {view === 'projects' && projects.length > 0 && (
            <div className="mt-4">
              <div className="text-[9px] font-mono uppercase tracking-widest text-stone-600 mb-1.5 px-3">
                最近项目
              </div>
              {projects.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectProject(p.id)}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors truncate ${
                    selectedProjectId === p.id
                      ? 'text-amber-300 bg-white/[0.07] rounded'
                      : 'text-stone-500 hover:text-stone-300 hover:bg-white/[0.045] rounded'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* Save Status + User */}
        <div className="p-4 border-t border-white/10 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
            {saveStatus === 'saved' ? (
              <>
                <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                <span className="text-stone-500">已同步至云端</span>
              </>
            ) : saveStatus === 'error' ? (
              <>
                <span className="text-[10px] text-rose-400 shrink-0">✕</span>
                <span className="text-rose-400">同步失败</span>
              </>
            ) : (
              <>
                <Save size={11} className="text-amber-400 animate-pulse shrink-0" />
                <span className="text-stone-500">同步中...</span>
              </>
            )}
          </div>
          {lastSavedAt && saveStatus === 'saved' && (
            <div className="text-[9px] font-mono text-stone-600">
              {lastSavedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
          <div className="text-[9px] font-mono text-stone-700">
            {portfolioProjectCount} PROJECTS · CLOUD DB
          </div>
          {/* SOP library - secondary entry (moved out of main nav) */}
          <button
            onClick={() => handleNavClick('sop')}
            className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${view === 'sop' ? 'text-amber-300 bg-white/[0.07]' : 'text-stone-400 hover:text-stone-200 hover:bg-white/[0.045]'}`}
          >
            <BookOpen size={12} className="shrink-0" />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider">SOP 流程库</div>
              <div className="text-[9px] font-mono text-stone-600">SOP Library</div>
            </div>
          </button>

          {/* Admin link - only visible to admin users */}
          {isAdmin && (
            <button
              onClick={() => navigate('/admin')}
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-amber-500 hover:text-amber-300 hover:bg-white/[0.045] transition-colors"
          >
              <Shield size={12} className="shrink-0" />
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider">系统管理</div>
                <div className="text-[9px] font-mono text-stone-600">Admin Panel</div>
              </div>
            </button>
          )}

          {/* User info + change password + logout */}
          <div className="pt-1 flex items-center gap-2 group">
            <div className="w-6 h-6 rounded bg-amber-600 flex items-center justify-center text-[9px] font-mono text-stone-900 uppercase shrink-0">
              {(user.name || user.email || 'U').charAt(0)}
            </div>
            <span className="text-[10px] text-stone-500 truncate flex-1">{user.name || user.email}</span>
            <button
              onClick={() => setChangePasswordOpen(true)}
              title="修改密码"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-stone-600 hover:text-amber-400"
            >
              <KeyRound size={11} />
            </button>
            <button
              onClick={() => logout()}
              title="退出登录"
              aria-label="退出登录"
              className="text-stone-600 hover:text-rose-400 transition-colors"
            >
              <LogOut size={11} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 border-b border-stone-200/80 bg-white/82 px-4 py-3 backdrop-blur-xl lg:px-7 flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-stone-500 hover:text-stone-900 transition-colors"
          >
            <Menu size={20} />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-[11px] font-mono text-stone-400 min-w-0">
            <span className="uppercase tracking-wider hidden sm:inline">CE Project Hub</span>
            <ChevronRight size={11} className="hidden sm:inline shrink-0" />
            <span className="uppercase tracking-wider text-stone-700">
              {viewLabels[view]}
            </span>
            {selectedProject && (
              <>
                <ChevronRight size={11} className="shrink-0" />
                <span className="text-stone-500 truncate">{selectedProject.name}</span>
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            {/* Search trigger */}
            <button
              onClick={() => setSearchOpen(true)}
              className="ce-control flex items-center gap-2 border border-stone-200 bg-white px-3 py-1.5 text-stone-400 shadow-sm transition-colors hover:border-stone-400 hover:text-stone-700"
            >
              <Search size={13} />
              <span className="text-[11px] font-mono hidden sm:inline">搜索</span>
              <kbd className="hidden md:flex items-center gap-0.5 text-[9px] font-mono text-stone-300 bg-stone-100 px-1 py-0.5 border border-stone-200">
                ⌘K
              </kbd>
            </button>

            {/* Sync status */}
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider">
              {saveStatus === 'saving' ? (
                <span className="flex items-center gap-1.5 text-stone-400">
                  <Save size={11} className="text-amber-400 animate-pulse" />
                  <span>同步中...</span>
                </span>
              ) : saveStatus === 'error' ? (
                <span className="flex items-center gap-1.5 text-rose-500">
                  <span>✕</span><span>同步失败</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-stone-400">
                  <Cloud size={11} className="text-emerald-500" />
                  <span>已同步</span>
                  {lastSavedAt && (
                    <span className="text-stone-300 normal-case tracking-normal">
                      {lastSavedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="ce-control text-[10px] font-mono text-stone-400 hidden md:block bg-stone-100 px-2 py-1">
              {projectsLoading && portfolioRows === undefined ? '...' : `${portfolioProjectCount} PROJECTS`}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-4 lg:p-7">
          {projectsLoading && view !== 'overview' ? (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={24} className="animate-spin text-amber-500" />
                <p className="text-sm font-mono text-stone-400 uppercase tracking-widest">加载项目数据...</p>
              </div>
            </div>
          ) : (
            <Suspense fallback={<ViewLoading />}>
              {view === 'overview' && (
                <OverviewPage onSelectProject={handleSelectProject} />
              )}
              {view === 'mytasks' && (
                <MyTasksView onSelectProject={handleSelectProject} />
              )}
              {view === 'projects' && !selectedProjectId && (
                <ProjectListView
                  projects={projects}
                  onSelectProject={handleSelectProject}
                  onAddProject={handleAddProject}
                  onDeleteProject={handleDeleteProject}
                  onCloneProject={handleCloneProject}
                  canCreateProject={canCreateProject}
                />
              )}
              {view === 'projects' && selectedProjectId && (
                <ProjectDetailWrapper
                  key={`${selectedProjectId}:${pendingFocus?.taskId ?? ''}`}
                  projectId={selectedProjectId}
                  focus={pendingFocus}
                  onBack={() => {
                    setSelectedProjectId(null);
                    setPendingFocus(null);
                    syncWorkbenchUrl('projects', null);
                  }}
                  onSaveStatus={handleSaveStatus}
                />
              )}
              {view === 'calendar' && <CalendarPage projects={projects} onSelectProject={handleSelectProject} />}
              {view === 'products' && <ProductLibraryView />}
              {view === 'requirements' && <RequirementsView />}
              {view === 'sop' && <SOPLibraryView />}
            </Suspense>
          )}
        </main>
      </div>

      {/* Global Search */}
      {searchOpen && (
        <Suspense fallback={null}>
          <GlobalSearch
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            projects={projects}
            onNavigate={handleSearchNavigate}
          />
        </Suspense>
      )}
      {/* Change Password Dialog */}
      {changePasswordOpen && (
        <Suspense fallback={null}>
          <ChangePasswordDialog
            open={changePasswordOpen}
            onOpenChange={setChangePasswordOpen}
          />
        </Suspense>
      )}

      {kickoffProject && (
        <Suspense fallback={null}>
          <KickoffWizard project={kickoffProject} onClose={() => setKickoffProject(null)} />
        </Suspense>
      )}
    </div>
  );
}
