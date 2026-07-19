# 一人多岗与职责冲突矩阵 Implementation Plan

**Status:** ✅ 已完成（2026-07-12）— 166 个测试文件/937 项测试、类型检查、生产构建、diff 检查与本地浏览器验收通过。

**Goal:** 在不推翻现有主角色模型的前提下，支持项目内一人多岗、权限并集、时效代理、待补岗位承接、签字角色留痕，并对安全/认证、量产放行、客户放行三类红线强制自然人四眼。

**Architecture:** `project_members.role` 保留为主角色，`extraRoles` 保存兼任角色；统一 access service 同时返回主角色、有效角色集合与 OR 后权限。代理角色在查询时按 Asia/Shanghai 日期并入。普通对象允许多帽处理并留痕；红线对象在最终事务内按 `userId` 检查提交者、审核者、Gate 签署者。空岗任务由 PM 暂承接，但单独记录 `staffingGapRole`，补人后可识别和移交。

**Migration:** 单一 `0065_multi_role_conflict_matrix.sql`，包含本设计新增列与表；存量成员 `extraRoles=[]`，不回填角色、不改变既有权限。

**Execution rule:** 每个任务遵循“失败测试 → 最小实现 → 聚焦通过 → 相关回归”。工作区含计划一、二未提交改动，提交时不能整体 stage。

## 最终数据口径

- `project_members.extraRoles: ProjectMemberRole[]`：去重、排除主角色、过滤非法角色；普通成员不能声明 owner。
- `project_role_delegations`：项目、被代理角色、可空 fromUserId、toUserId、上海日期起止、reason、active、createdBy。
- `project_tasks.staffingGapRole`：PM 因空岗临时承接时记录原岗位；正式派工或补人移交后清空。
- `project_tasks.completedBy`：稳定保存完成提交者；直接完成写操作者，审批通过写 `approvalRequestedBy`，取消完成清空。
- `project_tasks.approvalActedAsRole / approvalViaDelegationId`：任务审批签字身份。
- `project_deliverable_reviews.actedAsRole / viaDelegationId`：交付物审核签字身份。
- `project_gate_signoffs.viaDelegationId`：slot 已表示 acted-as 身份，代理来源单独记录。
- `project_role_fallback_reviewers`：系统级按角色维护的兜底审核人。

## Task 1：schema、0065 迁移与规范化函数

**Files**

