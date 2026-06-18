import "dotenv/config";
import pg from "pg";
import { getPhasesForCategory, getReleaseGatePhase } from "../shared/sop-templates";
import { buildSchedTasks } from "../shared/schedule-graph";
import { planWorkingCalendarMigration } from "../shared/schedule-migration";

type ProjectRow = {
  id: string;
  name: string;
  category: string;
  startDate: string | Date | null;
};

type TaskRow = {
  projectId: string;
  phaseId: string;
  taskId: string;
  startDate: string | Date | null;
  dueDate: string | Date | null;
  status: string;
  completed: boolean;
  completedAt: Date | null;
};

type TailoringRow = {
  id: number;
  projectId: string;
  targets: Array<{ scope: "phase"; phaseId: string } | { scope: "task"; phaseId: string; taskId: string }>;
};

const { Client } = pg;

function summarize<T>(items: T[], limit = 20) {
  return {
    count: items.length,
    sample: items.slice(0, limit),
  };
}

function toISODate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(fmt.formatToParts(value).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  return String(value).slice(0, 10);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const projects = (await db.query<ProjectRow>(`
      SELECT id, name, category, "startDate"
      FROM projects
      WHERE archived = false
      ORDER BY "updatedAt" DESC
    `)).rows;
    const tasks = (await db.query<TaskRow>(`
      SELECT "projectId", "phaseId", "taskId", "startDate", "dueDate", status, completed, "completedAt"
      FROM project_tasks
      WHERE "projectId" = ANY($1)
    `, [projects.map((p) => p.id)])).rows;
    const tailoring = (await db.query<TailoringRow>(`
      SELECT id, "projectId", targets
      FROM project_tailoring
      WHERE status = 'approved'
        AND "projectId" = ANY($1)
    `, [projects.map((p) => p.id)])).rows;

    const projectById = new Map(projects.map((p) => [p.id, p]));
    const tasksByProject = new Map<string, TaskRow[]>();
    for (const task of tasks) {
      const list = tasksByProject.get(task.projectId) ?? [];
      list.push(task);
      tasksByProject.set(task.projectId, list);
    }

    const releaseGateTailoring: unknown[] = [];
    const trailingPhaseTailoring: unknown[] = [];
    for (const row of tailoring) {
      const project = projectById.get(row.projectId);
      if (!project) continue;
      const release = getReleaseGatePhase(project.category);
      const phases = getPhasesForCategory(project.category);
      const trailingPhaseId = phases[phases.length - 1]?.id;
      for (const target of row.targets ?? []) {
        if (release && target.scope === "phase" && target.phaseId === release.id) {
          releaseGateTailoring.push({ projectId: row.projectId, tailoringId: row.id, target });
        }
        if (release && target.scope === "task" && target.phaseId === release.id && target.taskId === release.gateTaskId) {
          releaseGateTailoring.push({ projectId: row.projectId, tailoringId: row.id, target });
        }
        if (target.scope === "phase" && target.phaseId === trailingPhaseId) {
          trailingPhaseTailoring.push({ projectId: row.projectId, tailoringId: row.id, target });
        }
      }
    }

    const migrationPreview: unknown[] = [];
    for (const project of projects) {
      const projectStart = toISODate(project.startDate);
      if (!projectStart) continue;
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const plan = planWorkingCalendarMigration({
        tasks: buildSchedTasks(getPhasesForCategory(project.category)),
        startDate: projectStart,
        current: projectTasks.map((task) => ({
          taskId: task.taskId,
          startDate: toISODate(task.startDate),
          dueDate: toISODate(task.dueDate),
        })),
      });
      if (plan.updates.length > 0 || plan.missingSchedule.length > 0 || plan.manualOrUnknown.length > 0) {
        migrationPreview.push({
          projectId: project.id,
          name: project.name,
          updates: plan.updates.length,
          alreadyWorking: plan.alreadyWorking.length,
          missingSchedule: plan.missingSchedule.length,
          manualOrUnknown: plan.manualOrUnknown.length,
          sampleUpdates: plan.updates.slice(0, 5),
          sampleMissing: plan.missingSchedule.slice(0, 5),
          sampleSkipped: plan.manualOrUnknown.slice(0, 5),
        });
      }
    }

    const doneWithoutCompletedAt = tasks
      .filter((task) => (task.completed || task.status === "done" || task.status === "skipped") && !task.completedAt)
      .map((task) => ({
        projectId: task.projectId,
        taskId: task.taskId,
        status: task.status,
        dueDate: toISODate(task.dueDate),
      }));

    console.log(JSON.stringify({
      auditedProjects: projects.length,
      releaseGateTailoring: summarize(releaseGateTailoring),
      trailingPhaseTailoring: summarize(trailingPhaseTailoring),
      migrationPreview: summarize(migrationPreview),
      doneWithoutCompletedAt: summarize(doneWithoutCompletedAt),
    }, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
