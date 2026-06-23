# 账户设置页 + 导航精简 + 总览视角自动化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「账户/设置」页（资料/改密/系统管理/SOP/退出），精简导航栏只留核心业务页，总览视角按账户类型自动决定。

**Architecture:** 后端加 `auth.updateProfile` patch mutation（只改自己 name/mobile）。前端新建 `AccountPage`（从头像直接进，无下拉）；Home rail 删掉 4 个账户/工具图标、头像变可点；OverviewPage 删手动 select，按 isAdmin/isPM 自动选 lens + 空状态兜底。

**Tech Stack:** React 19 + tRPC + drizzle + shadcn + Linear 基元。验证：vitest（server）+ preview（前端）+ `pnpm check`。

**规格：** `docs/superpowers/specs/2026-06-24-account-page-design.md`。**分支：** `feat-account-page`。

**前置事实（已核对）：**
- 认证路由在 `server/routers.ts` 的 `auth` 下（`changePassword` 用 `protectedProcedure` + `db.getUserByOpenId(ctx.user.openId)` + `db.updateUserPassword`）。整个 router 导出为 `appRouter`。
- `server/db.ts`：`updateUserPassword(userId, hash)` 是 `db.update(users).set({...}).where(eq(users.id,userId))`；`users` 和 `eq` 已 import。`getUserByOpenId(openId)` 返回 user（含 id/name/mobile/role/username/email）。
- `Home.tsx`：`type View` + `VIEW_IDS` 当前含 overview/mytasks/projects/calendar/products/requirements/sop；`isAdmin = user.role==='admin'`、已有 `isPM`；rail 底部有 修改密码(KeyRound)/退出(LogOut)/头像；nav 区后有 SOP(BookOpen,`setView('sop')`)、系统管理(Shield,`navigate('/admin')`)。
- `OverviewPage.tsx`：`allowedLenses=[exec?,pm?,'mine']`；顶部 `{allowedLenses.length>1 && <select>}`；`isWorkbench = mine||pm`；exec→PortfolioDashboard，pm/mine→PerspectivePanel。

---

## Task 1: 后端 `auth.updateProfile`（TDD）

**Files:**
- Modify: `server/db.ts`（加 `updateUserProfile`）
- Modify: `server/routers.ts`（auth 路由加 `updateProfile`）
- Test: `server/auth-update-profile.test.ts`（新建）

- [ ] **Step 1: 写失败测试** — 新建 `server/auth-update-profile.test.ts`：

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { appRouter } from "./routers";

const OPENID = `acct-test-${Date.now()}`;
let userId = 0;
const ctx = (openId: string | null) => ({
  user: openId ? { id: userId, openId, role: "user", name: "旧名", email: null, username: openId,
    passwordHash: null, canCreateProject: false, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null } : null,
}) as any;

beforeAll(async () => {
  const db = await getDb(); if (!db) throw new Error("no db");
  const [row] = await db.insert(users).values({
    openId: OPENID, username: OPENID, name: "旧名", mobile: null, role: "user", loginMethod: "password",
  }).returning();
  userId = row.id;
});
afterAll(async () => {
  const db = await getDb(); if (!db) return;
  await db.delete(users).where(eq(users.id, userId));
});

