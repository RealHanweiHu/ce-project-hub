# 迭代全景与待办清单（2026-06-11 → 2026-06-20）

> 10 天内完成五个阶段：**自托管迁移 → PLM 双轴骨架 → 自动化/钉钉/排期三引擎 → 视图与立项闭环 → 项目轴硬化**。
> 截至 2026-06-20：工作树干净，全部已推 `origin/main`，322+ 测试全绿、tsc 干净。

---

## 一、按类别的变更全景

### 1. 基础设施 / 自托管化（06-11~12）
- 数据库整体 **MySQL → PostgreSQL**：schema 转 pg、db 层 port 到 node-postgres、pg migrations、测试全部 port。
- 自托管部署：Docker 化、streaming storage proxy、Aliyun ECS/RDS 部署配置 + 一键部署脚本、RDS CA chain 内置、字体本地化。
- 移除 Manus OAuth 及死代码平台模块；sameSite=lax cookie 适配 http 自托管。
- 安全：`auth.me` 剥离 passwordHash、`ALLOW_REGISTRATION` 开关、邀请码注册、first-admin setup。

### 2. 两轴 PLM 骨架（06-13，五刀切 Cut 1-5）
- **Cut 1 产品脊柱**：platforms / products / product_revisions + projects PLM 列。
- **Cut 2 量产发布**：`mp_releases` + 发布事务 + precheck + 版本时间线。
- **Cut 3 模块化 SOP**：模块库 / 复用集。
- **Cut 4 BOM**：`bom_items` + 发布冻结 + where-used + diff。
- **Cut 5 协作**：评论 + @提及 + 通知 + webhook + 通知铃。
- 同期：需求池、看板拖拽、自定义字段、文件在线预览（图片/PDF/Office）、中文文件名修复。

### 3. 三大引擎从零搭建（06-14）
- **自动化规则引擎**：`automation_rules/runs` 表 + 引擎核心 + 进程内定时器 + 各路由埋点 + Admin 设置页。
- **钉钉集成**：token 模块、日程 payload、周会同步编排（日程优先/降级群推）、视频会议、手机号管理、真机校验回改。
- **自动排期引擎**：`generateSchedule/rescheduleFrom` 纯函数 + IPD 依赖图（NPD7/ECO5/IDR4 全量工期）+ 排期压缩到 3-4 月。
- **PLM 简化**（SKG 三分法）+ 项目总揽页。

### 4. 视图合并 + 立项闭环（06-15）
- **总览页合并**（仪表盘 + 组合看板 + 三视角报表）、RAG 健康度纯函数、项目日历端点。
- **统一需求池**（可空 projectId + 三视图过滤 + 一键转化 + 权限细分）。
- **立项向导（3步）** + PM 自动入组 + 按角色分配负责人 + 钉钉通知。
- **Gate 就绪检查**（关卡从审批 → 门禁）、任务级甘特 + 关键路径、问题闭环（发起变更 + 关联修复任务）。

### 5. 项目轴深度硬化（06-16~20）
- **排期精度**：工作日历（周一~六）、法定节假日表真接入（`calendar_exceptions` + admin 维护表 + seed-2026）、in-progress 任务预测按剩余量缩放。
- **延期影响分析**：`shared/delay-impact.ts` 纯函数；dueDate 编辑改「确认改期」流 + 影响弹窗；`delay_impact_notify` 规则。
- **交付物审核工作流 (#2b)**：`project_deliverable_reviews` 表 + 状态机（待审/通过/驳回）、重传触发重审、Gate 就绪口径升级为「已审核合格」。
- **变更↔版本关联 (PLM)**：发布盖章冻结 `snapshotChangelog`、版本时间线展开「本版本变更」、已盖章不可删守卫。
- **度量体系**：单项目度量（Lead Time / 吞吐 / 逾期 / 缺陷 DI / 燃尽 / Gate 一次通过率）+ MetricsView Tab。
- **PM 工作台**：PmCockpit 重构为 TODAY / 待协调拍板 / 我负责的项目 三卡。
- **权限/治理收口**：`server/project-access.ts` 统一鉴权（取最高权）、Release Gate 禁裁、advisory lock 防重复发布。
- **产品/SKU/版本对齐**：产品定义交接工作流、项目↔产品↔SKU 层级对齐、客户改版需 eco trace、任务 assignee 持久化修复、admin drill-in、项目删除自动化修复。

---

## 二、待办清单（被遗忘 / 半截 / backlog）

### 🔴 已写 spec 但没接着做（最易被遗忘）
- **Portfolio 度量 rollup**（多项目对比表）：spec 已写（`docs/superpowers/specs/2026-06-19-portfolio-metrics-rollup-design.md`），**无 plan、无代码** —— 写完当天即转去做产品/SKU。复用单项目度量逐项聚合。

### 🟡 卡在「待用户拍板」
- **交付物 类型+版本 (P1-1)**（`task_plan.md` 结构工程师工作台唯一未完成项）：`project_files` 加 `fileType`/`fileVersion` + 上传 UI，**待确认后再动 DB**。

### 🟠 backlog 未启动（按优先级）
- **P1 需求价值链路**：商业目标 → 项目目标 → 需求 → 任务全链路追溯 + OKR（现 projectRequirements 较薄）。
- **P2 异常升级机制 (#5)**：按时长阶梯升级 负责人 → PM → manager。
- **P2 风险生命周期**：项目级 risk 字段升级为独立风险列表 + 状态机。
- **P3 角色分派升级 (#4)**：建项目时自动触发 + 输出「待补角色」清单。

### ⚪ 已知技术小遗留（不阻塞）
- `getPortfolio` 的 gate/release readiness 批量化（现 N+1）。
- 度量：周桶左边界轻微外溢、燃尽基线不含范围增长。

---

## 三、下一步建议
优先把**两件「差临门一脚」**的事做完，再开新需求：
1. **Portfolio 度量 rollup** —— spec 已就绪，直接补 plan + 实现。
2. **交付物类型+版本 P1-1** —— 需先拍板 DB 改动，再走迁移 + 上传 UI。

之后再从 backlog 起 **需求价值链路**（P1，价值最高的新功能），走 brainstorm → spec → plan → subagent。
