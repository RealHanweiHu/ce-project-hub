/**
 * Server-side SOP template access.
 * The actual templates live in shared/sop-templates.ts so frontend display and
 * backend seeding cannot drift apart.
 */

import { getPhasesForCategory } from "../shared/sop-templates";

export interface SopTask {
  id: string;
  visibleRoles: string[];
}

export interface SopPhase {
  id: string;
  tasks: SopTask[];
}

/**
 * Get SOP phases for a project category.
 * Falls back to NPD if category is unknown.
 */
export function getSopPhasesForCategory(category: string): SopPhase[] {
  return getPhasesForCategory(category).map((phase) => ({
    id: phase.id,
    tasks: phase.tasks.map((task) => ({
      id: task.id,
      visibleRoles: task.visibleRoles ?? [],
    })),
  }));
}
