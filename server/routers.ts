import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { hashPassword, verifyPassword } from "./_core/password";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { projectsRouter } from "./routers/projects";
import { membersRouter } from "./routers/members";
import { adminRouter } from "./routers/admin";
import { tasksRouter } from "./routers/tasks";
import { issuesRouter } from "./routers/issues";
import { gateReviewsRouter } from "./routers/gateReviews";
import { changelogRouter } from "./routers/changelog";
import { phasesRouter } from "./routers/phases";
import { filesRouter } from "./routers/files";
import { productsRouter } from "./routers/products";
import { modulesRouter } from "./routers/modules";
import { bomRouter } from "./routers/bom";
import * as db from "./db";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    /** Public: registration mode (drives Login page UI) */
    registrationEnabled: publicProcedure.query(() => ({
      enabled: ENV.allowRegistration,
      requiresInviteCode: ENV.allowRegistration && ENV.registrationInviteCode.length > 0,
    })),

    me: publicProcedure.query(opts => {
      const user = opts.ctx.user;
      if (!user) return null;
      // Never expose the password hash to the client
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return {
        ...safeUser,
        // Derived permission: admin always can create projects
        canCreateProject: user.role === 'admin' || user.canCreateProject,
      };
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
          role: 'user',
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
        role: z.enum(['user', 'admin']).default('user'),
        canCreateProject: z.boolean().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'admin') {
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
          role: input.role,
          canCreateProject: input.canCreateProject,
        });
        return { success: true } as const;
      }),

    /** Admin-only: reset a user's password */
    resetPassword: protectedProcedure
      .input(z.object({
        userId: z.number(),
        newPassword: z.string().min(6, '密码至少6位'),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'admin') {
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
  }),

  projects: projectsRouter,
  members: membersRouter,
  admin: adminRouter,
  tasks: tasksRouter,
  issues: issuesRouter,
  gateReviews: gateReviewsRouter,
  changelog: changelogRouter,
  phases: phasesRouter,
  files: filesRouter,
  products: productsRouter,
  modules: modulesRouter,
  bom: bomRouter,
});

export type AppRouter = typeof appRouter;
