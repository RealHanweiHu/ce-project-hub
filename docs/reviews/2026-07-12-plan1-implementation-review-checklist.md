# 计划一实施评审 — 处理清单

评审对象：分支 `codex/system-lightening-plan-1`（11 提交 + 未提交改动，82 文件）
评审基线：typecheck 0 错误；139 测试文件 / 802 测试全绿
日期：2026-07-12

## 🔴 P0 — 系统性：模板解析感知级别不一致（一次性按高度修）

**病根**：模板解析存在三个感知级别，主干已迁到项目感知（version+customFields），旁路调用点停在低级别。
**修法**：`getEffectivePhasesForProjectLike` 定为唯一入口；名字解析给轻量帮助函数 `resolveTaskName(projectLike, taskId)` / `resolvePhaseName(projectLike, phaseId)`；迁完后给 `getPhasesForCategory` 加使用守卫（grep 测试断言非白名单调用点为 0，防回潮）。

### 级别③ 完全盲（1 参数 → 永远 v2，所有 v3 项目任务名退化为裸 id）

- [x] `server/task-title.ts:15` — taskDisplayTitle 无版本入参；**波及所有钉钉通知**（审批 tasks.ts:122/227、每日摘要 personalDailyDigest.ts:164、改期通知 schedule-service.ts:91、kickoff 派工卡 projects.ts:93）。TaskDisplayTitleInput 需带 projectLike
- [x] `client/src/components/views/TaskListView.tsx:77,89` — resolveTaskName/resolvePhaseLabel
- [x] `client/src/components/views/MyTasksView.tsx:62`
- [x] `client/src/components/views/CalendarPage.tsx:116`
- [x] `client/src/components/GlobalSearch.tsx:135`（还硬编码 'npd'）
- [x] `client/src/components/views/overview/PortfolioDashboard.tsx:159`
- [x] `client/src/pages/Home.tsx:832`
- [x] `client/src/lib/sop-templates.ts:34`
- [x] `shared/schedule-graph.ts:113,120` — scheduleForCategory / criticalPathTasks（甘特关键路径对 v3/v1 项目静默变空；消费方 TaskGanttView.tsx:32）

### 级别② 仅版本感知（拿到 v3 核心 25，看不到 lite 'verification' 阶段与 pack 任务）

- [x] `server/db.ts:5447,5476` — resolveTailoringTargetTasks（lite/pack 任务提裁剪被误拒 '任务不存在'）
- [x] `server/routers/tailoring.ts:76` — **高风险红线裁剪保护对 pack 任务（pb2 安全FMEA）静默失效**（`!phase→false` / `!!task` 放行）⚠️ 最高优先
- [x] `server/routers/projects.ts:957` — **move 阶段守卫**：lite 项目 currentPhase='verification' 时 fromIdx=-1 走脏数据分支，可绕 Gate 直接前进到 pvt/mp ⚠️ 量产放行红线可被跳过
- [x] `server/db.ts:2326`（getPortfolio）、`:2487`（Gate 风险快照）、`:8900,8925`（日历）— lite 项目 verification 阶段解析 null：看板 Gate 就绪/红黄灯消失、gateTaskTotal 按 7 计而项目只有 5、里程碑标签裸 id
- [x] `server/routers/tailoring.ts:169` — deliverableLibrary 读路径无版本（v2 库）vs 写路径 db.ts:5710 按 v3 核心校验：v3 项目所有 override 添加被拒；**pack 交付物（认证报告等）两边都没有**；lite 的 verification 节点被拒
- [x] `server/routers/sampleSignoffs.ts:48`、`npiReadiness.ts:35`、`gateBlockers.ts:32`、`testPlans.ts:58` — 阶段存在性校验拒绝 verification、放行幽灵 evt/dvt
- [x] 复查其余级别②调用点是否可接受：`server/routers/tasks.ts:94`、`gateReviews.ts:294,365`、`projects.ts:314`、`db.ts:5704,7333`（标准档无包项目不受影响，lite/带包项目逐个确认语义）

