# 钉钉引擎优化 + 审批流实施计划

**Goal:** 先把现有钉钉日程、群、工作通知做成可靠的协同引擎，再接入钉钉审批底座，首批支持 MP Release 与 Gate 条件通过 / 强制发布审批。

**Source spec:** `docs/superpowers/specs/2026-06-27-dingtalk-engine-approval-design.md`

**Principle:** 钉钉是外部通道，CE Project Hub 是业务状态真相源。审批通过后仍要重新执行系统硬卡。

## Implementation Status 2026-06-27

- 已完成钉钉可靠性补强：手机号变更清缓存、工作通知真实送达统计、单次日程群推状态校正、token/用户解析异常降级。
- 已完成周会生命周期闭环：同步状态字段、保存后记录、停用/发布/删除取消日程、PM/日期变化重同步、前端状态与重试入口。
- 已完成每周降级提醒：未有效同步钉钉周期会的项目按周去重，优先项目群，失败回退全局 webhook。
- 已完成审批底座：审批配置表、外部审批实例表、钉钉审批发起/查询模块、加密回调入口、Admin 配置页。
- 已完成首批 Release 接入：MP Release 发起钉钉审批、同步审批状态、审批通过后重新跑硬卡并自动发布，发布记录追溯外部审批实例。
- 上线前仍需在真实钉钉企业应用中配置 `processCode`、回调公网地址、`DINGTALK_CALLBACK_TOKEN`、`DINGTALK_CALLBACK_AES_KEY`，并跑真 E2E。

---

## Task 0: 基线确认

- [ ] 跑现有钉钉单测：
  - `./node_modules/.bin/vitest run server/_core/dingtalk.test.ts server/_core/dingtalkCalendar.test.ts server/_core/meetingSync.test.ts`
- [ ] 跑审批相关现有测试：
  - `./node_modules/.bin/vitest run server/release.test.ts server/task-approval.test.ts server/tailoring-service.test.ts server/deliverable-review-service.test.ts`
- [ ] 确认 `.env` 已有：
  - `DINGTALK_APP_KEY`
  - `DINGTALK_APP_SECRET`
  - `DINGTALK_CORP_ID`
  - `DINGTALK_AGENT_ID`
  - 后续新增回调密钥配置

---

## Task 1: 统一钉钉 Client 与错误模型

**Files:**

- Create: `server/_core/dingtalkClient.ts`
- Modify: `server/_core/dingtalk.ts`
- Modify: `server/_core/dingtalkCalendar.ts`
- Modify: `server/_core/dingtalkGroup.ts`
- Modify: `server/_core/dingtalkMessage.ts`
- Test: `server/_core/dingtalkClient.test.ts`

### Steps

- [ ] 新增 `DingtalkCallResult<T>`。
- [ ] 把 token 获取、401 清缓存重试、errcode 归一化放入统一 client。
- [ ] `resolveDingtalkUserId` / `resolveDingtalkCorpUserId` 不再让 fetch 异常穿透。
- [ ] `upsertWeeklyMeeting` / `upsertSingleMeeting` 返回失败原因，而不是只有 `null`。
- [ ] 群发与工作通知读取响应体，errcode 非 0 算失败。

### Acceptance

- [ ] 网络异常时，保存周会配置不抛 500。
- [ ] token 过期时自动刷新并重试一次。
- [ ] 单测覆盖 `ok / http error / errcode error / network error / 401 retry`。

---

## Task 2: 周会同步状态与生命周期

**Files:**

- Modify: `drizzle/schema.ts`
- Generate: `drizzle/00NN_dingtalk_meeting_sync_status.sql`
- Modify: `server/db.ts`
- Modify: `server/_core/meetingSync.ts`
- Modify: `server/routers/meetings.ts`
- Modify: `server/routers/projects.ts`
- Modify: `server/routers/products.ts`
- Modify: `client/src/components/views/MeetingConfigPanel.tsx`
- Test: `server/_core/meetingSync.test.ts`

### Schema

- [ ] `projects.dingtalkMeetingSyncStatus`
- [ ] `projects.dingtalkMeetingLastError`
- [ ] `projects.dingtalkMeetingLastSyncedAt`

### Steps

- [ ] `syncProjectMeeting` 返回 `{ mode, eventId?, error? }`。
- [ ] 周会保存后写同步状态。
- [ ] enabled=false 时调用 `cancelMeeting`，成功后清 `dingtalkEventId`。
- [ ] PM 变更时取消旧 PM event，新 PM 可解析则新建。
- [ ] startDate / targetDate 变化时更新 event。
- [ ] Release 归档后尝试取消周会，不阻断发布。
- [ ] 项目硬删除前尝试取消周会，不阻断删除。
- [ ] 前端展示状态与“重试同步”按钮。

