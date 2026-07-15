import {
  CATEGORY_MAP,
  DERIVATIVE_PHASES,
  DERIVATIVE_MODULE_TASK_IDS,
  ECO_PHASES,
  IDR_PHASES,
  NPD_PHASES,
  PROJECT_CATEGORIES,
  getPhasesForCategory,
  type ProjectCategory,
  type ProjectCategoryConfig,
  type SOPGateStandard,
  type SOPPhase,
  type SOPTask,
} from '@shared/sop-templates';
import type { PhaseData, TaskDetails } from './data';
import {
  getEffectivePhasesForProjectLike,
  type ProjectTemplateLike,
} from '@shared/npd-v3';

const buildPhasesData = (
  phases: SOPPhase[],
  completedPhaseIds: string[] = [],
): Record<string, PhaseData> => {
  const data: Record<string, PhaseData> = {};
  phases.forEach((phase) => {
    const isCompleted = completedPhaseIds.includes(phase.id);
    const tasks: Record<string, boolean> = {};
    const taskDetails: Record<string, TaskDetails> = {};
    phase.tasks.forEach((task) => {
      tasks[task.id] = isCompleted;
      taskDetails[task.id] = { instructions: '', files: [] };
    });
    data[phase.id] = { tasks, taskDetails, notes: '' };
  });
  return data;
};

/**
 * Build initial phase data for a new project based on category.
 */
export const buildPhasesDataForCategory = (
  category: ProjectCategory,
  _currentPhaseId: string,
  completedPhaseIds: string[] = []
): Record<string, PhaseData> => {
  return buildPhasesData(getPhasesForCategory(category), completedPhaseIds);
};

/** Build initial phase state from a concrete project's effective process. */
export const buildPhasesDataForProject = (
  projectLike: ProjectTemplateLike,
  _currentPhaseId: string,
  completedPhaseIds: string[] = [],
): Record<string, PhaseData> =>
  buildPhasesData(getEffectivePhasesForProjectLike(projectLike), completedPhaseIds);

export {
  CATEGORY_MAP,
  DERIVATIVE_PHASES,
  DERIVATIVE_MODULE_TASK_IDS,
  ECO_PHASES,
  IDR_PHASES,
  NPD_PHASES,
  PROJECT_CATEGORIES,
  getPhasesForCategory,
};

export type {
  ProjectCategory,
  ProjectCategoryConfig,
  SOPGateStandard,
  SOPPhase,
  SOPTask,
};
