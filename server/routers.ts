import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { SYSTEM_ROLES, isSystemAdminRole, systemRoleCanCreateProject } from "@shared/system-roles";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { getDingtalkUserByAuthCode } from "./_core/dingtalk";
import { ENV } from "./_core/env";
import { hashPassword, verifyPassword } from "./_core/password";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { projectsRouter } from "./routers/projects";
import { membersRouter } from "./routers/members";
import { delegationsRouter } from "./routers/delegations";
import { staffingRouter } from "./routers/staffing";
import { adminRouter } from "./routers/admin";
import { tasksRouter } from "./routers/tasks";
import { issuesRouter } from "./routers/issues";
import { risksRouter } from "./routers/risks";
import { gateReviewsRouter } from "./routers/gateReviews";
import { gateBlockersRouter } from "./routers/gateBlockers";
import { testPlansRouter } from "./routers/testPlans";
import { npiReadinessRouter } from "./routers/npiReadiness";
import { sampleSignoffsRouter } from "./routers/sampleSignoffs";
import { changelogRouter } from "./routers/changelog";
import { phasesRouter } from "./routers/phases";
import { filesRouter } from "./routers/files";
import { requirementsRouter } from "./routers/requirements";
import { productsRouter } from "./routers/products";
import { bomRouter } from "./routers/bom";
import { keyModulesRouter } from "./routers/keyModules";
import { projectDeliveryModulesRouter } from "./routers/projectDeliveryModules";
import { commentsRouter, notificationsRouter } from "./routers/collab";
import { customFieldsRouter } from "./routers/customFields";
import { projectCollectionsRouter } from "./routers/projectCollections";
import { automationRouter } from "./routers/automation";
import { meetingsRouter } from "./routers/meetings";
import { tailoringRouter } from "./routers/tailoring";
import { deliverableReviewsRouter } from "./routers/deliverableReviews";
import { workbenchRouter } from "./routers/workbench";
import { analyticsRouter } from "./routers/analytics";
import { stabilityRouter } from "./routers/stability";
import { certificatesRouter } from "./routers/certificates";
import { conditionsRouter } from "./routers/conditions";
import { handoffsRouter } from "./routers/handoffs";
import { expensesRouter } from "./routers/expenses";
import { productGovernanceRouter } from "./routers/productGovernance";
import { productWaiversRouter } from "./routers/productWaivers";
import { transitionsRouter } from "./routers/transitions";
import { terminationRouter } from "./routers/termination";
import { sopGovernanceRouter } from "./routers/sopGovernance";
import * as db from "./db";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const notificationPrefsSchema = z.object({
  dingtalk: z.object({
    enabled: z.boolean().optional(),
    quietHours: z.object({
      startHour: z.number().int().min(0).max(23).optional(),
      endHour: z.number().int().min(0).max(23).optional(),
      timezone: z.string().trim().min(1).max(64).optional(),
    }).strict().optional(),
    maxImmediatePerDay: z.number().int().min(0).max(100).optional(),
  }).strict().optional(),
}).strict();

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    /** Public: registration mode (drives Login page UI) */
    registrationEnabled: publicProcedure.query(() => ({
      enabled: ENV.allowRegistration,
      requiresInviteCode: ENV.allowRegistration && ENV.registrationInviteCode.length > 0,
    })),

    dingtalkConfig: publicProcedure.query(() => ({
      enabled: Boolean(ENV.dingtalkAppKey && ENV.dingtalkAppSecret && ENV.dingtalkCorpId),
      corpId: ENV.dingtalkCorpId || null,
    })),

    me: publicProcedure.query(opts => {
      const user = opts.ctx.user;
      if (!user) return null;
      // Never expose the password hash to the client
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return {
        ...safeUser,
        canCreateProject: systemRoleCanCreateProject(user),
      };
    }),

    notificationPrefs: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserNotificationPrefs(ctx.user.id);
    }),

    updateNotificationPrefs: protectedProcedure
      .input(notificationPrefsSchema)
      .mutation(async ({ ctx, input }) => {
        return db.updateUserNotificationPrefs(ctx.user.id, input);
      }),

    /** Password-based login */
    login: publicProcedure
      .input(z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const user = await db.getUserByUsername(input.username);
        if (!user || !user.passwordHash) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '用户名或密码错误' });
        }
        const valid = await verifyPassword(input.password, user.passwordHash);
        if (!valid) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '用户名或密码错误' });
        }
        // Update last sign in
        await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
        // Create session token using existing JWT infrastructure
        const sessionToken = await sdk.createSessionToken(user.openId, {
          name: user.name || user.username || '',
          expiresInMs: ONE_YEAR_MS,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true } as const;
      }),

    /** DingTalk micro-app passwordless login: getAuthCode → existing bound user → session cookie */
    dingtalkLogin: publicProcedure
      .input(z.object({ code: z.string().trim().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const identity = await getDingtalkUserByAuthCode(input.code);
        if (!identity) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "钉钉免登失败，请使用账号密码登录" });
        }
        const user = await db.getUserByDingtalkIdentity({
          corpUserId: identity.corpUserId,
          unionId: identity.unionId,
          mobile: identity.mobile,
        });
        if (!user) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "未找到已绑定的钉钉账号，请先用手机号/账号绑定后再免登" });
        }

        await Promise.all([
          identity.unionId ? db.setUserDingtalkId(user.id, identity.unionId) : Promise.resolve(),
          db.setUserDingtalkCorpId(user.id, identity.corpUserId),
          db.upsertUser({ openId: user.openId, lastSignedIn: new Date() }),
        ]);
        const sessionToken = await sdk.createSessionToken(user.openId, {
          name: user.name || user.username || identity.name || "",
          expiresInMs: ONE_YEAR_MS,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true } as const;
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),

    /** Public: self-registration - creates a regular user account */
    register: publicProcedure
      .input(z.object({
        username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_\.\-]+$/, '用户名只能包含字母、数字、下划线、点和横线'),
        password: z.string().min(6, '密码至少6位'),
        name: z.string().trim().min(1, '请输入显示名称').max(64),
        email: z.string().trim().email('请输入有效的邮箱地址').toLowerCase(),
        inviteCode: z.string().trim().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ENV.allowRegistration) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '注册已关闭，请联系管理员开通账号' });
        }
        if (ENV.registrationInviteCode && input.inviteCode !== ENV.registrationInviteCode) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '邀请码不正确，请向管理员索取' });
        }
        const existing = await db.getUserByUsername(input.username);
        if (existing) {
          throw new TRPCError({ code: 'CONFLICT', message: '用户名已被占用，请更换一个' });
        }
        // Check email uniqueness
        const existingEmail = await db.getUserByEmail(input.email);
        if (existingEmail) {
          throw new TRPCError({ code: 'CONFLICT', message: '该邮箱地址已被注册，请更换一个' });
        }
        const passwordHash = await hashPassword(input.password);
        await db.createUserWithPassword({
          username: input.username,
          passwordHash,
          name: input.name,
          email: input.email,
          role: 'member',
          canCreateProject: false,
        });
        // Auto login after registration
        const user = await db.getUserByUsername(input.username);
        if (user) {
          const sessionToken = await sdk.createSessionToken(user.openId, {
            name: user.name || user.username || '',
            expiresInMs: ONE_YEAR_MS,
          });
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        }
        return { success: true } as const;
      }),

    /** Admin-only: create a new user with username + password */
    createUser: protectedProcedure
      .input(z.object({
        username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_.\-]+$/, '用户名只能包含字母、数字、下划线、点和横线'),
        password: z.string().min(6, '密码至少6位'),
        name: z.string().trim().min(1, '请输入显示名称').max(64),
        email: z.string().trim().email('请输入有效的邮箱地址').toLowerCase().optional(),
        mobile: z.string().trim().max(32).optional(),
        role: z.enum(SYSTEM_ROLES).default('member'),
        canCreateProject: z.boolean().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!isSystemAdminRole(ctx.user.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '仅管理员可创建用户' });
        }
        const existing = await db.getUserByUsername(input.username);
        if (existing) {
          throw new TRPCError({ code: 'CONFLICT', message: '用户名已存在' });
        }
        if (input.email) {
          const existingEmail = await db.getUserByEmail(input.email);
          if (existingEmail) {
            throw new TRPCError({ code: 'CONFLICT', message: '该邮箱地址已被占用' });
          }
        }
        const passwordHash = await hashPassword(input.password);
        await db.createUserWithPassword({
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

    /** Admin-only: 设置用户手机号（用于钉钉日程映射） */
    setUserMobile: protectedProcedure
      .input(z.object({ userId: z.number(), mobile: z.string().trim().max(32) }))
      .mutation(async ({ input, ctx }) => {
        if (!isSystemAdminRole(ctx.user.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '仅管理员可修改手机号' });
        }
        await db.setUserMobile(input.userId, input.mobile.trim() || null);
        return { success: true } as const;
      }),

    /** Admin-only: reset a user's password */
    resetPassword: protectedProcedure
      .input(z.object({
        userId: z.number(),
        newPassword: z.string().min(6, '密码至少6位'),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!isSystemAdminRole(ctx.user.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '仅管理员可重置密码' });
        }
        const passwordHash = await hashPassword(input.newPassword);
        await db.updateUserPassword(input.userId, passwordHash);
        return { success: true } as const;
      }),

    /** Self-service: logged-in user changes their own password */
    changePassword: protectedProcedure
      .input(z.object({
        currentPassword: z.string().min(1, '请输入当前密码'),
        newPassword: z.string().min(6, '新密码至少6位'),
      }))
      .mutation(async ({ input, ctx }) => {
        const user = await db.getUserByOpenId(ctx.user.openId);
        if (!user || !user.passwordHash) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '当前账号未设置密码，请联系管理员' });
        }
        const valid = await verifyPassword(input.currentPassword, user.passwordHash);
        if (!valid) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '当前密码不正确' });
        }
        if (input.currentPassword === input.newPassword) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '新密码不能与当前密码相同' });
        }
        const newHash = await hashPassword(input.newPassword);
        await db.updateUserPassword(user.id, newHash);
        return { success: true } as const;
      }),

    /** Self-service: logged-in user updates their own display name and mobile */
    updateProfile: protectedProcedure
      .input(z.object({
        name: z.string().trim().min(1, '请输入显示名称').max(64),
        mobile: z.string().trim().max(32).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const user = await db.getUserByOpenId(ctx.user.openId);
        if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
        const mobile = input.mobile && input.mobile.length > 0 ? input.mobile : null;
        const database = await getDb();
        if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        const mobileChanged = (user.mobile ?? null) !== mobile;
        await database.update(users).set({
          name: input.name,
          mobile,
          ...(mobileChanged ? { dingtalkUserId: null, dingtalkCorpUserId: null } : {}),
        }).where(eq(users.id, user.id));
        return { success: true, name: input.name, mobile } as const;
      }),
  }),

  projects: projectsRouter,
  members: membersRouter,
  delegations: delegationsRouter,
  staffing: staffingRouter,
  admin: adminRouter,
  tasks: tasksRouter,
  tailoring: tailoringRouter,
  issues: issuesRouter,
  risks: risksRouter,
  gateReviews: gateReviewsRouter,
  gateBlockers: gateBlockersRouter,
  testPlans: testPlansRouter,
  npiReadiness: npiReadinessRouter,
  sampleSignoffs: sampleSignoffsRouter,
  deliverableReviews: deliverableReviewsRouter,
  changelog: changelogRouter,
  phases: phasesRouter,
  files: filesRouter,
  requirements: requirementsRouter,
  customFields: customFieldsRouter,
  projectCollections: projectCollectionsRouter,
  automation: automationRouter,
  meetings: meetingsRouter,
  workbench: workbenchRouter,
  analytics: analyticsRouter,
  stability: stabilityRouter,
  certificates: certificatesRouter,
  conditions: conditionsRouter,
  handoffs: handoffsRouter,
  expenses: expensesRouter,
  productGovernance: productGovernanceRouter,
  productWaivers: productWaiversRouter,
  transitions: transitionsRouter,
  termination: terminationRouter,
  sopGovernance: sopGovernanceRouter,
  products: productsRouter,
  bom: bomRouter,
  keyModules: keyModulesRouter,
  projectDeliveryModules: projectDeliveryModulesRouter,
  comments: commentsRouter,
  notifications: notificationsRouter,
});

export type AppRouter = typeof appRouter;
