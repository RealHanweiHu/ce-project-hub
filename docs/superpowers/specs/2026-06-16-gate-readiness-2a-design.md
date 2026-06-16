# Gate 就绪度自动检查 (2a) — 设计文档

日期：2026-06-16
状态：已评审，待实现
范围：五大功能 #2「Gate 就绪度自动检查」的第一层（2a）。**2b（交付物审核工作流：审核人 + 待审/通过/驳回 + 钉钉提醒 + 就绪口径升级为「已审核合格」）另立 spec。**

## 目标

Gate 前自动检查 4 个维度并给出「还差哪几项不能过会」：前置任务完成、必需交付物上传、本阶段 P0/P1 关闭、遗留评审条件闭环。把现有「快到 Gate 了」的提醒升级为「列出具体缺项」。并提供每个必需交付物的上传入口（多版本）。

## 现状（已有基础）

- `shared/sop-templates.ts`：`SOPPhase` 有 `gateTaskId`、`gate`、`gateStandard.requiredDeliverables`（gate 非协商必备交付物）、`tasks`。
- `server/db.ts`：`getReleaseGateStatus`（**仅** MP Release 闸口，源用 `phase.deliverables`+全任务，**不复用**）、`getAutomationGatePrereqs`（供 #1 健康度，**不动**）、`getOpenP0P1Count(projectId)`（项目级，供 release）。
- `project_tasks.deliverables: Record<string,boolean>`（手动勾选，独立机制，**不动**）、`project_tasks.assigneeUserId`。
- `project_files`：按 `projectId/phaseId/taskId` 关联，经 `registerFileUploadRoute`（REST）上传；`filesRouter.list/delete`。
- `project_gate_reviews`：`phaseId/gateName/decision(approved|conditional|rejected)/conditions/notes/roundNumber/createdAt`。`gateReviewsRouter.list/create`。`pickLatestReview`（roundNumber→createdAt）。
- `project_issues`：`phaseId/severity(P0..P3)/status(open|in_progress|resolved|closed|wont_fix)`。
- 自动化：`gate_prereq_incomplete` 规则（仅数未完成前置）+ scheduler 扫描。
- 前端：`GateReviewModal`（建评审）、`filesRouter`。

## 设计

### A. 就绪度纯核心 `shared/gate-readiness.ts`

```ts
export type GateDim = "prereq" | "deliverables" | "critical_issues" | "review_conditions";

export type GateReadinessInput = {
  phaseId: string;
  gateName: string;
  prereq: { incompleteTaskIds: string[] };                 // 非 gate 任务中未完成的
  deliverables: { required: string[]; uploaded: string[] }; // 必备 vs 已上传(文件存在)
  criticalIssues: { titles: string[] };                     // 本阶段 open/in_progress P0/P1
  latestReview: { decision: "approved" | "conditional" | "rejected"; conditions: string | null; notes: string | null } | null;
};

export type GateDimResult = { dimension: GateDim; ok: boolean; summary: string; blockers: string[] };
export type GateReadiness = { phaseId: string; gateName: string; ready: boolean; dimensions: GateDimResult[]; blockerCount: number };

export function computeGateReadiness(input: GateReadinessInput): GateReadiness;
```

判定（纯函数，无 IO）：
- **prereq**：`incompleteTaskIds.length===0` → ok；否则 blockers=未完成任务 id，summary `还差 N 项前置任务`。
- **deliverables**：`missing = required \ uploaded`；空→ok；否则 blockers=missing，summary `缺 N/总 项交付物`。
- **critical_issues**：`titles.length===0` → ok；否则 blockers=titles，summary `N 个未关闭 P0/P1`。
- **review_conditions**：`latestReview==null`（首轮）或 `decision==="approved"` → ok；`conditional` → 阻塞，blockers=[conditions||"有遗留条件"]；`rejected` → 阻塞，blockers=[notes||conditions||"上轮被驳回"]。
- `ready = 所有维度 ok`；`blockerCount = Σ blockers.length`。

**与 MP Release 严格区分**：release 路径完全不动（`releasePrecheck` 仍项目级 P0/P1 硬卡不可 override；release gate 仍要求最新记录且 approved 或 conditional+override）。本核心「首轮 null=OK」只服务 gate 就绪度，绝不喂给 release。

### B. db 取数 `server/db.ts`

- `getGateReadiness(projectId, phaseId): Promise<GateReadiness | null>`（phase 不存在→null）：
  - phase 取自 `getPhasesForCategory(project.category)` 按 id 匹配。
  - **prereq**：phase.tasks 中 `id !== gateTaskId` 且未完成（`status in ('done','skipped') || completed===true` 取反）的 taskId 列表。
  - **deliverables.required** = `phase.gateStandard.requiredDeliverables`；**uploaded** = `project_files` 中 `(projectId, phaseId, taskId=gateTaskId, deliverableName in required)` 去重存在的名字（**文件存在即已上传**，单一真相）。
  - **criticalIssues** = `getOpenP0P1Count` 的阶段级版本返回标题（见下）。
  - **latestReview** = 该 phase 的 gate reviews 按 `roundNumber desc, createdAt desc, id desc` 取第一条（抗脏数据；同时把 `pickLatestReview` 增 id tiebreak 以保持一致）。
  - 调 `computeGateReadiness` 返回。
