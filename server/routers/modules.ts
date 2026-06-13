import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  seedModuleLibrary, listModuleLibrary, getModuleTasks,
  setProjectModule, listProjectModules,
} from "../db";

export const modulesRouter = router({
  /** 模块库（每模块带任务块） */
  library: protectedProcedure.query(async () => {
    const mods = await listModuleLibrary();
    const withTasks = await Promise.all(
      mods.map(async (m) => ({ ...m, tasks: await getModuleTasks(m.moduleKey) }))
    );
    return withTasks;
  }),

  /** 某项目的复用集声明 */
  projectModules: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => listProjectModules(input.projectId)),

  /** 声明某模块的变更等级 */
  setProjectModule: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      moduleKey: z.string(),
      changeLevel: z.enum(["carryover", "reuse_verify", "minor", "redesign", "new"]),
      reusedRevisionId: z.number().int().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      await setProjectModule(input.projectId, input.moduleKey, input.changeLevel, input.reusedRevisionId ?? null);
      return { ok: true };
    }),

  /** 一次性填充模块库（管理员） */
  seed: adminProcedure.mutation(async () => {
    await seedModuleLibrary();
    return { ok: true };
  }),
});