- Modify: `drizzle/schema.ts`（projectMembers、projectTasks、projectDeliverableReviews、projectGateSignoffs）
- Create: `drizzle/0065_multi_role_conflict_matrix.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `shared/project-roles.ts`
- Test: `shared/project-roles.test.ts`

**Red tests**

- 非法角色、owner、主角色自身从 extraRoles 移除；顺序稳定、去重。
- 日期区间按上海自然日含首尾。
- schema 类型能表达 delegation、fallback reviewer 与签字身份字段。

**Implementation**

- 新增 `normalizeExtraRoles(primaryRole, raw)` 和 `isShanghaiDateInInclusiveRange(today,start,end)`。
- 0065 只新增 nullable/default-safe 字段；不修改存量 role。

**Pass**

```bash
pnpm vitest run shared/project-roles.test.ts
pnpm check
```

## Task 2：canonical 有效角色集合与权限并集

**Files**

- Modify: `server/project-access.ts`
- Modify: `server/db.ts`（批量 member roles/delegations 查询）
- Modify: `server/routers/members.ts`（myRole 返回 role + roles + union permissions）
- Test: `server/project-multi-role-access.test.ts`
- Test: `server/effective-role-unify.test.ts`

**Red tests**

- `qa + scm` 同时获得 QA 关闭问题与 SCM 商业权限，主角色仍为原 role。
- PM/创建人/admin floor 与 extraRoles 并集，不会因 rank 只保留一个角色。
- external + internal 混合时按内部权限访问；纯 external 仍受边界限制。

**Implementation**

- 新增 `getEffectiveProjectRoles(project,userId,options?)`。
- 新增 `getUnionPermissions(roles)`；所有布尔权限 OR，label 仍取主角色。
- `getEffectiveProjectRole` 保留为显示兼容层，返回 roles 中最高 rank。
- `assertProjectAccess/Permission` 改用 union permissions。

## Task 3：四类集合语义硬边界迁移

**Files**

- Modify: `server/deliverable-access.ts`
- Modify: `server/routers/tasks.ts`
- Modify: `server/routers/workbench.ts`
- Modify: `server/db.ts`（assignTasksByRole）
- Modify: `shared/gate-signoffs.ts`
- Modify: `server/routers/gateReviews.ts`
- Modify: `client/src/hooks/useProjectPermission.ts`
- Modify: `client/src/components/views/ProjectDetailView.tsx`
- Test: `server/multi-role-boundaries.test.ts`
- Test: `shared/gate-signoffs.test.ts`

**Red tests**

- 第二岗位能看见、认领和处理 visibleRoles 匹配任务。
- workbench 能返回第二岗位的未指派任务。
- assignTasksByRole 能按 extraRoles 找到持有人。
- Gate 专业槽位接受任一有效角色，不能用“最高 rank”替代集合匹配。
- 有明确 assignee 时仍只认该自然人，角色并集不能越权代办。

## Task 4：kickoff 与成员管理多角色闭环

**Files**

- Modify: `server/db.ts`（ensureProjectMember/updateProjectMember）
- Modify: `server/routers/projects.ts`（kickoff）
- Modify: `server/routers/members.ts`
- Modify: `client/src/components/views/KickoffWizard.tsx`
- Modify: `client/src/components/views/MembersPanel.tsx`
- Test: `server/kickoff-e2e.test.ts`
- Test: `server/project-members-multi-role.test.ts`

**Red tests**

- 同一 user 被 staffing 为两个岗位后落一行：主角色不降级、extraRoles 含另一岗位。
- 创建者兼任岗位也持久化为有效角色，不再只在 staffingMap 生效一次。
- invite 已有成员默认 append extraRole，不覆盖主角色；显式编辑可分别修改主角色/extraRoles。
- 活动日志记录 before/after roles。

**UI**

- 成员卡显示主角色 chip + 兼任 chips。
- 编辑区保留主角色单选，新增兼任角色多选；同一角色不能同时出现。

## Task 5：代理人表、API、有效期与通知

**Files**

- Create: `server/routers/delegations.ts`
- Modify: `server/routers.ts`
- Modify: `server/project-access.ts`
- Modify: `server/db.ts`
- Modify: `client/src/components/views/MembersPanel.tsx`
- Test: `server/project-role-delegation.test.ts`

**Red tests**

- 起止日期首尾当天生效，前一天/后一天不生效。
- fromUserId 为空时可代理待补岗位；toUserId 必须是可访问项目的内部成员。
- 创建/撤销写活动日志；重复有效代理拒绝。
- 过期代理不需要清理任务，也不再提供权限/签核资格。

## Task 6：待补岗位识别、PM 承接与可移交

**Files**

- Modify: `server/db.ts`（assignTasksByRole、gap aggregate）
- Modify: `server/routers/projects.ts` 或 Create: `server/routers/staffing.ts`
- Modify: `client/src/components/views/ProjectDetailView.tsx`
- Modify: `client/src/components/views/MembersPanel.tsx`
- Test: `server/staffing-gap.test.ts`

**Red tests**

- 岗位无人时任务分给项目 PM/PMO，并写 `staffingGapRole`。
- PM 不存在时回退创建者；两者均无才保持未分配并报 gap。
- 补入岗位持有人后 gap 角标消失，未完成承接任务返回“可移交”。
- 移交后 assignee 改为新持有人并清空 staffingGapRole；已完成任务不自动改写。

## Task 7：任务审批与交付物审核 actedAsRole

**Files**

- Modify: `server/task-approval-service.ts`
- Modify: `server/routers/tasks.ts`
- Modify: `server/services/external-approval-service.ts`
- Modify: `server/deliverable-review-service.ts`
- Modify: `server/routers/deliverableReviews.ts`
- Modify: `client/src/pages/ActionPage.tsx`
- Modify: `client/src/components/views/ProjectDetailView.tsx`
- Test: `server/acted-as-role.test.ts`

**Red tests**

- 唯一相关角色自动落 actedAsRole；多于一个合格角色未选择时拒绝并返回候选。
- 选择角色必须属于当时有效角色；代理角色同步写 viaDelegationId。
- 外部钉钉回调使用行动项创建时冻结的签字角色，不能靠回调参数伪造。
- 活动日志包含 actedAsRole/viaDelegationId。

## Task 8：统一红线映射与自然人四眼守卫

**Files**

- Create: `shared/redline-four-eyes.ts`
- Create: `server/redline-four-eyes-service.ts`
- Modify: `server/task-completion-guard.ts`
- Modify: `server/task-approval-service.ts`
- Modify: `server/deliverable-review-service.ts`
- Modify: `server/routers/gateReviews.ts`
- Test: `shared/redline-four-eyes.test.ts`
- Test: `server/redline-four-eyes-integration.test.ts`

**Red tests**

- v1/v2/v3 红线 taskId 映射准确；普通任务/普通交付物不命中。
- 直接完成和审批通过均稳定写 completedBy。
- 红线交付物 reviewer 与 submittedBy/completedBy 相同自然人时拒绝；换角色也不能绕过。
- 量产发布 Gate、certification/customer 红线槽 signer 与提交人相同则拒绝。
- 普通对象允许同一人以另一有效角色处理并留下 actedAsRole。

## Task 9：冲突升级链与系统兜底审核人

**Files**

- Modify: `server/redline-four-eyes-service.ts`
- Modify: `server/routers/admin.ts`
- Modify: `client/src/components/AdminPanel.tsx` 或现有 admin 页面组件
- Modify: `server/action-item-notify.ts`
- Test: `server/redline-reviewer-escalation.test.ts`

**Red tests**

- 首选专业角色仅提交人一人时，依次选择：非提交人的 manager/owner → 生效代理 → 系统 fallback reviewer。
- 无可用人时返回包含具体出路的错误，不静默 pending。
- 兜底审核人必须 active、内部账号且不是提交者。
- 升级产生行动项/通知并写清 actedAsRole、来源和冲突原因。

## Task 10：全量验收与文档收口

**Checks**

```bash
pnpm check
pnpm test
pnpm build
git diff --check
```

**Browser QA**

- 同一成员主角色 + 两个兼任 chips。
- 第二岗位任务可见且可处理。
- 创建/撤销代理后权限即时变化。
- 空岗角标、PM 承接与补人后移交。
- 多帽审批角色选择；红线同人复核给出明确替代人提示。

**Docs**

- 设计文档状态改为已实现并写最终口径。
- 路线图设计 3 / 计划 3 标为完成。
- 记录生产迁移和真实钉钉验收前置。
