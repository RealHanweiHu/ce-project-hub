# Linear 风格前端改版 实施计划（Phase 1 视觉改版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 CE Project Hub 前端从 stone/amber + Playfair 风格整体改版为 Linear 风格（Hanken Grotesk + 靛蓝 + zinc），只改表现层，不动数据/业务逻辑。

**Architecture:** Token-first：先重写 `index.css` 的 `@font-face`/`:root`/`@theme` 让所有用 shadcn 语义 token 的组件自动迁移；再建一组共享 Linear 基元组件；重建共享外壳（60px 图标栏 + 52px 顶栏）；最后逐屏把硬编码的 `stone-*/amber-*/font-serif/font-mono/ce-*` 清理为新 token/基元，并对照设计稿 HTML 调整布局。看板拖拽/WIP/撤销等新行为属 Phase 2，**不在本计划**。

**Tech Stack:** React 19 + Vite + TypeScript + Tailwind v4 (`@theme inline`) + shadcn/ui + wouter + tRPC（21 个 router）。验证用 preview 工具（snapshot/screenshot/console_logs）+ `pnpm check`（tsc）。

**权威设计源：** `/Users/huhanwei/Desktop/design_handoff_ce_hub/`（7 个 HTML 稿 + `app.css` + `README.md`）。
**规格：** `docs/superpowers/specs/2026-06-23-linear-redesign-design.md`。

---

## 全局映射表（所有屏复用 — 清理时照此替换）

| 旧（硬编码） | 新（Linear） |
|---|---|
| `text-stone-900` / `text-stone-800` | `text-foreground`（`#1a1a1e`） |
| `text-stone-500` / `text-stone-400` | `text-muted-foreground`（`#71717a`） |
| `bg-stone-50` / `bg-stone-100` | `bg-background` / `bg-muted`（zinc） |
| `border-stone-200/300` | `border-border`（`#e9e9eb`） |
| `bg-amber-*` / `text-amber-*` / `ring-amber-*` | `bg-primary` / `text-primary` / `ring-ring`（靛蓝 `#5e6ad2`），或语义色 token |
| `font-serif`（标题） | 默认 sans（Hanken Grotesk），用字号/字重做层级 |
| `font-mono`（kicker/数字） | 普通 sans；数字加 `.num`（tabular-nums） |
| `.ce-card` / `.ce-panel` | `<LinearCard>`（Task 3） |
| `.ce-kicker` | `<Kicker>`（Task 3） |
| `.ce-page-header` | `<PageHeader>`（Task 3） |
| 状态点（绿/琥珀/红） | `<StatusDot tone="green|amber|red">`（Task 3） |
| 进度条 | `<LinearBar value={n}>`（Task 3） |
| 段控（列表/看板切换） | `<SegToggle>`（Task 3） |

**每屏「完成」硬标准：** 改完该屏，运行
`grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' <该屏文件>` **必须 0 命中**（Office 预览相关的 `.xlsx-host/.docx-host` 例外，见 index.css 底部）。

---

## Task 1: 自托管 Hanken Grotesk 字体

**Files:**
- Create: `client/public/fonts/hanken_grotesk_400.woff2`、`..._500.woff2`、`..._600.woff2`、`..._700.woff2`
- Modify: `client/src/index.css:5-86`（替换 `@font-face` 块）

- [ ] **Step 1: 下载 4 个权重的 woff2（fontsource 静态文件，非运行时 CDN）**

```bash
cd /Users/huhanwei/Desktop/ce-project-hub/client/public/fonts
for w in 400 500 600 700; do
  curl -fsSL "https://cdn.jsdelivr.net/fontsource/fonts/hanken-grotesk@latest/latin-$w-normal.woff2" \
    -o "hanken_grotesk_$w.woff2"
done
ls -la hanken_grotesk_*.woff2
```
Expected: 4 个文件，每个 > 10KB。若 curl 失败（无网），改用 `npm i @fontsource/hanken-grotesk` 后从 `node_modules/@fontsource/hanken-grotesk/files/*latin-{400,500,600,700}-normal.woff2` 复制进来。

- [ ] **Step 2: 替换 index.css 顶部 `@font-face` 块（删除 Playfair/JetBrains/SourceSans，新增 Hanken Grotesk）**

把 `client/src/index.css` 第 4–86 行整段替换为：

