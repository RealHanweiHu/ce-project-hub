import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { SYSTEM_ROLES, isSystemAdminRole, isSystemExternalRole } from "../../shared/system-roles";

const DINGTALK_APPROVAL_BUSINESS_TYPES = [
  "mp_release",
  "task_approval",
  "deliverable_review",
  "issue_validation",
  "gate_override",
] as const;
import {
  createUserWithPassword,
  getDb,
  getUserByEmail,
  getUserByUsername,
  listApprovalConfigs,
  upsertApprovalConfig,
} from "../db";
import { hashPassword } from "../_core/password";
import {
  users,
  projectMembers,
  projects,
  projectCalendarEvents,
  projectTailoring,
  projectDeliverableOverrides,
  projectTasks,
  projectIssues,
  projectRisks,
  projectRequirements,
  projectGateReviews,
  projectChangelog,
  projectFiles,
  activityLogs,
  organizations,
  projectDeliverableReviews,
  platforms,
  products,
  productDefinitions,
  productDefinitionSnapshots,
  productDefinitionChanges,
  productRevisions,
  mpReleases,
  customerVariants,
  comments,
  notifications,
  automationRules,
  calendarExceptions as calendarExceptionsTable,
} from "../../drizzle/schema";
import { eq, desc, and, notInArray, or, like, inArray, sql as drizzleSql } from "drizzle-orm";

/** Middleware: only system admins can call these procedures */
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isSystemAdminRole(ctx.user.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "仅系统管理员可执行此操作",
    });
  }
  return next({ ctx });
});

