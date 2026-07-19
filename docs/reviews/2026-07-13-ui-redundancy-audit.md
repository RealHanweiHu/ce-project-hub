# UI 信息冗余全量审查（2026-07-13）

范围：员工可达的全部页面——全局壳/我的任务/总览、项目列表与详情（含设置抽屉）、任务/问题/风险/需求/Gate 各 tab、BOM/文件/19 个治理面板、产品库/SOP 库/管理后台/账户页。基线：当前工作树（含未提交修改）。5 路并行代码审查汇总，与 `2026-07-12-page-load-reduction-design.md` §10 遗留清单已交叉对照。

**总结论**：页面减负 §1-§6 落地后，"进度/就绪度"数据口径已经统一，但**呈现层还留着三类大冗余**——①旧一代组件没删干净（总览目录近半是死代码、旧总揽 OverviewPanel 成了设置抽屉里的只读躯壳）；②评审/发布弹窗把各面板已有的缺口信息又汇总重列一遍；③个人工作队列在 3-4 个入口重复渲染（对应 spec §6 遗留未完成项）。

---

## A. 死代码 / 不可达（直接删，零风险）

### A1. 总览目录近一半组件从未被渲染
`OverviewPage.tsx:67-77` 实际只渲染 PortfolioDashboard（exec）或 PerspectivePanel（其他角色）。以下仅被当类型 import 或完全无引用：

| 文件 | 状态 |
|---|---|
| `overview/KpiStrip.tsx` | 整文件死代码 |
| `overview/RagHealthPanel.tsx` | 整文件死代码 |
| `overview/PortfolioTable.tsx` | 组件死代码（`PortfolioTableRow` 类型仍被多个 live 文件引用，删前需迁类型） |
| `overview/PortfolioMetricsTable.tsx` | 整文件死代码 |
| `overview/MilestoneCalendar.tsx` | 整文件死代码（CalendarPage 是其严格超集） |
| `PerspectivePanel.tsx:40-41` ExecutiveDecisionBoard 分支 | `lens==="exec"` 不可达（exec 恒走 PortfolioDashboard） |

### A2. 三个整文件死组件
- `pages/ComponentShowcase.tsx`（1438 行）：App.tsx 路由未挂载、全仓无 import，纯 demo，应从生产 bundle 删除。
- `components/AIChatBox.tsx`（335 行）：唯一引用点是 ComponentShowcase，随其一并成死代码（生产顶栏没有 AI 入口）。
- `components/ChangePasswordDialog.tsx`（172 行）：`Home.tsx:1180-1187` 有渲染，但 `setChangePasswordOpen` 全仓从未以 true 调用，对话框永远打不开；功能已被 `AccountPage.tsx:94-109` 取代。连同 Home.tsx 相关 state 一起删。

### A3. 死属性/死分支（小件）
- `ProjectDetailView.tsx:731` `ReadinessRow` 组件疑似 orphan（Gate 缺口已收敛到 GateReadinessChecklist），确认无引用后删。
- `GanttView.tsx:95,377` `editingField` state 写入后从未被读取。
- `TaskListView.tsx:52,115` `showAssignee` 死属性（无调用方传入、JSX 无负责人列，且文件头注释与实现不符）。
- `GateReviewModal.tsx:376-377,530-538` `blockers` 回退分支不可达（唯一调用点恒传 projectId/gateTaskId 且 `blockers={[]}`）。
- `MembersPanel.tsx:17,26-122` 18 个角色的 `labelEn` 字段定义后零渲染。

---

## B. 重复信息（同一数据员工看到 2-6 遍）——按价值排序

### B1. 设置抽屉里的旧总揽躯壳（最大单点）
`OverviewPanel` 被降级塞进 ProjectSettingsDrawer（`ProjectDetailView.tsx:3013-3022`）后，其中**只读**的「关键信息」「关键指标」「catConfig 类别大卡」（`OverviewPanel.tsx:215-291`）把 编号/PM/阶段/进度/健康度/任务完成率 在"设置"抽屉里再展示一遍——与详情页头部、ProjectDashboard 构成三重重复，且这些块在抽屉里并不可编辑（基础字段编辑实际走头部 inline）。
**建议**：抽屉只留可编辑的「立项信息」与各功能分区，删掉只读三块。