```css
/* Self-hosted Hanken Grotesk for China mainland accessibility */
@font-face { font-family:'Hanken Grotesk'; font-style:normal; font-weight:400; font-display:swap; src:url('/fonts/hanken_grotesk_400.woff2') format('woff2'); }
@font-face { font-family:'Hanken Grotesk'; font-style:normal; font-weight:500; font-display:swap; src:url('/fonts/hanken_grotesk_500.woff2') format('woff2'); }
@font-face { font-family:'Hanken Grotesk'; font-style:normal; font-weight:600; font-display:swap; src:url('/fonts/hanken_grotesk_600.woff2') format('woff2'); }
@font-face { font-family:'Hanken Grotesk'; font-style:normal; font-weight:700; font-display:swap; src:url('/fonts/hanken_grotesk_700.woff2') format('woff2'); }
```

- [ ] **Step 3: 删除旧字体文件（避免无用产物）**

```bash
cd /Users/huhanwei/Desktop/ce-project-hub/client/public/fonts
rm -f playfair_display_*.woff2 jetbrains_mono_*.woff2 source_sans_3_*.woff2
```

- [ ] **Step 4: 提交**

```bash
git add client/public/fonts client/src/index.css
git commit -m "feat(theme): 自托管 Hanken Grotesk，移除 Playfair/JetBrains/SourceSans"
```

---

## Task 2: 全局 token swap（基础层）

**Files:**
- Modify: `client/src/index.css:90-212`（`@theme inline` 字体段 + `:root` 颜色 + `@layer base`）

- [ ] **Step 1: 改 `@theme inline` 的字体族（约 128–131 行）**

```css
  /* Custom font families */
  --font-sans: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
  --font-serif: 'Hanken Grotesk', system-ui, sans-serif;
  --font-mono: 'Hanken Grotesk', system-ui, sans-serif;
```
（serif/mono 指向同一字体，使残留 `font-serif/font-mono` 类在清理前也不破坏观感。）

- [ ] **Step 2: 重写 `:root`（134–176 行）为 Linear token（oklch 近似 app.css 十六进制）**

```css
:root {
  --radius: 0.6875rem; /* 11px 卡片 */

  /* 靛蓝主强调 #5e6ad2 */
  --primary: oklch(0.556 0.146 277.5);
  --primary-foreground: oklch(1 0 0);
  --ring: oklch(0.556 0.146 277.5);

  /* 背景/文本（白底 + zinc 中性） */
  --background: oklch(1 0 0);                 /* #ffffff */
  --foreground: oklch(0.205 0.006 285.9);     /* #1a1a1e */
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.205 0.006 285.9);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.205 0.006 285.9);
  --secondary: oklch(0.967 0.001 286.4);      /* zinc-100 #f4f4f5 */
  --secondary-foreground: oklch(0.37 0.012 285.8); /* zinc-600 #52525b */
  --muted: oklch(0.967 0.001 286.4);
  --muted-foreground: oklch(0.552 0.014 285.9);    /* zinc-500 #71717a */
  --accent: oklch(0.962 0.02 277.5);          /* acc-soft #eef0fb */
  --accent-foreground: oklch(0.556 0.146 277.5);
  --destructive: oklch(0.62 0.21 21.6);       /* #e5484d */
  --destructive-foreground: oklch(1 0 0);
  --border: oklch(0.918 0.002 286.3);         /* #e9e9eb */
  --input: oklch(0.918 0.002 286.3);

  /* 语义扩展 token（新增，供基元/语义色用） */
  --success: oklch(0.64 0.13 155);            /* #3fa66a */
  --success-soft: oklch(0.957 0.03 155);      /* #e7f6ee */
  --warning: oklch(0.68 0.13 73);             /* #d68a22 */
  --warning-soft: oklch(0.96 0.04 80);        /* #fbf0dd */
  --star: oklch(0.82 0.16 85);                /* #f5b301 */
  --acc-soft: oklch(0.962 0.02 277.5);        /* #eef0fb */
  --acc-border: oklch(0.9 0.04 277.5);        /* #d9ddf6 */

  /* chart：靛蓝→语义渐变 */
  --chart-1: oklch(0.556 0.146 277.5);
  --chart-2: oklch(0.64 0.13 155);
  --chart-3: oklch(0.68 0.13 73);
  --chart-4: oklch(0.62 0.21 21.6);
  --chart-5: oklch(0.552 0.014 285.9);

  /* sidebar：Linear 浅侧栏 #fafafa */
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.37 0.012 285.8);
  --sidebar-primary: oklch(0.556 0.146 277.5);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.962 0.02 277.5);
  --sidebar-accent-foreground: oklch(0.556 0.146 277.5);
  --sidebar-border: oklch(0.918 0.002 286.3);
  --sidebar-ring: oklch(0.556 0.146 277.5);
}
```

