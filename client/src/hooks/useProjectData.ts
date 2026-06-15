/**
 * useProjectData – fetches all relational data for a selected project and
 * assembles it into the legacy `Project` aggregate that the existing view
 * components expect.
 *
 * Data sources (all tRPC):
 *   - projects.get         → project meta (name, pm, risk, dates, …)
 *   - tasks.list           → per-phase task completion + instructions
 *   - issues.list          → per-phase issues
 *   - gateReviews.list     → per-phase gate review history
 *   - changelog.list       → project-level change records
 *   - phases.list          → per-phase date overrides + notes
 *   - files.list           → project files (persisted to DB / S3)
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Project,
  PhaseData,
  Issue,
  GateReview,
  ChangeRecord,
  TaskDetails,
  FileAttachment,
  normalizeProject,
} from "@/lib/data";

export function useProjectData(projectId: string | null) {
  const enabled = !!projectId;

  const { data: projectRow, isLoading: loadingProject } =
    trpc.projects.get.useQuery(
      { id: projectId! },
      { enabled, staleTime: 5_000 }
    );

  const { data: taskRows = [], isLoading: loadingTasks } =
    trpc.tasks.list.useQuery(
      { projectId: projectId! },
      { enabled, staleTime: 5_000 }
    );

  const { data: issueRows = [], isLoading: loadingIssues } =
    trpc.issues.list.useQuery(
      { projectId: projectId! },
      { enabled, staleTime: 5_000 }
    );

  const { data: gateRows = [], isLoading: loadingGates } =
    trpc.gateReviews.list.useQuery(
      { projectId: projectId! },
      { enabled, staleTime: 5_000 }
    );

  const { data: changeRows = [], isLoading: loadingChangelog } =
    trpc.changelog.list.useQuery(
      { projectId: projectId! },
      { enabled, staleTime: 5_000 }
    );

  const { data: phaseRows = [], isLoading: loadingPhases } =
    trpc.phases.list.useQuery(
      { projectId: projectId! },
      { enabled, staleTime: 5_000 }
    );

  // ── Persistent file list from DB ──────────────────────────────────────────
  const { data: fileRows = [], isLoading: loadingFiles } =
    trpc.files.list.useQuery(
      { projectId: projectId! },
      { enabled, staleTime: 10_000 }
    );

  const isLoading =
    loadingProject ||
    loadingTasks ||
    loadingIssues ||
    loadingGates ||
    loadingChangelog ||
    loadingPhases ||
    loadingFiles;

  const project: Project | null = useMemo(() => {
    if (!projectRow) return null;

    // ── Build phases map ─────────────────────────────────────────────────────
    // Collect all unique phaseIds across all data sources
    const phaseIdSet = new Set<string>([
      ...taskRows.map((t) => t.phaseId),
      ...issueRows.map((i) => i.phaseId),
      ...gateRows.map((g) => g.phaseId),
      ...phaseRows.map((p) => p.phaseId),
    ]);
    const phaseIds = Array.from(phaseIdSet);

    const phases: Record<string, PhaseData> = {};

    for (const phaseId of phaseIds) {
      // Tasks → Record<taskId, boolean> + taskDetails
      const phaseTasks = taskRows.filter((t) => t.phaseId === phaseId);
      const tasks: Record<string, boolean> = {};
      const taskDetails: Record<string, TaskDetails> = {};
      for (const t of phaseTasks) {
        // status 是唯一主状态：done/skipped 均算「已解决」，与组合看板/报表口径一致
        tasks[t.taskId] = t.status === "done" || t.status === "skipped";

        // Build DB-backed file list for this task
        const dbFiles: FileAttachment[] = fileRows
          .filter((f) => f.phaseId === phaseId && f.taskId === t.taskId)
          .map((f) => ({
            id: String(f.id),
            name: f.name,
            size: f.size,
            type: f.mimeType,
            uploadDate: f.createdAt ? new Date(f.createdAt).toISOString() : new Date().toISOString(),
            dataUrl: "",
            storageUrl: f.storageUrl,
            storageKey: f.storageKey,
          }));

        taskDetails[t.taskId] = {
          instructions: t.instructions ?? "",
          files: dbFiles,
          assigneeUserId: t.assigneeUserId ?? null,
          startDate: t.startDate ? String(t.startDate).slice(0, 10) : null,
          dueDate: t.dueDate ? String(t.dueDate).slice(0, 10) : null,
          taskStatus: t.status ?? "todo",
          taskPriority: t.priority ?? "medium",
          deliverables: (t.deliverables as Record<string, boolean> | null) ?? {},
        };
      }

      // Issues
      const issues: Issue[] = issueRows
        .filter((i) => i.phaseId === phaseId)
        .map((i) => ({
          id: String(i.id),
          title: i.title,
          desc: i.description ?? "",
          severity: (i.severity as Issue["severity"]) ?? "P2",
          status: (i.status as Issue["status"]) ?? "open",
          category: (i.category as Issue["category"]) ?? "other",
          owner: i.owner ?? "",
          reporter: i.reporter ?? "",
          foundDate: i.foundDate ?? "",
          targetDate: i.targetDate ?? "",
          closedDate: i.closedDate ?? undefined,
          rootCause: i.rootCause ?? undefined,
          solution: i.solution ?? undefined,
          relatedTaskId: i.relatedTaskId ?? undefined,
          creatorId: i.creatorId ? String(i.creatorId) : undefined,
        }));

      // Gate reviews
      const gateReviews: GateReview[] = gateRows
        .filter((g) => g.phaseId === phaseId)
        .map((g) => ({
          id: String(g.id),
          phaseId: g.phaseId,
          phaseName: g.phaseName,
          gateName: g.gateName,
          reviewDate: g.reviewDate,
          participants: g.participants ?? "",
          decision: (g.decision as GateReview["decision"]) ?? "conditional",
          conditions: g.conditions ?? "",
          notes: g.notes ?? "",
          createdAt: g.createdAt ? new Date(g.createdAt).toISOString() : "",
          roundNumber: g.roundNumber ?? 1,
        }));

      // Phase notes
      const phaseRow = phaseRows.find((p) => p.phaseId === phaseId);

      phases[phaseId] = {
        tasks,
        taskDetails,
        notes: phaseRow?.notes ?? "",
        issues,
        gateReviews,
      };
    }

    // ── Build taskVisibleRoles map (Project-level) ──────────────────────────
    const taskVisibleRoles: Record<string, string[]> = {};
    for (const t of taskRows) {
      const roles = t.visibleRoles as string[] | null;
      if (roles && roles.length > 0) {
        taskVisibleRoles[t.taskId] = roles;
      }
    }

    // ── Build phaseDates map ─────────────────────────────────────────────────
    const phaseDates: Record<string, { startDate?: string; endDate?: string }> = {};
    for (const p of phaseRows) {
      if (p.startDate || p.endDate) {
        phaseDates[p.phaseId] = {
          startDate: p.startDate ?? undefined,
          endDate: p.endDate ?? undefined,
        };
      }
    }

    // ── Build changeLog ──────────────────────────────────────────────────────
    const changeLog: ChangeRecord[] = changeRows.map((c) => ({
      id: String(c.id),
      number: c.number ?? "",
      type: (c.type as ChangeRecord["type"]) ?? "other",
      title: c.title,
      description: c.description ?? "",
      reason: c.reason ?? "",
      decisionMaker: c.decisionMaker ?? "",
      affectedPhases: (c.affectedPhases as string[]) ?? [],
      status: (c.status as ChangeRecord["status"]) ?? "proposed",
      costImpact: c.costImpact ?? "",
      scheduleImpact: c.scheduleImpact ?? "",
      notes: c.notes ?? "",
      createdDate: c.createdDate ?? "",
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
      implementedDate: c.implementedDate ?? undefined,
    }));

    return normalizeProject({
      id: projectRow.id,
      name: projectRow.name,
      code: projectRow.projectNumber ?? '',
      category: (projectRow.category as 'npd' | 'eco' | 'idr') ?? 'npd',
      pm: '',  // pmName resolved in UI via listUsersForSelect
      pmUserId: projectRow.pmUserId ?? null,
      risk: (projectRow.risk as 'low' | 'medium' | 'high') ?? 'low',
      currentPhase: projectRow.currentPhase ?? 'concept',
      startDate: projectRow.startDate ?? '',
      targetDate: projectRow.targetDate ?? '',
      type: '',
      phases,
      phaseDates: Object.keys(phaseDates).length > 0 ? phaseDates : undefined,
      taskVisibleRoles: Object.keys(taskVisibleRoles).length > 0 ? taskVisibleRoles : undefined,
      changeLog,
      customFields: (projectRow as { customFields?: Record<string, unknown> }).customFields ?? {},
    } as Project);
  }, [projectRow, taskRows, issueRows, gateRows, changeRows, phaseRows, fileRows]);

  return { project, isLoading };
}
