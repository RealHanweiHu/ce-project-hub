# Implementation Plan: 项目类型与动态任务模型

## Overview

按已确认规格重构 NPD、DRV、JDM、OBT、ECO 与产品库 Revision 的分流和任务生成。第一增量先交付可正式使用的建项与任务生成：DRV 在创建时冻结六模块基线，JDM 在产品定义 Gate 后两段式生成，OBT 按客户设计输入导入，NPD 只有单一全流程，并保留风险/认证硬卡。第二增量增加受控基线变更，第三增量完成 ECO 动态任务和产品交付语义。

基线分支：`codex/project-type-dynamic-task-model`

专用 worktree：`/Users/huhanwei/Desktop/ce-project-hub-worktrees/project-type-dynamic-task-model`

已确认规格：`docs/design/2026-07-15-project-type-dynamic-task-model-spec.md`

## Architecture Decisions

- 新模型直接替换测试期旧模型，不保留历史项目兼容分支。
- 共享纯函数是任务组合的单一事实源，前端预览、服务端校验、数据库种任务均调用同一逻辑。
- DRV/JDM 模块只有 `reused | not_reused`；复用证据属于结构化基线，不生成隐藏任务。
- `id_cmf=not_reused` 必须同时满足 `structure_mold=not_reused`，共享校验和服务端都强制执行。
- DRV/OBT 创建时生成执行流程；JDM 创建时只种 P1，P1 Gate 通过后事务化生成 P2-P6。
- 阶段、任务、交付物、Gate 标准和排期依赖一起组合，不再先种全量任务再标记 skipped。
- `changeScopeDeclaration`、风险评估、证书覆盖和发布/关闭硬卡继续独立存在，模块复用不能替代安全输入。
- NPD 只有一个完整流程，删除 tier、addon pack 和固定配置透传死代码。
- 项目级 `productOwnerUserId` 表示产品负责人；现有 `pmUserId` 明确表示项目经理。
- 第一增量中冻结后的执行基线只读；受控变更入口在第二增量开放。
- 现有迁移已到 0067；本工作线从 0068 开始。不得与 `feat-project-collections` worktree 并行运行迁移型测试。

## Phase 0: Gate 0（已完成）

### Task 0.1: 固化在途基线并隔离工作树

**Description:** 将原工作树中的混合在途修改形成检查点提交，将本规格独立提交，并从验证通过的基线建立专用分支/worktree。

**Acceptance criteria:**
- [x] 原工作树类型检查、936 项测试和生产构建通过。
- [x] 在途工作和规格分别形成提交。
- [x] 新分支和专用 worktree 已创建，原工作树保持干净。

**Verification:**
- [x] `pnpm check`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `git worktree list --porcelain`

**Dependencies:** None

**Files likely touched:** Git metadata only

**Estimated scope:** S

## Phase 1: 第一增量——建项与任务生成

### Task 1: 建立项目执行基线领域模型

**Description:** 建立六模块、二元复用、复用证据、draft/frozen 执行基线和任务组合结果的严格类型与纯校验函数。

**Acceptance criteria:**
- [x] 六模块均有稳定 ID、显示名和责任域。
- [x] 复用模块缺来源、版本、证据或边界确认时校验失败。
- [x] 非法 ID/CMF 与结构组合、DRV 全模块复用均返回明确领域错误。

**Verification:**
- [x] RED→GREEN：`pnpm exec vitest run shared/project-track-tailoring.test.ts`
- [x] `pnpm check`

**Dependencies:** Task 0.1

**Files likely touched:**
- `shared/project-track-tailoring.ts`
- `shared/project-track-tailoring.test.ts`

**Estimated scope:** S

### Task 2: 增加项目产品负责人

**Description:** 在项目上增加产品负责人字段，创建时默认当前创建人，项目经理继续使用 `pmUserId`，并统一权限/展示语义。

**Acceptance criteria:**
- [x] 新项目保存 `productOwnerUserId`；未显式填写时默认创建人。
- [x] `pmUserId` 仍自动加入项目成员并获得 project_manager 角色。
- [x] 产品负责人和项目经理可以是不同用户，读取与权限判断不混淆。

