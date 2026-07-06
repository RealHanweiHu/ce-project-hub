# CEHub MVP Fix Plan (Engineering Execution)

> 日期：2026-07-05 · 基线：`main`（322+ 测试全绿）
> 本计划基于 2026-06-21 角色化流程审计（`docs/2026-06-21-wf-browser-test-findings.md`）+ 2026-07-05 代码现状核对。
> **重要**：审计后至今已有大量修复落地（Gate 原子化+硬卡、交付物类型/版本、角色透镜工作台、风险生命周期、Portfolio rollup、异常升级规则、Gate 收紧+豁免机制）。本计划**只覆盖仍然开放的缺口**，已修复项标注「已支持」不再重做。

---

## 1. Executive Summary (What must be fixed first)

截至 2026-07-05，真正阻断工厂实际使用的 TOP 5：

| # | 问题 | 为什么阻断 EVT/DVT/PVT 流程或角色分工 |
|---|------|--------------------------------------|
| 1 | **BOM 批量导入完全不存在**（openBOM/Excel/CSV） | OBT 转产轨道的核心输入是客户 openBOM。现在 `server/routers/bom.ts` 只有逐行手填（add/update/delete/whereUsed/diff），一个 100+ 行的电池泵 BOM 手工录入不可行 → OBT 轨道实质是「换了阶段名的空壳」，采购(scm)看板也无物料数据可看。审计唯一遗留的「严重」级缺失。 |
| 2 | **ECO 项目无法挂靠源 NPD 项目** | `projects` 表没有 `sourceProjectId`。量产后发现 P0 问题 → 发起 ECO，是锂电产品最高频的变更场景，但现在 ECO 只能建成孤立项目，问题→变更→验证→切版的追溯链在项目层断裂（`product_definition_changes.sourceProjectId` 只覆盖定义层变更，不覆盖 ECO 项目本身）。 |
| 3 | **「决策层只读」组织角色不存在** | exec 大盘现在授权给 system admin ∪ 任一项目 owner/manager（`shared/role-dashboard.ts:69`）。厂长/老板要看全景必须被加进某个项目当 manager（获得该项目**编辑权**）或当 admin（全系统满权限）。「看全部、改不了」这个真实厂长诉求 NOT SUPPORTED CURRENTLY，权限模型与决策可视性耦合。 |
| 4 | **Gate 有条件通过(conditional)无跟踪闭环** | `project_gate_reviews.conditions` 是纯文本。EVT/DVT 常见「有条件过会：3 项遗留 DVT 前关闭」，但没人、没期限、没状态跟这些条件——下个 Gate 就绪检查也不校验上个 Gate 的遗留条件。硬卡上线后，conditional 会成为主要泄压阀，无闭环 = 硬卡被架空。 |
| 5 | **项目列表/总览无轨道/阶段多维筛选** | 18 个项目已经找不过来（现仅风险 chip + 星标，`ProjectListView.tsx:109`）。PM/管理层每天「看我的 NPD 在 DVT 的红灯项目」这类组合查询做不了，规模到 30+ 项目时导航瘫痪。数据全在 portfolio 接口里，纯 UI 缺口。 |

**已修复、无需再规划**（供对照）：Gate 通过原子化+就绪硬卡（`gateReviews.confirmAndAdvance` + `assertGateReady`）、产品/项目双轴分离（products/product_revisions/projects.productId）、Task/Issue/Change 三表分离、交付物审核+类型/版本、17 角色权限矩阵+统一鉴权入口、角色透镜工作台、被指派任务无条件可见、风险生命周期对象、Portfolio 度量 rollup、测试报告 QA 审核卡 Gate、MP Release 硬闸+钉钉审批。

---

## 2. Phase 1 — MUST FIX (Core System Stability)

> 周期建议：第 1–3 周。全部 P0。

### 2.1 Product vs Project separation — 补最后一块：非 NPD 轨道的产品挂靠 + ECO 源项目链

* **Problem**：双轴骨架已建成（已支持），但 ① ECO/OBT/JDM 项目可以不挂 `productId` 建成孤儿项目；② ECO 项目没有源项目字段，无法从在制/量产 NPD 上「发起 ECO」。
* **Why it breaks real factory workflow**：锂电池泵的 ECO 几乎都源于某个已量产产品的某个具体项目（客诉/认证整改/降本）。孤儿 ECO = 变更验证结果无法回写产品版本线，`resultRevisionId` 无处可挂，Rev A→Rev B 断链。
* **Proposed solution**：
  1. `projects` 增加 `sourceProjectId`（nullable, FK→projects.id）+ `originType`（enum: `issue` | `changelog` | `manual`）+ `originId`。
  2. ECO/OBT 轨道创建时**强制**选择 productId（NPD 概念期可空、planning Gate 就绪检查里要求补挂——沿用现有 gate readiness 维度扩展）。
  3. 项目详情「问题」和「变更记录」卡片增加「发起 ECO 项目」按钮：预填 productId、baseRevisionId=当前已发布 revision、sourceProjectId、originId。
* **Data model change**：`drizzle/schema.ts` projects 表 +3 列（如上），加索引 `idx_projects_source_project`。迁移单独提交（遵循仓库约定：drizzle generate + 程序化 migrate）。
* **API change**：`server/routers/projects.ts` create 入参 schema +3 字段；新增 `projects.listDerived({projectId})`（查 ECO 子项目）；`getGateReadiness` 增加「非 NPD 项目必须挂产品」blocker。
* **Frontend change**：新建向导第 2 步按 category 分支（ECO/OBT 显示源项目+产品选择器）；`ProjectDetailView` 头部显示「源项目 →」面包屑；IssueList/ChangeLog 行内加发起入口。
* **Priority: P0**

