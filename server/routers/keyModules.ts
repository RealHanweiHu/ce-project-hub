import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { KEY_MODULE_STATUSES, KEY_MODULE_TYPE_IDS } from "../../shared/key-modules";
import {
  isSystemAdminRole,
  isSystemExternalRole,
  normalizeSystemRole,
  systemRoleCanCreateProject,
} from "../../shared/system-roles";
import { protectedProcedure, router } from "../_core/trpc";
import {
  KeyModuleServiceError,
  approveKeyModule,
  compareKeyModules,
  confirmKeyModuleTechnical,
  createKeyModule,
  deriveKeyModule,
  getKeyModuleDetail,
  getKeyModuleWhereUsed,
  listKeyModules,
  obsoleteKeyModule,
  reopenKeyModuleDraft,
  restrictKeyModule,
  updateKeyModuleDraft,
} from "../services/key-module-service";

const evidenceRefSchema = z.object({
  type: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(256),
  ref: z.string().trim().min(1).max(2048),
}).strict();

const itemSchema = z.object({
  partNumber: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(256),
  spec: z.string().trim().max(4000).nullish(),
  quantity: z.number().int().positive(),
  refDesignator: z.string().trim().max(128).nullish(),
  componentProductId: z.string().trim().max(32).nullish(),
  sortOrder: z.number().int().min(0).optional(),
}).strict();

const createSchema = z.object({
  id: z.string().trim().min(1).max(32).optional(),
  moduleNumber: z.string().trim().min(1).max(64),
  moduleType: z.enum(KEY_MODULE_TYPE_IDS),
  name: z.string().trim().min(1).max(256),
  category: z.string().trim().max(64).nullish(),
  model: z.string().trim().max(128).nullish(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  evidenceRefs: z.array(evidenceRefSchema).max(50).optional(),
  items: z.array(itemSchema).min(1).max(2000),
}).strict();

const updateSchema = createSchema
  .omit({ id: true, moduleType: true })
  .partial()
  .extend({ id: z.string().trim().min(1).max(32) })
  .strict();

type User = { id: number; role: string; canCreateProject?: boolean | null };

function assertInternalRead(user: User) {
  if (isSystemExternalRole(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "外部协作账号不能访问内部关键模块库" });
  }
}

function assertInternalWrite(user: User) {
  assertInternalRead(user);
  if (normalizeSystemRole(user.role) === "viewer") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只读账号不能维护关键模块" });
  }
}

function assertModuleApprover(user: User) {
  assertInternalWrite(user);
  if (!isSystemAdminRole(user.role) && !systemRoleCanCreateProject(user)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要产品经理或项目经理批准关键模块供项目使用" });
  }
}

async function callService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof KeyModuleServiceError) {
      const code = error.code === "NOT_FOUND"
        ? "NOT_FOUND"
        : error.code === "IMMUTABLE_MODULE" || error.code === "INVALID_STATE"
          ? "CONFLICT"
          : "BAD_REQUEST";
      throw new TRPCError({ code, message: error.message });
    }
    const postgresCode = (error as { cause?: { code?: string } }).cause?.code;
    if (postgresCode === "23505") {
      throw new TRPCError({ code: "CONFLICT", message: "模块编号或内部 BOM 位置已存在" });
    }
    if (postgresCode === "23503") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "引用的产品或部件不存在" });
    }
    throw error;
  }
}

export const keyModulesRouter = router({
  list: protectedProcedure
    .input(z.object({
      query: z.string().trim().max(256).optional(),
      moduleType: z.enum(KEY_MODULE_TYPE_IDS).optional(),
      category: z.string().trim().max(64).optional(),
      statuses: z.array(z.enum(KEY_MODULE_STATUSES)).max(KEY_MODULE_STATUSES.length).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    }).strict())
    .query(({ ctx, input }) => {
      assertInternalRead(ctx.user);
      return callService(() => listKeyModules(input));
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().trim().min(1).max(32) }).strict())
    .query(async ({ ctx, input }) => {
      assertInternalRead(ctx.user);
      const detail = await callService(() => getKeyModuleDetail(input.id));
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "关键模块不存在" });
      return detail;
    }),

  whereUsed: protectedProcedure
    .input(z.object({ id: z.string().trim().min(1).max(32) }).strict())
    .query(({ ctx, input }) => {
      assertInternalRead(ctx.user);
      return callService(() => getKeyModuleWhereUsed(input.id));
    }),

  compare: protectedProcedure
    .input(z.object({ leftId: z.string().trim().min(1), rightId: z.string().trim().min(1) }).strict())
    .query(({ ctx, input }) => {
      assertInternalRead(ctx.user);
      return callService(() => compareKeyModules(input.leftId, input.rightId));
    }),

  create: protectedProcedure
    .input(createSchema)
    .mutation(({ ctx, input }) => {
      assertInternalWrite(ctx.user);
      return callService(() => createKeyModule(input, ctx.user.id));
    }),

  updateDraft: protectedProcedure
    .input(updateSchema)
    .mutation(({ ctx, input }) => {
      assertInternalWrite(ctx.user);
      const { id, ...patch } = input;
      return callService(() => updateKeyModuleDraft(id, patch, ctx.user.id));
    }),

  confirmTechnical: protectedProcedure
    .input(z.object({ id: z.string().trim().min(1).max(32) }).strict())
    .mutation(({ ctx, input }) => {
      assertInternalWrite(ctx.user);
      return callService(() => confirmKeyModuleTechnical(input.id, ctx.user.id));
    }),

  returnToDraft: protectedProcedure
    .input(z.object({ id: z.string().trim().min(1).max(32) }).strict())
    .mutation(({ ctx, input }) => {
      assertModuleApprover(ctx.user);
      return callService(() => reopenKeyModuleDraft(input.id));
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.string().trim().min(1).max(32) }).strict())
    .mutation(({ ctx, input }) => {
      assertModuleApprover(ctx.user);
      return callService(() => approveKeyModule(input.id, ctx.user.id));
    }),

  restrict: protectedProcedure
    .input(z.object({ id: z.string().trim().min(1).max(32), reason: z.string().trim().min(1).max(2000) }).strict())
    .mutation(({ ctx, input }) => {
      assertModuleApprover(ctx.user);
      return callService(() => restrictKeyModule(input.id, input.reason, ctx.user.id));
    }),

  obsolete: protectedProcedure
    .input(z.object({ id: z.string().trim().min(1).max(32), reason: z.string().trim().min(1).max(2000) }).strict())
    .mutation(({ ctx, input }) => {
      assertModuleApprover(ctx.user);
      return callService(() => obsoleteKeyModule(input.id, input.reason, ctx.user.id));
    }),

  derive: protectedProcedure
    .input(z.object({
      sourceId: z.string().trim().min(1).max(32),
      id: z.string().trim().min(1).max(32).optional(),
      moduleNumber: z.string().trim().min(1).max(64),
      name: z.string().trim().min(1).max(256).optional(),
      model: z.string().trim().max(128).nullish(),
    }).strict())
    .mutation(({ ctx, input }) => {
      assertInternalWrite(ctx.user);
      const { sourceId, ...deriveInput } = input;
      return callService(() => deriveKeyModule(sourceId, deriveInput, ctx.user.id));
    }),
});
