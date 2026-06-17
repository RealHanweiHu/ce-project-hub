# 交付物审核工作流（2b）设计

日期：2026-06-16
状态：设计已确认，待写实施计划

## 背景与目标

Gate 就绪度的 2a 期（`gate-readiness-2a`）实现了交付物"**已上传**"口径——某 `deliverableName` 在 `project_files` 有文件即算满足。2a 明确把"**交付物审核工作流**"划给 2b 另立 spec，并预留了扩展点：`deliverableName` 是审核记录锚点；就绪的"deliverables.uploaded"口径集中在 `getGateReadiness` 一处，纯函数 `computeGateReadiness` 签名不变。

本功能（2b）在交付物上加**审核态**：提交审核 → 审核人通过/驳回 → Gate 就绪口径从"已上传"升级为"**已审核通过**"，并钉钉提醒审核人。与流程裁剪的交付物归集正交叠加（归集到目标节点的交付物照常走审核）。

## 关键决策（已确认）

1. **审核人**：**提交审核时指定**（默认项目 PM），按交付物可不同。钉钉提醒发给该审核人。
2. **重审**：交付物已"通过"后又上传新版本 → **自动回退"待审"并重新提醒审核人**（"已通过"永远对应当前文件）。
3. **就绪口径升级**：硬切换为"已审核通过才算满足"；**2b 上线前已上传、无审核记录的存量交付物豁免视为通过**（不打乱现有项目）。
4. **钉钉**：提交即提醒审核人；驳回提醒提交人。复用现有"工作通知发给个人"路径。
5. **审核人待审队列**：轻量露出（`myPending` 端点 + 通知/项目内可审）；不新建独立大页面。

非目标（本次不做）：交付物多级会签；审核 SLA/超时升级；按角色自动派审核人；审核历史多版本 diff。

## 数据模型

新增表 `project_deliverable_reviews`（一行 = 某节点某交付物的当前审核态）：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | serial PK | |
| `projectId` | varchar(32) | |
| `phaseId` | varchar(32) | 提交节点（交付物实际在哪个 Gate 提交，= 有效流程里的归集目标节点） |
| `deliverableName` | varchar(256) | 交付物名 |
| `status` | enum `deliverable_review_status` | `pending` / `approved` / `rejected` |
| `reviewerUserId` | integer | 提交时指定的审核人（默认 project.pmUserId） |
| `submittedBy` | integer | 提交人 |
| `submittedAt` | timestamp | |
| `reviewedBy` | integer null | |
| `reviewedAt` | timestamp null | |
| `reviewNote` | text null | 通过/驳回意见 |
| `createdAt/updatedAt` | timestamp | |

唯一约束 `(projectId, phaseId, deliverableName)`：一个节点一个交付物只有一条当前审核记录。索引 `(reviewerUserId, status)` 供 `myPending` 查询。

Drizzle：新增 `deliverableReviewStatusEnum`、`projectDeliverableReviews` 表 + `ProjectDeliverableReview`/`Insert...` 类型 + 迁移（drizzle-kit generate，下一序号）。

## 状态机

```
未提交(无记录)
   │ 提交审核(选审核人, 默认PM)
   ▼
 待审(pending) ──审核人通过──▶ 通过(approved)
   │                              │ 上传新版本文件
   └──审核人驳回──▶ 驳回(rejected)  ▼
                      │ 改文件后  待审(pending)  ← 自动回退 + 重新提醒
                      └─重新提交──┘
```

- 提交审核：建/更新记录为 `pending`，`reviewerUserId` 取入参（缺省 = project.pmUserId），`submittedBy/At` 写当前。
- 通过/驳回：仅 `reviewerUserId`（或 admin）可操作，写 `status`/`reviewedBy/At`/`reviewNote`。
- **重审触发**：文件上传服务在写入带 `deliverableName` 的 `project_files` 后，若该 (projectId,phaseId,deliverableName) 已有 `approved`/`rejected` 记录 → 置回 `pending` 并重发钉钉给 `reviewerUserId`。

## Gate 就绪口径升级（2a 单点改造）

`getGateReadiness`（`server/db.ts`）当前：`uploaded = 有文件的 deliverableName ∩ required`。改为 `satisfied`：

```
satisfied(deliverableName) =
  有文件(deliverableName)
  且 ( 无该交付物审核记录            // 存量豁免：2b 前的旧数据视为通过
       或 审核记录.status === 'approved' )
```

把 `getGateReadiness` 里喂给 `computeGateReadiness` 的 `deliverables.uploaded` 集合替换为上述 `satisfied` 集合。`required` 仍是裁剪后的**有效提交集**（含归集项），二者交集即"已满足"。纯函数 `computeGateReadiness` 与其 `GateReadiness` 类型不变。