### 2.2 Role-based dashboards — 决策层只读角色（解耦 admin）

* **Problem**：exec 透镜授权 = `systemRole==='admin' || 任一项目 owner/manager`（`shared/role-dashboard.ts:69`）。不存在「组织级只读决策者」。
* **Why it breaks real factory workflow**：厂长/总经理要全景大盘但不该有编辑权；现在要么给 admin（可改一切、可删项目），要么逐项目加 manager（获得 Gate 评审、成员管理等写权限）。审计 PERM-02 的设计矛盾仍在。
* **Proposed solution**：`users.role` 枚举从 `"user" | "admin"` 扩为 `"user" | "exec_viewer" | "admin"`。`exec_viewer`：
  - `getEffectiveProjectRole()`（`server/project-access.ts`）中解析为任意项目的 `viewer`（canView=true，全部写权限 false）。
  - `resolveRoleDashboardLens()` 第 69 行：`systemRole === 'admin' || systemRole === 'exec_viewer' || hasRole(EXEC_ROLES)` → exec 透镜。
  - portfolio/analytics 查询的项目可见范围对 exec_viewer 放开为全量（同 admin 的读路径）。
* **Data model change**：`users.role` varchar 值域扩展（无结构迁移，补 zod 枚举）。
* **API change**：`server/routers/admin.ts` 用户管理 setRole 支持新值；`server/db.ts` 中所有 `role === 'admin'` 的**读路径**判断处补 exec_viewer（写路径不动——这是安全关键点，逐处 review，配测试 `exec-viewer-readonly.test.ts`）。
* **Frontend change**：AdminPanel 用户角色下拉 +「决策层(只读)」；exec_viewer 登录默认落 overview；项目详情全组件走现有 `canEditProjectInfo=false` 只读态（已支持，复用）。
* **Priority: P0**

### 2.3 Task / Issue / Change separation — 统一「变更」双机制入口

* **Problem**：三实体表已分离（已支持）。剩余混乱点：变更有两套机制——`project_changelog`（项目级 ECO/ECN/决策记录）和 `product_definition_changes`(产品定义偏离)，UI 入口分散，用户分不清何时用哪个。
* **Why it breaks real factory workflow**：工程师发现「客户要求把额定压力从 150psi 改 120psi」不知道记在哪：改的是产品定义（应走 definition change）还是项目内 spec 决策（changelog）。记错则 Gate trace snapshot 与产品定义快照对不上。
* **Proposed solution**：不合表（语义确实不同）。做**统一发起入口**：「记录变更」弹窗第一步选影响范围（仅本项目执行 → changelog；改产品定义/规格基线 → definition change，且自动带 `sourceProjectId`）。changelog 类型为 eco/ecn/spec 时提示是否同步产生 definition change。
* **Data model change**：无。
* **API change**：无新 procedure；`changelog.create` 返回值附带 `suggestDefinitionChange: boolean`（按 type 判断）。
* **Frontend change**：`ChangeLog.tsx` 新建流程改两步向导；ProjectDetailView 变更 tab 顶部并列展示两类记录（现状核实：definition changes 在产品库侧，项目侧不可见）。
* **Priority: P0**

### 2.4 Gate Review structure — conditional 条件项闭环 + rejected 恢复动线

* **Problem**：① `project_gate_reviews.conditions` 纯文本，无 owner/期限/状态；② rejected 后 gate task 置 blocked，但被锁阶段的恢复入口是「重新评审」，审计发现体验割裂（历史显示 approved 却要求再审）已部分修复，rejected→整改→重审动线仍靠用户自己找。
* **Why it breaks real factory workflow**：EVT/DVT Gate 大量以 conditional 放行（硬卡上线后更甚）。条件不闭环 = DVT 带着 EVT 遗留跑，PVT 爆雷。这正是 stage-gate 在工厂失效的经典路径。
* **Proposed solution**：
  1. 新表 `gate_review_conditions`（id, gateReviewId FK, title, ownerUserId, dueDate, status: `open`|`closed`|`waived`, closedBy, closedAt, waiveReason）。
  2. `getGateReadiness`（`server/db.ts`）加第 5 维度：**上一 Gate 的 open conditions 必须全部 closed/waived** 才就绪。
  3. rejected 时在被锁阶段头部渲染「整改中」横幅：列出 rejected 原因(notes) + 一键「发起重审」按钮（复用现有多轮 roundNumber 机制）。
* **Data model change**：+1 表（如上），`project_gate_reviews` 保留 conditions 文本列做迁移兼容。
* **API change**：`gateReviews.ts` + `conditions.list/add/close/waive`；`confirmAndAdvance` decision=conditional 时强制至少 1 条 condition（zod refine）；readiness 计算扩维。
* **Frontend change**：`GateReviewModal.tsx` conditional 分支加条件项编辑器（owner 选择器+日期）；`GateReadinessChecklist.tsx` 显示遗留条件维度；工作台 TODAY 卡纳入「我 owner 的 Gate 遗留条件」。
* **Priority: P0**

### 2.5 Basic permission model — 现状确认 + 一处收口

* **Problem**：矩阵和统一鉴权已支持（`ROLE_PERMISSIONS` + `project-access.ts`），本阶段只剩 2.2 的 exec_viewer。另有一处审计残留：admin 在任意项目满权限且无审计区分（PERM-02 的另一半）。
* **Proposed solution**：admin 在项目内的写操作在 `activity_logs.meta` 里标记 `viaSystemAdmin: true`（`project-access.ts` 的 effective role 解析处已知来源，透传到日志层即可），供事后审计。不做行为限制。
* **Data model change / API change**：无表变更；`server/db.ts` logActivity 调用点透传标记。
* **Frontend change**：无。
* **Priority: P0**（半天工作量，随 2.2 一起做）