- [ ] **Step 3: 改 `@layer base` 的 body/标题（178–199 行）**

```css
@layer base {
  * { @apply border-border outline-ring/50; }
  body {
    @apply bg-background text-foreground;
    font-family: var(--font-sans);
    letter-spacing: 0;               /* 不用 -.01em，避免中文/按钮发紧 */
    background: var(--background);    /* 移除暖色渐变 */
  }
  h1, h2, h3 { font-family: var(--font-sans); font-weight: 700; letter-spacing: -0.01em; }
  .font-serif { font-family: var(--font-sans) !important; }
  .font-mono  { font-family: var(--font-sans) !important; }
  .num { font-variant-numeric: tabular-nums; }
  /* cursor 规则保持不变 */
}
```

- [ ] **Step 4: 弱化 `.ce-*` 旧基元（过渡期，逐屏清理后再删）**

把 `.ce-card/.ce-panel` 的暖色阴影改中性（214–268 行 box-shadow 换为 `0 1px 2px rgb(0 0 0 / .03)`，hover `0 4px 14px rgb(0 0 0 / .09)`，border-radius 改 `0.6875rem`），`.ce-kicker` 去掉 `font-mono`、颜色改 `var(--muted-foreground)`。其余 `.ce-*` 保留以防破图。

- [ ] **Step 5: 启动 dev 并验证基础观感**

```bash
pnpm dev   # 后台
```
用 preview_start → preview_screenshot 首页。Expected：整体转白底/靛蓝，无 amber 暖调，字体变 Hanken Grotesk，无控制台报错。`pnpm check` 通过。

- [ ] **Step 6: 提交**

```bash
git add client/src/index.css
git commit -m "feat(theme): 全局 token swap 到 Linear 靛蓝/zinc，letter-spacing:0"
```

---

## Task 3: 共享 Linear 基元组件

**Files:**
- Create: `client/src/components/linear/primitives.tsx`
- Test: 通过 `pnpm check` + 在外壳里实际使用验证

- [ ] **Step 1: 实现基元（对照 app.css 的 `.card/.kicker/.page-h/.st/.bar/.seg/.badge/.pill/.chip`）**

```tsx
// client/src/components/linear/primitives.tsx
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export function LinearCard({ className, hover, children, ...p }: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-[11px] border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]',
        hover && 'transition-[box-shadow,border-color,transform] duration-150 hover:shadow-[0_4px_14px_rgb(0_0_0/0.09)] hover:border-[color:var(--acc-border)]',
        className,
      )}
      {...p}
    >
      {children}
    </div>
  );
}

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground', className)}>{children}</div>;
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.4px]">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusDot({ tone }: { tone: 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? 'var(--success)' : tone === 'amber' ? 'var(--warning)' : 'var(--destructive)';
  return <span className="relative inline-block h-[13px] w-[13px] shrink-0 rounded-full border-2" style={{ borderColor: color }}>
    <span className="absolute inset-[2px] rounded-full" style={{ background: color }} />
  </span>;
}

export function LinearBar({ value, className }: { value: number; className?: string }) {
  return <div className={cn('h-1.5 overflow-hidden rounded bg-[color:var(--secondary)]', className)}>
    <div className="h-full rounded bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>;
}

export function SegToggle<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="flex rounded-[7px] bg-[color:var(--secondary)] p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn('flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium whitespace-nowrap',
            value === o.value ? 'bg-card font-semibold text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]' : 'text-muted-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TypeBadge({ type }: { type: 'NPD' | 'ECO' | 'JDM' | string }) {
  const cls = type === 'NPD'
    ? 'bg-[color:var(--acc-soft)] text-primary border-[color:var(--acc-border)]'
    : type === 'ECO' ? 'bg-secondary text-[color:var(--secondary-foreground)] border-border'
    : 'bg-card text-[color:var(--secondary-foreground)] border-border';
  return <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-[6px] border px-2 text-[11px] font-semibold', cls)}>{type}</span>;
}
```

- [ ] **Step 2: 验证类型与渲染**

Run: `pnpm check`
Expected: 无 TS 报错。（实际渲染验证留待 Task 4 在外壳里用到时一并看。）

- [ ] **Step 3: 提交**

