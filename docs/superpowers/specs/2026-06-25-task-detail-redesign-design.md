# 任务详情页改版（Linear 两栏 + 4 标签 + 逐任务审批闸门）设计规格

> 状态：待用户评审
> 分支：feat-product-simplify（或新建 feat-task-detail）
> 日期：2026-06-25

## 1. 目标

把任务详情弹窗从单栏改为 **Linear 风两栏**（左主栏内容 + 右属性栏），并把底部信息区做成 **4 个标签：评论 / 活动 / 流转 / 状态审批**。其中：
- 评论：复用现有 `CommentThread`。
- 活动：任务自身操作日志时间线（复用 `activity_logs`）。
- 流转：任务状态生命周期步进时间线（`activity_logs` 子集渲染）。
- 状态审批：**逐任务、默认关**的审批闸门 —— 开启后该任务「勾完成 → 待审批 → 审批人通过才真正完成」。

**核心不变量**：`completed=true` 只在审批通过后置位；`requiresApproval` 默认 false，存量任务/demo/看板/进度/Gate/自动化全部零回归。

## 2. 已确认决策

| 决策点 | 选择 |
|---|---|
| 标签范围 | 4 个全做真功能（评论已有；活动/流转/状态审批 新建） |
| 状态审批语义 | 审批即完成闸门（勾完成→待审→通过才计入完成；驳回退回未完成） |
| 闸门范围 | **逐任务开关 `requiresApproval`，默认关，零回归** |
| 审批历史 | 走 `activity_logs`，不新建审批历史表 |

## 3. 现状（已核对，含行号）

- 任务弹窗（单栏 fixed overlay，`max-w-2xl`）：`client/src/components/views/ProjectDetailView.tsx` 约 2407–2702；内含 `TaskDetail`（1030–1306，渲染 负责人/截止/状态/优先级 网格 + 执行说明 + 附件 + 可见岗位）。
- 任务状态自动重算：`server/db.ts`
  - `automaticTaskStatus`（1833–1855）：**只保留 `skipped`，以及 `completed||done`→`done`**；其余按 起始日/依赖/指派/截止 重算为 todo/blocked/in_progress。**`pending_approval` 会被它吞掉**。
  - 依赖判定（1844–1848）：依赖任务 `status!=="done" && !=="skipped" && !completed` 视为未解决 → 下游 blocked。`pending_approval`（completed=false）天然被当「未完成」，符合预期。
  - `refreshProjectTaskStatuses`（1880+）：对每行套用 `applyAutomaticTaskStatuses`（1857，`completed = status==="done"`）。
  - `setTaskCompletion`（1964–1978）：勾选即 `status=done/todo` + `completed` + 立即 `refreshProjectTaskStatuses`。
- 任务状态枚举：`drizzle/schema.ts:455` `TASK_STATUSES=["todo","in_progress","blocked","done","skipped"]`；`taskStatusEnum`（460）；`project_tasks.status`（494）。
- 看板固定 5 列：`client/src/components/views/KanbanBoard.tsx:5` `COLUMNS`。
- 状态中文标签分散在：`TaskListView.tsx` `STATUS_CONFIG`（56–60）、`CalendarPage.tsx` statusLabel（130–133）、`ProjectDetailView.tsx` `TASK_STATUS_CONFIG`（1110–1116）、`KanbanBoard.tsx` `COLUMNS`（5）。
- `activity_logs` 表（`drizzle/schema.ts` ~951）：`projectId/userId/action/entityType/entityId/meta(jsonb)/createdAt`，已被 `tasks.ts` 各 mutation 通过 `createActivityLog`（`server/db.ts` ~1748）写入；**但无任何 API 读取**。
- 现有审批范式可参考：交付物审核 `server/routers/deliverableReviews.ts`、Gate 评审 `server/routers/gateReviews.ts`、工艺裁剪 `server/routers/tailoring.ts`。
- 权限：`canEditTasks` 含研发角色（**不止 PM/admin**）；`canEditProjectInfo` 更窄。