### 2.6 Deliverable binding to stages — 已支持，仅补展示缺口

* **Problem**：交付物按阶段绑定、审核状态机、类型/版本、Gate 硬卡、收紧+豁免全链路已支持。剩余：文件 tab 仍以「文件」为主视角，交付物视角要看审核面板，执行角色反映「这一阶段我还欠哪几个交付物」不直观。
* **Proposed solution**：`FilesPanel.tsx` 增加「按交付物」分组视图（deliverableName 分桶：要求的交付物 × 已传文件 × 审核状态 × 当前版本），缺失项置顶红字。纯前端，数据已齐（effective process + files + deliverable reviews 三个已有查询拼装）。
* **Data model / API change**：无。
* **Frontend change**：FilesPanel 分组切换 + 缺口卡片。
* **Priority: P0**

---

## 3. Phase 2 — SHOULD FIX (Workflow Correctness)

> 周期建议：第 3–6 周。全部 P1。

### 3.1 BOM 批量导入（openBOM / Excel / CSV）— 本阶段最高优先

> Top-5 第 1 名放在 Phase 2 是因为它属于 BOM 域且依赖 2.1 的产品挂靠收口；如果 OBT 是近期业务重点，可提前与 Phase 1 并行。

* **Implementation steps**：
  1. 后端解析：`server/services/bom-import.ts`——xlsx/csv 解析（用 `exlsx`/`papaparse` 级轻量库），输出 `{rows, errors}`；**整单校验、任一行错则全部拒绝、不落库**（审计 TRK-02 预期）。
  2. 字段映射：内置 openBOM 列名映射表（Part Number/Quantity/Ref Des/Manufacturer…→ `bom_items` 列），支持用户在预览步调整映射（映射配置随请求走，MVP 不持久化模板）。
  3. 事务入库：`bom.import` mutation——解析结果 + projectId → 单事务批量 insert 到 working BOM（`bom_items.projectId` 模式）；已有 working BOM 时提供「覆盖 / 合并(按 partNumber upsert)」二选一。
  4. 权限：复用 `assertProjectPermission(canEditTasks 或新增 canEditBom)`——现状 bom 路由权限已有测试（`bom-router-perms.test.ts`），沿用其口径。
* **Data schema changes**：无新表。`bom_items` 已够用。
* **UI flow changes**：`BomPanel.tsx` +「导入」按钮 → 三步弹窗（上传 → 映射预览+错误清单 → 确认入库）；错误清单可下载。空 BOM 态首推导入而非手填。
* **Priority: P1**

### 3.2 EVT / DVT / PVT / MP 流正确性 — rejected 语义（✅ 已拍板 2026-07-05）

* **决议**：**保留「停留本阶段整改重审」为唯一语义，不做阶段回退**。不通过 = 停留本阶段 + gate task blocked + 多轮重审（已支持且可追溯）；DVT 发现设计问题的正确表达是「DVT 停留 + 发起设计整改任务/ECO」。已过 Gate 记录、交付物审核态、测试报告不级联失效。
* **已落地**：语义定版常量 `GATE_REJECTION_SEMANTICS`（`shared/sop-templates.ts` 头部，含标准横幅文案供 CEH-10 复用）；用例集 RISK-08「交付物随阶段回退」预期按此语义作废对齐。
* **剩余**：CEH-10 被锁阶段整改横幅接入该文案（不通过时明示「不回退」）。
* **Data schema changes**：无。
* **Priority: P1**（决策部分已完成）

### 3.3 质量阻断机制 — 已支持，补「质量一票否决」显性化

* 现状：`project_gate_blockers`（quality/npi 双类型）+ 测试报告 QA 审核才计入 readiness + `canCloseIssues` 仅 owner/manager/qa——机制已在。缺口：QA 角色透镜里没有「我挂出的 blocker / 待我审的报告」聚合。
* **Implementation steps**：quality 透镜（`PerspectivePanel` quality 分支）加两卡：待审测试报告（`project_test_reports.reviewStatus='pending'`）、我创建未解除的 gate blocker。纯前端 + workbench 一个聚合查询。
* **Data schema changes**：无。
* **Priority: P1**

### 3.4 PE / NPI 集成 — 已支持骨架，补 NPI 就绪清单

* 现状：pe/mfg 角色、npi 类 gate blocker、canNpiGateBlock 已在；Gate 收紧已把 PFMEA/CTQ、EOL 测试验收等 NPI 交付物压进 DVT/PVT。
* **Implementation steps**：npi 透镜加「PVT 前 NPI 就绪」卡（治具/夹具/产线交付物完成度，数据 = 该阶段 NPI 责任角色交付物的审核状态过滤）；`sop-templates.ts` 给 NPI 交付物统一标注 responsibleRoles 含 pe/mfg（部分已有，补齐）。
* **Priority: P1**

### 3.5 BOM revision + 产品版本 — 已支持冻结/diff/where-used，补「变更↔BOM行」关联

* 现状：working/frozen 双态、发布冻结、diff、where-used、changelog↔revision 关联已支持。缺口：ECO 改了哪些 BOM 行没有结构化记录（只有 revision 间 diff 事后推断）。
* **Implementation steps**：`project_changelog` 增加 `affectedPartNumbers: JSONB[string]`（轻量方案，MVP 不做行级 FK）；ChangeLog 编辑器支持从当前 working BOM 多选零件；revision 发布时 snapshotChangelog 已带走该字段（已支持的盖章机制自动覆盖）。
* **Data schema changes**：changelog +1 JSONB 列。
* **UI flow changes**：ChangeLog 表单 + BOM 零件选择器；BomPanel 行上显示「关联变更」徽标。
* **Priority: P1**

