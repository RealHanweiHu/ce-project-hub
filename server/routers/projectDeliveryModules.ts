import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { KEY_MODULE_TYPE_IDS } from "../../shared/key-modules";
import { isSystemExternalRole } from "../../shared/system-roles";
import { protectedProcedure, router } from "../_core/trpc";
import { canRoleViewInternalWorkspace } from "../file-visibility";
import { assertProjectAccess, assertProjectPermission } from "../project-access";
import {
  ProjectDeliveryModuleError,
  bindProjectDeliveryModule,
  listProjectDeliveryModuleBindings,
  unbindProjectDeliveryModule,
} from "../services/project-delivery-module-service";

async function callService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof ProjectDeliveryModuleError) {
      const code = error.code === "NOT_FOUND"
        ? "NOT_FOUND"
        : error.code === "PROJECT_RELEASED" || error.code === "MODULE_NOT_APPROVED" || error.code === "REQUIRED_BASELINE"
          ? "CONFLICT"
          : "BAD_REQUEST";
      throw new TRPCError({ code, message: error.message });
    }
    throw error;
  }
}

const projectModuleSlotSchema = z.object({
  projectId: z.string().trim().min(1).max(32),
  moduleType: z.enum(KEY_MODULE_TYPE_IDS),
}).strict();

const customerConfirmationSchema = z.object({
  customerConfirmationRef: z.string().trim().min(1).max(2048).optional(),
});

function assertInternalSystemUser(user: { role: string }) {
  if (isSystemExternalRole(user.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "外部协作账号不能访问内部产品交付模块",
    });
  }
}

export const projectDeliveryModulesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().trim().min(1).max(32) }).strict())
    .query(async ({ ctx, input }) => {
      assertInternalSystemUser(ctx.user);
      const access = await assertProjectAccess(input.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "外部协作角色不能查看内部受控模块" });
      }
      return callService(() => listProjectDeliveryModuleBindings(input.projectId));
    }),

  bind: protectedProcedure
    .input(projectModuleSlotSchema.extend({
      moduleId: z.string().trim().min(1).max(32),
      ...customerConfirmationSchema.shape,
    }).strict())
    .mutation(async ({ ctx, input }) => {
      assertInternalSystemUser(ctx.user);
      await assertProjectPermission(
        input.projectId,
        ctx.user,
        "canEditProjectInfo",
        "只有产品负责人或项目管理者可以确认产品交付模块",
      );
      return callService(() => bindProjectDeliveryModule({ ...input, actorId: ctx.user.id }));
    }),

  unbind: protectedProcedure
    .input(projectModuleSlotSchema.extend(customerConfirmationSchema.shape).strict())
    .mutation(async ({ ctx, input }) => {
      assertInternalSystemUser(ctx.user);
      await assertProjectPermission(
        input.projectId,
        ctx.user,
        "canEditProjectInfo",
        "只有产品负责人或项目管理者可以调整产品交付模块",
      );
      await callService(() => unbindProjectDeliveryModule({ ...input, actorId: ctx.user.id }));
      return { ok: true };
    }),
});
