import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getProjectMetricsData, getPortfolioMetricsData } from "../db";
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

  // getPortfolio 返回全部未归档项目，本端点不做范围过滤——管理层对比工具，范围由前端只在 exec lens 发起查询收口。
  portfolioMetrics: protectedProcedure
    .query(async ({ ctx }) => {
      return getPortfolioMetricsData(ctx.user.id);
    }),
});
