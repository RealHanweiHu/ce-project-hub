# 账户设置页 + 导航精简 + 总览视角自动化 设计规格

> 状态：已确认（用户批准设计）
> 分支：`feat-account-page`
> 日期：2026-06-24
> 前置：Linear 改版已在 main（Phase 1+2）。

## 1. 目标

整理外壳信息架构（IA）：把散落在导航栏的账户类入口收进一个「账户/设置」页，精简导航栏只留核心业务页，并让总览视角按账户类型自动决定（不再手动切换）。

## 2. 已确认决策

| 决策点 | 选择 |
|---|---|
| 总览视角 | **完全按账户自动决定**：admin→管理层视角(大盘)；PM(非admin)→PM视角(工作台)；都不是→空状态引导去「我的任务」。去掉 select 与「我的视角」。 |
| SOP 流程库(书) + 系统管理(盾) | 从导航栏移除，**都收进「账户/设置」页**（系统管理仅 admin 可见）。 |
| 账户入口 | 头像**直接点进账户页**（不用下拉菜单）。 |
| 可编辑资料 | **显示名(name) + 手机号(mobile)**；用户名/角色/邮箱 只读。 |

## 3. 现状事实（已核对）

- 认证路由在 `server/routers.ts` 的 `auth` 下：有 `me / login / logout / register / resetPassword / changePassword`，**无 updateProfile**。`changePassword` 用 `protectedProcedure` + `db.getUserByOpenId(ctx.user.openId)` + `db.updateUserPassword`。
- users 表字段：`username`(唯一,登录号) / `name` / `email` / `mobile` / `role` / `passwordHash`；无 avatar 字段。
- `Home.tsx`：`type View = 'overview'|'mytasks'|'projects'|'calendar'|'products'|'requirements'|'sop'`；`VIEW_IDS` 同集合。`isAdmin = user.role === 'admin'`，已有 `isPM`。rail 底部有 4 个散按钮：修改密码(KeyRound)、退出登录(LogOut)、头像(不可点)，以及 nav 区后面单独的 SOP(BookOpen) 和 系统管理(Shield) 两个 Tooltip 按钮。系统管理走 wouter `navigate('/admin')`；SOP 是 `setView('sop')`。
- `OverviewPage.tsx`：`allowedLenses = [exec if admin, pm if isPM, 'mine']`；顶部 `{allowedLenses.length>1 && <select>}` 切换；`isWorkbench = mine || pm`；exec 出 PortfolioDashboard，pm/mine 出 PerspectivePanel。
- ChangePasswordDialog 组件保留（AdminPanel 可能用），但 rail 不再触发。

## 4. 后端：新增 `auth.updateProfile`

`server/routers.ts` 的 auth 路由内，仿 `changePassword`：
- `protectedProcedure`，输入 `{ name: z.string().trim().min(1,'请输入显示名称').max(64), mobile: z.string().trim().max(32).nullable().optional() }`。
- 取当前用户（`db.getUserByOpenId(ctx.user.openId)`），更新其 `name`、`mobile`。新增 `db.updateUserProfile(userId, { name, mobile })`（drizzle `update(users).set({name, mobile}).where(eq(users.id,userId))`）。
- mobile 为空串归一化为 null。
- 返回 `{ success: true, name, mobile }`。
- 仅改自己（用 ctx.user，不接受任意 userId）。

## 5. 前端：账户/设置页 `AccountPage`

- 新文件 `client/src/components/views/AccountPage.tsx`。
- 新 view `'account'`：加入 `View` 类型与 `VIEW_IDS`；URL `/?view=account`；**不进主导航**，只从头像进。
- 读 `useAuth().user`。区块（Linear 基元 LinearCard / PageHeader / shadcn Button / Input）：
  1. **个人资料**：Input 显示名(name) + 手机号(mobile)；只读行 用户名/角色/邮箱；保存按钮 → `trpc.auth.updateProfile` → 成功 toast + `utils.auth.me.invalidate()`。校验：name 必填。
  2. **修改密码**：当前/新/确认 三个 password Input → `trpc.auth.changePassword`（复用现有逻辑：当前密码错→提示，新旧相同→提示，<6位→提示）；成功 toast + 清空。
  3. **系统管理**（`isAdmin` 才渲染）：入口卡 → `navigate('/admin')`。
  4. **SOP 流程库**：入口卡 → `onNavigate('sop')`（AccountPage 接收的 prop 回调，由 Home 的 setView 实现）。
  5. **退出登录**：危险色按钮 → `logout()`。