> 效果：今后新提交的交付物必须审核通过 Gate 才就绪；被裁阶段归集到本节点的交付物同样要审。存量项目不受影响（豁免）。

## 与现有审批的关系（正交）

- **交付物审核(2b)**：单个交付物文件**合不合格**（质量门）→ 喂 Gate 就绪的 deliverables 维度。
- **Gate 评审（已有）**：整个 Gate 的总体放行（评审会 + 决议）。就绪了才好开。
- **裁剪审批（已有）**：流程要不要裁。被裁阶段的交付物归集到下一节点后照常审核。
三套独立的状态/记录，互不耦合。

## 钉钉提醒

复用现有"钉钉工作通知发给个人"机制（automation/dingtalk 路径，实施期确认确切函数）：
- **提交审核** → 给 `reviewerUserId` 发："【待审】项目X / 设计冻结 / MD结构图 待你审核"。
- **驳回** → 给 `submittedBy` 发："【驳回】… 原因：…"。
- 钉钉发送失败**不**阻塞审核流程（best-effort，记日志）。

## API（新增 tRPC 路由 `deliverableReviews`）

- `list({ projectId })` → 该项目所有交付物审核记录（供项目内交付物区显示徽标）。
- `myPending()` → `reviewerUserId === ctx.user.id 且 status='pending'` 的记录（审核人队列）。
- `submit({ projectId, phaseId, deliverableName, reviewerUserId? })` → 校验提交人有编辑权 + 该交付物在有效提交集内 + 有文件；建/更新 pending + 钉钉提醒审核人。
- `review({ projectId, phaseId, deliverableName, decision: 'approved'|'rejected', note? })` → 仅 `reviewerUserId` 或 admin；驳回提醒提交人。

服务层（`server/deliverable-review-service.ts`，单一职责）：`listDeliverableReviews`、`getMyPendingReviews`、`submitDeliverableReview`、`reviewDeliverable`、`getReviewSatisfiedSet(projectId, phaseId)`（供 getGateReadiness 读"已审核通过"集合，含存量豁免逻辑）、`resetReviewOnReupload(projectId, phaseId, deliverableName)`（上传钩子调用）。

## 文件上传钩子

现有文件上传服务（写 `project_files`）在成功写入带 `deliverableName` 的文件后，调用 `resetReviewOnReupload` —— 若已有 approved/rejected 记录则置回 pending + 重发钉钉。无记录则不动（首次上传后由用户显式"提交审核"）。

## 权限

- 提交审核：项目可编辑成员（PM / owner / 有 canEditTasks 的成员）；服务端校验。
- 通过/驳回：仅该记录的 `reviewerUserId`，或 admin。
- 读取：项目可见者（沿用 canView）。

## 前端

- 在 Gate 交付物区（`ProjectDetailView` 的 `DeliverablesChecklist` / 交付物面板，2b 紧接裁剪那块 UI）每个交付物加：
  - **审核态徽标**：待审 / 通过(审核人名) / 驳回(原因) / 已上传·未提交。
  - 提交人：「提交审核」按钮（弹出选审核人，默认 PM）。
  - 审核人：在该交付物上直接「通过 / 驳回(填意见)」。
- **审核人待审队列**：`myPending` 数据接入通知铃角标 + 一个轻量列表（在通知面板或项目内），不做独立大页。
- Gate 就绪面板「必需交付物」维度文案/计数随审核态变化（已由就绪口径升级驱动）。

## 测试

- 服务层（DB-backed）：submit→pending；review approved→satisfied 集含该项；reject→不在 satisfied + （mock）通知提交人；重审：approved 后调 resetReviewOnReupload→回 pending；存量豁免：有文件无记录→satisfied 含之；`myPending` 只返回本人 pending；权限（非 reviewer/admin review 抛 FORBIDDEN，非编辑成员 submit 抛 FORBIDDEN）。
- `getGateReadiness`：required 含某交付物、有文件但 review=pending → 该交付物不计入 satisfied、gate 未就绪；review=approved → 计入。
- `getReviewSatisfiedSet` 纯逻辑分支（无记录豁免 / approved / pending / rejected）。
- 钉钉发送用可注入的 deps 做 mock（参考现有 automation 测试的 DispatchDeps 注入），断言提交→通知审核人、驳回→通知提交人。

## 开放项（实施计划阶段确认）

1. 钉钉"发给个人"的确切函数/入口（automation engine vs 直接 work-notification API）——读现有代码定。
2. 文件上传服务的确切位置（哪个 service/router 写 project_files）——挂钩子处。
3. 审核态徽标在 `ProjectDetailView` 的具体落点（该文件较大，与裁剪交付物 UI 同区）。