**Verification:**
- [x] RED→GREEN：项目创建与角色集成测试。
- [x] `pnpm check`
- [x] `pnpm exec vitest run server/project-access-role.test.ts server/project-pm-membership.test.ts`

**Dependencies:** Task 0.1

**Files likely touched:**
- `drizzle/0068_project_product_owner.sql`
- `drizzle/schema.ts`
- `server/routers/projects.ts`
- `server/project-access-role.test.ts`

**Estimated scope:** M

### Task 3: 组合 DRV 六阶段模板

**Description:** 用公共任务与六个模块任务包构建 DRV 的 iteration/design/evt/dvt/pvt/mp 阶段，同时生成交付物、Gate 标准和排期依赖。

**Acceptance criteria:**
- [x] DRV 保留六阶段和 Close Gate 语义，旧四级复用不参与新组合。
- [x] 软件、可靠性、安规、配件、包装、物流、治具和 EOL 均为独立任务。
- [x] 复用一个模块只移除该模块专属任务和交付物，公共硬证据始终保留。

**Verification:**
- [x] RED→GREEN：DRV 阶段、任务、交付物和依赖测试。
- [x] `pnpm exec vitest run shared/sop-templates.test.ts shared/schedule-graph-coverage.test.ts shared/deliverable-vocab-guard.test.ts`
- [x] `pnpm check`

**Dependencies:** Task 1

**Files likely touched:**
- `shared/sop-templates.ts`
- `shared/task-deliverables.ts`
- `shared/schedule-graph.ts`
- `shared/sop-templates.test.ts`

**Estimated scope:** M

### Task 4: 交付 DRV 创建服务端链路

**Description:** 创建接口校验冻结基线和风险声明，数据库直接种最终有效阶段/任务，不再依赖建项后的策略应用。

**Acceptance criteria:**
- [x] API 拒绝缺复用证据、非法模块组合和六模块全复用。
- [x] 创建后的任务数与共享组合器完全一致，项目无需再次应用策略。
- [x] DRV 创建时仍生成风险声明版本并运行风险/认证评估。

**Verification:**
- [x] RED→GREEN：`server/project-track-create.test.ts`
- [x] `pnpm exec vitest run server/project-track-create.test.ts server/sop-entry-hardcards.test.ts`
- [x] `pnpm check`

**Dependencies:** Tasks 2, 3

**Files likely touched:**
- `server/routers/projects.ts`
- `server/db.ts`
- `server/project-track-create.test.ts`
- `shared/npd-v3.ts`

**Estimated scope:** M

### Task 5: 交付 DRV 创建界面

**Description:** 在两步建项中提供六模块复用选择、复用证据字段、条件化安全追问和实时任务预览。

**Acceptance criteria:**
- [x] DRV 默认六模块均“不复用”，复用时要求补齐证据字段。
- [x] ID/CMF 联动结构/模具，界面无法形成非法组合。
- [x] 公共、模块和总任务数实时显示，并与服务端创建结果一致。

**Verification:**
- [x] `pnpm check`
- [x] `pnpm build`
- [x] 本地浏览器创建 DRV，检查任务数、持久化结果和控制台。

**Dependencies:** Task 4

**Files likely touched:**
- `client/src/components/views/ProjectListView.tsx`
- `client/src/lib/data.ts`
- `client/src/lib/sop-templates.ts`

**Estimated scope:** M

### Checkpoint A: DRV 可运行

- [x] DRV 纯逻辑、API、数据库和 UI 串通。
- [x] 风险/认证链路没有被模块选择绕过。
- [x] `pnpm check && pnpm test && pnpm build` 通过。

### Task 6: 组合 JDM 六阶段模板

**Description:** 保留 input/design/evt/dvt/pvt/mp phaseId，将 P1 定义任务与 DRV 剩余公共任务、模块任务包和客户确认任务组合。

**Acceptance criteria:**
- [x] draft 基线只返回 input 阶段；frozen 基线返回 P1-P6。
- [x] P1 包含我方产品规格、CSR、风险声明、模块草稿和客户确认硬卡。
- [x] JDM 定义任务与 DRV 产品基线公共任务按语义键去重。