describe("auth.updateProfile", () => {
  it("改自己 name + mobile 落库", async () => {
    const caller = appRouter.createCaller(ctx(OPENID));
    const r = await caller.auth.updateProfile({ name: "新名字", mobile: "13800000000" });
    expect(r.success).toBe(true);
    const db = await getDb();
    const [row] = await db!.select().from(users).where(eq(users.id, userId));
    expect(row.name).toBe("新名字");
    expect(row.mobile).toBe("13800000000");
  });
  it("空 name 被拒", async () => {
    const caller = appRouter.createCaller(ctx(OPENID));
    await expect(caller.auth.updateProfile({ name: "  ", mobile: null })).rejects.toThrow();
  });
  it("未登录 → 拒绝", async () => {
    const caller = appRouter.createCaller(ctx(null));
    await expect(caller.auth.updateProfile({ name: "x", mobile: null })).rejects.toThrow();
  });
});
```
（若 users 表的 `loginMethod`/其它 NOT NULL 字段插入报错，按 schema 补必填字段——参考 `scripts/create-test-users.mjs` 的插入列。）

- [ ] **Step 2: 跑测试确认失败**

Run: `export $(grep -E '^DATABASE_URL=' .env | xargs) && npx vitest run server/auth-update-profile.test.ts`
Expected: FAIL（`updateProfile` 不存在）。

- [ ] **Step 3: 加 `db.updateUserProfile`** — 在 `server/db.ts` 的 `updateUserPassword` 之后：

```ts
export async function updateUserProfile(userId: number, patch: { name: string; mobile: string | null }): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({ name: patch.name, mobile: patch.mobile }).where(eq(users.id, userId));
}
```

- [ ] **Step 4: 加 `auth.updateProfile`** — 在 `server/routers.ts` 的 auth 路由里（`changePassword` 之后），并确保 `db.updateUserProfile` 可调用（db 已作为 `db` 命名空间 import，与 `db.updateUserPassword` 同样用法）：

```ts
    updateProfile: protectedProcedure
      .input(z.object({
        name: z.string().trim().min(1, '请输入显示名称').max(64),
        mobile: z.string().trim().max(32).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const user = await db.getUserByOpenId(ctx.user.openId);
        if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
        const mobile = input.mobile && input.mobile.length > 0 ? input.mobile : null;
        await db.updateUserProfile(user.id, { name: input.name, mobile });
        return { success: true, name: input.name, mobile } as const;
      }),
```
（`protectedProcedure`、`z`、`TRPCError`、`db` 均已在该文件 import；`changePassword` 同样用 `ctx.user.openId` + `db.getUserByOpenId`。）

- [ ] **Step 5: 跑测试确认通过** — 同 Step 2 命令，Expected: PASS（3 测试）。再 `pnpm check` 无报错。

- [ ] **Step 6: 提交**

```bash
git add server/db.ts server/routers.ts server/auth-update-profile.test.ts
git commit -m "feat(auth): 新增 auth.updateProfile（只改自己 name/mobile）+ 测试"
```

---

## Task 2: AccountPage 组件

**Files:**
- Create: `client/src/components/views/AccountPage.tsx`

读现有 `ChangePasswordDialog.tsx` 拿改密表单的字段与错误处理写法；用 Linear 基元（`@/components/linear/primitives` 的 LinearCard/PageHeader）、shadcn `Button`/`Input`、`sonner` toast、`@/_core/hooks/useAuth`、`@/lib/trpc`。

- [ ] **Step 1: 写 AccountPage（资料 + 改密 + 入口 + 退出）**

```tsx
// client/src/components/views/AccountPage.tsx
import { useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LinearCard, PageHeader, Kicker } from '@/components/linear/primitives';
import { Shield, BookOpen, LogOut } from 'lucide-react';

type View = 'overview' | 'mytasks' | 'projects' | 'calendar' | 'products' | 'requirements' | 'sop' | 'account';

export function AccountPage({ onNavigate, onOpenAdmin }: { onNavigate: (v: View) => void; onOpenAdmin: () => void }) {
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();
  const isAdmin = (user as { role?: string } | null)?.role === 'admin';

  const [name, setName] = useState(user?.name ?? '');
  const [mobile, setMobile] = useState((user as { mobile?: string | null } | null)?.mobile ?? '');
  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: () => { utils.auth.me.invalidate(); toast.success('资料已保存'); },
    onError: (e) => toast.error(e.message || '保存失败'),
  });

  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [cf, setCf] = useState('');
  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => { setCur(''); setNw(''); setCf(''); toast.success('密码已修改'); },
    onError: (e) => toast.error(e.message || '修改失败'),
  });

  const roleLabel = isAdmin ? '管理员' : '成员';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader title="账户设置" sub="管理你的个人资料、密码与登录" />

      {/* 个人资料 */}
      <LinearCard className="p-5">
        <Kicker>个人资料</Kicker>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground">显示名</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="显示名" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground">手机号</span>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="手机号（选填）" />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground">用户名</span>
            <div className="num text-[14px] text-foreground">{user?.username ?? '—'}</div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground">角色</span>
            <div className="text-[14px] text-foreground">{roleLabel}</div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button disabled={!name.trim() || updateProfile.isPending}
            onClick={() => updateProfile.mutate({ name: name.trim(), mobile: mobile.trim() || null })}>
            {updateProfile.isPending ? '保存中…' : '保存资料'}
          </Button>
        </div>
      </LinearCard>

      {/* 修改密码 */}
      <LinearCard className="p-5">
        <Kicker>修改密码</Kicker>
        <div className="mt-3 flex flex-col gap-3">
          <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="当前密码" />
          <Input type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder="新密码（至少 6 位）" />
          <Input type="password" value={cf} onChange={(e) => setCf(e.target.value)} placeholder="确认新密码" />
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="outline"
            disabled={!cur || nw.length < 6 || nw !== cf || changePassword.isPending}
            onClick={() => changePassword.mutate({ currentPassword: cur, newPassword: nw })}>
            {changePassword.isPending ? '修改中…' : '修改密码'}
          </Button>
        </div>
        {nw && cf && nw !== cf && <p className="mt-2 text-[12px] text-[color:var(--destructive)]">两次输入的新密码不一致</p>}
      </LinearCard>

      {/* 入口：系统管理（admin）+ SOP */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {isAdmin && (
          <button onClick={onOpenAdmin} className="flex items-center gap-3 rounded-[11px] border border-border bg-card p-4 text-left transition-colors hover:border-[color:var(--acc-border)] hover:bg-secondary">
            <Shield size={18} className="text-primary" />
            <div><div className="text-[14px] font-semibold">系统管理</div><div className="text-[12px] text-muted-foreground">成员与权限管理</div></div>
          </button>
        )}
        <button onClick={() => onNavigate('sop')} className="flex items-center gap-3 rounded-[11px] border border-border bg-card p-4 text-left transition-colors hover:border-[color:var(--acc-border)] hover:bg-secondary">
          <BookOpen size={18} className="text-primary" />
          <div><div className="text-[14px] font-semibold">SOP 流程库</div><div className="text-[12px] text-muted-foreground">查看各类项目阶段与任务模板</div></div>
        </button>
      </div>

      {/* 退出 */}
      <div className="flex justify-start">
        <Button variant="outline" onClick={() => logout()} className="text-[color:var(--destructive)]">
          <LogOut size={15} /> 退出登录
        </Button>
      </div>
    </div>
  );
}
```
（若 `Button` 不支持 `variant="outline"`，用项目实际的 variant；查 `@/components/ui/button` 的 variants。`useAuth().user` 的 mobile/username/role 字段若 TS 报缺，按上面用窄化断言取。）

- [ ] **Step 2: 类型检查**

Run: `pnpm check`
Expected: 无 TS 报错。

- [ ] **Step 3: 提交**

```bash
git add client/src/components/views/AccountPage.tsx
git commit -m "feat(account): 新增账户设置页（资料/改密/系统管理·SOP 入口/退出）"
```

---

## Task 3: Home.tsx — account 路由 + 头像可点 + 删 4 个 rail 图标

**Files:**
- Modify: `client/src/pages/Home.tsx`

- [ ] **Step 1: 加 'account' view + 懒加载 AccountPage**

- `type View` 与 `VIEW_IDS` 都加上 `'account'`。
- 顶部加 `const AccountPage = lazy(() => import('@/components/views/AccountPage').then(m => ({ default: m.AccountPage })));`
- 在视图渲染 switch/分支里加：`view === 'account'` → `<AccountPage onNavigate={(v) => goView(v)} onOpenAdmin={() => navigate('/admin')} />`（`goView`/`setView` 用文件里实际切换 view 的函数；`navigate` 来自 wouter，已在文件内用过）。
- 面包屑标题 `viewLabels` 里给 `account` 配「账户设置」。

- [ ] **Step 2: rail 底部头像变可点（进 account）**

把底部头像那段（当前是 `<div className="w-[28px] h-[28px] rounded-full bg-primary …">{首字母}</div>` 包在 Tooltip 里）改成 `<button onClick={() => goView('account')} aria-label="账户设置" className="…同样圆形样式… hover:opacity-90">{首字母}</button>`，保留外层 Tooltip（显示姓名）。

- [ ] **Step 3: 删掉 4 个 rail 图标按钮**

- 删 rail 底部「修改密码(KeyRound)」「退出登录(LogOut)」两个 Tooltip 按钮（整段）。
- 删 nav 区后面的「SOP 流程库(BookOpen)」「系统管理(Shield)」两个 Tooltip 按钮（整段）。
- 清理因此不再使用的 import（`KeyRound`/`LogOut`/`BookOpen`/`Shield` 若文件别处仍用则保留——grep 确认）。`setChangePasswordOpen` 状态与 `ChangePasswordDialog` 懒加载：rail 不再触发；若文件别处（如全局快捷键）没再用就一并删掉，否则保留。
- SOP 仍是合法 view（从账户页进）；`navigate('/admin')` 仍用于账户页入口。

- [ ] **Step 4: 验证（preview，已登录 test_pm/admin）**

`pnpm check` 通过。dev server "cehub-dev" 运行（preview_start name cehub-dev）。登录后 `/?view=account`：见账户页（资料/改密/系统管理入口/SOP 入口/退出）。点 rail 头像 → 进账户页。确认 rail 上**不再有** 钥匙/退出/书/盾 四个图标，只剩核心 6 个 nav + 顶部 logo + 底部头像。preview_console_logs 无报错。`grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' client/src/pages/Home.tsx` = 0。截图 rail + 账户页。

