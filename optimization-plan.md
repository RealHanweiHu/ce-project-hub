# 珠峰项目管理网站 (CE Project Hub) 优化计划

## 1. 项目现状评估

珠峰项目管理网站（CE Project Hub）是一个专为消费电子产品开发设计的项目管理系统。经过前期的迭代，系统已经具备了较为完整的功能框架，包括四大视图（仪表盘、项目管理、SOP 流程库、任务视图）、三种 SOP 模板（NPD、ECO、IDR）、基于角色的权限控制体系、问题追踪、变更记录以及完整的前后端架构（Vite + React + tRPC + Drizzle ORM + MySQL）。

### 1.1 架构亮点
* **技术栈现代化**：采用了 tRPC 实现了端到端的类型安全，配合 Drizzle ORM 和 MySQL，保证了数据的结构化和一致性。
* **业务逻辑贴合**：内置了消费电子行业的标准 SOP 流程，贴合实际业务场景。
* **权限体系完善**：实现了基于角色的细粒度权限控制，从项目创建到任务级可见性都有覆盖。

### 1.2 核心痛点与瓶颈

通过对代码架构（特别是 `useProjectData.ts`、`Home.tsx` 和 `db.ts`）的深入分析，我们识别出当前系统存在以下核心问题：

#### 1.2.1 状态管理与数据同步机制存在性能隐患
当前项目详情页采用了一种**“全量聚合数据拉取 -> 客户端重组巨型对象 -> 局部修改 -> 全量对象回传 diff -> 批量触发多个 mutation”**的模式。
* 在 `useProjectData.ts` 中，前端并行发起 7 个 tRPC 请求拉取各维度数据，然后在客户端 `useMemo` 中重新拼装成一个庞大的旧版 `Project` 聚合对象。
* 在 `Home.tsx` 的 `ProjectDetailWrapper` 中，`handleUpdate` 接收整个更新后的 `Project` 对象，通过复杂的 diff 逻辑计算出变更，然后并行触发多个 mutation（如 `setTaskCompleted`、`setTaskMeta`、`createIssue` 等）。
* 这种模式在项目规模较小、任务较少时还能运行，但随着阶段、任务、问题、评审记录的增加，前端计算量和网络请求数将急剧上升，极易导致性能瓶颈和状态同步冲突（Race Condition）。

#### 1.2.2 前端组件体积庞大，职责耦合严重
* `ProjectDetailView.tsx` 行数超过 1100 行，是一个典型的“巨型组件”（God Component）。它内部混合了展示、表单、文件上传、状态派生等多种逻辑。
* `GanttView.tsx`（500+ 行）同样将时间轴计算、缩放控制、编辑状态和渲染逻辑耦合在一起。这种高耦合度不仅降低了代码的可维护性，也增加了后续功能扩展的难度。

#### 1.2.3 认证模块与路由装配不够清晰
* 在服务端的 `routers.ts` 中，认证逻辑（login、logout、register、changePassword）与业务路由混合在同一个顶层文件中。
* `createUser` 和 `resetPassword` 虽然使用了 `protectedProcedure`，但内部还需要手动检查 `ctx.user.role !== 'admin'`，存在权限校验逻辑分散的问题。
* 前端 `useAuth.ts` 中混入了 `localStorage` 的副作用，且存在与 `main.tsx` 错误拦截器双重重定向的冗余逻辑。

#### 1.2.4 数据库查询模式存在优化空间
* 在 `db.ts` 中，部分查询（如 `getProjectsByUser`）采用了“先查 membership，再用 `inArray` 查 projects”的两次查询模式，而非使用 `JOIN`，这在数据量增大时可能引发性能问题。

---

## 2. 优化目标与策略

### 2.1 优化目标
1. **提升性能与响应速度**：重构前后端数据交互模式，消除巨型对象 diff，减少不必要的网络请求。
2. **增强代码可维护性**：拆分巨型组件，解耦业务逻辑与 UI 渲染，规范化状态管理。
3. **完善基础设施**：优化认证模块结构，统一权限校验口径，提升数据库查询效率。
4. **提升用户体验**：优化甘特图等复杂交互组件的流畅度，提供更清晰的状态反馈。

### 2.2 优化策略
采取**“分层推进、逐步解耦”**的策略，优先解决影响最大的数据流和架构瓶颈，再逐步进行组件拆分和体验优化。

---

## 3. 详细优化方案 (Phased Action Plan)

### Phase 1: 数据交互层重构 (Data Flow Refactoring)
**目标**：打破现有的“全量拉取 -> 拼装 -> diff -> 批量更新”模式，转向细粒度的状态管理和乐观更新。