**Verification:**
- [x] RED→GREEN：JDM draft/frozen 模板测试。
- [x] `pnpm exec vitest run shared/sop-templates.test.ts shared/gate-signoffs.test.ts`
- [x] `pnpm check`

**Dependencies:** Tasks 1, 3

**Files likely touched:**
- `shared/sop-templates.ts`
- `shared/project-track-tailoring.ts`
- `shared/sop-templates.test.ts`
- `shared/gate-signoffs.test.ts`

**Estimated scope:** M

### Task 7: 实现 JDM 两段式持久化

**Description:** 创建 JDM 时只种 P1；产品定义 Gate 通过时在同一事务冻结执行基线并幂等生成 P2-P6。

**Acceptance criteria:**
- [ ] JDM 创建不要求客户规格书、客户输入版本或模块状态，只保存原始输入快照。
- [ ] 缺规格、CSR、模块基线、风险声明或客户确认时 P1 Gate 被阻塞。
- [ ] Gate 成功后原子插入 P2-P6；失败回滚，重复提交不重复插入。

**Verification:**
- [ ] RED→GREEN：`server/jdm-two-stage-seed.test.ts`
- [ ] `pnpm exec vitest run server/jdm-two-stage-seed.test.ts server/gate-confirm-atomicity.test.ts server/customer-track-seed.test.ts`
- [ ] `pnpm check`

**Dependencies:** Tasks 2, 6

**Files likely touched:**
- `server/db.ts`
- `server/routers/projects.ts`
- `server/routers/gateReviews.ts`
- `server/jdm-two-stage-seed.test.ts`

**Estimated scope:** M

### Task 8: 交付 JDM 定义与冻结界面

**Description:** JDM 创建页只收概念输入；项目 P1 显示规格、CSR、模块草稿、风险与客户确认表单，并预览 Gate 后任务。

**Acceptance criteria:**
- [ ] 创建页不再要求 `customerInputVersion` 或模块选择。
- [ ] Gate 前模块草稿可正常收敛；Gate 后基线只读，变更入口置灰。
- [ ] Gate 预览任务数等于实际生成任务数。

**Verification:**
- [ ] `pnpm check`
- [ ] `pnpm build`
- [ ] 本地浏览器完成“JDM 创建→填写 P1→通过 Gate→出现 P2-P6”。

**Dependencies:** Task 7

**Files likely touched:**
- `client/src/components/views/ProjectListView.tsx`
- `client/src/components/views/OverviewPanel.tsx`
- `client/src/pages/Home.tsx`
- `client/src/lib/data.ts`

**Estimated scope:** M

### Task 9: 重构 OBT 四阶段模板与入口硬卡

**Description:** 保留 intake/sample/pvt/mp，围绕客户输入、缺口/DFM、标准模块建议、首件、试产和客户放行生成固定任务。

**Acceptance criteria:**
- [ ] OBT 创建必须有客户设计输入版本、客户料号、商务边界和确认责任人。
- [ ] 治具与 EOL/测试程序、包装与物流分别为独立任务。
- [ ] 需要新产品设计时给出转 JDM 阻断，不使用 DRV 复用裁剪。

**Verification:**
- [ ] RED→GREEN：OBT 模板与入口测试。
- [ ] `pnpm exec vitest run shared/sop-templates.test.ts server/sop-entry-hardcards.test.ts server/customer-track-seed.test.ts`
- [ ] `pnpm check`

**Dependencies:** Tasks 1, 2

**Files likely touched:**
- `shared/sop-templates.ts`
- `server/routers/projects.ts`
- `server/services/sop-blindspot-service.ts`
- `server/sop-entry-hardcards.test.ts`

**Estimated scope:** M

### Task 10: 交付 OBT 创建界面

**Description:** 显示客户设计输入、未指定模块和我方标准模块建议字段，移除 JDM/OBT 共用错误文案。

**Acceptance criteria:**
- [ ] OBT 保留客户输入版本硬卡，JDM 不受该硬卡影响。
- [ ] 标准模块建议仅在 BOM 未指定时展示，并提示必须客户确认。
- [ ] 创建后阶段和任务与 OBT 共享模板一致。