### 3.6 客户版本处理 — 已支持 delta 模型，补 JDM 结构化字段（审计 #10）

* 现状：`customer_variants`（delta、认证复用、golden sample、客户签核）已支持。缺口：JDM 项目本身无「客户来图/规格输入/委托范围」结构化字段。
* **Implementation steps**：
  1. `projects` 增加 `trackFields: JSONB`（按 category 的专属字段包，zod schema 定义在 `shared/track-fields.ts`：jdm={designInputSource, customerDrawingFileIds[], scopeOfWork, customerSignoffs[]}, obt={sourceBomFileId, customerPartNumbers}…）。用 JSONB 而非加列：各轨道字段集不同、演进快，与现有 `customFields` JSONB 先例一致。
  2. 新建向导第 2 步按 category 渲染专属字段块；详情页 OverviewPanel 固定展示。
  3. JDM 的「设计输入冻结」Gate readiness 增加 blocker：designInputSource/scopeOfWork 必填、客户来图至少 1 个文件。
* **Data schema changes**：projects +1 JSONB 列。
* **Priority: P1**

### 3.7 File → Deliverable 重构 — 已基本完成，补草稿与失败恢复（审计 #13 残留）

* 现状：文件挂 deliverableName/fileType/fileVersion、重传触发重审、审核对应版本可见——已支持。残留：表单编辑无本地草稿，401 与网络错误同权处理。
* **Implementation steps**：
  1. `client/src/hooks/useDraftField.ts`：编辑中字段写 `localStorage`（key=`draft:{projectId}:{field}`），保存成功清除；页面加载检测到草稿弹「恢复未保存内容」。只覆盖项目基础信息长文本字段（background/description/value），任务勾选类不需要。
  2. 401 专项处理：tRPC client errorLink 里 401 → 弹「会话过期」模态（保留页面状态）+ 重新登录入口，与普通网络错误 toast 区分。
* **Data schema changes**：无。
* **Priority: P1**

### 3.8 多维筛选（审计 #8/#12，Top-5 第 5 名）

* **Implementation steps**：`ProjectListView.tsx` 现有 FilterKey 机制扩为多维组合：track(category) / phase(stageBucket 已有) / risk(已有) / PM。chip 可叠加 + 一键清除；总览 PerspectivePanel 的分布图块变成可点击筛选入口（点「DVT」柱 → 带 filter 跳列表）。纯前端，portfolio 数据已含全部维度。
* **Priority: P1**

---

## 4. Phase 3 — ADVANCED PLM / SCALING LAYER

> 全部 P2，MVP 8 周内不做，仅立架构方向。

### 4.1 ECR → ECO → ECN 正式管线

* **Architecture suggestion**：不再造新表，升级现有链：`project_requirements`(source=quality/customer, 承担 ECR 角色) → convert 到 `project_changelog`(type=eco, 已有) → ECO 项目（2.1 的 sourceProjectId 链）→ 实施完成时自动生成 type=ecn 的 changelog 记录 + 通知受影响 customer_variants 的负责人（复用 automation engine 事件）。加一个状态机守卫服务 `server/services/change-pipeline.ts` 串联状态迁移合法性。
* **Tradeoffs**：复用三张现有表 vs 独立 ECR/ECO/ECN 三表——复用省 2 周开发且不分裂历史数据，代价是 requirements 表语义变宽（用 `type` 区分）。规模 <50 变更/月时复用方案胜。
* **Complexity: M** · **Priority: P2**

### 4.2 多客户产品变体规模化

* **Architecture suggestion**：现有 delta 模型（`customer_variants.deltas`）保持；加「合成视图」——`bom.resolveVariant({variantId})` 在读时把 base revision BOM + deltas 合成完整 BOM（纯函数放 `shared/oem-variant.ts`，已有骨架）。变体数 >20 或 delta 深度嵌套时再考虑物化。
* **Tradeoffs**：读时合成（一致性好、无同步问题）vs 物化变体 BOM（查询快、要维护失效）。当前客户量选读时合成。
* **Complexity: M** · **Priority: P2**

### 4.3 高级 BOM revision 图谱

* **Architecture suggestion**：`product_revisions.parentRevisionId` 已构成链；升级为图 = 允许多父（合并降本 ECO 与客户 ECO）时加 `revision_edges` 表。UI 用现有 diff 做边标注。**先不做**——单链 + where-used 已覆盖当前产品复杂度（组件级 componentProductId/componentRevisionId 已支持子装配）。
* **Complexity: L** · **Priority: P2**

### 4.4 审计追踪 / 合规

* **Architecture suggestion**：`activity_logs` 已是不可变追加表，且 gate traceSnapshot / mp_releases 快照 / product_definition_snapshots 三层盖章已在。补：① 导出服务（按项目/时间段生成 PDF/CSV 审计包，供客户验厂）；② `activity_logs` 加 DB 级防篡改（撤销 UPDATE/DELETE 权限的独立 pg role）。
* **Tradeoffs**：应用层只追加（现状，够用）vs 触发器/权限级强制（验厂硬要求时再上）。
* **Complexity: S–M** · **Priority: P2**

### 4.5 供应商集成层

* **Architecture suggestion**：supplier 角色 + canViewSupplierFiles + file visibility='supplier' 已在。集成层 = 供应商询价/交期回写：MVP 用「供应商成员 + 受限视图」（BOM 只读其供货行 + 文件上传到 supplier visibility），不做独立系统对接。`bom_items.supplierName` 升级为 `suppliers` 主数据表是前置条件。
* **Complexity: M** · **Priority: P2**