```bash
git add client/src/components/linear/primitives.tsx
git commit -m "feat(linear): 新增共享 Linear 基元（Card/Kicker/PageHeader/StatusDot/Bar/SegToggle/TypeBadge）"
```

---

## Task 4: 共享外壳（60px 图标栏 + 52px 顶栏）

**Files:**
- Modify: `client/src/pages/Home.tsx`（导航数据 `navItems` ~755 行；`<aside>` 845–997；`<header>` 1002+；顶部注释 1–4）

- [ ] **Step 1: 把侧栏从 stone-900 宽侧栏改为 60px 浅图标栏**

替换 `<aside>` 块为 Linear `.rail`：宽 60px、`bg-sidebar`(#fafafa)、右边框 `border-border`；顶部 30×30 靛蓝圆角 logo（`bg-primary text-white`）；`navItems` 渲染为 38×38 图标按钮，激活态 `bg-[color:var(--acc-soft)] text-primary`，hover `bg-secondary`；图标用现有 `lucide-react`（图标尺寸 18）；底部用户头像 28×28 `bg-primary` 圆。导航标签用 shadcn `Tooltip`（hover 出中文名）。**保留** `navItems` 的 id/onClick/路由逻辑不变。

- [ ] **Step 2: 把顶栏改为 52px 面包屑 + searchbox + 主操作**

替换 `<header>`：高 52px、`border-b border-border`、白底（去掉 `backdrop-blur`/暖色）；左侧面包屑（`text-[14px] font-semibold`，分隔符 `text-muted-foreground`，首段图标 `text-primary`）；右侧 230px searchbox（`<SegToggle>` 不在此，搜索框 32px 高、`border-border`、focus 时 `ring`）；主操作按钮用 shadcn `Button`（default variant 现在已是靛蓝）。保留现有搜索/快捷键/NotificationBell 逻辑。

- [ ] **Step 3: 更新顶部注释（1–4 行）**

```tsx
// Design: Linear style — zinc neutrals + indigo accent
// Main application with 60px icon rail + 52px topbar + view routing
// Font: Hanken Grotesk (self-hosted)
// Colors: #fafafa rail, #ffffff bg, #5e6ad2 indigo accent
```

- [ ] **Step 4: 验证外壳**

preview reload → preview_screenshot。Expected：60px 图标栏 + 52px 顶栏，靛蓝激活态，tooltip 出中文名，切换视图正常，无控制台报错。
`grep -nE 'stone-|amber-' client/src/pages/Home.tsx` 应仅剩内容区（非 shell）残留，shell 部分 0 命中。

- [ ] **Step 5: 提交**

```bash
git add client/src/pages/Home.tsx
git commit -m "feat(shell): Linear 60px 图标栏 + 52px 顶栏，保留导航/路由逻辑"
```

---

## Task 5: 项目组合看板（核心，Phase 1 视觉）

> Phase 2（拖拽推进/改派、WIP 硬限制、撤销、分组持久化）**不做**。本任务只做视觉/三视图切换/分组显示+本地折叠/筛选/搜索/详情抽屉。

**Files:**
- Modify: `client/src/components/views/ProjectListView.tsx`（40KB；列表+看板）、`client/src/components/views/GanttView.tsx`（时间轴）
- Reference: `项目组合看板.html`（自带完整 CSS + 交互 script，是最全参考）

- [ ] **Step 1: 顶部用 `<PageHeader>` + `<SegToggle>` 三视图（列表/看板/时间轴）**
- [ ] **Step 2: 看板列 = 6 阶段（概念→设计→EVT→DVT→PVT→量产）；列头显示数量；卡片用 `<LinearCard hover>`，含 `<StatusDot>` 风险灯 / 编号 / `<TypeBadge>` / 星标显示 / `<LinearBar>` 进度 / 负责人头像 / 下一评审。**
- [ ] **Step 3: 分组泳道（无/产品线/类型/负责人）用现有分组逻辑，折叠态用本地 `useState<Set>`（不持久化）。**
- [ ] **Step 4: 筛选 chip（按期/风险/告警/已标星）+ 搜索框，叠加现有过滤逻辑。**
- [ ] **Step 5: 点卡片 → 右侧详情抽屉用 shadcn `Sheet`（参数 / 6 段生命周期 stepper / 最近变更 / 推进按钮——推进仅调现有 mutation）。**
- [ ] **Step 6: 按映射表清理 `stone-/amber-/font-serif/font-mono/ce-*`。**

- [ ] **Step 7: 验证**

preview：切三视图、分组、折叠泳道、筛选、搜索、开抽屉，preview_screenshot 看板视图 + preview_console_logs 无错。
Run: `grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' client/src/components/views/ProjectListView.tsx client/src/components/views/GanttView.tsx`
Expected: 0 命中。`pnpm check` 通过。

- [ ] **Step 8: 提交** `git commit -m "feat(board): 项目组合看板 Linear 视觉改版（Phase 1）"`

---

## Task 6: 总览 Overview

**Files:** Modify `client/src/components/views/overview/OverviewPage.tsx` 及 `overview/` 子组件、`OverviewPanel.tsx`。Reference: `总览 Overview.html`。

- [ ] **Step 1:** 问候头 + 6 KPI 卡（`<LinearCard>` + `.num`）。
- [ ] **Step 2:** 全宽「今日聚焦」3 项。
- [ ] **Step 3:** 两栏（左：风险预警/组合进度；右：即将 Gate/阶段分布），两栏等高齐底（`items-stretch`）。
- [ ] **Step 4:** 按映射表清理旧类。
- [ ] **Step 5: 验证** preview_screenshot 总览；`grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' client/src/components/views/overview client/src/components/views/OverviewPanel.tsx` = 0；`pnpm check` 通过。
- [ ] **Step 6: 提交** `git commit -m "feat(overview): 总览 Linear 视觉改版"`

---

## Task 7: 我的任务 My Tasks

**Files:** Modify `client/src/components/views/MyTasksView.tsx`、`TaskListView.tsx`、`KanbanBoard.tsx`。Reference: `我的任务 My Tasks.html`。

- [ ] **Step 1:** 列表/看板双模式 `<SegToggle>`。
- [ ] **Step 2:** 按 逾期/进行中/已完成 分组；复选勾选即完成（复用现有 mutation）；优先级旗标；状态筛选 + 搜索。
- [ ] **Step 3:** 清理旧类。
- [ ] **Step 4: 验证** preview（勾选一个任务确认 toast/状态变更）；`grep` 三文件 = 0；`pnpm check`。
- [ ] **Step 5: 提交** `git commit -m "feat(mytasks): 我的任务 Linear 视觉改版"`

---

## Task 8: 需求池 Requirements

**Files:** Modify `client/src/components/views/RequirementsView.tsx`、`RequirementPoolPanel.tsx`（42KB）。Reference: `需求池 Requirements.html`。

- [ ] **Step 1:** 列表/看板双模式；按状态分组（新建/评估中/已立项/已拒绝）。
- [ ] **Step 2:** 投票数、来源徽章（客户/市场/内部）、来源筛选、已立项关联项目编号。
- [ ] **Step 3:** 清理旧类。
- [ ] **Step 4: 验证** preview_screenshot；`grep` 两文件 = 0；`pnpm check`。
- [ ] **Step 5: 提交** `git commit -m "feat(requirements): 需求池 Linear 视觉改版"`

---

## Task 9: 项目详情 Project Detail

**Files:** Modify `client/src/components/views/ProjectDetailView.tsx`（130KB — 最大；只改表现层，谨慎按区块改）。Reference: `项目详情 Project Detail.html`。

- [ ] **Step 1:** 头部（名称/`<TypeBadge>`/`<StatusDot>` 风险/负责人/`<LinearBar>` 进度/推进按钮）。
- [ ] **Step 2:** P1–P7 阶段进度条（stepper）。
- [ ] **Step 3:** 标签页用 shadcn `Tabs`（概览/任务/Gate/问题/变更/成员…保留现有全部 tab）。
- [ ] **Step 4:** 任务按阶段折叠可勾选。
- [ ] **Step 5:** 清理旧类（文件大，分多次 commit 也可）。
- [ ] **Step 6: 验证** preview：逐个 tab 点开看渲染 + console 无错；`grep` = 0；`pnpm check`。
- [ ] **Step 7: 提交** `git commit -m "feat(project-detail): 项目详情 Linear 视觉改版"`

---

## Task 10: 产品库 Products

**Files:** Modify `client/src/components/views/ProductLibraryView.tsx`（68KB）。Reference: `产品库 Products.html`。

- [ ] **Step 1:** 产品卡片网格（`<LinearCard hover>`：占位图 + 规格 + 在研项目数 + 当前阶段）。
- [ ] **Step 2:** 类别筛选 chip + 搜索。
- [ ] **Step 3:** 清理旧类。
- [ ] **Step 4: 验证** preview_screenshot 网格；`grep` = 0；`pnpm check`。
- [ ] **Step 5: 提交** `git commit -m "feat(products): 产品库 Linear 视觉改版"`

---

## Task 11: 日历 Calendar

**Files:** Modify `client/src/components/views/CalendarPage.tsx`（26KB）。Reference: `日历 Calendar.html`。

- [ ] **Step 1:** 月历网格；今天高亮（靛蓝）。
- [ ] **Step 2:** Gate/里程碑/紧急事件 chip 着色（靛蓝/警示/危险语义色）。
- [ ] **Step 3:** 清理旧类。
- [ ] **Step 4: 验证** preview_screenshot 月历；`grep` = 0；`pnpm check`。
- [ ] **Step 5: 提交** `git commit -m "feat(calendar): 日历 Linear 视觉改版"`

---

## Task 12: 设计稿外的面板逐个精细重做

> 这些不在 7 张设计稿里，但用户确认「按 Linear 风精细重做」。逐个用映射表 + 基元改皮，**保功能优先**。每个面板单独 commit。

**Files（逐个处理）:**
- `BomPanel.tsx`、`ChangeLog.tsx`（30KB）、`GateReviewModal.tsx`、`GateReadinessChecklist.tsx`、`GateStandardPanel.tsx`、`MembersPanel.tsx`（27KB）、`MetricsView.tsx`、`IssueList.tsx`（32KB）、`RisksPanel.tsx`、`AutomationSettings.tsx`、`CustomFieldsPanel.tsx`、`FilesPanel.tsx`、`FilePreviewModal.tsx`、`MeetingConfigPanel.tsx`、`ReleaseDialog.tsx`、`KickoffWizard.tsx`、`SOPLibraryView.tsx`、`TaskGanttView.tsx`、`PhaseDistributionChart.tsx`、`RescheduleConfirmDialog.tsx`、`shared/ProgressBar.tsx`、`shared/StatCard.tsx`、`shared/GateStandardPanel.tsx`

- [ ] **Step 1（每个文件）:** 按全局映射表替换硬编码类为 token/基元；shadcn 弹层统一 `Dialog/Sheet/Popover/DropdownMenu`。
- [ ] **Step 2（每个文件）:** `grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' <file>` = 0（`.xlsx-host/.docx-host` 例外）。
- [ ] **Step 3:** preview 抽查涉及该面板的入口（项目详情各 tab、Release、Kickoff）。
- [ ] **Step 4:** 分批提交，如 `git commit -m "feat(panels): <面板名> Linear 视觉改版"`。

---

## Task 13: 全局收尾扫描

**Files:** 全仓 `client/src`

- [ ] **Step 1: 全局残留扫描**

```bash
grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' client/src \
  | grep -vE 'xlsx-host|docx-host'
```
Expected: 0 命中（若有，回到对应屏清理）。

- [ ] **Step 2: 删除已无引用的 `.ce-*` 旧基元**

确认 `.ce-card/.ce-panel/.ce-kicker/.ce-page-header/.ce-table-shell/.ce-muted-band/.ce-control` 无引用后，从 `index.css` 的 `@layer components` 删除（保留 `.container`、Office 预览样式、scrollbar）。

- [ ] **Step 3: 类型检查 + 构建**

Run: `pnpm check && pnpm build`
Expected: 均通过。

- [ ] **Step 4: 全屏 preview 走查**

逐屏 preview_screenshot（总览/看板/我的任务/需求池/项目详情/产品库/日历）+ preview_console_logs 无错。

- [ ] **Step 5: 提交** `git commit -m "chore(theme): 删除遗留 ce-* 基元，收尾"`

---

## Self-Review 备注（已核对规格覆盖）

- 规格 §5.1 token swap → Task 2；§4 字体执行细节 → Task 1；§5.2 基元 → Task 3；§5.3 外壳 → Task 4；§5.4 七屏 → Task 5–11；§5.5 额外面板 → Task 12；「无残留旧类」完成标准 → 每屏 grep + Task 13。
- 看板 Phase 2 行为（DnD/WIP/撤销/持久化）**已排除**，仅 Task 5 注明边界。
- 类型一致：基元名（`LinearCard/Kicker/PageHeader/StatusDot/LinearBar/SegToggle/TypeBadge`）在 Task 3 定义，Task 5–12 一致引用。
