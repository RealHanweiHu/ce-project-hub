import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getManagementKpisData, getPortfolio, getProjectMetricsData, getPortfolioMetricsData } from "../db";
import { assertProjectAccess } from "../project-access";
import { computeProjectMetrics } from "../../shared/metrics";
import { isSystemAdminRole } from "../../shared/system-roles";
import { defaultFromISO, shanghaiTodayISO } from "../metrics-window";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const analyticsRouter = router({
  projectMetrics: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      fromISO: isoDateSchema.optional(),
      toISO: isoDateSchema.optional(),
      phaseId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      const todayISO = shanghaiTodayISO();
      const toISO = input.toISO ?? todayISO;
      const raw = await getProjectMetricsData(input.projectId, input.fromISO ?? "", toISO, input.phaseId);
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

  managementKpis: protectedProcedure
    .query(async ({ ctx }) => {
      const portfolio = await getPortfolio(ctx.user.id);
      const canViewManagementKpis = isSystemAdminRole(ctx.user.role)
        || portfolio.some((row) => row.myRole === "owner" || row.myRole === "manager");
      if (!canViewManagementKpis) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有管理层可以查看组合决策 KPI" });
      }
      return getManagementKpisData(ctx.user.id);
    }),
});