## 4. 设计

### 4.1 版式（前端）

`max-w-2xl → max-w-4xl`，保留遮罩/Esc/关闭。
- **顶部整宽**：类型徽标（IDR/NPD/Gate）+ `task.name` + `task.desc` + 关闭；保留 Done/Gate 徽标。
- **两栏**：`grid lg:grid-cols-[1fr_300px]`，移动端纵向堆叠。
  - **左主栏**：操作指南（有 `task.guide` 才显示）→ 交付物 N/M（`DeliverablesChecklist`）→ 网关任务专属区块（Gate 就绪检查 / Gate 管理标准 / 关联问题，**仅网关任务显示，保留全部功能**，放在交付物下方、不进任何标签）→ 执行说明（textarea）→ **标签区**（评论/活动/流转/状态审批）。
  - **右属性栏**（`bg-secondary` 浅底）：负责人、截止日期、状态（含「待审批」态）、优先级、**需审批开关 + 审批人**(新)、附件（`FileUploadArea` 从主栏移来）、可见岗位（admin）、责任角色（只读）。
- `TaskDetail` 拆解：meta/附件/可见岗位 → 右属性栏；执行说明 → 左主栏。逻辑与 mutation 不变，仅重组 JSX。

### 4.2 四个标签

标签状态 `activeTab: 'comments'|'activity'|'flow'|'approval'`，默认 `comments`。

- **评论**：`CommentThread`（entityType=`task`，entityId=`${projectId}:${taskId}`），不变。
- **活动（任务活动）**：新增 `tasks.activity` 查询 → **`getTaskActivityLogs(projectId, phaseId, taskId)`**（`activity_logs` where entityType='task' AND entityId=taskId **AND `meta->>'phaseId' = phaseId`**，新→旧）。任务唯一身份是 `(projectId, phaseId, taskId)`，而 activity 的 entityId 只是 taskId、phaseId 在 meta 里；**必须带 phaseId 过滤**，否则不同阶段同名 taskId 会串任务。**前置要求**：所有 task 维度活动日志写入时 `meta` 必须含 `phaseId`（核对/补齐 `tasks.ts` 各 `createActivityLog` 调用）。渲染只读时间线：操作人 + 中文化动作 + 相对时间。**范围 = 任务自身活动**（meta/完成/交付物/执行说明/审批动作）；附件/关联问题事件目前不是 task 维度日志，**明确不纳入**（非目标，见 §9）。
- **流转**：同一查询的子集（仅状态/审批迁移动作：`task.complete/uncomplete/submit_approval/approve/reject`），渲染为竖向步进时间线：`fromStatus → toStatus` + 人 + 时间 + 意见。
- **状态审批**：见 §4.3，展示当前审批态 + 操作（提交/通过/驳回）+ 历史（取 activity 子集）。

### 4.3 审批闸门状态机（核心）

字段（见 §4.4）：`requiresApproval`、`approverUserId`、`approvalStatus∈{none,pending,approved,rejected}`、`approvalNote`、`approvalRequestedBy/At`、`approvalDecidedBy/At`。任务 `status` 新增 `pending_approval`。

**正常态（requiresApproval=false）**：勾完成 → `status=done, completed=true`（与现状完全一致），`approvalStatus` 恒 `none`。

**闸门态（requiresApproval=true）**：
1. **提交**：勾完成 → `status=pending_approval, completed=false`，`approvalStatus=pending`，`approvalRequestedBy=actor, approvalRequestedAt=now`。日志 `task.submit_approval {from, to:pending_approval, requester}`。通知 approver。
2. **通过**（approver 或 admin）：`status=done, completed=true, completedAt=now`，`approvalStatus=approved, approvalDecidedBy/At, approvalNote`。日志 `task.approve {from:pending_approval,to:done,approver,note,proxyBy?}`。通知 requester。
3. **驳回**（approver 或 admin）：`completed=false, approvalStatus=rejected, approvalDecidedBy/At, approvalNote`；**`status` 不写死** —— 清掉 pending 后交给 `refreshProjectTaskStatuses`/`automaticTaskStatus` 归位（结果按排期/依赖可能为 todo/in_progress/blocked，贴合现有系统）。日志 `task.reject {from:pending_approval,to:<归位后状态>,approver,note,proxyBy?}`。通知 requester。
4. **撤回**（requester/editor 取消勾选 pending_approval 任务）：`completed=false, approvalStatus=none`；`status` 同样交给 `automaticTaskStatus` 归位（非写死）。日志 `task.uncomplete`。

