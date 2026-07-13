# DRV（产品迭代/衍生开发）设计审核报告

> 日期：2026-07-08
> 审核对象：未提交 WIP（migration 0051 + 23 文件），含 `shared/sop-templates.ts` DRV 模板与复用策略、`server/db.ts applyDerivativeReuseStrategyToProject`、`projects.applyDerivativeStrategy`、OverviewPanel 流程策略面板、schedule-graph DRV 依赖网、sop-templates.test.ts。
> 结论：**设计方向正确、机制骨架完整，可以走下去；但有 2 个 P1 缺陷需在提交前修复、1 个 P1 设计缺口决定 DRV 能否兑现"减负"承诺。**

---

## 1. 总体评价

DRV 的设计目标——"避免所有项目都走 NPD，把大/中改款从 NPD 和 ECO 之间的空档接住"——定位准确，三轨分流（极小改→ECO / 大中改→DRV / 外观→IDR）的边界在 exceptionStrategy 里写得清楚，转轨规则（触平台重构→NPD、纯 CMF→IDR）双向都有。

**专属裁剪机制是这版设计的亮点**：6 模块（电池/机芯/PCBA/软件/结构模具/包装认证）× 4 复用等级（直接复用/适配验证/轻量修改/重新开发）驱动任务集自动裁剪，比通用的"整阶段裁剪 + 手动任务裁剪"前进了一大步，而且机制可泛化到 NPD/ECO（见瘦身计划批次二）。

## 2. 确认有效的设计点（不用改）

1. **恒留集保底**（`DERIVATIVE_ALWAYS_TASK_IDS` 21 项）：立项全套、DFM/设计冻结、整机回归、EVT/DVT 评审、PVT 全阶段、MP 全阶段不可被策略裁掉——发布硬闸口语义与 `assertNoReleaseGateTailoring` 双保险。
2. **OR 语义**：任务命中任一模块规则即保留，避免多模块共用任务被误裁（如 de2 关键模块验证挂 4 个模块）。
3. **策略应用事务化**：skip/restore/insert 同事务 + 活动日志（含 effectiveTasks/skippedTasks 明细）+ 联动重排期 + 自动派工，且 `assignTasksByRole` 已跳过 skipped 任务。
4. **已完成任务防误裁**：非 rebased 的已完成/待审批任务被策略裁剪时直接抛错，防止静默丢工作量。
5. **大/中改自动建议**：UI 按策略实时算 gateSuggestion（redevelop≥1 或深改≥2 → 大改款），把设计文档里的判定规则落成了代码。
6. **normalizeDerivativeReuseStrategy 容错**：未知模块/非法等级回退默认档，老数据安全。
7. **模块规则内容质量高**：每模块的 cannotCut 边界（电芯/热路径/主承力结构/认证边界变化不得裁）与锂电产品风险实况吻合。

## 3. 问题清单

### P1-1 排期坍塌：被裁任务的依赖链断裂后回退到项目开始日 ✅ 已修复（2026-07-09）

> 修复：`shared/scheduling.ts` 新增 `contractSchedTasks`（依赖收缩，环安全），接入 `applyProjectSchedule`（改为按有效任务收缩排期，被裁任务不再占用幽灵工期）、`loadEffectiveScheduleContext`（重排/延误影响不断链）、`forecastProjectEnd`（预测不坍塌）。测试：`shared/scheduling-contraction.test.ts`（4 例）+ `server/derivative-strategy-apply.test.ts` 排期/重排 2 例。

`server/services/schedule-service.ts:60` 把 skipped 任务从排期域剔除；`shared/scheduling.ts:118-123 computeStart` 对"前置全部不在域内"的任务回退 `startDate`（项目开始日）。

**失败场景**：全模块 direct_reuse（系统明确支持的最轻场景，21/38 任务）。dd6（恒留）的前置 dd1-dd5/dd9 全部被裁 → dd6 被排到项目第 0 天，与立项阶段并行；dd10→de1→整条 EVT/DVT/PVT 链连锁提前，甘特图与"预计完成日"全部失真。

