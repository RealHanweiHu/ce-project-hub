# 一人多岗与职责冲突矩阵 — 设计文档

日期：2026-07-12
状态：✅ 已实现（渐进式方案 A）；施工计划见 `docs/superpowers/plans/2026-07-12-multi-role-conflict-matrix.md`
范围：成员多角色模型、权限并集、签字留痕、职责冲突矩阵（四眼复核/待补岗位/代理人）
姊妹文档：`2026-07-12-npd-template-slimming-tiering-design.md`、`2026-07-12-status-maintenance-lightening-design.md`

## 1. 背景与问题（代码核实）

公司多岗位一人兼任或空缺，但系统是"一人一角色"模型，且失真已实际发生：

1. `project_members` 单 `role` 列 + `uniq(projectId, userId)` 唯一索引——一人一项目只能有一个角色。
2. **立项嘴上答应多岗、库里只记一岗**：KickoffWizard 允许同一人被选进多个角色槽位，服务端 `kickoff` 逐条 `ensureProjectMember` 撞唯一索引后静默吞掉第二个角色（non-fatal warn），通知却按多岗发出。
3. 权限是单角色查表：`getEffectiveProjectRole` 返回单值（成员角色与 PM/创建人/管理员按 rank 取高），全系统 79 处 `ROLE_PERMISSIONS[role]` 均吃单值；任务可见性 `visibleRoles`、按角色派工同样按单角色匹配——兼岗者看不到第二岗位的任务。
4. 已有半成品：Gate 签核 `project_gate_signoffs` 按 slot 落行（slot 即"以哪个角色签署"），signedBy 记自然人。缺口在任务审批与交付物审核（只记 userId 不记帽子）。

## 2. 方案（已确认：A 渐进式）

### 2.1 多角色存储与权限并集

- `project_members` 保留 `role` 作为**主角色**（rank、显示、排序语义不变），新增 `extraRoles: jsonb`（`ProjectMemberRole[]`，默认 `[]`）。存量数据零迁移。
- 新增 `getEffectiveProjectRoles(project, userId): Set<ProjectMemberRole>`：主角色 ∪ extraRoles ∪ PM/创建人/管理员升级角色 ∪ 生效中的代理角色（见 §2.5）。
- 新增 `getUnionPermissions(roles: Set<Role>): ProjectPermission`：各角色 `ROLE_PERMISSIONS` 布尔字段取 OR。
- 迁移策略：**只有权限判定、任务可见性（visibleRoles 匹配）、按角色派工、签核槽位资格**四类调用点换成集合/并集函数；纯显示处照旧读主角色。`kickoff` 的 staffing 循环改为：已是成员则把新角色 append 进 extraRoles（去重、不降主角色），不再静默吞掉。
- KickoffWizard/成员管理 UI：成员卡片显示多角色 chips，可增删 extraRoles。

### 2.2 签字留痕："以哪个角色签署"

- Gate 签核：已由 slot 承载，不动。
- 任务审批（`projectTasks.approvalStatus` 链路）与交付物审核（`project_deliverable_reviews`）：新增 `actedAsRole` 列；审批/审核 mutation 入参带角色（默认取该人在此对象上下文的唯一相关角色，多帽时前端要求选择），落库并写入活动日志 `meta.actedAsRole`。
- 普通任务/普通 Gate：**允许同一人戴不同帽子处理**，留痕即可，不做拦截。

### 2.3 职责冲突矩阵（红线四眼）

红线对象复用瘦身设计的三条红线，按模板版本映射任务 id：

| 红线 | v3 对象 | v1/v2 对象 |
|---|---|---|
| 安全/认证 | pb1、pb2、pc1、pc2、npv2 + certification 签核槽 | p5a、d6a、d7a、d7b、p6a、v3、pv3 + certification 槽 |
| 量产发布 | npv5（isReleaseGate Gate 签核全部必签槽） | pv8 同 |
| 客户放行 | nm1 + customer 签核槽 | mp1 同 |

强制规则（服务端校验，不可绕过）：

