import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  isSystemAdminRole,
  isSystemExternalRole,
  systemRoleCanCreateProject,
  type AnySystemRole,
} from "../../shared/system-roles";
import {
  listProjectCollections,
  getProjectCollection,
  createProjectCollection,
  updateProjectCollection,
  deleteProjectCollection,
  addProjectsToCollection,
  removeProjectFromCollection,
  listCollectionProjects,
  listProjectCollectionAssignments,
  getProjectsByMember,
} from "../db";

const nameSchema = z.string().trim().min(1, "名称不能为空").max(128);

/** 外部协作账号不可见项目集（集合名可能含客户/商业信息）。 */
function assertCanView(user: { role?: AnySystemRole }) {
  if (isSystemExternalRole(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "外部协作账号无法查看项目集" });
  }
}

/** 管理门禁与「创建项目」一致：管理员或被授予 canCreateProject 的用户。 */
function assertCanManage(user: { role?: AnySystemRole; canCreateProject?: boolean | null }) {
  if (!systemRoleCanCreateProject(user)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "您没有管理项目集的权限。请联系管理员授权。" });
  }
}

function isUniqueNameViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const anyErr = cur as { code?: string; constraint?: string; message?: string; cause?: unknown };
    if (anyErr.code === "23505" || anyErr.constraint === "uq_project_collection_name") return true;
    if (typeof anyErr.message === "string" && anyErr.message.includes("uq_project_collection_name")) return true;
    cur = anyErr.cause;
  }
  return false;
}

async function requireCollection(id: string) {
  const collection = await getProjectCollection(id);
  if (!collection) throw new TRPCError({ code: "NOT_FOUND", message: "项目集不存在" });
  return collection;
}

export const projectCollectionsRouter = router({
  /** 项目集列表（含项目数）。内部登录用户可见。 */
  list: protectedProcedure.query(async ({ ctx }) => {
    assertCanView(ctx.user);
    return listProjectCollections();
  }),

  /** 当前项目归属，用于在重新归类前明确提示“将从原项目集移入”。 */
  assignments: protectedProcedure.query(async ({ ctx }) => {
    assertCanView(ctx.user);
    const rows = await listProjectCollectionAssignments();
    if (isSystemAdminRole(ctx.user.role)) return rows;
    const accessible = new Set((await getProjectsByMember(ctx.user.id)).map((project) => project.id));
    return rows.filter((row) => accessible.has(row.projectId));
  }),

  /** 项目集详情：集合 + 成员项目。非管理员只看到自己有权限的项目，其余计入 hiddenCount。 */
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    assertCanView(ctx.user);
    const collection = await requireCollection(input.id);
    const allProjects = await listCollectionProjects(input.id);
    if (isSystemAdminRole(ctx.user.role)) {
      return { collection, projects: allProjects, hiddenCount: 0 };
    }
    const accessible = new Set((await getProjectsByMember(ctx.user.id)).map((p) => p.id));
    const visible = allProjects.filter((p) => accessible.has(p.id));
    return { collection, projects: visible, hiddenCount: allProjects.length - visible.length };
  }),

  create: protectedProcedure
    .input(z.object({ name: nameSchema, description: z.string().trim().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx.user);
      try {
        const id = await createProjectCollection({
          name: input.name,
          description: input.description || null,
          createdBy: ctx.user.id,
        });
        return { id };
      } catch (err) {
        if (isUniqueNameViolation(err)) {
          throw new TRPCError({ code: "CONFLICT", message: "同名项目集已存在" });
        }
        throw err;
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        patch: z.object({
          name: nameSchema.optional(),
          description: z.string().trim().max(2000).nullable().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx.user);
      await requireCollection(input.id);
      try {
        await updateProjectCollection(input.id, input.patch);
      } catch (err) {
        if (isUniqueNameViolation(err)) {
          throw new TRPCError({ code: "CONFLICT", message: "同名项目集已存在" });
        }
        throw err;
      }
      return { success: true } as const;
    }),

  /** 删除项目集（仅解除分组，不影响项目本身）。 */
  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertCanManage(ctx.user);
    await requireCollection(input.id);
    await deleteProjectCollection(input.id);
    return { success: true } as const;
  }),

  /** 把项目加入项目集（幂等）。非管理员只能加入自己有权限的项目。 */
  addProjects: protectedProcedure
    .input(z.object({ id: z.string(), projectIds: z.array(z.string()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx.user);
      await requireCollection(input.id);
      if (!isSystemAdminRole(ctx.user.role)) {
        const accessible = new Set((await getProjectsByMember(ctx.user.id)).map((p) => p.id));
        const denied = input.projectIds.filter((pid) => !accessible.has(pid));
        if (denied.length > 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只能将您有权限的项目加入项目集" });
        }
      }
      await addProjectsToCollection(input.id, input.projectIds, ctx.user.id);
      return { success: true } as const;
    }),

  removeProject: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx.user);
      await requireCollection(input.id);
      if (!isSystemAdminRole(ctx.user.role)) {
        const accessible = new Set((await getProjectsByMember(ctx.user.id)).map((project) => project.id));
        if (!accessible.has(input.projectId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只能调整您有权限的项目" });
        }
      }
      await removeProjectFromCollection(input.id, input.projectId);
      return { success: true } as const;
    }),
});