**Verification:**
- [ ] `pnpm check`
- [ ] `pnpm build`
- [ ] 本地浏览器创建 OBT 并检查 intake 任务。

**Dependencies:** Task 9

**Files likely touched:**
- `client/src/components/views/ProjectListView.tsx`
- `client/src/lib/data.ts`
- `client/src/pages/Home.tsx`

**Estimated scope:** M

### Task 11: 保护安全/法规和盲点链路

**Description:** 按类型采集风险声明；JDM 未评估时不写全 false 声明，P1 Gate 阻塞；修正盲点扫描和认证覆盖。

**Acceptance criteria:**
- [ ] DRV/OBT/ECO 仍产生正式声明版本，JDM 可显示“待评估”。
- [ ] JDM 不再因缺客户输入版本误报，但缺规格/CSR/风险/客户确认会正确标红。
- [ ] 证书覆盖、风险单向升级、Release/Close 硬卡回归测试通过。

**Verification:**
- [ ] RED→GREEN：风险/盲点专项测试。
- [ ] `pnpm exec vitest run shared/sop-risk.test.ts server/sop-blindspot-completion.test.ts server/sop-governance-v3.test.ts server/release-gate.test.ts`
- [ ] `pnpm check`

**Dependencies:** Tasks 4, 7, 9

**Files likely touched:**
- `server/routers/projects.ts`
- `server/services/sop-blindspot-service.ts`
- `shared/sop-risk.ts`
- `server/sop-blindspot-completion.test.ts`

**Estimated scope:** M

### Task 12: 删除旧 DRV 四级策略链路

**Description:** 清除四级复用类型、策略应用、旧 resolver、自动豁免和设置面板，确保不存在旧任务 ID 的运行时入口。

**Acceptance criteria:**
- [x] `DerivativeReuseLevel`、`derivativeReuseStrategy` 和旧策略 mutation 无生产引用。
- [x] 新项目不创建 skipped 任务或自动豁免记录。
- [x] 任务、交付物和排期均只读取新执行基线。

**Verification:**
- [x] 删除前测试先改为新行为并确认 RED，再完成 GREEN。
- [x] 符号搜索结果清零。
- [x] `pnpm check`

**Dependencies:** Tasks 4, 7

**Files likely touched:**
- `shared/derivative-phase-resolver.ts`
- `shared/derivative-deliverable-tailoring.ts`
- `client/src/lib/sop-templates.ts`
- `client/src/components/views/OverviewPanel.tsx`

**Estimated scope:** M

### Task 13: 删除 NPD 分档和附加包死逻辑

**Description:** 保留单一完整 NPD 模板，删除 tier/addon 推荐、输入字段、固定配置透传和冲突文档状态。

**Acceptance criteria:**
- [ ] 创建 API 不接收 tier、packs 或降档理由。
- [ ] 前端不传 `NPD_FULL_TEMPLATE_CONFIG`，所有 NPD 使用唯一阶段/任务集。
- [ ] 旧分档规格标记为已被当前规格取代。

**Verification:**
- [ ] RED→GREEN：NPD 固定流程测试。
- [ ] `pnpm exec vitest run shared/npd-v3.test.ts server/npd-v3-create.test.ts shared/client-data-npd-v3.test.ts`
- [ ] `pnpm check`

**Dependencies:** Task 11

**Files likely touched:**
- `shared/npd-v3.ts`
- `server/routers/projects.ts`
- `client/src/pages/Home.tsx`
- `client/src/components/views/ProjectListView.tsx`
- `server/npd-v3-create.test.ts`

**Estimated scope:** M

### Checkpoint B: 第一增量完成

- [ ] DRV、JDM、OBT 三条创建路径通过 API 和浏览器验收。
- [ ] NPD 单一全流程、风险/认证硬卡和 Gate/Close 语义通过回归。
- [ ] 测试项目已按新模型重建，无旧策略运行时引用。
- [ ] `pnpm check && pnpm test && pnpm build` 全绿。

## Phase 2: 第二增量——受控基线变更

### Task 14: 建立执行基线变更记录与审批状态