**修复建议**：排期前做**依赖收缩**——被裁任务从图中摘除时，把它的前置转接给它的后继（透传闭包），而不是简单过滤。`buildSchedTasks` 后加一步 `contractSkippedDeps(tasks, effectiveIds)` 即可，纯函数可单测。

### P1-2 rebasedTaskIds 重置过宽：任何一次策略应用都会重置已完成的核心任务 ✅ 已修复（2026-07-09）

> 修复：`applyDerivativeReuseStrategyToProject` 对比新旧策略，重置范围限定为「等级变化的模块」影响的任务（`getDerivativeModuleAffectedTaskIds`）；同策略重放 no-op；已完成任务被裁剪时在返回值/活动日志的 `completedSkippedTasks` 单列。测试：`server/derivative-strategy-apply.test.ts`（重放/无关模块/相关模块/单列 4 例）。

`applyDerivativeReuseStrategyToProject` 中，凡在 `rebasedTaskIds`（dd1-dd5/de5/dv1-dv5/dp3-dp5）内、已完成且仍有效的任务，**每次 apply 都被重置为 todo 并清空审批字段**——包括：只改 packaging 一个模块、甚至重放完全相同的策略。同时这批任务被排除在"已完成不可裁"守卫之外，可被静默 skip。

**失败场景**：设计阶段已完成 dd1-dd5，PM 在 EVT 期间把 packaging_cert 从 direct_reuse 调成 adapt_verify（合理操作），结果电池/机芯/PCBA/软件/结构五个设计包任务全部回到 todo、审批记录清零。

**修复建议**：
- 对比新旧策略，**只重置"等级发生变化的模块"所影响的任务**（用 `DERIVATIVE_TASK_REQUIREMENTS` 反查模块→任务）；
- 同策略重放应为 no-op；
- 已完成的 rebased 任务被裁剪时，至少在返回值/活动日志里单列"已完成但被跳过"清单，UI 提示 PM 确认。

### P1-3 设计缺口：任务裁剪不联动交付物，"减负"只兑现了一半 ✅ 已修复（2026-07-09）

> 修复：`shared/derivative-deliverable-tailoring.ts` —— 交付物的全部产出任务（排除 Gate 评审任务）被策略裁掉时自动豁免（复用任务级映射推导，不另维护模块→交付物表）；`applyDerivativeReuseStrategyToProject` 同事务落 override（理由「模块直接复用—流程策略自动豁免」），策略回调自动撤销，只增删带该理由的行、PM 手动豁免/加回不碰；安全锚点（UN38.3/MSDS/电芯认证/EOL 100%/认证补测）永不自动豁免。附带合理性修正：dv1（DVT 样机）从只挂结构模块改为挂 5 个关键模块。测试：shared 4 例 + server 4 例。

`getProjectEffectiveProcess` 对 derivative 的 phaseOverride 只过滤 tasks；`phase.deliverables ∪ gateStandard.requiredDeliverables` 不随策略收缩。结果：structure_mold=direct_reuse 后 DVT Gate 仍必交「T1试模报告/模具问题清单/T2修模验证报告/限度样本」4 项模具交付物，PM 必须去 Gate 面板逐项排除并填写理由。

这直接决定 DRV 能否兑现承诺——**任务少了但要交的东西没少，员工感受不到减负**。而 `DERIVATIVE_REUSE_MODULE_RULES.deliverables` 字段已经维护了模块→交付物映射，目前只做展示、没有被机器消费。

**修复方案（2026-07-09 拍板）**：applyDerivativeStrategy 时**自动删除相关评审要求和交付物**——按模块规则直接落 deliverable override（action=remove，理由自动填"模块直接复用—策略裁剪"），与任务 skip 同一事务生效，不走"建议+确认"弹窗；活动日志留痕，PM 可在 Gate 面板逐项恢复。人工手动裁剪保留为补充手段（处理映射未覆盖的个案）。安全类交付物（UN38.3/MSDS/电芯认证/EOL 100%）永不自动删除（其"或复用确认"措辞本身就是快速路径）。模块→任务/交付物映射需按合理性逐条复核后再上线。审计闭环沿用现有 override+reason 机制，不需要新表。

### P2-4 策略冻结时点未实现