- `getPhaseOpenP0P1(projectId, phaseId): Promise<{ count: number; titles: string[] }>`：阶段级未关闭 P0/P1（不动现有项目级 `getOpenP0P1Count`）。
- `getApproachingGates(): Promise<Array<{ projectId; phaseId; gateTaskId; gateName; dueDate; status }>>`：跨 `archived=false` 项目，gate 任务有 dueDate 且未完成（供推送扫描；与 `getAutomationGatePrereqs` 并存，后者仍供 #1）。

### C. 交付物多版本上传

- **迁移 0018**：`project_files` 加 `deliverableName varchar(256)` 可空列。
- `registerFileUploadRoute` 增可选 `deliverableName` 字段；写入 `project_files`。gate 交付物上传 = `taskId=gateTaskId` + `deliverableName=<必备名>`。
- `filesRouter.list` 已可按 phaseId/taskId 过滤；前端按 `deliverableName` 分组展示。
- **多版本保留**：同 `deliverableName` 多次上传=多行；最新（createdAt desc）置顶；旧版 `filesRouter.delete` 可删。
- 「已上传」= 该 deliverableName 文件数 ≥1；删到 0 自动变未就绪（纯由文件存在派生，不另存 boolean；现有 `deliverables` 勾选机制独立不动）。

### D. UI

- `gateReviewsRouter.readiness({ projectId, phaseId }) → GateReadiness`（protectedProcedure + 成员校验，仿 list）。
- `GateReviewModal` 顶部加就绪清单组件：4 维 ✅/❌ + 每维 summary + 「还差：…」blockers。
- 交付物维度每项可展开：列该 deliverableName 的文件（最新置顶）+ 上传入口（上传后 invalidate readiness/files → 自动显示已交付）+ 删除。
- 未就绪仍允许发起新一轮评审，仅提示「未就绪，建议补齐后过会」。

### E. 推送升级 `gate_prereq_incomplete`（保留 key）

- scheduler：用 `getApproachingGates()` 取临近 gate，对每个算 `getGateReadiness`，发 `scheduled` 事件，`after` 带 `{ isGate:true, gateTaskId, gateName, dueDate, status, notReady:boolean, blockerSummaries:string[] }`。
- rules.ts：`gate_prereq_incomplete` 改 label 为「Gate 就绪度提醒」；`matches` 改为 `d∈[0,leadDays] && after.notReady===true`；`buildMessage` 列出 `blockerSummaries`（前置/交付物/P0P1/评审条件各一行）。
- `getAutomationGatePrereqs` 不动（#1 仍用）。

## 2b 扩展点（本期仅预留，不实现）

- `deliverableName` 列即 2b 审核记录的锚点。
- 就绪「deliverables.uploaded」口径在 db 层集中一处，2b 改为「该 deliverableName 已审核 approved」即可，纯核心 `computeGateReadiness` 签名不变。

## 模块边界

- `shared/gate-readiness.ts`：纯判定，无 IO。
- `server/db.ts`：新增 `getGateReadiness` / `getPhaseOpenP0P1` / `getApproachingGates`；`pickLatestReview` 加 id tiebreak。不动 release/health 相关函数。
- `server/routers/gateReviews.ts`：加 `readiness` 查询。
- 上传路由 + filesRouter：加 `deliverableName`。
- `server/automation/{scheduler,rules}.ts`：gate 规则升级。
- 前端 `GateReviewModal` + 一个就绪清单子组件 + 交付物上传子组件。

## 测试

- `shared/gate-readiness.test.ts`（纯核心）：4 维各 ok/blocker；评审 null/approved/conditional/rejected（含 rejected 用 notes、conditions fallback）；全就绪 ready=true；blockerCount 累计。
- `server/gate-readiness-db.test.ts`（集成）：建项目+任务(部分 done/skipped)+gate 任务 deliverableName 文件+阶段 P0/P1 issue+评审记录，验 `getGateReadiness` 四维与 `getApproachingGates`/`getPhaseOpenP0P1`；删除最后一个交付物文件→该项变未就绪。
- `server/automation/rules.test.ts` 扩展：gate 规则在 `notReady` 且 `d∈[0,leadDays]` 触发；就绪时不触发；message 含 blockerSummaries。

## 明确排除（YAGNI / 归 2b）

- 交付物审核人 + 待审/通过/驳回 + 钉钉提醒审核人 + 就绪口径升级为「合格」—— 归 **2b**。
- 交付物逐条「需修改」状态机；历史就绪度趋势；自动阻止建评审。