**边界（必须实现，避免 UI/测试各自猜）**：
- **待审时关闭「需审批」开关**：若当前 `pending_approval` → **取消在途审批（`approvalStatus=none`）、`completed=false`，status 交给 `automaticTaskStatus` 归位**（不擅自替用户判定通过）。用户可重新勾选（此时直接完成）。
- **改审批人**（PM/admin，pending 期间允许）：更新 `approverUserId`，`approvalStatus` 仍 `pending`，通知新审批人，日志 `task.update_meta {approver: old→new}`；原审批人不再有裁决权。
- **驳回后再次提交**：rejected 任务回到 `automaticTaskStatus` 归位的非终态，再勾完成 → 新一轮 `pending`（新 `approvalRequestedAt`）。历史在 activity_logs 顺序可见。
- **通过后重开任务**（取消勾选 done+approved）：回 `in_progress, completed=false, approvalStatus=none`；再勾选 → 新审批轮。日志 `task.uncomplete`。
- **审批人被移出项目**：`approverUserId` 可能指向非成员。裁决权 = `actor===approverUserId || admin`；审批人缺位时 **admin 代审**，或 PM/admin 改派审批人。
- **admin 代审记录**：`approvalDecidedBy=admin.id`，日志 meta 带 `proxyBy`（actor!==approverUserId 时），UI 显示「（管理员代审）」。
- **对已完成任务开「需审批」**：保持 `done`、`approvalStatus=none`（不追溯闸门）；仅之后「取消勾选→再勾选」才会走审批。

### 4.4 数据模型（`drizzle/schema.ts`）

- `TASK_STATUSES` 增 `"pending_approval"`（→ `taskStatusEnum` 需 PG `ALTER TYPE ADD VALUE`，见 §5）。
- 新 `taskApprovalStatusEnum = pgEnum("task_approval_status", ["none","pending","approved","rejected"])`（CREATE TYPE，无 ADD VALUE 问题）。
- `project_tasks` 新增列（全部可空或安全默认 → 存量零回归）：
  - `requiresApproval boolean not null default false`
  - `approverUserId integer`（FK users，可空）
  - `approvalStatus taskApprovalStatusEnum not null default 'none'`
  - `approvalNote text`（可空）
  - `approvalRequestedBy integer` / `approvalRequestedAt timestamp`（可空）
  - `approvalDecidedBy integer` / `approvalDecidedAt timestamp`（可空）
- `TaskDetails`（`client/src/lib/data.ts`）补：`requiresApproval?, approverUserId?, approvalStatus?, approvalNote?, approvalRequestedBy?, approvalRequestedAt?, approvalDecidedBy?, approvalDecidedAt?`，并在 task 数据映射处带出。

### 4.5 服务端