核心字段重复矩阵（同一数值最多 6 处）：

| 字段 | 出现位置 |
|---|---|
| 整体进度 | 头部进度条 `ProjectDetailView.tsx:2583` / Dashboard 进度卡 `ProjectDashboard.tsx:351` / 抽屉 `OverviewPanel.tsx:264` / 列表卡 `ProjectListView.tsx:1830` / 列表行 `:1971` / 列表抽屉 `:845` |
| 当前阶段 | 头部 PhaseStepper `:2590` + FocusBand `:648` / Dashboard 关键信息 `:309` + 焦点卡 `:168` / 抽屉 `:262` / 列表抽屉 `:844` |
| PM、日期、健康度、code、类别 | 均为 4-5 处，同上分布 |

### B2. ProjectDashboard 内部与 FocusBand 的自我重复
- 「下一 Gate」在 Dashboard 内渲染两次：焦点卡 `ProjectDashboard.tsx:168-182` 与右列大卡 `:367-388`，同源 statusSummary.nextGate。二选一。
- 常驻 FocusBand（`ProjectDetailView.tsx:591-688`）与总览 tab 焦点三卡上下叠加，且 Gate 数据来自**两套 query**（`gateReviews.readiness` vs `projects.statusSummary`）——有口径不一致风险，违反 §5 单一来源原则。建议总览 tab 下隐藏 FocusBand，或统一数据源。

### B3. Gate/Close 评审弹窗把各面板缺口重列一遍（面板群最大问题）
GateReviewModal 单弹窗依次塞入：就绪清单、StabilityGatePanel、CloseHandoffPanel、硬卡警告、会签矩阵、Gate 标准、历史、表单——纵向极长且多处重复：
- Gate 就绪度三处并存：`ProjectDetailView.tsx:2900-2904`（内联摘要）+ `:3435`（阶段侧栏 checklist）+ `GateReviewModal.tsx:521`（弹窗 checklist），同一 readiness 数据。
- CloseHandoffPanel 双挂载（`OverviewPanel.tsx:310` 可编辑 + `GateReviewModal.tsx:543` 只读整表），且移交阻塞在弹窗内被列两次（面板自身 `CloseHandoffPanel.tsx:110-114` + 弹窗汇总 `:550`）。
- 认证缺口（`CertificationCoveragePanel.tsx:94-108` vs `GateReviewModal.tsx:548`）、条件项缺口（`ControlledConditionsPanel.tsx:68` vs `:549`）、测试报告（TestPlanPanel vs checklist test_reports 维度）同样被重列。
- GateStandardPanel 渲染两遍：任务详情内联 `ProjectDetailView.tsx:3449-3454` + 弹窗 `GateReviewModal.tsx:622-629`。
- 「未就绪」warning 文案三处（`GateReviewModal.tsx:335,530,544`。

**建议**：弹窗层的硬卡汇总块（`:544-553`）整体降级为一行「存在 N 项未满足硬卡」+ 跳转；明细只在各自面板一处；Gate 标准弹窗内折叠。这正是 spec §4 遗留「交付物完成度改链接」的延伸。

### B4. ReleaseDialog 平行维护第二套判定
`ReleaseDialog.tsx:216-244` 的发布前校验（交付物缺失/P0P1/前置 Gate）本质是 GateReadinessChecklist 维度的再实现，违反单一口径原则；且阻塞信息三重呈现（结论块 `:193-211` + 逐项 Check + 底部红框 `:359-369` + 按钮 title）。
**建议**：校验直接消费 `gateReviews.readiness` 结论；红框在有逐项 Check 时省略。