export const adminRouter = router({
  /**
   * Search registered users for project invite.
   * Returns up to 10 matches on name/username/email, excluding existing members.
   * Any logged-in user can call this.
   */
  searchUsersForInvite: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(50),
      projectId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      if (isSystemExternalRole(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "外部协作账号不能搜索内部用户" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Collect existing member userIds AND project owner to exclude
      const [existingMembers, projectRow] = await Promise.all([
        db
          .select({ userId: projectMembers.userId })
          .from(projectMembers)
          .where(eq(projectMembers.projectId, input.projectId)),
        db
          .select({ createdBy: projects.createdBy })
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .limit(1),
      ]);
      const ownerIds: number[] = projectRow.length > 0 && projectRow[0].createdBy != null
        ? [projectRow[0].createdBy]
        : [];
      const existingIds = [
        ...existingMembers.map((m) => m.userId),
        ...ownerIds,
      ].filter((id, i, arr) => arr.indexOf(id) === i); // deduplicate
      const q = `%${input.query}%`;
      const matchCondition = or(
        like(users.name, q),
        like(users.username, q),
        like(users.email, q),
      )!;
      const whereClause = existingIds.length > 0
        ? and(matchCondition, notInArray(users.id, existingIds))!
        : matchCondition;
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          email: users.email,
        })
        .from(users)
        .where(whereClause)
        .orderBy(users.name)
        .limit(10);
      return rows;
    }),

  /** List users for project manager selection (any logged-in user can call) */
  listUsersForSelect: protectedProcedure.query(async ({ ctx }) => {
    if (isSystemExternalRole(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "外部协作账号不能查看内部用户" });
    }
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
        mobile: users.mobile,
        role: users.role,
        canCreateProject: users.canCreateProject,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .orderBy(desc(users.lastSignedIn));
    return rows;
  }),

  /** Create a user account (admin only) */
  createUser: adminProcedure
    .input(z.object({
      username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.\-]+$/, "用户名只能包含字母、数字、下划线、点和横线"),
      password: z.string().min(6, "密码至少6位"),
      name: z.string().trim().min(1, "请输入显示名称").max(64),
      email: z.string().trim().email("请输入有效的邮箱地址").toLowerCase().optional(),
      mobile: z.string().trim().max(32).optional(),
      role: z.enum(SYSTEM_ROLES).default("member"),
      canCreateProject: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const existing = await getUserByUsername(input.username);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "用户名已存在" });
      }
      if (input.email) {
        const existingEmail = await getUserByEmail(input.email);
        if (existingEmail) {
          throw new TRPCError({ code: "CONFLICT", message: "该邮箱地址已被占用" });
        }
      }
      const passwordHash = await hashPassword(input.password);
      await createUserWithPassword({
        username: input.username,
        passwordHash,
        name: input.name,
        email: input.email ?? null,
        mobile: input.mobile?.trim() || null,
        role: input.role,
        canCreateProject: isSystemAdminRole(input.role) || input.canCreateProject,
      });
      return { success: true } as const;
    }),

  /** Delete a user account and clean all user references in RDS (admin only) */
  deleteUser: adminProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [target] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      }
      if (target.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能删除自己的账号" });
      }
      if (isSystemAdminRole(target.role)) {
        const admins = await db
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.role, ["owner", "admin"]));
        if (admins.length <= 1) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不能删除最后一个拥有者/管理员" });
        }
      }

      const replacementUserId = ctx.user.id;
      await db.transaction(async (tx) => {
        // User-owned collaboration rows can be removed; business records keep their history
        // while references to the deleted account are cleared or transferred to this admin.
        await tx.execute(drizzleSql`
          UPDATE "comments"
          SET "mentions" = COALESCE((
            SELECT jsonb_agg(mention_values.value::int)
            FROM jsonb_array_elements_text(COALESCE("comments"."mentions", '[]'::jsonb)) AS mention_values(value)
            WHERE mention_values.value::int <> ${input.userId}
          ), '[]'::jsonb)
          WHERE COALESCE("comments"."mentions", '[]'::jsonb) @> ${JSON.stringify([input.userId])}::jsonb
        `);

        await tx.delete(notifications).where(eq(notifications.userId, input.userId));
        await tx.delete(activityLogs).where(eq(activityLogs.userId, input.userId));
        await tx.delete(comments).where(eq(comments.authorId, input.userId));

        await tx.update(projectMembers)
          .set({ invitedBy: replacementUserId })
          .where(eq(projectMembers.invitedBy, input.userId));
        await tx.delete(projectMembers).where(eq(projectMembers.userId, input.userId));

        await tx.update(projects)
          .set({ pmUserId: null })
          .where(eq(projects.pmUserId, input.userId));
        await tx.update(projects)
          .set({ riskOverrideUpdatedBy: null })
          .where(eq(projects.riskOverrideUpdatedBy, input.userId));
        await tx.update(projects)
          .set({ createdBy: replacementUserId })
          .where(eq(projects.createdBy, input.userId));

        await tx.update(projectCalendarEvents)
          .set({ organizerUserId: replacementUserId })
          .where(eq(projectCalendarEvents.organizerUserId, input.userId));
        await tx.update(projectCalendarEvents)
          .set({ createdBy: replacementUserId })
          .where(eq(projectCalendarEvents.createdBy, input.userId));

        await tx.update(calendarExceptionsTable)
          .set({ createdBy: null })
          .where(eq(calendarExceptionsTable.createdBy, input.userId));

        await tx.update(projectTailoring)
          .set({ proposedBy: replacementUserId })
          .where(eq(projectTailoring.proposedBy, input.userId));
        await tx.update(projectTailoring)
          .set({ reviewedBy: null })
          .where(eq(projectTailoring.reviewedBy, input.userId));

        await tx.update(projectDeliverableOverrides)
          .set({ createdBy: replacementUserId })
          .where(eq(projectDeliverableOverrides.createdBy, input.userId));

        await tx.update(projectDeliverableReviews)
          .set({ reviewerUserId: replacementUserId })
          .where(eq(projectDeliverableReviews.reviewerUserId, input.userId));
        await tx.update(projectDeliverableReviews)
          .set({ submittedBy: replacementUserId })
          .where(eq(projectDeliverableReviews.submittedBy, input.userId));
        await tx.update(projectDeliverableReviews)
          .set({ reviewedBy: null })
          .where(eq(projectDeliverableReviews.reviewedBy, input.userId));

        await tx.update(projectTasks)
          .set({ assigneeUserId: null })
          .where(eq(projectTasks.assigneeUserId, input.userId));
        await tx.update(projectTasks)
          .set({ updatedBy: null })
          .where(eq(projectTasks.updatedBy, input.userId));
        await tx.update(projectTasks)
          .set({ approverUserId: null })
          .where(eq(projectTasks.approverUserId, input.userId));
        await tx.update(projectTasks)
          .set({ approvalRequestedBy: null })
          .where(eq(projectTasks.approvalRequestedBy, input.userId));
        await tx.update(projectTasks)
          .set({ approvalDecidedBy: null })
          .where(eq(projectTasks.approvalDecidedBy, input.userId));

        await tx.update(projectIssues)
          .set({ creatorId: null })
          .where(eq(projectIssues.creatorId, input.userId));
        await tx.update(projectRisks)
          .set({ creatorId: null })
          .where(eq(projectRisks.creatorId, input.userId));
        await tx.update(projectRequirements)
          .set({ creatorId: null })
          .where(eq(projectRequirements.creatorId, input.userId));
        await tx.update(projectGateReviews)
          .set({ createdBy: null })
          .where(eq(projectGateReviews.createdBy, input.userId));
        await tx.update(projectChangelog)
          .set({ creatorId: null })
          .where(eq(projectChangelog.creatorId, input.userId));
        await tx.update(projectFiles)
          .set({ uploadedBy: replacementUserId })
          .where(eq(projectFiles.uploadedBy, input.userId));

        await tx.update(organizations)
          .set({ ownerId: replacementUserId })
          .where(eq(organizations.ownerId, input.userId));
        await tx.update(platforms)
          .set({ createdBy: replacementUserId })
          .where(eq(platforms.createdBy, input.userId));
        await tx.update(products)
          .set({ createdBy: replacementUserId })
          .where(eq(products.createdBy, input.userId));
        await tx.update(productDefinitions)
          .set({ confirmedBy: null })
          .where(eq(productDefinitions.confirmedBy, input.userId));
        await tx.update(productDefinitions)
          .set({ createdBy: replacementUserId })
          .where(eq(productDefinitions.createdBy, input.userId));
        await tx.update(productDefinitionSnapshots)
          .set({ confirmedBy: replacementUserId })
          .where(eq(productDefinitionSnapshots.confirmedBy, input.userId));
        await tx.update(productDefinitionChanges)
          .set({ approvedBy: null })
          .where(eq(productDefinitionChanges.approvedBy, input.userId));
        await tx.update(productDefinitionChanges)
          .set({ createdBy: replacementUserId })
          .where(eq(productDefinitionChanges.createdBy, input.userId));
        await tx.update(productRevisions)
          .set({ releasedBy: null })
          .where(eq(productRevisions.releasedBy, input.userId));
        await tx.update(mpReleases)
          .set({ acceptedBy: null })
          .where(eq(mpReleases.acceptedBy, input.userId));
        await tx.update(mpReleases)
          .set({ followUpOwner: null })
          .where(eq(mpReleases.followUpOwner, input.userId));
        await tx.update(mpReleases)
          .set({ releasedBy: replacementUserId })
          .where(eq(mpReleases.releasedBy, input.userId));
        await tx.update(customerVariants)
          .set({ createdBy: replacementUserId })
          .where(eq(customerVariants.createdBy, input.userId));
        await tx.update(automationRules)
          .set({ updatedBy: null })
          .where(eq(automationRules.updatedBy, input.userId));

        await tx.delete(users).where(eq(users.id, input.userId));
      });

      return { success: true } as const;
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
      const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      if (isSystemAdminRole(target.role) && !input.canCreate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "拥有者/管理员默认拥有项目创建权限" });
      }
      if ((target.role === "external" || target.role === "viewer") && input.canCreate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "外部/只读账号不能创建项目" });
      }
      await db
        .update(users)
        .set({ canCreateProject: input.canCreate })
        .where(eq(users.id, input.userId));
      return { success: true };
    }),

  /** Admin CRUD for DingTalk approval process mappings */
  approvalConfigs: router({
    list: adminProcedure.query(async () => {
      const rows = await listApprovalConfigs();
      const existing = new Map(rows.map((row) => [row.businessType, row]));
      return DINGTALK_APPROVAL_BUSINESS_TYPES.map((businessType) => (
        existing.get(businessType) ?? {
            id: 0,
            businessType,
            processCode: null,
            enabled: false,
            defaultDeptId: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }
      ));
    }),
    upsert: adminProcedure
      .input(z.object({
        businessType: z.enum(DINGTALK_APPROVAL_BUSINESS_TYPES),
        processCode: z.string().trim().max(128).nullable(),
        enabled: z.boolean(),
        defaultDeptId: z.number().int().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const processCode = input.processCode?.trim() || null;
        if (input.enabled && !processCode) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "启用审批流前必须填写 processCode" });
        }
        const row = await upsertApprovalConfig({
          businessType: input.businessType,
          processCode,
          enabled: input.enabled,
          defaultDeptId: input.defaultDeptId ?? null,
        });
        return { success: true, config: row } as const;
      }),
  }),

  /** Admin CRUD for global calendar exceptions (holidays / makeup workdays) */
  calendarExceptions: router({
    list: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(calendarExceptionsTable).orderBy(calendarExceptionsTable.date);
    }),
    upsert: adminProcedure
      .input(z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        type: z.enum(["holiday", "makeup_workday"]),
        name: z.string().max(128).default(""),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });
        await db.insert(calendarExceptionsTable)
          .values({ date: input.date, type: input.type, name: input.name, createdBy: ctx.user.id })
          .onConflictDoUpdate({ target: calendarExceptionsTable.date, set: { type: input.type, name: input.name } });
        return { ok: true };
      }),
    remove: adminProcedure
      .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });
        await db.delete(calendarExceptionsTable).where(eq(calendarExceptionsTable.date, input.date));
        return { ok: true };
      }),
  }),

  /** Promote or demote a user's system role (admin only) */
  setUserRole: adminProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(SYSTEM_ROLES),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Prevent self-demotion
      if (input.userId === ctx.user.id && !isSystemAdminRole(input.role)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能撤销自己的系统管理权限",
        });
      }
      // Workspace owner/admin always have project creation permission.
      const updates: Partial<typeof users.$inferInsert> = { role: input.role };
      if (isSystemAdminRole(input.role)) {
        updates.canCreateProject = true;
      } else if (input.role === "external" || input.role === "viewer") {
        updates.canCreateProject = false;
      }
      await db
        .update(users)
        .set(updates)
        .where(eq(users.id, input.userId));
      return { success: true };
    }),
});
