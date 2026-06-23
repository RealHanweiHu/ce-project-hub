# 项目组合看板 Phase 2 — 交互增强 设计规格

> 状态：已确认（用户批准设计）
> 分支：`feat-board-phase2`（Phase 1 已合并 main）
> 日期：2026-06-23
> 前置：Phase 1 视觉改版 spec `docs/superpowers/specs/2026-06-23-linear-redesign-design.md`

## 1. 目标

给 Linear 风看板（`ProjectListView.tsx` 的看板视图）加上 Phase 1 明确排除的 5 个新交互行为：拖拽推进/回退、跨泳道改派、WIP 上限硬限制、撤销 toast、泳道折叠态持久化。

## 2. 已确认决策

| 决策点 | 选择 |
|---|---|
| 拖拽推进与 Gate 治理 | **PM/admin 覆盖 + 弹窗确认**：直接改 `currentPhase`，**不**生成 Gate 通过记录；仅 PM/admin 可拖；写 activity log 作审计 |
| 改派维度 | **仅 负责人(pmUserId) + 产品线(productId)**；类型(category) **不可**拖（改 category 会与已 seed 的 SOP 阶段/任务错位） |
| WIP 上限 + 折叠态存储 | **localStorage**（个人视图偏好，不动 schema） |

## 3. 关键架构决策：新增 `projects.move` patch mutation

**不复用 `projects.update`。** `update` 吃完整 `projectInputSchema`（`category`/`progress`/dates 等带默认值），从看板传不全的对象会**误清空 progress 等字段**。

新增 `projects.move`（server/routers/projects.ts）：
- 输入：`{ id: string, currentPhase?: string, pmUserId?: number | null, productId?: string | null }`（只传变化的字段）。
- 权限：仅 PM/admin（沿用现有 canManage / 项目权限判断；非授权 → FORBIDDEN）。
- 实现：调现有 `updateProject(id, patch)`（真 partial patch：`db.update(projects).set(patch)`），只 patch 传入字段。**不动** progress/dates/category。
- 审计：`createActivityLog`（action `project.move`，meta 记录 from/to）。因为绕过了 Gate，activity log 就是审计痕迹。
- 返回：`{ success: true }`。

## 4. 子功能

### 4.1 拖拽推进/回退（dnd-kit）
- 依赖：新增 `@dnd-kit/core`。
- 看板视图包一层 `DndContext`；每张卡 `useDraggable`，每个阶段列（+泳道）`useDroppable`。
- 仅 PM/admin 可拖（非授权用户卡片不挂 draggable）。
- `onDragEnd`：解析落点 = 目标阶段列 +（分组时）目标泳道。
  - 阶段变化 → **推进/回退**：弹确认框「手动覆盖：DEMO-XXX {fromPhaseLabel} → {toPhaseLabel}，不生成 Gate 通过记录。确认？」→ 确认后 `projects.move({id, currentPhase})`。
  - （见 4.2 改派、4.3 WIP）
- 乐观更新：先本地移动卡片，mutation 失败则回滚 + 错误 toast。

### 4.2 跨泳道改派
- 仅当 `groupBy === 'pm'`（负责人）或 `'line'`（产品线）时，跨泳道落下触发改派。
- `projects.move({id, pmUserId})` 或 `{id, productId}`（按分组维度）。
- `groupBy === 'cat'`（类型）或 `'none'` 时，跨泳道**不**改派（类型不可改；none 无泳道）。
- 同一次拖拽若既跨阶段又跨泳道：分别 patch（一次 move 调用可同时带 currentPhase + 改派字段）。

### 4.3 WIP 上限（硬限制）
- 列头显示「当前/上限」；上限数字旁 −/＋ 可点调整（每泳道列还是全列？→ 简单起见：**按阶段**设上限，跨泳道共享该阶段上限）。
- **硬限制**：拖拽目标阶段当前卡数 ≥ 上限时，禁止落下（onDragEnd 不执行 move）并 toast 提示「{stage} 已达 WIP 上限 {n}」。
- 存储：localStorage `wipLimits: Record<stageId, number>`（无上限 = 不限制）。

### 4.4 撤销 toast
- 每次拖拽写成功后 sonner toast：「已将 {name} {推进到/改派到} {target} · 撤销」。
- 点「撤销」→ 反向 `projects.move`（回原 currentPhase / pmUserId / productId）+ 乐观回滚卡片。

### 4.5 泳道折叠态持久化
- Phase 1 的折叠 `useState<Set>` 改为存 localStorage。

## 5. 单元划分

- `server/routers/projects.ts`：新增 `move` mutation（+ 服务端测试）。
- `client/src/hooks/useBoardPrefs.ts`（新）：封装 localStorage 读写 `{ wipLimits, collapsedLanes }`，单一职责、可独立测试。
- `client/src/components/views/ProjectListView.tsx`：看板视图加 `DndContext` + draggable/droppable + `onDragEnd` 派发（推进/改派/WIP 阻止）；列头 WIP 控件；确认框（复用 shadcn Dialog/AlertDialog）；撤销 toast（复用 sonner）。折叠态接 `useBoardPrefs`。

## 6. 数据流

拖拽 → onDragEnd 解析 → （WIP 满则阻止）→ 推进弹确认 → `trpc.projects.move` → 成功后乐观态确认 + 撤销 toast；失败回滚 + 错误 toast。WIP/折叠态纯前端 localStorage，不走 tRPC。

## 7. 错误处理

- mutation 失败：回滚乐观更新，错误 toast，卡片回原位。
- 权限：非 PM/admin 不挂 draggable（前端）；server 端 `move` 仍校验权限（后端兜底）。
- WIP 满：阻止落下，提示，不调 mutation。

## 8. 测试

- 服务端：`projects.move` 测试 —— (a) 只 patch 传入字段（progress 不变），(b) 非授权用户 FORBIDDEN，(c) 同时带 currentPhase + pmUserId 都生效。
- 前端：preview 实测 —— 拖拽推进（确认框 → 阶段变）、回退、跨泳道改派（负责人/产品线分组下）、WIP 硬限制阻止、撤销还原、折叠态刷新后保持。
- `pnpm check` + 现有 365 测试不回归。

## 9. 非目标（YAGNI / 明确不做）

- 类型(category)拖拽改派（会破坏 SOP 阶段一致性）。
- 拖拽推进生成/联动 Gate 评审记录（本期是"覆盖"语义，正式推进仍走项目详情的 Gate 流程）。
- WIP 上限存服务端 / 团队共享（本期个人 localStorage）。
- 列表/时间轴视图的拖拽（仅看板视图）。
- 触屏拖拽优化（先桌面）。

## 10. 不回归（保 Phase 1）

- 看板的三视图切换、筛选/搜索、分组显示、详情抽屉、克隆/删除入口（Phase 1 + 回归修复 b4f0967）全部保留。
- 全仓 0 残留 stone/amber/ce-* 不破。