- [ ] **Step 5: 提交**

```bash
git add client/src/pages/Home.tsx
git commit -m "feat(shell): 头像进账户页 + rail 移除 钥匙/退出/SOP/系统管理 四图标"
```

---

## Task 4: OverviewPage.tsx — 视角自动化

**Files:**
- Modify: `client/src/components/views/overview/OverviewPage.tsx`

- [ ] **Step 1: 删手动 select + 自动决定 lens**

- 删除顶部 `{allowedLenses.length > 1 && (<div>…<select>…</select>…</div>)}` 整块（连同「以…查看」）。
- 把 `activeLens` 改为：`const activeLens: Lens | null = isAdmin ? 'exec' : isPM ? 'pm' : null;`（删掉 `allowedLenses`、`lens`/`setLens` 手动选择逻辑；若其它地方引用 `allowedLenses`/`setLens` 一并清理）。
- `isWorkbench`/`dashboardRows`/`scopeLabel`/`pageTitle`/`pageDesc` 里所有 `'mine'` 分支删除（mine 不再是总览 lens）。`isWorkbench = activeLens === 'pm'`。

- [ ] **Step 2: 空状态兜底（非 admin/PM）**

在 return 顶部，`activeLens == null` 时直接返回空状态卡：
```tsx
if (activeLens == null) {
  return (
    <div className="mx-auto mt-10 max-w-md text-center">
      <LinearCard className="p-8">
        <p className="text-[15px] font-semibold">总览面向管理层与项目经理</p>
        <p className="mt-2 text-[13px] text-muted-foreground">你的待办、审核与在手任务请在「我的任务」查看。</p>
        <button onClick={() => onSelectView?.('mytasks')} className="mt-4 inline-flex h-8 items-center rounded-[7px] bg-primary px-4 text-[13px] font-medium text-white">前往我的任务</button>
      </LinearCard>
    </div>
  );
}
```
若 OverviewPage 当前没有切到 mytasks 的回调 prop，则加一个可选 `onSelectView?: (v) => void` prop，由 Home 传 `goView`；按钮没有回调时可降级为 `window.location.href='/?view=mytasks'`。确认 `LinearCard` 已 import（没有就从 `@/components/linear/primitives` 引）。

