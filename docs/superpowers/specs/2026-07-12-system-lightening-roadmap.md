# 系统减重优化 — 总览与施工路线图

日期：2026-07-12
性质：四份设计 + 两份实施计划的索引与执行顺序，开工前从这里进入。

## 一、问题与总方向

系统目标是集中信息、跟进状态、促进协作，但任务/交付物过重、日常维护琐碎，会压垮小团队（多岗一人兼任），且系统尚未大规模推行——可以做破坏性简化。总方向四层递进：

1. **源头减量**：模板 55 任务 → 分档 15/25/强监管，附加包按需激活
2. **操作外移**：日常状态维护从"开网站"变成"点钉钉卡片"，能自动的不让人动手
3. **组织适配**：一人多岗 + 红线四眼，承认小团队现实但不放弃职责分离
4. **呈现收敛**：每个页面首屏只回答一个问题，全系统单一状态口径

## 二、文档索引

| # | 文档 | 状态 | 内容一句话 |
|---|---|---|---|
| 设计1 | `specs/2026-07-12-npd-template-slimming-tiering-design.md` | ✅ 已确认 | 55→核心25+附加包7+轻量档15；四项判据准入；复杂度预算 25/30/32；§7 自动分档推导（属性→档位+包，红线锁定） |
| 设计2 | `specs/2026-07-12-status-maintenance-lightening-design.md` | ✅ 已实现 | 钉钉卡片一键 ▶开始/✅完成/⏰延两天；NPD v3 证据分级与完成守卫；五条自动化规则；通知三层（即时带按钮/日摘要/FYI进群） |
| 设计3 | `specs/2026-07-12-multi-role-conflict-matrix-design.md` | ✅ 已实现 | 渐进式多角色（主角色+extraRoles，权限并集）；红线四眼（提交人≠复核人，升级链：管理层→代理人→跨项目审核人）；待补岗位 PM 承接；带起止日期的代理人 |
| 设计4 | `specs/2026-07-12-page-load-reduction-design.md` | 🟢 主体已实现（遗留见其 §10） | 总览焦点三卡；任务列表默认"我的·当前阶段"；任务详情按角色×状态渐进；Gate 缺口清单唯一视图；§5 统一状态口径（删客户端三套进度算法）；§6 "我的工作"三桶合并入口；四项验收指标 |
| 计划1 | `plans/2026-07-12-npd-template-slimming.md` | ✅ 已实现，10 任务 | 实现设计1（含自动分档 Task 10） |
| 计划2 | `plans/2026-07-12-status-maintenance-lightening.md` | ✅ 已实现，9 任务 | 实现设计2；**依赖计划1 的 Task 1/3/5** |
| 计划3 | `plans/2026-07-12-multi-role-conflict-matrix.md` | ✅ 已实现，10 任务 | 实现设计3；0065 零回填迁移，多岗/代理/空岗/签字/四眼闭环 |
| — | 设计4 的实施计划 | ⏳ 未写 | 设计3 已落地；下一步可拆页面减负计划 |

另有既有关联设计（照旧执行，设计4 在其上叠加）：`2026-06-25-project-detail-dashboard-design.md`、`2026-06-25-task-detail-redesign-design.md`。

## 三、执行顺序与依赖

```
计划1 模板瘦身分档 (10 tasks)
  │  产出: shared/npd-v3.ts (evidence 字段 / getEffectivePhasesForProjectLike / 红线任务id)
  ▼
计划2 状态维护轻量化 (9 tasks)          ← 依赖计划1 Task 1/3/5
  │  产出: 卡片端点 / completionNote / 完成与依赖守卫 / task_ready 生命周期 / 通知分层
  ▼
┌────────────────────────┬───────────────────────────┐
计划3 一人多岗（已实现）       设计4 页面减负（计划待写）
0065 + 多岗/四眼闭环            §5 状态口径先行，再改页面；
                            §6 分桶器与计划2日摘要共用
└────────────────────────┴───────────────────────────┘
```

- 开工前建 feature 分支；计划2 包含 0063/0064，计划3 使用 0065（多岗与冲突矩阵，零回填）。
- 计划1 零数据迁移：新模板走版本号 `2026-07-v3`，存量项目钉在旧版本照常运行。
- 每个计划的任务按 TDD 步骤写好（失败测试→实现→通过→提交），可逐任务独立执行。

