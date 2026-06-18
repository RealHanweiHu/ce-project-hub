import "dotenv/config";
import pg from "pg";
import { buildSchedTasks } from "../shared/schedule-graph";
import { getPhasesForCategory } from "../shared/sop-templates";
import { planWorkingCalendarMigration } from "../shared/schedule-migration";

type ProjectRow = {
  id: string;
  name: string;
  category: string;
  startDate: string | Date | null;
};

type TaskRow = {
  id: number;
  projectId: string;
  phaseId: string;
  taskId: string;
  startDate: string | Date | null;
  dueDate: string | Date | null;
};

const { Client } = pg;

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
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

function parseProjectFilter(): Set<string> | null {
  const raw = argValue("--project");
  if (!raw) return null;
  return new Set(raw.split(",").map((item) => item.trim()).filter(Boolean));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const apply = hasArg("--apply");
  const fillMissing = hasArg("--fill-missing");
  const includeArchived = hasArg("--include-archived");
  const projectFilter = parseProjectFilter();

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const projects = (await db.query<ProjectRow>(`
      SELECT id, name, category, "startDate"
      FROM projects
      ${includeArchived ? "" : "WHERE archived = false"}
      ORDER BY "updatedAt" DESC
    `)).rows.filter((project) => !projectFilter || projectFilter.has(project.id));
    const projectIds = projects.map((project) => project.id);
    const tasks = projectIds.length === 0 ? [] : (await db.query<TaskRow>(`
      SELECT id, "projectId", "phaseId", "taskId", "startDate", "dueDate"
      FROM project_tasks
      WHERE "projectId" = ANY($1)
    `, [projectIds])).rows;

    const tasksByProject = new Map<string, TaskRow[]>();
    for (const task of tasks) {
      const list = tasksByProject.get(task.projectId) ?? [];
      list.push(task);
      tasksByProject.set(task.projectId, list);
    }

    const projectSummaries: unknown[] = [];
    let plannedUpdates = 0;
    let appliedUpdates = 0;
    let plannedFillMissing = 0;
    let appliedFillMissing = 0;
    let manualOrUnknown = 0;

    if (apply) await db.query("BEGIN");
    try {
      for (const project of projects) {
        const startDate = toISODate(project.startDate);
        if (!startDate) continue;
        const rows = tasksByProject.get(project.id) ?? [];
        const rowByTaskId = new Map(rows.map((row) => [row.taskId, row]));
        const plan = planWorkingCalendarMigration({
          tasks: buildSchedTasks(getPhasesForCategory(project.category)),
          startDate,
          current: rows.map((row) => ({
            taskId: row.taskId,
            startDate: toISODate(row.startDate),
            dueDate: toISODate(row.dueDate),
          })),
        });
        plannedUpdates += plan.updates.length;
        plannedFillMissing += plan.missingSchedule.length;
        manualOrUnknown += plan.manualOrUnknown.length;

        let appliedForProject = 0;
        let filledForProject = 0;
        if (apply) {
          for (const update of plan.updates) {
            const row = rowByTaskId.get(update.taskId);
            if (!row) continue;
            const result = await db.query(`
              UPDATE project_tasks
              SET "startDate" = $1::date,
                  "dueDate" = $2::date,
                  "updatedAt" = now()
              WHERE id = $3
                AND "startDate" IS NOT DISTINCT FROM $4::date
                AND "dueDate" IS NOT DISTINCT FROM $5::date
            `, [update.to.start, update.to.due, row.id, update.from.start, update.from.due]);
            appliedForProject += result.rowCount ?? 0;
          }
          if (fillMissing) {
            for (const missing of plan.missingSchedule) {
              const row = rowByTaskId.get(missing.taskId);
              if (!row) continue;
              const result = await db.query(`
                UPDATE project_tasks
                SET "startDate" = $1::date,
                    "dueDate" = $2::date,
                    "updatedAt" = now()
                WHERE id = $3
                  AND "startDate" IS NULL
                  AND "dueDate" IS NULL
              `, [missing.to.start, missing.to.due, row.id]);
              filledForProject += result.rowCount ?? 0;
            }
          }
          appliedUpdates += appliedForProject;
          appliedFillMissing += filledForProject;
        }

        if (plan.updates.length > 0 || plan.missingSchedule.length > 0 || plan.manualOrUnknown.length > 0) {
          projectSummaries.push({
            projectId: project.id,
            name: project.name,
            plannedUpdates: plan.updates.length,
            appliedUpdates: appliedForProject,
            plannedFillMissing: plan.missingSchedule.length,
            appliedFillMissing: filledForProject,
            alreadyWorking: plan.alreadyWorking.length,
            manualOrUnknown: plan.manualOrUnknown.length,
            sampleUpdates: plan.updates.slice(0, 5),
            sampleMissing: plan.missingSchedule.slice(0, 5),
            sampleSkipped: plan.manualOrUnknown.slice(0, 5),
          });
        }
      }
      if (apply) await db.query("COMMIT");
    } catch (error) {
      if (apply) await db.query("ROLLBACK");
      throw error;
    }

    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      fillMissing,
      auditedProjects: projects.length,
      plannedUpdates,
      appliedUpdates,
      plannedFillMissing,
      appliedFillMissing,
      manualOrUnknown,
      projects: projectSummaries,
    }, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