### 4.6 外部协作门户

* **Architecture suggestion**：不建独立门户应用。复用现有登录 + external_customer 角色，做「外部视图收敛」：外部账号登录后只渲染 CustomerPortalLayout（里程碑时间线 + customer visibility 文件 + 待客户签核项），路由层白名单硬隔离（`server/project-access.ts` 的 canViewInternalWorkspace=false 已挡数据层）。
* **Tradeoffs**：同应用收敛视图（快、共享鉴权）vs 独立门户（隔离彻底、双倍维护）。小团队选前者，数据层已有双保险。
* **Complexity: M** · **Priority: P2**

---

## 5. Data Model Refactor Plan

> 现有 schema（`drizzle/schema.ts`，1756 行）结构大体正确，**不需要推倒重构**。以下为目标模型全景 = 现有关系确认 + 本计划新增（标 ★）。

### 核心关系（ER 说明）

```
Platform 1—N Product 1—N ProductRevision（链式 parentRevisionId）
Product  1—N ProductDefinition 1—N ProductDefinitionSnapshot（versionNumber 递增）
Product  1—N CustomerVariant（delta 引用 baseRevision）
Product  1—N Project（projects.productId；项目是"一次开发活动"，产品是"长生命周期资产"）

Project  N—1 ProductRevision（baseRevisionId 起点）
Project  N—1 ProductRevision（resultRevisionId 产出）
Project ★N—1 Project（sourceProjectId：ECO 挂源项目）
Project  1—N ProjectPhase / ProjectTask / ProjectIssue / ProjectRisk / ProjectRequirement
Project  1—N ProjectChangelog（项目级变更）；Product 1—N ProductDefinitionChange（定义级变更）
Project  1—N GateReview（同 phase 多轮 roundNumber）
GateReview ★1—N GateReviewCondition（conditional 遗留项）
Project  1—N DeliverableReview（unique: projectId+phaseId+deliverableName）
Project  1—N ProjectFile（可挂 phaseId/taskId/deliverableName）
Project  N—M User（经 project_members，带 role）
BomItem  N—1 ProductRevision（frozen 态）或 N—1 Project（working 态）——互斥
MpRelease N—1 Product + N—1 ProductRevision + N—1 Project（三方盖章点）
ExternalApprovalInstance N—1 任意实体（entityType+entityId 多态）
```

### 关系基数速查

| 关系 | 基数 | 说明 |
|------|------|------|
| Product↔Project | 1—N | 一个产品多次开发活动（NPD、多个 ECO、OBT） |
| Project↔Member(User) | N—M | 经 project_members，一人一项目一角色（unique 约束） |
| Deliverable↔File | 1—N | 同名交付物多版本文件（fileVersion 区分），审核对最新版 |
| Task↔Issue | 1—N 弱关联 | issues.relatedTaskId，可空 |
| Requirement↔Task/Issue/Change | 1—1 转化 | convertedType+convertedId，保留来源 |
| Change↔Revision | N—1 | changelog.revisionId，发布时 snapshotChangelog 盖章 |
| Role↔Permission | 静态矩阵 | 代码内 ROLE_PERMISSIONS，非表——MVP 保持（见第 9 节） |

### 版本化实体（versioned）

- **ProductRevision**（revisionLabel：Rev A/B…，status: draft→released→superseded）
- **ProductDefinitionSnapshot**（versionNumber 单调递增）
- **ProjectFile**（fileVersion，同 deliverableName 多版本共存）
- **GateReview**（roundNumber 多轮）
- **CustomerVariant**（经 sourceRefId 追 ECO 来源）

### 不可变记录（immutable，只增不改）

- `activity_logs` — 全系统审计流水
- `mp_releases` 的 snapshotBom/snapshotDocs/snapshotChangelog/openIssues — MP 盖章
- `project_gate_reviews.traceSnapshot` — Gate 时刻 BOM/变体断面
- `product_definition_snapshots.snapshot` — PRD 版本断面
- released 态的 `bom_items`（冻结后禁改，已有 `bom-frozen-access` 守卫）

### 本计划全部 schema 变更汇总（4 项，均为增量）

1. ★ `projects` +`sourceProjectId`/`originType`/`originId`（2.1）
2. ★ `users.role` 值域 +`exec_viewer`（2.2）
3. ★ 新表 `gate_review_conditions`（2.4）
4. ★ `projects` +`trackFields` JSONB（3.6）；`project_changelog` +`affectedPartNumbers` JSONB（3.5）

---

## 6. Workflow Engine Design (Critical)

> 现状：SOP 模板驱动（`shared/sop-templates.ts` 的 gateStandard）+ 有效流程（模板+裁剪）+ `getGateReadiness` 多维就绪 + `confirmAndAdvance` 原子推进。**引擎已存在且经过测试，本节是定版规格 + 2.4 扩展后的目标态。**

### 项目如何从 Concept → MP

```
concept → planning → design → EVT → DVT → PVT → MP
每阶段：执行任务（visibleRoles 派工）→ 上传交付物（审核工作流）→ 满足就绪 → Gate 评审 → confirmAndAdvance
```

### Gate 迁移触发与阻断

* **触发**：具备 `canGateReview`（owner/manager）的用户在 GateReviewModal 提交 decision → 服务端 `confirmAndAdvance` 单事务完成【写评审 + gate task=done + currentPhase 前进】。
* **硬阻断**（`assertGateReady`，任一不满足则 mutation 抛错，无法通过）：
  1. 本阶段前置任务全部 done/skipped（skipped 需裁剪审批）
  2. 必需交付物全部「已审核通过」（deliverable review approved；豁免需 override+reason）
  3. 无 open 的 P0/P1 issue
  4. 无 open 的 gate blocker（quality/npi 任何角色挂的）
  5. ★ 上一 Gate 的 conditional 遗留条件全部 closed/waived（2.4 新增）
