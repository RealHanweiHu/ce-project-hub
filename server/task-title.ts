import { getPhasesForCategory } from "../shared/sop-templates";

export type TaskDisplayTitleInput = {
  taskId?: string | null;
  phaseId?: string | null;
  projectCategory?: string | null;
  instructions?: string | null;
};

export function taskDisplayTitle(task: TaskDisplayTitleInput): string {
  const taskId = String(task.taskId ?? "").trim();
  const normalizedTaskId = taskId.toLowerCase();

  if (normalizedTaskId) {
    const phases = getPhasesForCategory(task.projectCategory ?? undefined);
    const phaseId = task.phaseId?.trim();
    const orderedPhases = phaseId
      ? [
          ...phases.filter((phase) => phase.id === phaseId),
          ...phases.filter((phase) => phase.id !== phaseId),
        ]
      : phases;

    for (const phase of orderedPhases) {
      const matchedTask = phase.tasks.find((candidate) => candidate.id.toLowerCase() === normalizedTaskId);
      if (matchedTask?.name) return matchedTask.name;
    }
  }

  const instructionTitle = firstMarkdownHeading(task.instructions);
  if (instructionTitle) return instructionTitle;

  return taskId || "任务";
}

function firstMarkdownHeading(markdown?: string | null): string | null {
  if (!markdown) return null;
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}
