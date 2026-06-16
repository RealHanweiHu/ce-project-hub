# 流程/Gate 裁剪 + 审核 设计

日期：2026-06-16
状态：设计已确认，待写实施计划

## 背景与目标

部分项目客户会提供现成产出（如客户提供工业设计 ID、客户提供内部结构设计），对应的标准 SOP 流程里某些阶段/任务/Gate 就不必再做。当前系统没有成体系的"流程裁剪"能力——`project_tasks.status` 虽有 `skipped`，但只能逐个手动标、无原因、无审核、不影响进度/Gate 计算。

本功能新增**项目级流程裁剪 + 审核**：PM 提报裁剪申请（选阶段/任务 + 原因）→ admin 审批 → 通过后被裁部分跳过，不再拖累进度、不卡 Gate、不上日历，全程留痕，且可撤销。

## 关键决策（已确认）

1. **粒度**：阶段级为主 + 任务级补充。一次申请可裁"整个阶段"（连带其任务+Gate）或"阶段内的个别任务"。
2. **审核形态**：PM 提报 → admin 一键通过/驳回。**通过才生效**，驳回只留痕。
3. **审批人**：admin（管理层）。复用现有 admin 角色。
4. **原因**：预设原因类型（`customer_id` 客户提供ID / `customer_structure` 客户提供结构设计 / `reuse_mature` 沿用成熟方案 / `other` 其他）+ 自由说明。
5. **时机**：项目进行中**任何时候**都能提报（针对"尚未完成"的阶段/任务）。
6. **可撤销**：admin 可撤销已生效的裁剪，被跳过的阶段/任务恢复为未完成；撤销不再走审批。
7. **单一事实源**：以裁剪记录为准。审批通过时既把目标任务置 `skipped`（让现有任务视图/聚合自动识别），也让进度/Gate/日历改读"有效流程（模板 − 已批准裁剪）"。
8. **交付物流转**：节点被裁后，其应交付物**自动归集到下一个有效 Gate 提交**；团队可从"模板派生的交付物清单"里按项目实际增删，灵活调整。归集为派生（基于已批准裁剪），手工调整以 override 持久化。

非目标（本次不做）：原因→裁剪项的自动联动建议；裁剪的多角色会签评审；裁剪模板/category 级预设；可维护的交付物主数据后台（资源库即模板派生清单，不做 CRUD）。

## 数据模型

新增表 `project_tailoring`（一行 = 一次裁剪申请，可含多个目标）：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `projectId` | varchar(32) | 所属项目 |
| `reasonType` | enum | `customer_id` / `customer_structure` / `reuse_mature` / `other` |
| `reasonNote` | text | 补充说明 |
| `targets` | jsonb | `Array<{ scope: 'phase' \| 'task'; phaseId: string; taskId?: string }>`，一次申请的裁剪对象 |
| `status` | enum | `pending` / `approved` / `rejected` / `revoked` |
| `proposedBy` | integer | 提报人 userId |
| `proposedAt` | timestamp | |
| `reviewedBy` | integer null | 审批/撤销人 userId |
| `reviewedAt` | timestamp null | |
| `reviewNote` | text null | 审批/驳回/撤销意见 |
| `createdAt/updatedAt` | timestamp | |

Drizzle：新增 `tailoringReasonEnum`、`tailoringStatusEnum`、`projectTailoring` 表 + `ProjectTailoring`/`InsertProjectTailoring` 类型。`targets` 用 `.$type<TailoringTarget[]>()`。

状态机：`pending → approved`（admin 通过）/`pending → rejected`（admin 驳回）/`approved → revoked`（admin 撤销）。`rejected`/`revoked` 为终态。

新增表 `project_deliverable_overrides`（交付物在某节点的手工增删，仅存"偏离默认"的项）：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `projectId` | varchar(32) | |
| `nodePhaseId` | varchar(32) | 该交付物落在哪个阶段的 Gate 提交 |
| `deliverableName` | varchar(256) | 交付物名称（来自模板派生清单） |
| `action` | enum | `add`（额外加到本节点）/ `remove`（本节点不需要） |
| `createdBy` | integer | |
| `createdAt/updatedAt` | timestamp | |

唯一约束 `(projectId, nodePhaseId, deliverableName)`：同一节点同一交付物只一条 override（add 或 remove）。

## "有效流程"与裁剪集

定义"已批准裁剪集" = 某项目所有 `status='approved'` 的 `project_tailoring` 行的 `targets` 并集，归一化为：
- `tailoredPhaseIds: Set<string>`（scope=phase 的 phaseId）
- `tailoredTaskIds: Set<string>`（scope=task 的 taskId）

