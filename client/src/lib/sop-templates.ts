import {
  CATEGORY_MAP,
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

/**
 * Build initial phase data for a new project based on category.
 */
export const buildPhasesDataForCategory = (
  category: ProjectCategory,
  currentPhaseId: string,
  completedPhaseIds: string[] = []
): Record<string, PhaseData> => {
  const phases = getPhasesForCategory(category);
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

export {
  CATEGORY_MAP,
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