**Description:** 增加不可覆盖的变更记录，包含旧/新基线、原因、影响、产品负责人批准以及 JDM/OBT 客户确认。

**Acceptance criteria:**
- [ ] 变更草稿、待内部批准、待客户确认、已应用、已拒绝状态可审计。
- [ ] 产品负责人以外用户不能内部批准；JDM/OBT 缺客户确认不能应用。
- [ ] 原冻结基线不被直接覆盖。

**Verification:**
- [ ] RED→GREEN：变更状态机与权限测试。
- [ ] `pnpm check`

**Dependencies:** Checkpoint B

**Files likely touched:**
- `drizzle/0069_project_execution_baseline_changes.sql`
- `drizzle/schema.ts`
- `server/routers/projects.ts`
- `server/project-baseline-change.test.ts`

**Estimated scope:** M

### Task 15: 实现任务恢复、保护和重排

**Description:** 应用已批准变更时原子对比有效任务，新增/恢复任务、保护已完成/待审批任务，并重新排期。

**Acceptance criteria:**
- [ ] reused→not_reused 恢复完整模块包并正确接入依赖链。
- [ ] not_reused→reused 遇已完成或待审批任务时阻止静默删除并返回影响清单。
- [ ] 应用、排期和活动日志同事务或具备明确回滚边界。

**Verification:**
- [ ] RED→GREEN：`server/project-baseline-reconcile.test.ts`
- [ ] `pnpm exec vitest run server/project-baseline-reconcile.test.ts shared/scheduling-contraction.test.ts`
- [ ] `pnpm check`

**Dependencies:** Task 14

**Files likely touched:**
- `server/db.ts`
- `shared/project-track-tailoring.ts`
- `shared/scheduling.ts`
- `server/project-baseline-reconcile.test.ts`

**Estimated scope:** M

### Task 16: 交付受控变更界面

**Description:** 在冻结基线面板提供“申请变更”，展示任务增减影响、内部批准和客户确认状态。

**Acceptance criteria:**
- [ ] 普通编辑仍不能修改冻结字段。
- [ ] 提交前可预览新增、保留、受保护任务和排期影响。
- [ ] JDM/OBT 明确显示客户确认步骤和证据。

**Verification:**
- [ ] `pnpm check`
- [ ] `pnpm build`
- [ ] 本地浏览器完成 DRV 和 JDM 各一条受控变更。

**Dependencies:** Task 15

**Files likely touched:**
- `client/src/components/views/OverviewPanel.tsx`
- `client/src/components/views/project-overview/ProjectSettingsDrawer.tsx`
- `client/src/lib/data.ts`

**Estimated scope:** M

### Checkpoint C: 第二增量完成

- [ ] 变更审批、客户确认、任务恢复/保护和审计端到端通过。
- [ ] `pnpm check && pnpm test && pnpm build` 全绿。

## Phase 3: 第三增量——ECO、产品交付与 Revision

### Task 17: 建立 ECO 变更类型任务组合器

**Description:** 用公共变更任务和变更类型包生成 ECO 任务、交付物、Gate 与排期。

**Acceptance criteria:**
- [ ] 电池、核心功能、电子、软件、结构、制造/EOL、重大包装/认证均有任务包。
- [ ] 创建时至少选择一个变更类型，风险声明继续驱动认证硬卡。
- [ ] ECO 输出语义为现有产品受控版本，不生成独立产品。

**Verification:**
- [ ] RED→GREEN：ECO 组合与创建测试。
- [ ] `pnpm check`

**Dependencies:** Checkpoint C

**Files likely touched:**
- `shared/project-track-tailoring.ts`
- `shared/sop-templates.ts`
- `shared/sop-templates.test.ts`
- `server/sop-entry-hardcards.test.ts`

**Estimated scope:** M

### Task 18: 交付 ECO 创建与预览界面

**Description:** ECO 创建页直接选择变更类型和完整风险范围，实时预览任务，不出现 DRV 模块或工作包。

**Acceptance criteria:**
- [ ] ECO 必须关联现有产品，但不要求先选择产品 Revision。
- [ ] 变更类型和风险声明均结构化保存。
- [ ] 前端预览与服务端实际任务一致。