1. **废弃巨型 `Project` 聚合对象**：
   * 不再在 `useProjectData.ts` 中将所有关系型数据强行拼装回旧版嵌套结构。
   * 前端组件应直接消费细粒度的 tRPC 查询结果（如 `tasks.list.useQuery`、`issues.list.useQuery`）。
2. **引入细粒度 Mutation 与乐观更新 (Optimistic Updates)**：
   * 将修改操作下放到具体的子组件中。例如，任务状态的修改直接在 `TaskDetail` 组件中调用 `tasks.setMeta.useMutation`。
   * 利用 React Query 的 `onMutate` 实现乐观更新，提升 UI 响应速度，避免全页 loading。
3. **移除 `ProjectDetailWrapper` 中的复杂 diff 逻辑**：
   * 随着细粒度更新的实施，废弃 `handleUpdate` 中繁重的全量比对逻辑。

### Phase 2: 前端组件架构解耦 (Component Architecture)
**目标**：拆分 `ProjectDetailView` 等巨型组件，提升代码可读性和可复用性。

1. **重构 `ProjectDetailView`**：
   * 将其拆分为多个独立的区块组件：`ProjectHeader`（元信息）、`PhaseNavigator`（阶段导航）、`TaskChecklist`（任务列表）、`IssuePanel`（问题面板）等。
   * 每个区块组件自行负责其所需数据的拉取（通过细粒度 hook）和更新。
2. **优化 `GanttView` 甘特图组件**：
   * 将核心的时间轴计算逻辑抽离为自定义 hook（如 `useGanttTimeline`）。
   * 优化日期更新逻辑，避免拖拽或修改单个阶段日期时触发整个项目对象的更新。
3. **状态管理规范化**：
   * 对于确实需要跨组件共享的状态（如当前选中的阶段、过滤条件），引入轻量级状态管理（如 Zustand 或 Jotai），替代层层 Props 传递。

### Phase 3: 服务端与基础设施优化 (Backend & Infra)
**目标**：清理路由结构，优化查询性能，统一认证体系。

1. **路由与认证模块分层**：
   * 将 `auth` 相关的路由从顶层 `routers.ts` 中剥离，建立独立的 `auth.ts` 路由文件。
   * 优化 tRPC 中间件，引入 `adminProcedure` 以统一处理管理员权限校验，移除业务逻辑中重复的 `ctx.user.role !== 'admin'` 检查。
2. **数据库查询优化**：
   * 重构 `db.ts` 中的查询逻辑，将 N+1 查询或多次查询（如 `getProjectsByUser`）优化为 `JOIN` 查询。
   * 审查现有索引，确保针对高频过滤字段（如 `status`、`priority`、`dueDate`）建立合理的复合索引。
3. **清理前端 Auth 副作用**：
   * 移除 `useAuth.ts` 中与 `localStorage` 的不必要耦合。
   * 统一未授权跳转逻辑，依赖 `main.tsx` 中的全局错误拦截器，移除 `useAuth.ts` 中的重复重定向代码。

### Phase 4: 用户体验与细节打磨 (UX & Polish)
**目标**：提升交互细节，完善边缘场景处理。

1. **加载状态与骨架屏**：
   * 为数据加载过程引入 Skeleton 骨架屏，替代生硬的全局 Spinner。
2. **错误处理与反馈**：
   * 完善细粒度操作的错误反馈（如 Toast 提示），确保用户清楚了解操作结果。
3. **列表视图补充**：
   * 完善 `TaskListView`，补充缺失的负责人显示列。

---

## 4. 实施建议与里程碑

为了确保优化过程不影响现有业务的正常运行，建议按照以下里程碑逐步推进：

* **Milestone 1: 基础设施清理 (Phase 3)**
  * 预计时间：1 周
  * 成果：路由分层清晰，数据库查询优化，认证逻辑统一。
* **Milestone 2: 数据流重构验证 (Phase 1 局部)**
  * 预计时间：1-2 周
  * 成果：选取“问题追踪 (Issues)”或“变更记录 (Changelog)”作为试点，将其从全量更新改造为细粒度查询与更新，验证可行性。
* **Milestone 3: 核心视图拆分与彻底重构 (Phase 1 剩余 + Phase 2)**
  * 预计时间：2-3 周
  * 成果：彻底拆分 `ProjectDetailView`，废弃 `ProjectDetailWrapper` 的 diff 逻辑，全面推行细粒度更新。
* **Milestone 4: 体验打磨与验收 (Phase 4)**
  * 预计时间：1 周
  * 成果：UI 流畅度提升，骨架屏和反馈机制完善。
