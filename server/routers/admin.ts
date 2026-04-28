import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

/** Middleware: only system admins can call these procedures */
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "仅系统管理员可执行此操作",
    });
  }
  return next({ ctx });
});

export const adminRouter = router({
  /** List users for project manager selection (any logged-in user can call) */
  listUsersForSelect: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
      })
      .from(users)
      .orderBy(users.name);
    return rows;
  }),

  /** List all registered users (admin only) */
  listUsers: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email,
        role: users.role,
        canCreateProject: users.canCreateProject,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .orderBy(desc(users.lastSignedIn));
    return rows;
  }),

  /** Grant or revoke a user's ability to create projects (admin only) */
  setCanCreateProject: adminProcedure
    .input(z.object({
      userId: z.number(),
      canCreate: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(users)
        .set({ canCreateProject: input.canCreate })
        .where(eq(users.id, input.userId));
      return { success: true };
    }),

  /** Promote or demote a user's system role (admin only) */
  setUserRole: adminProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(["user", "admin"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Prevent self-demotion
      if (input.userId === ctx.user.id && input.role !== "admin") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能撤销自己的管理员权限",
        });
      }
      // When promoting to admin, also grant canCreateProject automatically
      const updates: Partial<typeof users.$inferInsert> = { role: input.role };
      if (input.role === 'admin') {
        updates.canCreateProject = true;
      }
      await db
        .update(users)
        .set(updates)
        .where(eq(users.id, input.userId));
      return { success: true };
    }),
});