**Verification:**
- [ ] `pnpm check`
- [ ] `pnpm build`
- [ ] 本地浏览器创建 ECO 并核对任务和风险硬卡。

**Dependencies:** Task 17

**Files likely touched:**
- `client/src/components/views/ProjectListView.tsx`
- `client/src/components/views/ProductOperationsPanel.tsx`
- `server/routers/projects.ts`
- `server/project-track-create.test.ts`

**Estimated scope:** M

### Task 19: 落实项目完成后的产品/版本交付

**Description:** NPD/DRV/JDM/OBT 完成生成独立产品；ECO 完成生成现有产品受控版本；不依赖输入 Revision。

**Acceptance criteria:**
- [ ] 四类开发项目各生成一个独立产品且不生成包装 Revision。
- [ ] ECO 只更新关联产品的受控版本，不创建第二个产品。
- [ ] 交付动作幂等，Gate、移交和活动日志可追溯。

**Verification:**
- [ ] RED→GREEN：发布/关闭集成测试。
- [ ] `pnpm exec vitest run server/release.test.ts server/release-gate.test.ts server/sop-governance-sprint2.test.ts`
- [ ] `pnpm check`

**Dependencies:** Task 18

**Files likely touched:**
- `server/db.ts`
- `server/routers/products.ts`
- `server/routers/handoffs.ts`
- `server/release.test.ts`

**Estimated scope:** M

### Task 20: 收口 Revision 分流与产品库入口

**Description:** 产品库 Revision 只处理包装、印刷、标签、说明书和文案轻改；重大影响明确转 ECO。

**Acceptance criteria:**
- [ ] Revision 不创建项目、不依赖项目任务。
- [ ] 重大包装运输、认证、核心 BOM 或复杂协作不能留在 Revision。
- [ ] 产品库 ECO 按钮不再因 `currentRevisionId` 为空被禁用。

**Verification:**
- [ ] RED→GREEN：轻量 Revision 与 ECO 分流测试。
- [ ] `pnpm exec vitest run server/lightweight-product-revision.test.ts server/products.test.ts`
- [ ] `pnpm check && pnpm build`

**Dependencies:** Task 19

**Files likely touched:**
- `client/src/components/views/ProductLibraryView.tsx`
- `client/src/components/views/ProductOperationsPanel.tsx`
- `server/routers/productGovernance.ts`
- `server/lightweight-product-revision.test.ts`

**Estimated scope:** M

## Final Checkpoint

- [ ] 全部规格成功标准可从 UI 或自动测试验证。
- [ ] `pnpm check` 通过。
- [ ] `pnpm test` 全量通过，无 skipped/disabled 新测试。
- [ ] `pnpm build` 通过。
- [ ] 本地浏览器无控制台错误，DRV/JDM/OBT/ECO/Revision 关键流程完成验收。
- [ ] 旧四级 DRV、NPD 分档和 JDM 错误输入硬卡的生产引用清零。
- [ ] 文档描述最终状态，`tasks/todo.md` 全部勾选。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `sop-templates.ts` 体量大且被大量测试引用 | High | 每条轨道分任务修改；先写失败测试；每次只改一个模板族 |
| JDM Gate 后动态插入阶段破坏原子性 | High | 单事务 + 唯一约束 + 幂等集成测试 |
| 模块裁剪误删安全/认证证据 | High | 公共硬证据固定保留；风险/证书测试作为每个检查点必跑项 |
| 旧四级策略残留造成双轨行为 | High | 符号清零守卫测试；不保留兼容分支 |
| 两个 worktree 共用测试数据库 | Medium | 禁止并行迁移型测试；本工作线串行运行全量测试 |
| `feat-project-collections` 迁移编号冲突 | Medium | 本分支使用 0068+；合并时单独重编号，不在本任务合并该 worktree |
| UI 大文件继续膨胀 | Medium | 新表单/面板优先抽为独立组件，但不做无关重构 |

## Open Questions

无阻塞问题。以下按规格默认执行：产品负责人默认创建人；客户确认采用确认人、日期、证据引用和备注；现有测试项目可清理重建；不集成外部电子签名。