* **Gate 失败（rejected）**：停留本阶段（不回退，3.2 拍板确认）；gate task → blocked；整改后经「重新评审」发起 round+1；全部轮次留痕。

### 各阶段进入规则（entry = 上一 Gate 通过 + 该 Gate 的 exit 全量满足）

| 进入 | 规则要点（gateStandard.requiredDeliverables，含 2026-07-02 收紧项） |
|------|------|
| **EVT entry** | design Gate 过：安全 FMEA 与危害分析、电芯厂质量审核/复用资质、保护电路设计评审、PCB 原理图&Layout 审核通过；无 open P0/P1 |
| **DVT entry** | EVT Gate 过：EVT 测试报告（**QA reviewStatus=approved 的 pass/conditional 才计入**）、EVT 问题全部闭环或降级留痕、设计冻结确认 |
| **PVT entry** | DVT Gate 过：DVT 全项测试报告 QA 审核通过、PFMEA/CTQ 控制计划、可靠性/安全项无 waived 的 P0 |
| **MP release** | PVT Gate 过 + `products.mpRelease` 硬闸：无 open P0/P1、必需交付物齐（UN38.3、MSDS、电芯安全认证、EOL 100% 测试验收）、BOM 冻结为新 revision、snapshotBom/Docs/Changelog 盖章、钉钉审批（若启用）；条件放行必须 overrideReason+followUpOwner+dueDate |

### 谁能批 Gate

| 动作 | 角色 |
|------|------|
| Gate 评审（通过/有条件/不通过） | project owner、manager（`canGateReview`）；admin 兜底 |
| 质量 blocker 挂/解 | qa、owner、manager（`canQualityGateBlock`） |
| NPI blocker 挂/解 | pe、mfg、owner、manager（`canNpiGateBlock`） |
| 交付物审核 | 指定 reviewer（deliverable review 工作流） |
| 流程裁剪（跳任务/免交付物） | PM 提案 → admin 审批（tailoring 状态机） |
| MP Release | owner/manager 发起 → 钉钉外部审批链（可配置） |

---

## 7. Role Dashboard Redesign

> 底座已在：`resolveRoleDashboardLens` 九透镜 + `PerspectivePanel` + 我的任务视图 + 执行角色 tab 收敛。以下为每透镜的定版规格；标 ★ 为本计划新增 widget，其余为已支持项的确认。

| 角色(透镜) | 登录看到的 widgets | 可执行动作 | 永远不该看到 | 拥有的决策 |
|---|---|---|---|---|
| **Product Manager** (pm) | 我的产品线项目、产品定义偏离待批、需求池 triage 队列、★定义变更对成本/售价影响汇总 | 建/改需求、确认产品定义、批 definition change、转化需求 | 其他产品线细节、供应商成本明细以外的采购数据 | 产品定义基线、需求优先级、SKU 计划 |
| **Project Manager** (project_manager) | TODAY 三卡（逾期/今日/本周 Gate）、待协调拍板（待审交付物>P0P1>未分配>Gate 未就绪>阻塞）、我负责的项目、★我项目的 Gate 遗留条件 | 派工、改期（走延期影响确认流）、提裁剪、发起 Gate 评审会 | 全组合对比大盘（那是 exec 的） | 项目内资源分配、进度承诺、裁剪提案 |
| **Engineering** (rd_hw/rd_sw/rd_mech) | 我的任务（默认落地页，已支持）、我阶段的交付物缺口★（2.6 视图）、指给我的 issue | 完成任务、传交付物、报/改 issue、评论 | 度量/看板/需求池/甘特/变更 tab（已收敛）、成员管理、成本字段 | 技术方案（在任务/评审范围内） |
| **Quality** (qa/cert/battery_safety) | 待我审的测试报告★、我挂的未解除 gate blocker★、open P0/P1 列表、认证交付物到期 | 审报告、挂/解质量 blocker、关闭 issue（qa 独有 canCloseIssues）、waive 测试项留痕 | 编辑任务/改期（canEditTasks=false）、BOM 编辑 | 质量放行：报告审核结论、issue 关闭、质量一票阻断 |
| **PE / NPI** (pe/mfg) | PVT 前 NPI 就绪卡★（治具/产线交付物完成度）、我挂的 npi blocker、试产 issue | 挂/解 NPI blocker、完成 NPI 任务、传 DFM/PFMEA 交付物 | 需求池编辑、客户商务字段 | 可制造性放行（NPI blocker） |
| **Management** (exec：admin/owner/manager/★exec_viewer) | 组合大盘（RAG 分布、需关注红名单、阶段分布、度量对比表）、本周 Gate 日历、MP 放行待批 | admin/owner/manager：Gate 评审、健康度覆盖、MP 放行；**exec_viewer：零写动作** | 执行细节噪音（任务清单级别）——大盘只到项目/Gate 粒度 | 继续/终止（Gate decision）、资源仲裁、有条件放行 |
| **Sales** (sales) | 我客户的项目里程碑时间线、customer visibility 文件、客户签核待办 | 建需求（source=customer/sales）、传客户文件、评论 | 内部成本/毛利、BOM、内部 issue 细节、供应商文件 | 客户承诺日期的输入（不裁决） |
| **External** (external_customer/supplier) | 收敛门户视图（4.6）：里程碑、对其可见文件、待其签核项 | 下载/上传对应 visibility 文件、签核确认 | 内部工作区一切（canViewInternalWorkspace=false 已硬隔离）、其他客户变体存在性 | 客户侧签核（golden sample、来图确认） |