- `server/db.ts`
  - **`automaticTaskStatus`**：开头加 `if (task.status === "pending_approval") return "pending_approval";`（在 skipped 之后、completed 之前），使其成为 **显式保留状态**；`completed` 仍由 `status==="done"` 派生（pending_approval→false），下游依赖天然视为未完成。
  - **`setTaskCompletion`（改为「完成日志只由一层写」+ 返回 outcome）**：完成分支先读任务 `requiresApproval`：
    - 普通完成 → `status=done, completed=true`，outcome=`completed`。
    - 需审批 + 勾完成 → `status=pending_approval, completed=false, approvalStatus=pending, approvalRequestedBy/At`，outcome=`submitted`（通知 approver）。
    - 取消勾选 → `completed=false, approvalStatus=none`，**status 交 refresh 归位**，outcome=`uncompleted`。
    - **唯一日志规则（重要）**：完成 / 待审提交 / 取消 的 activity 日志**全部在 `setTaskCompletion` 内按 outcome 写**（三选一：`task.complete` / `task.submit_approval` / `task.uncomplete`）。`tasks.setCompleted` router **删除原有盲写**（现状：setTaskCompletion 后无脑写 `task.complete/uncomplete`，会把「待审提交」错记成「完成」），改用 helper 返回的 outcome 决定 toast/通知。其余调用方（如 `gate.confirmAndAdvance`）自动受益于单写层。
  - 新 `decideTaskApproval(projectId, phaseId, taskId, decision, actor, note)`：
    - approve → `status=done, completed=true, approvalStatus=approved`。
    - reject → `completed=false, approvalStatus=rejected`，**status 交 `refreshProjectTaskStatuses` 按 `automaticTaskStatus` 归位**（todo/in_progress/blocked 皆可能）。
    - 在 helper 内写唯一 `task.approve`/`task.reject` 日志（meta 带 from/to/note/approver/requester/proxyBy）+ 通知 requester。
- `server/routers/tasks.ts`
  - `activity`（query）：`getTaskActivityLogs`，输出 join 用户名。
  - `setApprovalConfig`（mutation，权限见 §4.6）：设 `requiresApproval` + `approverUserId`；含「待审时关开关 → 退回 in_progress」边界。
  - `decideApproval`（mutation）：approver/admin 通过·驳回 + 意见。
- 通知：复用现有通知基建（提交→审批人；裁决→提交人）。

### 4.6 权限口径（修正方案中的冲突）

- **配置审批（开关/审批人）**：`canEditProjectInfo`（或显式 owner/manager/pm/admin）—— **不用 `canEditTasks`**（含研发角色）。
- **裁决（通过/驳回）**：`actor===approverUserId || isAdmin`。
- **提交（勾完成触发待审）**：沿用现有 `canEditTasks && 阶段解锁`。

### 4.7 「待审批」展示口径（全站）

新增 `pending_approval`「待审批」（warning 色）到：
- `KanbanBoard.COLUMNS`：插一列（顺序：待办/进行中/阻塞/**待审批**/完成/跳过）。
- `TaskListView.STATUS_CONFIG`、`CalendarPage` statusLabel、`ProjectDetailView.TASK_STATUS_CONFIG`。
- **勾选框**：pending_approval 渲染为 **独立「待审」态**（沙漏/时钟 warning 图标，**非空、非已勾**），点击=撤回（requester），tooltip「待审批中，点击撤回」。避免用户误以为没提交而反复点。
- **我的任务**：assignee 仍能在我的任务看到该任务（带「待审批」徽标）；approver 经现有列表可见（专门「待我审批」队列列为非目标/后续）。
- **逾期统计**：pending_approval = 未完成；若 `dueDate` 已过仍按未完成计入逾期（并同时显示「待审批」徽标）。口径明确：逾期判定不变（基于 completed/done）。

## 5. 迁移（Postgres enum 小心处理）

- **手写幂等迁移**（不完全依赖 `drizzle-kit generate` 的默认产物）：
  1. `ALTER TYPE "task_status" ADD VALUE IF NOT EXISTS 'pending_approval';`（独立语句，先于建列；PG12+ 允许，且本迁移内不使用该值）。
  2. 新枚举幂等创建（**PG 无通用可靠的 `CREATE TYPE IF NOT EXISTS`**，用 DO 块吞 duplicate_object）：
     ```sql
     DO $$ BEGIN
       CREATE TYPE "task_approval_status" AS ENUM ('none','pending','approved','rejected');
     EXCEPTION WHEN duplicate_object THEN NULL;
     END $$;
     ```
  3. `ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS ...`（全部可空/带安全默认）。