### B5. 个人工作队列 3-4 个入口重复渲染（= spec §6 未完成项）
- `workbench.mine` 在 MyTasksView 整页（`:118`）、总览 PerspectivePanel「现在处理」桶（`:388-413`）**+ 底部又内嵌一份完整 TaskListView**（`:439-443`）、CalendarPage（`:185-203`）各渲染一遍。
- 待审核交付物两处：`MyTasksView.tsx:230-251` 与 PerspectivePanel 队列（`:485-498`）；**NotificationBell（`:48-74`）里还塞了第三份**「待你审核的交付物」列表。
**建议**：按 spec §6 把 MyTasksView 下线合并进「我的工作」；总览工作台不再内嵌第二份 TaskListView；铃铛只留通知计数+跳转。

### B6. 组合看板（exec 总览）内部指标成对重复
- 逾期任务 live 端 3 处（KPI `PortfolioDashboard.tsx:105` + FocusBand `:248-260` + 下钻抽屉）；P0/P1 明细在看板内出现 5 次（KPI sub / FocusBand / ManagementKpiBoard / 验证关闭率面板 / RiskAlertsBoard）。
- 「KPI 卡 + 明细面板」同源成对：延期预测（`:325` vs `:470`）、验证关闭（`:342` vs `:427`）；「今日聚焦」FocusBand（`:117-118`）全部从已展示 rows 派生，信息增量低。
**建议**：明细只留一处，KPI 卡只做计数入口；「今日聚焦」可删。

### B7. 项目列表详情抽屉 ≈ 详情页头部复刻
`ProjectListView.tsx:819-899` 的 Dialog 展示 code/名称/阶段/进度/风险/PM/目标日 + 生命周期 stepper + 最近变更，点「进入项目」后全部再看一遍。建议弱化为纯跳转或删去 stepper/最近变更。

### B8. 其他重复
- 修改密码两套实现（AccountPage vs 打不开的 ChangePasswordDialog，见 A2）。
- 任务状态/优先级配色映射复制三份：`TaskListView.tsx:60-74` / `KanbanBoard.tsx:7-29` / `TaskGanttView.tsx:157-161`，应收敛到 shared 常量（IssueList/RisksPanel 的 severity/status 配置同理）。
- 两个甘特各自实现整套脚手架（parseDate/月刻度/缩放/今天线/图例），建议抽 `useGanttTimeline` + 共用 Legend。
- 文件行渲染两套 + FilePreviewModal 双实例：任务级上传区 `ProjectDetailView.tsx:430-467` vs `FilesPanel.tsx:62-93`，抽共享 FileRow + 单 Modal。
- CommentThread 内外两套几乎相同（`CommentThread.tsx:238-283` vs ExternalCommentThread `:292-352`），可 variant 合并。
- 产品库：stage/EOL 状态两套文案（卡片徽章 vs 治理面板）；Revision 信息散落三处；两个面板各自拉 `admin.listUsersForSelect` 重复查询。

---

## C. 冗杂可删减（单页内）