派生 helper（streamlit-free 纯逻辑，前后端共享，放 `shared/`）：
```
getEffectiveProcess(category, tailoredPhaseIds, tailoredTaskIds, deliverableOverrides) -> {
  phases: Array<SOPPhase & {
    tailored: boolean,                 // 阶段是否整体裁剪
    submittedDeliverables: string[],   // 本阶段 Gate 实际应提交的交付物（含归集+手工调整）
    carriedDeliverables: { name: string; fromPhaseId: string }[],  // 其中哪些是从被裁阶段归集来的
  }>,
  isPhaseTailored(phaseId), isTaskTailored(phaseId, taskId)
}
```
进度/Gate/日历/阶段渲染/交付物提交都基于此。一个"被裁阶段"= phaseId ∈ tailoredPhaseIds（其全部任务视为裁剪）；"被裁任务"= taskId ∈ tailoredTaskIds 或其所在阶段被整体裁剪。交付物归集与有效提交集的算法见下节。

## 效果（审批通过时应用 / 撤销时回滚）

**通过（apply）**：对申请 `targets` 命中的任务（阶段目标→该阶段全部 SOP 任务；任务目标→该任务），把 `project_tasks.status` 置为 `skipped`（仅对未 `done` 的任务；幂等 upsert）。

**撤销（revoke）**：把该申请 `targets` 命中、且**不再被任何其它已批准裁剪覆盖**的任务，从 `skipped` 恢复为 `todo`。

派生影响（读时基于"有效流程/裁剪集"，无需额外迁移）：
- **进度**：
  - 总览/Portfolio：`getPortfolio` 的 `done = count filter status in ('done','skipped')` 已把 skipped 计入完成 → 裁剪部分视为已了结、不拖累进度，**无需改**。
  - 项目详情客户端 `computeOverallProgress`：当前按 `phases[].tasks` 完成布尔图计，需改为**剔除**被裁任务（status='skipped' 或 isTaskTailored），避免裁剪把进度拉低。
- **Gate**：现有"Gate 就绪检查"逻辑中，被裁阶段（`isPhaseTailored`）的 Gate 视为 N/A —— 不作为推进到下一阶段的前置闸口。
- **日历**：`getCalendar` 产出的 phase 截止里程碑，过滤掉被裁阶段（`isPhaseTailored`）。
- **可见**：项目阶段时间线里被裁阶段/任务显示"已裁剪 · <原因类型>"（置灰/删除线），可展开看原因+说明+审批人。

## 交付物归集与流转

**交付物现有模型（复用，不新建主数据）**：交付物按**名称**标识。模板里 `SOPPhase.deliverables` 与 `SOPGateStandard.requiredDeliverables` 定义各阶段/Gate 的交付物名；`project_tasks.deliverables`（名称→bool）记完成；`project_files`（`phaseId + deliverableName`）挂实际文件。交付物在**阶段的 Gate** 处提交/评审。

**交付物资源库 = 模板派生清单**：纯函数 `getDeliverableLibrary(category)` 返回该 category 模板中所有阶段 `deliverables` ∪ 各 Gate `requiredDeliverables` 的去重名称集。团队"人工灵活选择"即从此清单挑。

**归集规则（派生，随裁剪自动）**：当阶段 P 被裁（`isPhaseTailored`），P 的应交付物（`P.deliverables ∪ P.gateStandard.requiredDeliverables`）自动归集到 **P 之后第一个未裁剪阶段 Q 的 Gate** 提交。若 P 之后连续多个阶段都被裁，则级联归集到其后第一个有效阶段；若其后再无有效阶段（P 是末段被裁），归集到**最后一个有效阶段**的 Gate（兜底，避免丢失）。

**手工调整（override）**：每个有效节点 Q 可对其提交集增删，存 `project_deliverable_overrides`：
- `remove`：本项目此节点不需要该交付物（如客户已提供，确实不必交）。
- `add`：从资源库额外加一项到此节点提交。

**有效提交集**（`getEffectiveProcess` 计算，节点 Q）：
```
submitted(Q) = ( 模板(Q).deliverables ∪ requiredDeliverables
               ∪ {归集到 Q 的被裁阶段交付物} )
             − {Q 上 action=remove 的 override}
             ∪ {Q 上 action=add 的 override}
carried(Q)   = {归集到 Q 的项，标注 fromPhaseId}
```
去重按名称。`carried` 用于 UI 标"来自 已裁剪 XX 阶段"。

**派生影响**：
- **Gate 就绪**：审 Q 时校验 `submitted(Q)`（含归集项）是否齐备，而非仅模板项 —— 被裁阶段的关键交付物因此不会漏交。
- **文件**：在提交节点 Q 上传，`project_files.phaseId = Q`、`deliverableName` 不变，**无需改文件模型**。归集项在 Q 的交付物列表里展示并可上传。
- **撤销裁剪**：归集是派生的，阶段恢复后其交付物自动从 Q 退回本阶段（无需手工回退）；手工 override 保留（除非团队也手工删除该 override）。

> 例（你给的场景）：阶段含 MR1 Gate 被裁 → MR1 的 `requiredDeliverables` 自动出现在下一个有效阶段的 MR2 Gate 的提交集里，标"来自 MR1"，在 MR2 处上传提交；若客户已提供其中某件，团队在 MR2 对该件做 `remove`。