**回归测试建议**：加一个参数化测试——lite+battery 项目跑一遍 裁剪propose/deliverable override/move回退/样品签核/portfolio row，断言 verification 阶段与 pb* 任务全链路可用。

## 🔴 P0 — 独立正确性

- [x] `server/routers/projects.ts:599` — 旧 API 字段 `input.risk` 不再参与 deriveSopRiskAssessment（原先 risk==='high'→强监管推荐+裁剪保护）。按原契约传 risk:'high' 的调用方被静默降级为 standard → 红线保护整体失效。修：把 input.risk 映射进 manualSafety/RegulatoryRiskLevel 的下限，或 schema 层显式 deprecated+报错

## 🟡 需要你拍板的语义决策

- [x] `shared/gate-readiness.ts:155` — 驳回不再阻塞就绪（你的注释理由成立：旧行为死锁，驳回后永远开不了新一轮）。但现在驳回完全不留强制力，整改只靠自觉。**建议折中**：rejected 阻塞至"显式开启新一轮评审"动作（新一轮 open 即解除），而不是完全不阻塞；配套恢复一条测试
- [x] MP 发布不再 archived:true（配了 getArchivedProjects/getAutomationActiveProjects，与 v3 的 P7 关闭 Gate 流程自洽——**确认无误，无需改**；唯一残留：已发布但从不走关闭移交的项目会一直吃自动化提醒，可考虑给 released 且 90 天无动作的项目加提醒或自动建议关闭）

## 🟠 效率（上线前修，避免带病上量）

- [x] `shared/npd-v3.ts:839` — getNpdV3EffectivePhases 无记忆化：按 `${tier}|${packs.sort().join(',')}` 做模块级 Map 缓存（≤48 组合），返回冻结共享数组。同时解决客户端对象标识不稳定击穿 useMemo 的问题（data.ts:374 消费方）
- [x] `server/automation/engine.ts:85` — runAutomation 无条件预取 getProjectMembers：改为规则命中+claim 成功后惰性取（每 tick 省 ~200 次 SELECT）
- [x] `server/routers/gateReviews.ts:293,363,392` — confirm 流程同一项目取 3 次；`:427` 签核人姓名 N+1（改 inArray 一次取）
- [x] `server/db.ts:5929` — applyDerivativeReuseStrategyToProject 事务内 ~110 次串行往返（每任务 select+write）：用已加载的 existingByKey 分区后批量 INSERT ON CONFLICT / 批量 UPDATE

## 🟢 清理（顺手做）

- [x] tier-rank 映射 `{lite:0,standard:1,full:2}` 三处重复（ProjectListView.tsx:123、Home.tsx:860、projects.ts:642）→ shared/npd-v3.ts 导出 `NPD_TIER_RANK` 或 `isNpdTierDowngrade()`
- [x] `server/routers/projects.ts:635` — 锁定包报错文案手写三元 → 用 `NPD_ADDON_PACKS.find(p=>p.id===pack)?.name`
- [x] `client/src/lib/data.ts:372` — getProjectPhases 硬编码 '2026-07-v3' 魔法串且与 shared 分发重复 → 统一走 getEffectivePhasesForProjectLike（把衍生品分支也收进去）
- [x] `server/sop-data.ts` — getSopPhasesForCategory 已无调用方（种子已迁），死文件删除
- [x] `server/automation/certificateRenewal.ts:7` — 第五份上海时区日期工具 → 抽一个 shared 日期 util（addDays/daysBetween/todayShanghai），顺带收编 rules.ts:775、metrics-window.ts、action-card-route.ts 的拷贝
- [x] `shared/derivative-deliverable-tailoring.ts:29` — 内联提交集重实现 effective-process.ts:38 的 phaseSubmissionTemplate（私有）→ 导出复用

## 评审覆盖说明

逐行扫描（shared/server/client 三路）与计划覆盖代理因会话限额中断，本清单偏重跨文件一致性与删除行为审计；单行级小 bug 与两份计划的逐任务覆盖核对未完整跑完，建议修完 P0 后补一轮 `/code-review` 或让我重跑那四个角度。