- 流程：`drizzle-kit generate` 生成草稿后 **人工核对/改写**，确保上述顺序与幂等性；运行时 drizzle migrator 幂等应用（与现有机制一致）。
- 存量行：所有新列默认值/空，`requiresApproval=false` → 完成路径不变。

## 6. 错误处理

- 开「需审批」但未设审批人：阻止开启（提示先选审批人），或允许但仅 admin 可裁决。采前者（开关与审批人同表单提交）。
- 提交/裁决竞态：以 `approvalStatus` 当前值为准做幂等（重复通过=no-op）。
- 通知失败不阻断主流程（沿用现有 best-effort）。

## 7. 测试 / 验收

**服务端单测**：
- `setApprovalConfig` 写入开关/审批人 + 权限校验（canEditProjectInfo 通过、纯研发拒绝）。
- 需审批任务勾完成 → `status=pending_approval, completed=false, approvalStatus=pending, approvalRequestedBy` 已写。
- `decideApproval` 通过 → done/completed=true/approved；驳回 → completed=false/approvalStatus=rejected 且 status ∈ {todo,in_progress,blocked}（automaticTaskStatus 归位，**不断言硬 in_progress**）。
- `tasks.activity`（带 phaseId）返回该任务条目（含新动作），不串到其他阶段同名 taskId。
- 完成日志单写：需审批任务勾完成只产生 `task.submit_approval`（**不得**同时出现 `task.complete`）。
- 边界：待审时关开关→approvalStatus=none、completed=false、status 归位；admin 代审 proxyBy 记录。

**硬验收（不回归 + 用户追加 2 条）**：
- 【追加1】`refreshProjectTaskStatuses` **不会覆盖** `pending_approval`（automaticTaskStatus 保留）。
- 【追加2】`pending_approval` 在 **看板 / 我的任务 / 日历 / 逾期统计** 都有明确展示口径（如上 §4.7）。
- `requiresApproval=false` 任务：完成路径、`completed`、进度（`computeOverallProgress`）、看板、Gate 就绪 与现状逐一一致。
- 改动文件 0 残留 `stone-` / **`amber-` Tailwind 类名** / `font-serif` / `font-mono` / `ce-*`。注意「待审批」用 `var(--warning)` token（不是 amber 类名），二者不冲突。

**前端走查**：两栏版式、4 标签切换、需审批开关→勾完成→approver 通过/驳回 闭环、待审批徽标在看板/列表出现。

## 8. 单元 / 架构

- 前端弹窗重构集中在 `ProjectDetailView.tsx`（任务弹窗 + `TaskDetail` 拆分）；新增小组件：`TaskActivityTab` / `TaskFlowTab` / `TaskApprovalTab`（可同文件或 `views/task/` 下新文件，单一职责）。
- 服务端改动集中在 `server/db.ts`（automaticTaskStatus / setTaskCompletion / decideTaskApproval / getTaskActivityLogs）+ `server/routers/tasks.ts`（activity/setApprovalConfig/decideApproval）+ `drizzle/schema.ts`。
- **并行会话风险**：`drizzle/schema.ts`、`server/db.ts`、`server/routers/tasks.ts`、`ProjectDetailView.tsx` 均为热点文件，提交只 stage 自己的文件，必要时协调；加列/加枚举/改完成逻辑要避免与并行迁移撞车。

## 9. 非目标（YAGNI）

- 不做「待我审批」全局队列（后续）。
- 不把附件/关联问题事件纳入「活动」（保持「任务自身活动」；如需另加 task 维度日志，后续）。
- 不引入多级/会签审批（单审批人，admin 可代审）。
- 不改交付物审核 / Gate 评审 / 裁剪审批 既有机制。

## 10. 不回归

- 默认关 → 存量任务完成/进度/看板/Gate/自动化全不变。
- 活动/流转 为只读视图，不改写任何业务数据。
- 审批仅作用于显式开启 `requiresApproval` 的任务。