---

## 8. Implementation Backlog (Actionable Engineering Tasks)

> 命名：CEH-xx。S≈≤1天，M≈2–3天，L≈1周。前后端标注 BE/FE。

| ID | Title | 描述 & 涉及文件 | BE/FE | 复杂度 | 依赖 | 优先级 |
|----|-------|----------------|-------|--------|------|--------|
| CEH-01 | projects 加 sourceProjectId/originType/originId 迁移 | `drizzle/schema.ts` +3 列+索引；drizzle generate + migrate；zod 同步 | BE | S | — | P0 |
| CEH-02 | 「发起 ECO」入口 + 创建预填 | `projects.ts` create 入参、`IssueList.tsx`/`ChangeLog.tsx` 按钮、向导预填 | BE+FE | M | CEH-01 | P0 |
| CEH-03 | 非 NPD 项目产品挂靠就绪 blocker | `server/db.ts` getGateReadiness 增维；向导 ECO/OBT 分支强制产品选择器 | BE+FE | S | CEH-01 | P0 |
| CEH-04 | exec_viewer 系统角色 | `users.role` 值域、`project-access.ts` 解析、`role-dashboard.ts:69`、admin 面板下拉、读路径逐处 review | BE+FE | M | — | P0 |
| CEH-05 | exec_viewer 只读回归测试 | 新增 `server/exec-viewer-readonly.test.ts`：全部写 procedure 403、全部读 200 | BE | S | CEH-04 | P0 |
| CEH-06 | admin 代操作审计标记 | logActivity 透传 `viaSystemAdmin` | BE | S | — | P0 |
| CEH-07 | gate_review_conditions 表 + CRUD | 新表迁移；`gateReviews.ts` conditions.list/add/close/waive；conditional 强制≥1 条 | BE | M | — | P0 |
| CEH-08 | 就绪检查第 5 维：上 Gate 遗留条件 | `getGateReadiness` + `shared/gate-readiness.ts` 纯函数 + 测试 | BE | S | CEH-07 | P0 |
| CEH-09 | GateReviewModal 条件项编辑器 + 就绪清单展示 | `GateReviewModal.tsx`、`GateReadinessChecklist.tsx`、PM TODAY 卡接入 | FE | M | CEH-07 | P0 |
| CEH-10 | rejected 阶段整改横幅 + 一键重审 | `ProjectDetailView.tsx` 被锁阶段头部 | FE | S | — | P0 |
| CEH-11 | 变更统一发起两步向导 | `ChangeLog.tsx` 弹窗改造；definition change 联动建议 | FE | M | — | P0 |
| CEH-12 | FilesPanel 按交付物分组视图 | `FilesPanel.tsx`：交付物×文件×审核态×版本矩阵，缺口置顶 | FE | M | — | P0 |
| CEH-13 | BOM 导入解析服务（xlsx/csv，整单拒绝） | 新 `server/services/bom-import.ts` + 单测（错误行、空列、重复 PN） | BE | M | — | P1 |
| CEH-14 | bom.import mutation（事务、覆盖/合并） | `server/routers/bom.ts` + `db.ts` 批量 insert；权限沿用 bom-router-perms 口径 | BE | M | CEH-13 | P1 |
| CEH-15 | BomPanel 三步导入弹窗 | 上传→映射预览+错误清单→确认；空态导入引导 | FE | L | CEH-14 | P1 |
| CEH-16 | ~~rejected 语义拍板 + 文档/用例对齐~~ ✅ 2026-07-05 完成 | 决议=stay-and-rework 不回退；`GATE_REJECTION_SEMANTICS` 已加入 `sop-templates.ts`；RISK-08 预期作废对齐 | — | S | — | ~~P1~~ 完成 |
| CEH-17 | quality 透镜两卡（待审报告/我的 blocker） | `PerspectivePanel.tsx` quality 分支 + `workbench.ts` 聚合查询 | BE+FE | M | — | P1 |
| CEH-18 | npi 透镜 NPI 就绪卡 | 同上 npi 分支；数据=阶段内 pe/mfg 责任交付物审核态 | BE+FE | M | — | P1 |
| CEH-19 | changelog.affectedPartNumbers + BOM 零件选择器 | schema +1 列；`ChangeLog.tsx` 多选器；BomPanel 徽标 | BE+FE | M | — | P1 |
| CEH-20 | projects.trackFields JSONB + JDM/OBT 专属字段块 | schema +1 列；`shared/track-fields.ts` zod；向导/OverviewPanel 渲染 | BE+FE | M | — | P1 |
| CEH-21 | JDM 设计输入冻结 Gate 就绪扩展 | trackFields 必填 + 来图文件 ≥1 进 readiness | BE | S | CEH-20 | P1 |
| CEH-22 | 本地草稿 useDraftField + 恢复提示 | 新 hook；接入项目长文本字段 | FE | M | — | P1 |
| CEH-23 | 401 会话过期专项处理 | tRPC errorLink → 重登模态，保留页面状态 | FE | S | — | P1 |
| CEH-24 | 列表/总览多维组合筛选 | `ProjectListView.tsx` FilterKey 扩展（track/phase/PM 叠加+清除）；分布图点击联动 | FE | M | — | P1 |
| CEH-25 | ECR→ECO→ECN 管线状态机服务 | `server/services/change-pipeline.ts` + automation 事件通知变体负责人 | BE | L | CEH-02 | P2 |
| CEH-26 | 变体 BOM 读时合成 bom.resolveVariant | `shared/oem-variant.ts` 纯函数 + procedure | BE | M | — | P2 |
| CEH-27 | 审计包导出（PDF/CSV） | activity_logs+快照按项目/时段导出 | BE | M | — | P2 |
| CEH-28 | suppliers 主数据表 + bom_items 关联 | 供应商集成层前置 | BE | M | — | P2 |
| CEH-29 | 外部客户门户收敛视图 | CustomerPortalLayout + 路由白名单 | FE | L | — | P2 |

