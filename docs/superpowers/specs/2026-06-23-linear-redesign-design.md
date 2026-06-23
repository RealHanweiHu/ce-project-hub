# Linear 风格前端改版 — 设计规格

> 状态：已确认（用户最终确认设计稿 + 实施策略）
> 分支：`linear-redesign`
> 日期：2026-06-23
> 权威设计源：`/Users/huhanwei/Desktop/design_handoff_ce_hub/`（7 个 HTML 高保真稿 + `app.css` 设计系统 + `README.md`）

## 1. 目标

把 CE Project Hub 前端从「工业精密」风格（stone/amber + Playfair Display + JetBrains Mono）
整体改版为 **Linear 风格**：冷调中性灰（zinc）、靛蓝点缀（`#5e6ad2`）、Hanken Grotesk 字体、
克制圆角与阴影、清晰层级。

**核心原则：只改表现层，不动数据与业务逻辑。** 现有视图已正确接好 tRPC、状态管理与业务规则；
本次只翻译视觉（token / 布局 / 基元），数据 hooks、mutation、逻辑保持不变。

## 2. 已确认的决策

| 决策点 | 选择 |
|---|---|
| 本次范围 | 全部 7 屏一次性重建 |
| 分支 | 新建 `linear-redesign` |
| 设计稿未涵盖的面板（BOM/变更记录/Gate 评审/成员/指标/风险/自动化设置等） | 按 Linear 风**精细重做**（逐个） |
| 设计稿与现有功能冲突时 | **保功能，视觉让步**（任何现有功能/数据接线不得因改版丢失） |

## 3. 现状（目标代码库）

- React 18 + Vite + TypeScript + **Tailwind v4** + shadcn/ui + wouter + tRPC。
- 应用为**单页**：`client/src/pages/Home.tsx`（1146 行）通过 state + URL query 切换视图，
  **非**每页 wouter 路由。视图切换/URL 同步逻辑保持不变。
- ~32 个视图组件位于 `client/src/components/views/`，部分很大
  （ProjectDetailView 130KB、ProductLibraryView 68KB、RequirementPoolPanel 42KB、
  ProjectListView 40KB、OverviewPanel 32KB、IssueList 32KB、ChangeLog 30KB）。
- 主题机制：`client/src/index.css` 用 Tailwind v4 `@theme inline` 把 shadcn 语义 token
  （`--primary`/`--background`/`--radius`/字体…）映射到 `:root` 的 oklch 变量。
  **这是改版落点**——换 token 即可让所有 shadcn 组件自动变 Linear 风。
- 字体为**自托管 woff2**（`/fonts/...`，为中国大陆可访问性），不用 Google CDN。

## 4. 设计 Token（权威：`app.css` 的 `:root`）

- **字体**：`Hanken Grotesk`（自托管，权重 400/500/600/700），`letter-spacing:-.01em`；
  数字 `font-variant-numeric:tabular-nums`（`.num`）。
- **颜色**：
  - 背景 `#ffffff` · 侧栏/面板 `#fafafa` · hover `#f7f7f8`
  - zinc：z100 `#f4f4f5` · z200 `#e9e9eb` · z300 `#d8d8dc` · z400 `#a1a1aa` · z500 `#71717a` · z600 `#52525b`
  - 文本 `#1a1a1e` · 次级 `#71717a` · 分隔线 `#ededee` / `#f2f2f3`
  - 主强调（靛蓝）`#5e6ad2`（hover `#4f5ac4` · 浅底 `#eef0fb` · 边 `#d9ddf6`）
  - 语义：成功 `#3fa66a`（浅 `#e7f6ee`）· 警示 `#d68a22`（浅 `#fbf0dd`）· 危险 `#e5484d`（浅 `#fdeceb`）· 星标 `#f5b301`
- **圆角**：卡片 11px · 按钮 7–8px · chip/pill/badge 6–7px · 输入/段落卡 9–12px。
- **阴影**：基础 `0 1px 2px rgba(0,0,0,.03)`；卡片 hover `0 4px 14px rgba(0,0,0,.09)`；下拉/抽屉更重。
- **尺寸**：左侧图标栏 60px；顶栏 52px；内容区左右 padding 28px。