## 四、不可违背的决策（施工时的护栏）

1. **任务准入四项判据**：改变状态/明确责任/形成决策/产生审计证据，至少满足其一才建任务；过了判据还要回答"为什么不能是检查项/指南/附加包"。
2. **复杂度预算**：核心 25 / 常规组合 ≤30 / 四包全开 32（写死在测试里）。
3. **独立工作线不合并**：ID/MD/EE/Layout 各自成任务；合并仅限"同一责任人+同一证据"。
4. **三条红线任何档位不裁**：安全/认证（pb*/pc*/npv2）、量产放行（npv5）、客户放行（nm1）；立项时电池/认证包锁定、服务端强制。
5. **状态语义铁律**：前置未完成 = 待开始不是阻塞；blocked 不由依赖图派生；「开始」由人点（实现 = 写 actualStartedAt，startDate 只存计划排期）；依赖链驱动的是通知不是状态。
6. **不简单取消职责分离**：普通对象放开多帽+留痕；红线四眼按自然人 userId 比对，冲突走升级链，报错必须给出路。
7. **单一事实源**：进度/健康度/缺口只在服务端算一次（getProjectStatusSummary / getGateReadiness / workbench.mine），客户端重算函数删除不留兜底；同一证据只上传一次、只展示一处。
8. **验收指标四项**：周维护时间、单阶段人工操作次数、证据重复上传率（<10%）、页面状态一致率（100%，靠单一数据源）。先跑 2-4 周基线再定绝对目标。

## 五、关键实现事实（勘探结论，省得再查）

- 静态模板解析入口是 `getPhasesForCategory(category, version)`；凡已有具体项目（读路径、Gate、排期、完成守卫、通知）必须使用 `getEffectivePhasesForProjectLike(project)`，依赖消费者再经 `buildEffectiveProjectSchedTasks(project)` 收缩，不能回退到未分档的原始模板。
- `projectTasks.taskId` 存模板 id，唯一索引 (projectId, phaseId, taskId)。
- Gate readiness（db.ts:7049）已读 Issue P0/P1（getPhaseOpenP0P1）——e5/mp4 删除的 Gate 检查已就位。
- 状态派生 automaticTaskStatus：只有 actualStartedAt 且前置已完成才派生 in_progress；负责人、计划 startDate、dueDate 均不代表已经开始；status 是唯一主状态。
- 普通任务执行守卫统一在服务端：任何模板都禁止未来阶段任务和 Gate 任务走直接开始/完成；NPD v3 的开始与完成还必须通过分档、附加包与裁剪后的有效依赖图，light 必须有一句话结论，heavy 必须由责任人本人先上传文件。
- `task_ready` 使用项目+阶段+任务组合身份；开始/完成/提交审批/审批通过后关闭并同步把钉钉互动卡标为 handled，改派时关闭旧责任人并按有效依赖图给新责任人重新建项，重复就绪不清空 snooze。
- 卡片底座：action-card token（jose JWT，8 kind，含 `task_start`）+ 交互卡片三槽位（primary/secondary/detail）+ 失败自动回落工作通知；钉钉模板无需新增槽位。
- 自动化引擎：普通完成、审批通过和 Gate 通过在事务提交后内联发 `task.update_meta(done)`，activity-log tailer 保留作耐久日志补偿，dedupe 防重复；责任人的到期/逾期项只进每日个人摘要，零散 due-soon/overdue 默认关闭，异常升级按 day 2 仅 PM、day 7 仅管理层增量通知。
- 个人工作聚合 workbench.mine（workbench.ts:59）已取齐六类对象，分桶器 buildWorkbenchQueue 目前在客户端，需下沉。
- 进度三套算法并存：客户端 computeOverallProgress（data.ts:314，列表轻量对象恒显 0% 的根源）、getPortfolio SQL 聚合、projects.progress 列——设计4 §5 收敛。
- 一人多岗失真根因：kickoff staffing 撞 uniq(projectId,userId) 静默吞第二角色（projects.ts kickoff → ensureProjectMember）。