**建议排期（4–8 周 MVP）**：W1–2 → CEH-01~06；W2–3 → CEH-07~12；W3–5 → CEH-13~15（BOM 导入）+ CEH-16~18；W5–6 → CEH-19~24；P2 项 8 周后另立计划。

---

## 9. Suggested System Architecture

> 原则：现有架构（tRPC 单体 + Postgres + S3 + React SPA）对 3–5 人团队是**正确的**，不引入微服务/消息队列。以下为边界定版。

### 模块结构

```
shared/          纯函数域逻辑（gate-readiness / delay-impact / metrics / role-dashboard / track-fields★）
                 ← 所有业务规则先写这里 + 单测，前后端同构复用（现有模式，保持）
drizzle/         schema 单一事实源；枚举经 shared/const.ts 转出口
server/
  _core/         express + trpc 装配
  routers/       24 个域路由（薄层：zod 校验 + 权限断言 + 调 db/service）
  services/      跨表业务编排（deliverable-review-service、★bom-import、★change-pipeline）
  automation/    事件引擎 + 规则（升级/通知走这里，不另起通知系统）
  db.ts          查询层（当前 192KB——见下方拆分建议）
client/src/
  pages/Home.tsx 视图路由（query-string 状态机）
  components/views/  域视图组件
```

### 服务边界（单体内逻辑边界，非进程边界）

1. **Project Execution**（projects/tasks/issues/risks/phases）
2. **PLM Spine**（products/revisions/definitions/variants/bom/mp-release）——只通过 productId/revisionId 与执行域连接
3. **Governance**（gateReviews/gateBlockers/deliverableReviews/tailoring/testPlans）——全部经 `getGateReadiness` 汇聚
4. **Identity & Access**（auth/members/project-access）——唯一鉴权入口，任何新路由必须走 `assertProjectPermission`
5. **Integration**（dingtalk/automation/notifications/storage）

### 数据库设计方针

- Postgres 单库；JSONB 用于**低查询频/高演进**字段（customFields、trackFields、snapshots），关系列用于**要 join/要索引**的一切（本计划的 sourceProjectId 就因此做列不做 JSONB）。
- 快照盖章模式（gate trace / mp release / definition snapshot）继续作为不可变层，**禁止任何"修快照"需求**。
- 技术债：`server/db.ts` 192KB 应按上述 5 边界拆成 `server/db/{execution,plm,governance,access,integration}.ts`——建议在 Phase 2 结束后做一次机械拆分（纯移动，不改逻辑），避免与功能开发冲突。

### 权限系统架构

- 保持**代码内静态矩阵**（ROLE_PERMISSIONS）+ 统一解析（getEffectiveProjectRole 取最高权）。不做数据库驱动的动态权限——小团队下动态权限的配置错误风险 > 灵活性收益；新增角色 = 改矩阵 + 跑 role-visibility-coverage 测试。
- 三层防线不变：前端隐藏（体验）→ 路由断言（真正边界）→ 数据过滤（file visibility / 任务 visibleRoles / 外部工作区隔离）。
- 本计划唯一扩展：系统级角色轴 user/exec_viewer/admin 与项目级角色轴正交。

### 工作流引擎架构

- 保持**声明式 SOP 模板 + 计算就绪 + 原子迁移**，不引入通用 BPMN/状态机库：
  - 规则声明在 `sop-templates.ts`（gateStandard）+ 收紧 manifest（`gate-tightening.ts`，带日期追加 + 幂等豁免迁移——这个模式很好，定为标准）；
  - 就绪计算是纯函数（可测、可解释、blockers 可枚举展示）；
  - 迁移只有一个入口 `confirmAndAdvance`（单事务）。新增任何 Gate 维度（如 CEH-08）只改就绪函数，不碰迁移入口。
- 异常路径（升级/提醒/ECN 通知）一律走 automation engine 事件，不在业务路由里内联发通知。

---

## 附：与审计 14 项问题的对账

| 审计# | 状态 | 对应 |
|---|---|---|
| 1 Gate 非原子 | ✅ 已修（confirmAndAdvance） | — |
| 2/5 就绪可绕过 | ✅ 已修（assertGateReady 硬卡） | 2.4 补 conditional 闭环 |
| 3/7' 头部刷新滞后 | ✅ 大体已修 | 回归时顺带核验 |
| 4 回退语义 | ✅ 已拍板（2026-07-05：stay-and-rework 唯一语义，不回退） | CEH-16 完成；CEH-10 横幅接文案 |
| 6/14 exec 绑 admin | 🔶 部分修（lens 扩到 owner/manager） | CEH-04 exec_viewer 收口 |
| 7 指派不可见 | ✅ 已修（assignee 优先） | — |
| 8/12 无筛选器 | ❌ 开放 | CEH-24 |
| 9 ECO 无源项目 | ❌ 开放 | CEH-01/02 |
| 10 JDM 无专属字段 | ❌ 开放 | CEH-20/21 |
| 11 openBOM 导入缺失 | ❌ 开放（唯一严重级） | CEH-13/14/15 |
| 13 保存失败提示 | 🔶 部分修（toast 已加） | CEH-22/23 草稿+401 |