## 5. 架构与单元

### 5.1 基础层 — 全局 token swap（先做，约拿下 60% 观感）
重写 `client/src/index.css` 的 `:root` + `@theme inline` 块：
- 字体：Playfair/JetBrains/Source Sans → 自托管 **Hanken Grotesk**；移除 serif/mono 强制。
- 把 app.css token 映射到 shadcn 语义：`--primary`=`#5e6ad2`，`--background`=`#fff`，
  `--accent`=`--acc-soft`，`--destructive`=`#e5484d`，`--border`=`#e9e9eb`，`--radius`=11px，
  并新增成功/警示/星标 token。
- 因 shadcn Card/Button/Badge/Dialog/DropdownMenu/Sheet/Popover 等都读这些 token，
  全部视图自动迁移到 Linear 风。

### 5.2 共享基元 — `linear-primitives`
把 app.css 的 `.rail/.seg/.chip/.pill/.st/.badge/.bar/.card` 等基元
落为一小组 React 组件 / shadcn variants，供各屏组合复用，避免逐页重写 CSS。
单一职责、明确接口、可独立测试。

### 5.3 共享外壳 — `Home.tsx`
重建：60px 图标导航栏（我的任务/总览/项目组合/项目管理/日历/产品库/需求池）
+ 52px 顶栏（面包屑 + searchbox + 主操作按钮）+ 内容区。
**视图切换/URL 同步/懒加载逻辑保持不变**，只换外观。

### 5.4 七屏（复用逻辑，重皮 UI）
1. **项目组合看板（核心）**：列表/看板/时间轴(甘特) 三视图；6 阶段列；
   分组泳道（无/产品线/类型/负责人，可折叠持久化）；WIP 上限（硬限制 + toast 撤销）；
   拖拽（阶段=推进/回退，跨泳道=改派）建议 dnd-kit；筛选+搜索；卡片标星；右侧详情抽屉。
2. **总览**：问候 + 6 KPI + 全宽今日聚焦 3 项 + 两栏等高齐底。
3. **我的任务**：列表/看板双模式；逾期/进行中/已完成分组；勾选即完成；优先级旗标。
4. **项目详情**：头部 + P1–P7 阶段进度条 + 多标签页；任务按阶段折叠可勾选。
5. **需求池**：列表/看板双模式；状态分组；投票数、来源徽章、筛选。
6. **产品库**：产品卡片网格；类别筛选 + 搜索；图片为占位/接真实图源。
7. **日历**：月历；Gate/里程碑/紧急事件 chip 着色；今天高亮。

### 5.5 设计稿外的面板
BOM / 变更记录 / Gate 评审 / 成员 / 指标 / 风险 / 自动化设置 等：
按相同 token 与基元**逐个精细重做**为 Linear 风（保功能优先）。

## 6. 数据流

不改变。所有视图继续用现有 tRPC 路由（projects/tasks/issues/gateReviews/changelog/requirements…）
与现有 hooks（如 `useProjectData`）。看板拖拽/WIP/分组的临时态可用本地 state，
持久化走现有 tRPC mutation（不引入 localStorage 作为真实存储）。

## 7. 错误处理与回退

- 「保功能，视觉让步」：改版中若某交互无法在新皮肤下完整保留，保留旧交互、视觉后续再追。
- 逐屏提交（每屏一个 commit），便于回退与 review。
- 现有 `ErrorBoundary` / toast / 服务恢复提示保持。

## 8. 测试与验证

- 每屏改完用 preview 工具（snapshot/screenshot/console_logs）实测，不靠断言。
- `pnpm check`（tsc --noEmit）保持通过。
- 关键交互（拖拽推进、勾选完成、筛选、抽屉）手动走查一遍。

## 9. 实施顺序

token 主题 → 共享基元 → 共享外壳 → 项目组合看板 → 总览 → 我的任务/需求池
→ 项目详情 → 产品库/日历 → 其余面板逐个精细重做。逐屏提交。

## 10. 非目标（YAGNI）

- 不重写业务逻辑、数据层、tRPC 路由。
- 不做与改版无关的重构。
- 不引入 localStorage 作为真实持久化（仅原型稿如此）。
- 不改路由架构（维持单页 + URL query 切换）。