| 位置 | 问题 | 建议 |
|---|---|---|
| `IssueList.tsx:118-190` | 新建表单 severity/status/category 三整列纵向按钮铺满 | 改下拉/分段控件 |
| `IssueList.tsx:507-531` | 行内 左色条+severity 徽标+category 标签 三重色块 | 合并为一 |
| `MetricsView.tsx:137-142` vs `:150,167,228` | 顶部 6 tile 与面板内 InlineStat 数字重复 | 二选一 |
| `RisksPanel.tsx:255-270` | 缓解/兜底计划整段平铺每张卡 | 默认折叠/截断 |
| `SOPLibraryView.tsx:115-146` vs `:149-243` | 阶段概览网格与详情把 code/名称/时长/任务数各渲染一遍 | 概览改锚点导航 |
| `AccountPage.tsx:122-127` | 「钉钉通知 开/关」卡片只是复述上方 Switch 状态 | 删卡片 |
| `AutomationSettings.tsx:244-250` | 每条规则裸露可编辑 JSON 大文本框 | 默认折叠/结构化 |
| `AdminPanel.tsx:299-310,720-745` | 权限说明+角色对照表大段静态文字 | 收进折叠帮助区 |
| `AdminPanel.tsx:354-406` | 钉钉配置 10+ 行明细常显 | 默认「可用/待配置」汇总 |
| `Home.tsx:914-923` vs `:891-898` | 面包屑英文/侧栏中文两套视图名；首段与 Logo 冗余 | 统一中文 |
| `MyTasksView.tsx:290,300-304` | 一行内 PriorityFlag 图标 + 优先级文字胶囊 | 删胶囊 |
| `TaskGanttView.tsx:106,125,173` | 逾期计数+每阶段逾期+红条+图例四重表达 | 留一处主指示 |
| `NpiReadinessPanel.tsx:134,228` / `ReleaseDialog.tsx:202,371` | 说明文案两段重复 | 各删一 |
| `ControlledConditionsPanel.tsx:81` | 负责人显示裸 `#{ownerUserId}` | 映射成员名 |
| `TerminationReviewPanel.tsx:55` | 状态显示原始英文串（draft/pending_approval） | 接状态字典 |
| `GlobalSearch.tsx:244,258-271` | ESC 提示两处 | 二选一 |
| `PerspectivePanel` 各角色 MetricStrip | 计数=其下队列分组条数（摘要-明细重复） | 降级为小标注 |
| `ProductLifecycleGovernancePanel.tsx:108-118` | 软件发版表单 7 个 textarea 一次铺开 | 非必填折叠 |

---

## D. 良性差异——不要误删

- **TaskGanttView vs GanttView**：任务级只读 vs 阶段级可编辑，SegToggle 切换（`ProjectDetailView.tsx:3839-3857`），都在用；只需抽共享脚手架。
- **RequirementsView vs RequirementPoolPanel**：前者是薄壳（产品筛选+横幅），内部复用同一 Panel（`RequirementsView.tsx:52`），良性复用。
- **SOPLibraryView 内嵌 SopGovernancePanel**：只读库 vs admin 治理，不重叠。
- **ActionPage**：钉钉深链的单动作闭环卡片，与列表页职责不同，保留。
- **CalendarPage**：MilestoneCalendar 的严格超集，保留（删的是后者）。
- **KickoffWizard step3 recap**：确认摘要，非重复采集。但注意开始日期有 3 个可写入口（向导/头部/排期重生成），需保证口径一致。
- **手机号两处维护**（账户页自助 vs Admin 代改）：作用域不同，保留，可在 Admin 处加一句提示。
- **钉钉三面板**（个人偏好/全局配置/全局度量）：作用域各异，加作用域说明即可。

---

## E. 与 2026-07-12 页面减负 spec 遗留清单的对照

| spec §10 遗留 | 本次对应发现 |
|---|---|
| §6 MyTasksView 独立页下线合并 | B5（三入口重复渲染 + 铃铛第三份待审列表，比 spec 记录的更重） |
| §4 任务清单/审核状态页交付物完成度改链接 | B3/B4（评审弹窗+ReleaseDialog 的重列是同一问题的两个新场景） |
| 钉钉摘要切 classifyMyWork | 未涉 UI，不在本次范围 |

**spec 之外的新发现**：A1 总览死代码群、A2 三个死文件、B1 设置抽屉躯壳、B2 FocusBand 双口径、B6 组合看板自我重复、B7 列表抽屉复刻。

---

## 建议动手顺序

1. **纯删除批**（A 全部）：约 3400+ 行死代码，无行为变化，先行落地。
2. **设置抽屉瘦身**（B1）+ 列表抽屉弱化（B7）：删只读重复块，改动小收益大。
3. **评审弹窗收敛**（B3+B4）：硬卡汇总降级为计数+跳转，Release 校验改读 readiness——顺手完成 spec §4 遗留。
4. **个人工作入口合并**（B5）：即 spec §6 遗留的执行。
5. **组合看板去重**（B2+B6）+ C 类单页精简：可攒着与下次 UI 迭代一起做。
6. **技术性收敛**（配色映射/甘特脚手架/FileRow/CommentThread variant）：重构性质，不改信息呈现，排最后。
