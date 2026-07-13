import {
  getEffectivePhasesForProjectLike,
  type ProjectTemplateLike,
} from "./npd-v3";
import type { SOPPhase, SOPTask } from "./sop-templates";

/**
 * Resolve a phase from the process that is actually active for a project.
 *
 * Keep project-bound display code on this path so NPD v3 tier/add-on tasks do
 * not silently fall back to the category-level template.
 */
export function resolveProjectPhase(
  projectLike: ProjectTemplateLike,
  phaseId: string | null | undefined,
): SOPPhase | undefined {
  const normalizedPhaseId = String(phaseId ?? "").trim();
  if (!normalizedPhaseId) return undefined;
  return getEffectivePhasesForProjectLike(projectLike)
    .find((phase) => phase.id === normalizedPhaseId);
}
/** Resolve a task from the project's effective process, optionally phase-first. */
export function resolveProjectTask(
  projectLike: ProjectTemplateLike,
  taskId: string | null | undefined,
  phaseId?: string | null,
): SOPTask | undefined {
  const normalizedTaskId = String(taskId ?? "").trim().toLowerCase();
  if (!normalizedTaskId) return undefined;

  const phases = getEffectivePhasesForProjectLike(projectLike);
  const normalizedPhaseId = String(phaseId ?? "").trim();
  const orderedPhases = normalizedPhaseId
    ? [
        ...phases.filter((phase) => phase.id === normalizedPhaseId),
        ...phases.filter((phase) => phase.id !== normalizedPhaseId),
      ]
    : phases;

  for (const phase of orderedPhases) {
    const task = phase.tasks.find((candidate) => candidate.id.toLowerCase() === normalizedTaskId);
    if (task) return task;
  }
  return undefined;
}

/** Human-readable task name with the id as a stable fallback. */
export function resolveTaskName(
  projectLike: ProjectTemplateLike,
  taskId: string | null | undefined,
  phaseId?: string | null,
): string {
  const fallback = String(taskId ?? "").trim() || "任务";
  return resolveProjectTask(projectLike, taskId, phaseId)?.name ?? fallback;
}

/** Human-readable phase name with the id as a stable fallback. */
export function resolvePhaseName(
  projectLike: ProjectTemplateLike,
  phaseId: string | null | undefined,
): string {
  const fallback = String(phaseId ?? "").trim() || "阶段";
  return resolveProjectPhase(projectLike, phaseId)?.name ?? fallback;
}