### Acceptance

- [ ] 关闭周会后，本地 eventId 清空，状态为 `canceled`。
- [ ] PM 变更后，不继续使用旧 PM 的 event。
- [ ] 归档项目不会留下系统认为仍 active 的周期会。
- [ ] 同步失败时 UI 可见失败原因。

---

## Task 3: 每周降级提醒自动化

**Files:**

- Modify: `server/automation/rules.ts`
- Modify: `server/automation/scheduler.ts`
- Modify: `server/automation/engine.ts` 或新增专用 helper
- Modify: `server/db.ts`
- Test: `server/automation/scheduler.test.ts`

### Steps

- [ ] 新增规则 `weekly_meeting_reminder`，默认启用。
- [ ] scheduled scan 遍历 active projects。
- [ ] 只处理 `meetingConfig.enabled=true` 且未有效同步钉钉日程的项目。
- [ ] 以 `projectId:weekKey` 去重。
- [ ] 优先项目群，失败再全局 webhook。
- [ ] 写 `automation_runs`。

### Acceptance

- [ ] 同一项目同一周只提醒一次。
- [ ] 已同步钉钉日程的项目不发降级提醒。
- [ ] 没有项目群时回退全局 webhook。

---

## Task 4: 通知真实送达统计

**Files:**

- Modify: `server/_core/dingtalkMessage.ts`
- Modify: `server/_core/dingtalkGroup.ts`
- Modify: `server/routers/projects.ts`
- Modify: `server/routers/meetings.ts`
- Test: `server/_core/dingtalkMessage.test.ts`
- Test: `server/projects-dingtalk-notify.test.ts`

### Steps

- [ ] 统一 `DispatchResult`。
- [ ] `notifyUsersViaDingtalk` 返回成功 / 失败 / 跳过数量。
- [ ] `assignAndNotify.notified` 只统计真实成功。
- [ ] `createEvent` 只有群推成功才写 `group_push`。

### Acceptance

- [ ] 钉钉返回 errcode 非 0 时，不显示“已通知”。
- [ ] 未配置 AgentId 时，统计为 skipped 而非 delivered。

---

## Task 5: 手机号自助修改清钉钉缓存

**Files:**

- Modify: `server/routers.ts`
- Modify: `server/db.ts` if needed
- Test: `server/auth-update-profile.test.ts`

### Steps

- [ ] `auth.updateProfile` 手机号变化时复用 `setUserMobile`。
- [ ] 显示名修改仍保留原逻辑。
- [ ] 测试旧 `dingtalkUserId/dingtalkCorpUserId` 被清空。

### Acceptance

- [ ] 用户自己改手机号后，下次钉钉解析按新手机号走。

---

## Task 6: 审批配置与实例表

**Files:**

- Modify: `drizzle/schema.ts`
- Generate: `drizzle/00NN_dingtalk_approval.sql`
- Modify: `server/db.ts`
- Test: `server/dingtalk-approval-db.test.ts`

### Schema

- [ ] `dingtalk_approval_configs`
- [ ] `external_approval_instances`
- [ ] `mp_releases.externalApprovalInstanceId`

### DB helpers

- [ ] `getApprovalConfig(businessType)`
- [ ] `upsertApprovalConfig(...)`
- [ ] `createExternalApprovalInstance(...)`
- [ ] `updateExternalApprovalInstance(...)`
- [ ] `getExternalApprovalByProcessInstanceId(...)`
- [ ] `listExternalApprovalsForEntity(...)`

### Acceptance

- [ ] `processInstanceId` 唯一。
- [ ] 同一个业务对象可多次发起，但同一 pending 实例不可重复发起。

---

## Task 7: 钉钉审批 Core 模块

**Files:**

- Create: `server/_core/dingtalkApproval.ts`
- Test: `server/_core/dingtalkApproval.test.ts`

### Steps

- [ ] `createApprovalInstance(input)`
- [ ] `getApprovalInstance(processInstanceId)`
- [ ] `normalizeApprovalStatus(raw)`
- [ ] `buildApprovalForm(businessType, snapshot)`
- [ ] 所有 API 调用走 `dingtalkClient`。

### Acceptance

- [ ] 未配置 processCode 时返回可读错误。
- [ ] 发起失败写 `sync_failed`，不推进业务。
- [ ] 状态映射覆盖 pending / approved / rejected / terminated。

---

## Task 8: 钉钉回调入口与幂等同步

**Files:**

- Modify: `server/_core/index.ts` 或 Express route 所在文件
- Create: `server/services/external-approval-service.ts`
- Test: `server/external-approval-callback.test.ts`

### Steps