## 6. 前端：Home.tsx 外壳改动

- **rail 移除**：修改密码(KeyRound)、退出登录(LogOut) 两个用户操作按钮；nav 区后面的 SOP(BookOpen) 与 系统管理(Shield) 两个 Tooltip 按钮。清掉随之无用的 import（KeyRound/LogOut/BookOpen/Shield 若别处没用）。
- **头像变可点**：底部头像包成 `<button onClick={() => goView('account')}>`（保留 Tooltip 显示姓名），点击进账户页。
- **加 account 路由**：`'account'` 走 `<AccountPage>`（lazy）。给 AccountPage 传 `user`、`onNavigate(view)`（用于 SOP 入口）、`logout`。账户页的面包屑标题用「账户设置」。
- SOP view('sop') 仍保留（从账户页进）；admin 仍是 `/admin` 路由。

## 7. 前端：OverviewPage.tsx 视角自动化

- 删除顶部 `{allowedLenses.length>1 && <select>}` 整块（连同「以…查看」）。
- `activeLens` 改为自动：`isAdmin ? 'exec' : isPM ? 'pm' : null`。去掉 'mine'、去掉 setLens 手动选择。
- 若 `activeLens == null`（既非 admin 非 PM）：渲染简洁空状态卡「总览面向管理层 / PM；你的待办请看『我的任务』」+ 跳转按钮（回调切到 mytasks view）。
- exec → PortfolioDashboard（+ PortfolioMetricsTable）；pm → PerspectivePanel（PM 工作台）。页标题/描述按 lens（沿用现有 pageTitle/pageDesc，去掉 mine 分支）。
- 保留上一次已做的「exec 不显示 PerspectivePanel 需要处理块」逻辑。

## 8. 数据流

资料读 `useAuth().user`（auth.me）；存 → `auth.updateProfile` → invalidate auth.me → UI 更新。密码 → `auth.changePassword`。退出 → `logout()`。总览视角纯前端按 isAdmin/isPM 计算，无新查询。

## 9. 错误处理

- 资料保存：name 空 → 前端拦 + 后端校验；mutation 失败 → 错误 toast。
- 改密：沿用现有错误码提示（当前密码错/新旧相同/太短）。
- 账户页若 `user` 未加载：loading 占位。
- 总览空状态兜底，避免非 admin/PM 白屏。

## 10. 测试

- 服务端：`auth.updateProfile` 测试 —— (a) 改自己 name+mobile 落库；(b) 空 name 被拒；(c) 未登录（无 ctx.user）→ UNAUTHORIZED（protectedProcedure 行为）。
- 前端 preview：头像 → 账户页 → 改显示名保存（顶栏/头像首字母随之变）→ 改密码 → admin 看到系统管理入口、点进 /admin → SOP 入口 → 退出登录。总览：admin 账户自动显示管理层大盘、无 select、无我的视角。
- `pnpm check` + 现有测试不回归；账户页/改动文件 0 残留 stone/amber/ce-*。

## 11. 非目标（YAGNI）

- 头像上传 / 邮箱修改 / 用户名修改（用户名是登录号，本期只读）。
- 角色自助修改（角色由管理员在系统管理分配）。
- 账户页里重做系统管理/SOP 的内容（只放入口，页面本身不动）。
- 主题/通知等其它设置项（本期只资料/密码/退出 + 两个入口）。

## 12. 不回归

- 核心导航 6 页、看板 Phase 2 交互、各页 Linear 视觉 全部不受影响。
- ChangePasswordDialog 组件保留供 AdminPanel 等其它调用方。