1. **提报**（PM）：项目详情"申请流程裁剪"→ 对话框勾选未完成的阶段/任务 + 选原因类型 + 写说明 → 建 `pending` 申请 → 给该项目相关 admin 发通知（复用 `NotificationBell`/现有通知机制）。
2. **审批**（admin）：项目详情顶部"待审裁剪"横幅（也可从通知进入）→ 通过/驳回（可填意见）。通过即 apply 效果。
3. **撤销**（admin）：在裁剪记录里对 `approved` 行点"撤销"→ revoke 回滚。
4. **留痕**：项目内"裁剪记录"区，列每条申请的 提报人/裁剪对象/原因/时间/状态/审批人。

## 权限

- 提报：项目 PM（`projectMembers.role='pm'` 或项目 `pmUserId`）；admin 亦可。
- 审批/撤销：仅 admin。
- 读取裁剪记录：项目可见者（沿用项目 canView）。
- 服务端在 `tailoring.review`/`revoke` 强校验 `ctx.user.role==='admin'`，`propose` 校验 PM 或 admin。

## API（新增 tRPC 路由 `tailoring`）

- `list({ projectId })` → `ProjectTailoring[]`（按 proposedAt desc）。
- `propose({ projectId, reasonType, reasonNote, targets })` → 建 pending；校验 targets 非空、每个 phaseId/taskId 属于该项目 category 的模板、且对应任务未 done。
- `review({ id, decision: 'approved'|'rejected', reviewNote? })` → admin；approved 时 apply 效果（置 skipped）。
- `revoke({ id, reviewNote? })` → admin；仅 `approved` 可撤；回滚 skipped。
- `effectiveProcess({ projectId })` → 返回 `getEffectiveProcess` 结果（含每节点 `submittedDeliverables`/`carried`/`tailored`），供前端渲染裁剪标记与交付物提交集。
- `deliverableLibrary({ projectId })` → `string[]`（该项目 category 的模板派生交付物清单），供手工 `add` 选择。
- `setDeliverableOverride({ projectId, nodePhaseId, deliverableName, action: 'add'|'remove'|'clear' })` → 写/清 override；`clear` 删除该条恢复默认。权限：PM 或 admin。

服务层（streamlit-free，新建 `server/tailoring_service.ts`，单一职责）：`listTailoring`、`proposeTailoring`、`reviewTailoring`、`revokeTailoring`、`getApprovedTailoringSets(projectId)`、`listDeliverableOverrides(projectId)`、`setDeliverableOverride(...)`（供进度/Gate/日历/渲染/交付物读取）。

## 前端组件

- `TailoringDialog`：提报对话框（基于有效流程列出"未完成且未裁剪"的阶段/任务勾选 + 原因类型下拉 + 说明）。
- `TailoringPanel`：项目内裁剪记录列表 + admin 的通过/驳回/撤销操作 + 待审横幅。
- 阶段时间线渲染（`ProjectDetailView` 内）：被裁阶段/任务加"已裁剪"标记（读 `effectiveProcess` / 有效流程）。
- `NodeDeliverablesPanel`：某阶段 Gate 的"应提交交付物"列表 = `submittedDeliverables`，归集项标"来自 已裁剪 XX 阶段"；带"从资源库添加 / 移除"操作（写 override），每项可上传文件（复用现有 `project_files` 上传）。
- `computeOverallProgress` 调整：剔除被裁任务。

## 测试

- `getEffectiveProcess`（纯函数）：阶段裁剪→其任务全标记；任务裁剪→单点；空裁剪=完整模板。单元测试。
- 服务层（DB-backed）：propose 建 pending；review approved→目标任务变 skipped；review rejected→无效果；revoke→恢复 todo；revoke 时被其它批准裁剪覆盖的任务保持 skipped；权限校验（非 admin review/revoke 抛 FORBIDDEN，非 PM/admin propose 抛 FORBIDDEN）。
- `getCalendar`：被裁阶段的截止里程碑被过滤。
- `computeOverallProgress`：被裁任务不计入分母。
- **交付物归集**（`getEffectiveProcess`/`getDeliverableLibrary` 纯函数）：单阶段被裁→其交付物出现在下一有效阶段 `submittedDeliverables` 且标 `carried.fromPhaseId`；连续多阶段被裁→级联到其后第一个有效阶段；末段被裁→兜底到最后有效阶段；`add` override 加入、`remove` override 移除；`getDeliverableLibrary` 返回模板去重并集。
- **Gate 就绪含归集项**：被裁阶段的 requiredDeliverables 归集后，下一节点就绪校验把它们计入。

## 开放项（实施计划阶段确认）

1. 通知落地方式：复用现有 `notifications`/`NotificationBell` 的事件类型，还是新增一类 `tailoring_pending`。
2. `getApprovedTailoringSets` 放 `server/db.ts` 还是新 `tailoring_service.ts`（倾向新文件，单一职责）。
3. 阶段时间线"已裁剪"标记的具体落点（`ProjectDetailView` 当前文件较大，确认插入位置）。