- [ ] 新增 `POST /api/dingtalk/callback`。
- [ ] 按钉钉回调规范验签 / 解密。
- [ ] 提取 `processInstanceId` 与事件类型。
- [ ] 回调后拉取审批实例详情。
- [ ] 用 `processInstanceId + eventKey` 幂等。
- [ ] approved 后进入业务 apply，rejected / terminated 不推进。

### Acceptance

- [ ] 同一回调重复 3 次，只处理一次业务动作。
- [ ] 回调 payload 缺失或验签失败返回拒绝。
- [ ] 钉钉详情拉取失败时标 `sync_failed`，可手动同步。

---

## Task 9: MP Release 审批接入

**Files:**

- Modify: `server/routers/products.ts`
- Modify: `server/db.ts`
- Modify: `client/src/components/views/ReleaseDialog.tsx`
- Test: `server/release-dingtalk-approval.test.ts`

### Steps

- [ ] `releasePrecheck` 返回现有 pending approval。
- [ ] 新增 `products.submitReleaseApproval`。
- [ ] 发起前跑 release precheck。
- [ ] approved 回调后重新跑 precheck。
- [ ] precheck 通过后发布。
- [ ] precheck 失败后标 `business_blocked`。
- [ ] ReleaseDialog 展示 pending / rejected / failed / blocked。

### Acceptance

- [ ] 审批通过 -> 项目发布并归档。
- [ ] 审批驳回 -> 项目不发布。
- [ ] 审批期间新增 P0 -> 不发布，状态为 `business_blocked`。
- [ ] 重复回调不重复生成 Rev。

---

## Task 10: Gate 条件通过 / 强制发布审批接入

**Files:**

- Modify: `server/routers/products.ts`
- Modify: `server/db.ts`
- Modify: `client/src/components/views/ReleaseDialog.tsx`
- Test: `server/release-dingtalk-approval.test.ts`

### Steps

- [ ] Gate decision 为 `conditional` 时，ReleaseDialog 要求走钉钉审批。
- [ ] 审批表单包含条件、强制发布理由、跟进人、截止日。
- [ ] approved 后调用 release 服务并写 override 留痕。
- [ ] rejected 后不发布。

### Acceptance

- [ ] conditional Gate 无审批通过不可发布。
- [ ] 通过后 `mp_releases.overrideReason/followUpOwner/dueDate` 写入。
- [ ] 审批实例可从 Release 记录追溯。

---

## Task 11: Admin 审批配置页

**Files:**

- Modify: `server/routers/admin.ts`
- Modify: `client/src/pages/AdminPanel.tsx`
- Test: `server/admin-dingtalk-approval-config.test.ts`

### Steps

- [ ] 列出审批业务类型。
- [ ] 配置 `processCode`。
- [ ] 启用 / 停用。
- [ ] 测试同步或测试发起 dry-run。

### Acceptance

- [ ] 非 admin 不可修改审批配置。
- [ ] processCode 为空时不能启用。

---

## Task 12: 活动日志与审计

**Files:**

- Modify: `server/services/external-approval-service.ts`
- Modify: relevant routers/services
- Test: approval integration tests

### Steps

- [ ] 写 `approval.submit`。
- [ ] 写 `approval.approve`。
- [ ] 写 `approval.reject`。
- [ ] 写 `approval.business_blocked`。
- [ ] Release 成功日志包含 `externalApprovalInstanceId`。

### Acceptance

- [ ] 任一审批实例可追溯：发起人、钉钉实例、结果、业务动作。

---

## Task 13: 部署与真 E2E

### Preflight

- [ ] 钉钉企业内部应用权限：
  - 通讯录读取
  - 工作通知
  - 日历读写
  - 审批实例发起 / 查询
  - 回调事件订阅
- [ ] 配置公网回调地址。
- [ ] 配置回调 token / aes key。
- [ ] 配置审批模板 processCode。

### 真 E2E

- [ ] 建测试项目。
- [ ] 发起 MP Release 审批。
- [ ] 在钉钉通过。
- [ ] 系统生成 Rev，项目归档。
- [ ] 重复投递回调不重复发布。
- [ ] 驳回路径不发布。

---

## Recommended Build Order

1. Task 1 + 5：低风险可靠性补强。
2. Task 2 + 3 + 4：完成现有钉钉引擎闭环。
3. Task 6 + 7 + 8：审批底座。
4. Task 9 + 10：Release / Gate 首批审批。
5. Task 11 + 12 + 13：配置、审计、上线验证。

---

## Definition of Done

- [ ] 现有钉钉测试通过。
- [ ] 新增审批测试通过。
- [ ] `pnpm check` 通过。
- [ ] 未配置钉钉时，核心业务仍可用。
- [ ] 配置钉钉后，失败可见且可重试。
- [ ] 审批通过、驳回、重复回调、业务阻塞均有明确状态。
