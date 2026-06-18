import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getProjectMetricsData } from "../db";
import { assertProjectAccess } from "../project-access";
import { computeProjectMetrics } from "../../shared/metrics";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const analyticsRouter = router({
  projectMetrics: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      fromISO: isoDateSchema.optional(),
      toISO: isoDateSchema.optional(),
    }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      const todayISO = shanghaiTodayISO();
      const toISO = input.toISO ?? todayISO;
      const raw = await getProjectMetricsData(input.projectId, input.fromISO ?? "", toISO);
      const fromISO = input.fromISO ?? defaultFromISO(access.project.startDate, raw, toISO);

      return computeProjectMetrics({
        ...raw,
        window: { fromISO, toISO },
      });
    }),
});

function defaultFromISO(
  projectStartDate: string | null,
  raw: Awaited<ReturnType<typeof getProjectMetricsData>>,
  fallbackISO: string,
) {
  const projectStart = toISODate(projectStartDate);
  if (projectStart) return projectStart;

  const earliest = minISO([
    ...raw.tasks.map((task) => task.createdAt),
    ...raw.issues.map((issue) => issue.foundDate),
    ...raw.issues.map((issue) => issue.closedDate),
    ...raw.phases.map((phase) => phase.startDate),
  ]);
  return earliest ?? fallbackISO;
}

function shanghaiTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toISODate(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function minISO(values: Array<string | null | undefined>) {
  const dates = values.map(toISODate).filter((value): value is string => !!value);
  return dates.length > 0 ? dates.sort()[0] : null;
}