设计文档口径：P1 输出策略初版、**Gate1 冻结复用等级**、Gate2 复核、EVT Gate 关闭选做项、之后变化走 ECO/变更记录。代码现状：`canEditProjectInfo` 的人任何时点都能 apply，无 Gate 后加锁、升权或强制理由。配合 P1-2 的过宽重置，后期误操作破坏力不小。

**建议**：设计冻结（dd10 done）之后 apply 要求填写变更理由并在活动日志高亮；PVT 阶段之后直接拒绝（改走 ECO）。不必做复杂状态机，两个 if 即可。

### P2-5 同名交付物跨 Gate 重复审核

`getReviewSatisfiedSet(projectId, phaseId, …)` 按阶段隔离。DRV 里「认证补测/复用确认」是 DVT、PVT 双必交；UN38.3/MSDS/电芯认证在 dd9(P2)/dv4(P4)/dp6(P5) 三处任务级出现；「模块复用策略与流程裁剪矩阵」在 di2/di5(P1) 与 dd10(P2) 跨阶段重复。同一份证据要走 2-3 次上传+审核。

**建议**：同名交付物早阶段审核通过后，后续 Gate 自动视为满足（除非有更新版本文件）；或按瘦身计划把必交点收敛到发布闸口一处。

### P2-6 默认策略 = 全量 38 任务，且策略面板藏在设置里

默认档（battery/mechanism/firmware=adapt_verify、pcba/structure=light_modify、packaging=direct_reuse）经模拟为 **38/38 全保留**。新建 DRV 项目如果没人去「项目设置→流程策略」走一遍，实际就是一个比 ECO 重、逼近 NPD 的满配流程——"专属裁剪"退化为可选彩蛋。

**建议**：把策略选择嵌入建项流程（新建向导 Step 2 或立项向导 KickoffWizard），DRV 项目不选策略不能完成建项；默认档保守是对的（安全兜底），关键是**强制走一遍选择动作**。同时 di5 的「迭代计划与裁剪矩阵」guide 里链接到该面板。

### P3-7 小项

- `DERIVATIVE_REUSE_MODULE_RULES[battery].taskIds` 含 dp6（恒留 Gate 任务），映射冗余无害，但会让"该模块影响 N 个任务"的 UI 统计虚高一格。
- migration 0051 用 `ADD VALUE IF NOT EXISTS 'derivative'`——PG enum 追加不可回滚（DROP VALUE 不存在），部署顺序照旧（先迁移后重启 app），与既有 0044 经验一致，无需改动，仅提示。
- 文档 `2026-06-29-sop-design.md` 里 DRV 任务骨架写 29 项（di6+dd5+de5+dv5+dp5+dm3 编号），与代码 38 项（dd10/de6/dv7/dp6）不同步，提交前把文档刷新为单一事实源导出。

## 4. 与 SOP 瘦身计划的联动

DRV 模板本身的任务/交付物收敛（2026-07-09 加深口径：**P1 收敛为一份《迭代产品定义书》吸收复用策略确认与大/中改判定，交付物 51→约26 接近减半**；试产三报告合一、T1/T2 合一、EVT可选项裁剪记录改自动生成等）在 [2026-07-08-sop-simplification-plan.md](./2026-07-08-sop-simplification-plan.md) §2.3；本报告 P1-3 的"策略自动删除相关评审和交付物"即瘦身计划批次三的核心。两份文档按批次一起排期即可。

## 5. 提交前检查单（建议顺序）

1. ~~修 P1-1 排期依赖收缩~~ ✅ 已完成（contractSchedTasks + 三处接线，707 测试全过、tsc 零错）。
2. ~~修 P1-2 重置范围~~ ✅ 已完成（changedModules 限定 + completedSkippedTasks 单列）。
3. ~~做 P1-3 策略自动删除相关评审和交付物~~ ✅ 已完成（718 测试全过、tsc 零错、dev 项目真机验证：设计包自动豁免+理由+可恢复）。
4. P2-4/P2-6 各两处小改（Gate 后加锁提示 + 建项向导嵌入策略步骤）。
5. 刷新 2026-06-29-sop-design.md 的 DRV 章节，跑 `node scripts/test.mjs` 全量 + demo 项目全 direct_reuse/全 redevelop 两个极端演练，再提交。