- [ ] **Step 3: 验证（preview）**

`pnpm check` 通过。preview `/?view=overview`：admin（test_pm）→ 自动显示**管理层视角大盘**，顶部**无 select、无「我的视角」**。（可临时把 test_pm 降成 PM 非 admin 验证 PM 视角，再升回 admin；或信任逻辑。）preview_console_logs 无报错。`grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' client/src/components/views/overview/OverviewPage.tsx` = 0。截图总览。

- [ ] **Step 4: 提交**

```bash
git add client/src/components/views/overview/OverviewPage.tsx
git commit -m "feat(overview): 视角按账户自动决定（去 select/我的视角）+ 非管理/ PM 空状态兜底"
```

---

## Task 5: 收尾验证

- [ ] **Step 1: 全量检查**

```bash
export $(grep -E '^DATABASE_URL=' .env | xargs)
pnpm check
npx vitest run server/auth-update-profile.test.ts
pnpm test          # 现有不回归（注意 portfolio-health 是已知 flake，单独跑通即可）
grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' client/src/components/views/AccountPage.tsx client/src/pages/Home.tsx client/src/components/views/overview/OverviewPage.tsx | grep -vE 'xlsx-host|docx-host'
```
Expected：tsc 过、updateProfile 测试过、grep 0。

- [ ] **Step 2: preview 全流程走查**

头像 → 账户页 → 改显示名保存（顶栏/头像首字母随之变）→ 改密码 → admin 见系统管理入口点进 /admin → SOP 入口进 SOP → 退出登录。rail 只剩核心 6 nav + 头像。总览 admin 自动大盘无 select。截图汇总。

- [ ] **Step 3: 提交（如有收尾）** `git commit -m "chore(account): 收尾验证"`

---

## Self-Review 备注（已核对规格覆盖）

- §4 updateProfile → Task 1（含空 name 拒绝、未登录拒绝、落库三测试）。
- §5 AccountPage → Task 2。§6 Home rail/头像/account 路由 → Task 3。§7 Overview 自动 lens + 空状态 → Task 4。
- §10 测试：server TDD（T1）+ preview（T2-5）+ 不回归（T5，注明 portfolio-health 已知 flake）。
- §11 非目标（不改用户名/邮箱/角色，不重做 admin/SOP 内容）已遵守。
- 类型一致：`auth.updateProfile` 输入 `{name, mobile?}` T1 定义、T2 调用一致；`AccountPage` props `{onNavigate, onOpenAdmin}` T2 定义、T3 传入一致；View 加 `'account'` 贯穿 T2/T3。
