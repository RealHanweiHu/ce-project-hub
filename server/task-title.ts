import type { ProjectTemplateLike } from "../shared/npd-v3";
import { resolveProjectTask } from "../shared/sop-template-resolution";

export type TaskDisplayTitleInput = {
  taskId?: string | null;
  phaseId?: string | null;
  /** Project-bound template context (version + tier/add-on custom fields). */
  projectLike?: ProjectTemplateLike | null;
  /** @deprecated Prefer projectLike; retained for historical event payloads. */
  projectCategory?: string | null;
  /** @deprecated Prefer projectLike; retained for flat query rows. */
  sopTemplateVersion?: string | null;
  /** @deprecated Prefer projectLike; retained for flat query rows. */
  customFields?: unknown;
  instructions?: string | null;
};

export function taskDisplayTitle(task: TaskDisplayTitleInput): string {
  const taskId = String(task.taskId ?? "").trim();
  const normalizedTaskId = taskId.toLowerCase();

  if (normalizedTaskId) {
    const projectLike = task.projectLike ?? {
      category: task.projectCategory,
      sopTemplateVersion: task.sopTemplateVersion,
      customFields: task.customFields,
    };
    const matchedTask = resolveProjectTask(projectLike, taskId, task.phaseId);
    if (matchedTask?.name) return matchedTask.name;
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