- **提交人 ≠ 复核人（自然人比对 userId，而非角色）**。红线任务的完成提交者、其交付物审核者、对应 Gate 槽位签核者，两两校验：审核/签核者 userId 不得等于提交者 userId。
- 冲突时（该角色仅一名持有人且恰是提交人）按顺序升级：①管理层（manager/owner 任一成员代签，actedAsRole 记原角色+代签标记）→ ②生效中的代理人 → ③跨项目指定审核人（系统级配置的兜底名单，管理员维护）。
- 校验失败的报错文案必须给出可执行出路（"由 XX 代签或指定代理人"），不做静默阻塞。

### 2.4 待补岗位

- 角色在项目内无任何持有人时：该角色的任务/签核槽自动落到 PM 名下承接，项目详情与 Gate readiness 显示"待补岗位：认证 ×1"角标；PM 承接的红线对象仍受 §2.3 四眼约束（PM 不能既提交又复核）。
- 补人后角标消失，已承接未完成的对象提示"可移交"。

### 2.5 有起止日期的代理人

新表 `project_role_delegations`：

| 列 | 说明 |
|---|---|
| projectId | 所属项目（跨项目兜底审核人由系统级名单承担，不用本表） |
| role | 被代理的角色 |
| fromUserId | 被代理人（可空：代理"待补岗位"时无本人） |
| toUserId | 代理人 |
| startDate / endDate | 生效区间（含当天，Asia/Shanghai） |
| reason / createdBy | 休假/兼职/短期支援等 + 建立人 |

- `getEffectiveProjectRoles` 解析时并入"今天在区间内"的代理角色；到期自动失效（无需清理任务）。
- 代理人签字留痕：actedAsRole 记角色 + `viaDelegationId`，审计可见"张三代李四以 QA 签署"。
- 建立/撤销代理走活动日志 + 钉钉通知双方。

## 3. 与前两份设计的关系

- 依赖瘦身计划的 v3 任务 id（红线映射表）；依赖状态维护计划的行动项/卡片底座（待补岗位提醒、代签通知复用 task_ready 同款卡片）。**实施顺序第三**。
- 状态维护设计的"通知即操作"原则适用：四眼升级链触发时直接给管理层/代理人推带按钮的复核卡片，而不是让流程卡住等人发现。

## 4. 权衡记录

- 选 A（渐进）弃 B（拆关联表全量重构）：79 处调用点全改的回归面撞上"未大规模推行"窗口期的另外两个大改动，风险叠加；extraRoles 数组在成员数 ≤ 几十人的场景无查询性能问题。B 留作日后模型清理的选项。
- 不简单取消职责分离（用户明确要求）：普通对象放开多帽 + 红线保四眼，是"小团队现实"与"安全审计底线"的折中。
- 冲突矩阵硬编码三条红线而非做成可配置矩阵：可配置版本等有第二套矩阵需求时再抽象（YAGNI）。

## 5. 实施决策（2026-07-12）

- 多帽者签字：唯一合格角色自动推断；存在多个合格角色时必须显式选择，前端显示角色下拉，服务端重新校验。
- 跨项目指定审核人：使用独立系统级兜底审核人表，在 Admin 页面维护，不引入通用设置平台。
- 红线提交者使用稳定的 `completedBy/submittedBy` 留痕，不依赖会被后续编辑覆盖的通用 `updatedBy`。

## 6. 实施结果（2026-07-12）

- 数据：0065 增加 `extraRoles`、日期代理、待补岗位、稳定提交人、签字角色/代理来源和系统兜底审核人；不回填或改变存量主角色。
- 权限：服务端统一输出主角色、有效角色集合和权限并集；任务可见/处理、工作台、派工和 Gate 槽位均使用集合语义，明确负责人仍只认自然人本人。
- 人员：kickoff、成员邀请与编辑均持久化多岗；创建者可保存实际工作岗位；成员页显示主岗/兼任 chips、岗位代理和空岗移交。
- 审计：任务审批、交付物审核、Gate 会签记录 acted-as 身份；代理签字关联 delegation；普通完成/审批完成稳定写 `completedBy`。
- 四眼：安全/认证、量产发布、客户放行按模板版本映射；普通对象允许多帽，红线按 userId 强制独立复核，并按管理层→代理→系统 fallback 升级。
- 验收：`pnpm check`、166 个测试文件/937 项测试、`pnpm build`、`git diff --check` 全部通过；本地浏览器完成团队与分工/岗位代理页面验收，控制台无错误。

上线前仍需：在目标环境执行 0065，并用真实钉钉身份验证代理建立/撤销及红线升级通知送达。
