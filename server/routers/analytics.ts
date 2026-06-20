import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getProjectMetricsData } from "../db";
import { assertProjectAccess } from "../project-access";
import { computeProjectMetrics } from "../../shared/metrics";
import { defaultFromISO, shanghaiTodayISO } from "../metrics-window";

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
