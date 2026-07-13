# 日常状态维护轻量化 Implementation Plan

> **历史执行说明：** 下方仍保留最初的逐任务 TDD 清单与提交切分，方便追溯施工意图；复选框不再作为当前实施状态源。当前状态见路线图，技术语义以本页“最终实施口径”和对应回归测试为准。

**Goal:** 钉钉卡片一键操作（▶开始 / ✅完成+一句话 / ⏰延两天）+ 五条自动化规则 + 通知分层降噪，把日常状态维护从"开网站找任务"变成"点掉钉钉卡片"。

**Architecture:** 全部长在既有底座上：action-card token（`jose` JWT discriminatedUnion）新增 `task_start`；"开始"= 写独立 `actualStartedAt` 并顺着 `automaticTaskStatus` 派生 in_progress，`startDate` 保留为计划排期（不加新状态、不破坏「blocked 不由依赖图派生」铁律）；"可以开始"卡片 = 新增 automation 规则消费普通完成、审批通过和 Gate 通过产生的 `task.update_meta(done)` 事件（事务提交后内联触发，activity-log tailer 兼容补偿），从项目有效依赖图算后继；轻/重证据分流用 NPD v3 模板的 `evidence` 字段（**依赖姊妹计划 Task 1/3/5 先落地**：`docs/superpowers/plans/2026-07-12-npd-template-slimming.md`）；降噪靠既有 `automation_claims` + `action_items.dedupeKey` 双层去重与规则默认值调整。

**Tech Stack:** TypeScript, tRPC, Drizzle/Postgres（一次加列迁移 + 一次枚举扩值迁移）, jose, Vitest（自动化测试用 `makeDeps` 注入桩）。

**设计文档:** `docs/superpowers/specs/2026-07-12-status-maintenance-lightening-design.md`

> **最终实施口径（2026-07-12，覆盖早期草案）：** 人工开始只写 `actualStartedAt`，`startDate` 永远是计划排期；Gate 任务只能由正式评审推进，不能走普通任务的开始、上传后完成或直接勾选完成入口；NPD v3 的 light 完成必须带非空一句话，heavy 必须由任务责任人本人先上传任务文件；开始与完成都读取项目分档/附加包/裁剪后的有效依赖图；`task_ready` 采用项目+阶段+任务组合身份，并在开始、完成、提交审批、审批通过或改派时正确关闭/重建。下方各 Task 已按此最终口径修订，原施工顺序仍保留作历史记录。

**关键实现事实（开工勘探后已按最终实现更新）:**
- Token：`server/action-card-tokens.ts` `tokenPayloadSchema = z.discriminatedUnion("kind", …)`，现有 8 个 kind（含 `task_start`）；`action_item_snooze.until` 支持 `"tomorrow_morning" | "in_2_days"`。TTL 30 天。
- 执行：`server/action-card-route.ts` `executeActionCardPayload` switch(kind) → `appRouter.createCaller(ctx)` 调既有 tRPC 过程；`nextShanghaiMorning(now)` 算下一个上海 08:00；GET/POST `/api/action-card/execute`。
- 按钮拼装：`server/action-item-notify.ts` `buildActionItemButtons`（218 行 snooze 只给 level==="owner"）；交互卡片 `tryDeliverActionItemInteractiveCard`（primary+secondary+detail 三个槽位），失败自动回落 ActionCard 工作通知。
- 状态派生：`automaticTaskStatus` 只认可 `actualStartedAt` 作为人工开始承诺；`startDate` 是计划排期，负责人和 dueDate 也不派生 in_progress；`status` 仍是唯一主状态，`setMeta` 刻意删掉 patch 里的 status。
- 依赖图：无 DB 表；项目态消费者统一调用 `shared/schedule-graph.ts` 的 `buildEffectiveProjectSchedTasks`，它会按模板版本、分档、附加包及裁剪结果收缩 `dependsOn`，不能直接遍历原始模板边。
- 完成事件：普通任务完成、任务审批通过和 Gate 通过均在事务提交后内联发 `task.update_meta(done)`；`activityLogTailer` 继续把耐久日志归一为同类事件作兼容补偿，行动项 dedupe 防止重复。Gate 只由 `confirmGateReview` 关闭；v3 模板每阶段首任务依赖前一 Gate，因此下阶段卡片由同一有效后继计算自然产生，无需另写 phase.advanced 分支。
- 规则引擎：`server/automation/rules.ts` `BuiltInAutomationRule {key,label,triggerType,defaultEnabled,defaultConfig,configSchema,recipientRoles,matches,buildMessage}`；特例派发先例 `notifyDelayImpactActionItems`（engine.ts）。新 key 须同步 `AUTOMATION_RULE_KEYS` + `shared/notification-matrix.ts`。
- 通知默认收敛为“摘要 + 增量升级”：责任人的今日到期/逾期项只进每日个人摘要；`overdue_reminder` / `due_soon_reminder` 默认关闭；`exception_escalation` 在逾期 day 2 只新增 PM、day 7 只新增管理层，不重复通知责任人和上一层。仅对仍保留旧版精确配置且从未人工修改的存量规则做安全迁移。
- 每日个人摘要已存在：`server/automation/personalDailyDigest.ts`（sendHour 9 Asia/Shanghai，按日按人 claim 去重）。设计的"每日摘要"就是它，不新做。
- 快照/去重：`tryClaimAutomation`（automation_claims）+ `action_items.dedupeKey` unique。
- Snooze 语义：只推迟收件箱可见性（`snoozedUntil`），不动 dueDate；懒激活在 `listOpenActionItemsForUser`。
- 上传钩子点：`createProjectFile`（db.ts:4792 → 4802-4814 已挂 `maybeAutoSubmitDeliverableReviewOnUpload`）。
- ActionPage：`client/src/pages/ActionPage.tsx`，`ActionKind` union（L26），`/actions/task-complete` 页已存在。
- 深链：`shared/action-links.ts` `buildProjectActionPath` / `buildTaskCompletionActionPath`。
- 测试：automation 用 `server/automation/engine.test.ts` 的 `makeDeps()` 桩注入模式；token 测试 `server/action-card-tokens.test.ts`。

---

### Task 1: `completion_note` / `actualStartedAt` 列 + setCompleted 收一句话结论

**Files:**
- Modify: `drizzle/schema.ts:548-610`（projectTasks）
- Modify: `server/routers/tasks.ts:81+`（setCompleted）
- Test: `server/task-completion-note.test.ts`（新建）

- [ ] **Step 1: schema 加列 + 生成迁移**

`drizzle/schema.ts` projectTasks 表追加两个字段；`actualStartedAt` 由 Task 3 的人工开始动作使用：

```ts
/** 轻证据一句话结论：钉钉卡片/完成页随完成动作提交（设计：证据分级 A 方案） */
completionNote: text("completion_note"),
/** 人工点击开始的实际时间；与计划排期 startDate 严格分离。 */
actualStartedAt: timestamp("actualStartedAt"),
```

Run: `npm run db:push`
Expected: 生成迁移 `0063_task_completion_note_actual_start.sql`，同时新增 `completion_note` 与 `actualStartedAt`，并应用成功。

- [ ] **Step 2: 写失败测试**

创建 `server/task-completion-note.test.ts`（seed/cleanup 仿 `server/tasks-router-validation.test.ts`：建测试用户+项目+成员，`tasksRouter.createCaller({user})`）：

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectWithSeed, addProjectMember, upsertUser } from "./db";
import { appRouter } from "./routers";
import { projects, projectTasks } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const PID = "cnote01test";
let caller: ReturnType<typeof appRouter.createCaller>;

describe("setCompleted 带一句话结论", () => {
  beforeAll(async () => {
    const user = await upsertUser({ openId: "cnote-user", name: "cnote" } as never);
    await createProjectWithSeed({ id: PID, name: "note test" } as never, "npd", user.id);
    await addProjectMember(PID, user.id, "pm");
    caller = appRouter.createCaller({ user } as never);
  });
  afterAll(async () => {
    const db = await getDb();
    await db!.delete(projectTasks).where(eq(projectTasks.projectId, PID));
    await db!.delete(projects).where(eq(projects.id, PID));
  });

  it("completed:true + completionNote 落库；uncomplete 清空", async () => {
    await caller.tasks.setCompleted({
      projectId: PID, phaseId: "concept", taskId: "c1",
      completed: true, completionNote: "已对齐三家竞品，结论见链接",
    });
    const db = await getDb();
    const [row] = await db!.select().from(projectTasks)
      .where(and(eq(projectTasks.projectId, PID), eq(projectTasks.taskId, "c1")));
    expect(row.completionNote).toBe("已对齐三家竞品，结论见链接");

    await caller.tasks.setCompleted({ projectId: PID, phaseId: "concept", taskId: "c1", completed: false });
    const [row2] = await db!.select().from(projectTasks)
      .where(and(eq(projectTasks.projectId, PID), eq(projectTasks.taskId, "c1")));
    expect(row2.completionNote).toBeNull();
  });
});
```

（beforeAll 的 upsertUser/addProjectMember 具体签名执行时对照既有测试文件同名调用抄写。）

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- server/task-completion-note.test.ts`
Expected: FAIL — input schema 不认识 completionNote。

- [ ] **Step 4: 实现**

`server/routers/tasks.ts` setCompleted：input 加 `completionNote: z.string().trim().min(1).max(500).optional()`。最终实现先调用统一完成守卫，再把状态/日志与 `completionNote` 放进同一事务；任一步失败都整体回滚：

```ts
await assertTaskCompletionAllowed({
  project, task: taskBefore, allTasks, actorId: ctx.user.id,
  completed: input.completed, completionNote: input.completionNote,
});
await db.transaction(async (tx) => {
  const result = await setTaskCompletion(
    input.projectId, input.phaseId, input.taskId, input.completed, ctx.user.id, tx,
  );
  await tx.update(projectTasks)
    .set({ completionNote: input.completed ? (input.completionNote ?? null) : null })
    .where(taskIdentity(input));
  return result;
});
```

`assertTaskCompletionAllowed` 对所有模板拒绝未来阶段和 Gate 直接完成；对 NPD v3 再检查有效依赖图，并强制 light 非空一句话 / heavy 责任人本人文件。取消完成不受证据守卫影响。直接完成或提交审批成功后关闭对应的 `task_ready`。

- [ ] **Step 5: 跑测试确认通过 + Commit**

Run: `npm test -- server/task-completion-note.test.ts server/tasks-router-validation.test.ts`
Expected: PASS。

```bash
git add drizzle/ server/routers/tasks.ts server/task-completion-note.test.ts
git commit -m "feat(tasks): completion note column for light-evidence one-liner"
```

---

### Task 2: Snooze「延两天」

**Files:**
- Modify: `server/action-card-tokens.ts`（until 枚举）
- Modify: `server/action-card-route.ts`（日期计算）
- Modify: `server/action-item-notify.ts:218`（按钮文案/参数）
- Test: `server/action-card-tokens.test.ts`、`server/action-items-snooze.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

`server/action-card-tokens.test.ts` 追加：

```ts
it("action_item_snooze 支持 in_2_days", async () => {
  const token = await createActionCardToken({
    kind: "action_item_snooze", userId: 1, actionItemId: 99, until: "in_2_days",
  });
  const payload = await verifyActionCardToken(token);
  expect(payload).toMatchObject({ kind: "action_item_snooze", until: "in_2_days" });
});
```

`server/action-items-snooze.test.ts` 追加（对照该文件既有 snooze 用例的 seed 方式）：

```ts
it("in_2_days 把 snoozedUntil 设到后天上海 08:00", async () => {
  // 用与既有用例相同的 action item seed，然后：
  const token = await createActionCardToken({
    kind: "action_item_snooze", userId: testUserId, actionItemId: itemId, until: "in_2_days",
  });
  await executeActionCardToken(token, appRouter, fakeReq, fakeRes);
  const item = await getActionItemById(itemId);
  const until = item!.snoozedUntil!;
  const hoursAhead = (until.getTime() - Date.now()) / 3600e3;
  expect(hoursAhead).toBeGreaterThan(24);   // 严格晚于明早
  expect(hoursAhead).toBeLessThan(72);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server/action-card-tokens.test.ts server/action-items-snooze.test.ts`
Expected: FAIL — zod 枚举拒绝 `in_2_days`。

- [ ] **Step 3: 实现**

`action-card-tokens.ts`：`until: z.enum(["tomorrow_morning", "in_2_days"]).default("tomorrow_morning")`。

`action-card-route.ts` snooze case按上海**日历日**计算，不能用毫秒加法表达业务日期：

```ts
const snoozedUntil = payload.until === "in_2_days"
  ? shanghaiMorningAfterCalendarDays(now, 2) // 上海日历后天 08:00
  : nextShanghaiMorning(now);
```

`action-item-notify.ts` `buildActionItemButtons`：仅 `task_ready` 的 snooze 按钮改为 `⏰延两天` 并铸 `until: "in_2_days"`；其他行动项（包括非 `task_ready` 的到期提醒）继续使用 `明早处理`（`tomorrow_morning`），避免扩大本计划语义。

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `npm test -- server/action-card-tokens.test.ts server/action-items-snooze.test.ts`
Expected: PASS。

```bash
git add server/action-card-tokens.ts server/action-card-route.ts server/action-item-notify.ts server/*.test.ts
git commit -m "feat(action-card): 2-day snooze option"
```

---

### Task 3: 「▶开始」— `actualStartedAt` + `tasks.start` mutation + `task_start` 卡片动作

**Files:**
- Modify: `drizzle/schema.ts` / `drizzle/0063_task_completion_note_actual_start.sql`（字段由 Task 1 同迁移落地）
- Modify: `server/routers/tasks.ts`（新 mutation）
- Modify: `server/action-card-tokens.ts`（新 kind）、`server/action-card-route.ts`（新 case）
- Test: `server/task-start.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// seed 同 Task 1 模式，PID = "tstart01test"，用户为任务 assignee

describe("tasks.start", () => {
  it("写 actualStartedAt、保留计划 startDate 并派生为 in_progress；重复调用幂等", async () => {
    await caller.tasks.setMeta({ projectId: PID, phaseId: "concept", taskId: "c1", assigneeUserId: userId });
    const plannedStartDate = (await getRow("c1")).startDate;
    await caller.tasks.start({ projectId: PID, phaseId: "concept", taskId: "c1" });
    const row = await getRow("c1");
    expect(row.actualStartedAt).toBeInstanceOf(Date);
    expect(row.startDate).toBe(plannedStartDate);
    expect(row.status).toBe("in_progress");
    await caller.tasks.start({ projectId: PID, phaseId: "concept", taskId: "c1" }); // 不抛错
  });
  it("done/skipped 任务拒绝 start", async () => {
    await caller.tasks.setCompleted({ projectId: PID, phaseId: "concept", taskId: "c2", completed: true });
    await expect(caller.tasks.start({ projectId: PID, phaseId: "concept", taskId: "c2" }))
      .rejects.toThrow();
  });
  it("未来阶段、Gate、有效依赖未齐套均拒绝 start", async () => {
    // 分别断言 PRECONDITION_FAILED / BAD_REQUEST；拒绝后 actualStartedAt 仍为空。
  });
});
```

`start` 的重复调用以 `actualStartedAt` 是否已写判断，不再用计划日期判断幂等。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server/task-start.test.ts`
Expected: FAIL — `tasks.start` 不存在。

- [ ] **Step 3: 实现**

`server/routers/tasks.ts` 新 mutation（权限复用 setCompleted；任务已有责任人时只能由该自然人执行，同角色他人不能代点）。最终实现把读取、守卫、CAS 写入、状态刷新和活动日志放在同一事务内：

```ts
start: protectedProcedure
  .input(z.object({ projectId: z.string(), phaseId: z.string(), taskId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const project = await getProjectById(input.projectId);
    const result = await db!.transaction(async (tx) => {
      const task = await loadTask(tx, input);
      const allTasks = await loadProjectTasks(tx, input.projectId);
      assertTaskStartAllowed({ project, task, allTasks });
      if (task.actualStartedAt) return { already: true };
      assertNotTerminal(task);
      const actualStartedAt = new Date();
      const won = await compareAndSetActualStartedAt(tx, task, actualStartedAt);
      if (!won) return resolveConcurrentStartOrThrow(tx, input);
      await refreshProjectTaskStatuses(input.projectId, undefined, tx);
      await createTaskUpdateLog(tx, { ...input, patch: { actualStartedAt } });
      return { already: false };
    });
    await closeTaskReady(input); // 组合 identity：projectId:phaseId:taskId
    return { success: true, already: result.already };
  }),
```

`assertTaskStartAllowed` 对所有模板阻止未来阶段和 Gate；对 NPD v3 还按 `buildEffectiveProjectSchedTasks` 检查全部前置。只有 CAS 获胜者写活动日志并发事件，避免并发双击产生重复副作用。

`action-card-tokens.ts` union 追加：

```ts
z.object({
  kind: z.literal("task_start"),
  userId: z.number(),
  projectId: z.string(),
  phaseId: z.string(),
  taskId: z.string(),
  actionItemId: z.number().optional(),
}),
```

`action-card-route.ts` switch 追加：

```ts
case "task_start": {
  await caller.tasks.start({ projectId: payload.projectId, phaseId: payload.phaseId, taskId: payload.taskId });
  if (payload.actionItemId) await completeActionItem(payload.actionItemId, payload.userId);
  return {
    title: "任务已开始",
    message: "已记录开始时间，状态更新为进行中。",
    actionPath: buildProjectActionPath({ projectId: payload.projectId, tab: "tasks", phaseId: payload.phaseId, taskId: payload.taskId }),
  };
}
```

（`completeActionItem` 已有——delay_impact_confirm case 在用，同款调用。）

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `npm test -- server/task-start.test.ts server/action-card-tokens.test.ts`
Expected: PASS。

```bash
git add server/routers/tasks.ts server/action-card-tokens.ts server/action-card-route.ts server/task-start.test.ts
git commit -m "feat(tasks): human start action — actualStartedAt derives in_progress, card kind task_start"
```

---

### Task 4: 「可以开始」卡片 — `task_ready` 规则（自动化规则 2/3）

**Files:**
- Modify: `drizzle/schema.ts:2718`（ACTION_ITEM_KINDS 加 `task_ready`）→ 迁移
- Modify: `server/automation/rules.ts`（新规则 key）、`server/automation/engine.ts`（特例派发）、`shared/notification-matrix.ts`
- Create: `server/automation/taskReady.ts`
- Test: `server/automation/task-ready.test.ts`（新建）

- [ ] **Step 1: 枚举迁移**

`ACTION_ITEM_KINDS` 数组加 `"task_ready"`。Run: `npm run db:push`
Expected: 迁移含 `ALTER TYPE ... ADD VALUE 'task_ready'`（drizzle 对 pgEnum 的扩值写法）并应用成功。

- [ ] **Step 2: 写失败测试**

`server/automation/task-ready.test.ts`（`makeDeps()` 桩注入模式，仿 `engine.test.ts:21-42`；项目 seed 用 v3 模板以获得 dependsOn 链）：

```ts
import { describe, it, expect } from "vitest";
import { runAutomation } from "./engine";
import { listActionItemsByKind } from "../db"; // 若无此查询，直接 select action_items where projectId+kind

describe("task_ready 规则", () => {
  it("前置全部完成 → 给后继 assignee 建 task_ready 行动项；状态不变", async () => {
    // seed: v3 npd 项目（standard 无包），nc1/nc2 assignee 都是 userB，nc3 gate
    // 把 nc1 置 done，nc2 仍 todo → 触发事件：
    await runAutomation({
      action: "task.update_meta", entityType: "task", projectId: PID, entityId: "nc1",
      before: { status: "in_progress" }, after: { status: "done" }, now,
    } as never, deps);
    // nc3 依赖 nc1+nc2，nc2 未完成 → 不应产生行动项
    expect(await countItems(PID, "task_ready")).toBe(0);

    // 再完成 nc2 → nc3 就绪（gate 任务本身不推 ready 卡——由 Gate 评审流程接管），
    // 换用 np1（dependsOn nc3）验证正向路径：完成 nc3 后：
    await markDone(PID, "nc2"); await markDone(PID, "nc3");
    await runAutomation({
      action: "task.update_meta", entityType: "task", projectId: PID, entityId: "nc3",
      before: { status: "in_progress" }, after: { status: "done" }, now,
    } as never, deps);
    const items = await listItems(PID, "task_ready");
    expect(items.map((i) => i.metadata.taskId)).toEqual(expect.arrayContaining(["np1", "np2"]));
    expect(items.find((i) => i.metadata.taskId === "np1")?.entityId)
      .toBe(`${PID}:planning:np1`);
    // 状态铁律：np1 行仍是 todo（不自动变 in_progress）
    expect((await getRow(PID, "np1")).status).toBe("todo");
  });
  it("dedupeKey 去重：同一后继重复触发只有一条", async () => {
    await runAutomation({ /* 同上 nc3 done 事件再来一次 */ } as never, deps);
    expect((await listItems(PID, "task_ready")).filter((i) => i.metadata.taskId === "np1"))
      .toHaveLength(1);
  });
  it("重复就绪保留 snooze；开始/完成/提交审批/审批通过关闭；改派转给新责任人", async () => {
    // 组合 entityId 精确关闭；改派先关旧项，再按有效依赖重新判断并给新责任人建项。
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- server/automation/task-ready.test.ts`
Expected: FAIL — 规则不存在。

- [ ] **Step 4: 实现**

`server/automation/taskReady.ts`：最终实现让事件扇出和任务改派共用同一个候选派发函数，依赖图只从项目有效流程生成：

```ts
import { getEffectivePhasesForProjectLike, getTaskEvidenceLevel } from "../../shared/npd-v3";
import { buildEffectiveProjectSchedTasks } from "../../shared/schedule-graph";
import { notifyActionItem, taskActionEntityId } from "../action-item-notify";

/** 规则2/3：前置完成 → 后继 assignee 收「可以开始」卡片。状态不动，依赖链驱动的是通知不是状态。 */
export async function notifyTaskReadyActionItems(event: AutomationEvent, deps: DispatchDeps) {
  if (event.after?.status !== "done") return { fired: 0 };
  const project = await getProjectById(event.projectId);
  if (!project) return { fired: 0 };
  const phases = getEffectivePhasesForProjectLike(project);
  const gateIds = new Set(phases.map((p) => p.gateTaskId));
  const graph = buildEffectiveProjectSchedTasks(project);
  const successors = graph.filter((t) =>
    (t.dependsOn ?? []).includes(completedTaskId(event)) && !gateIds.has(t.id),
  );
  if (!successors.length) return { fired: 0 };

  const rows = await getProjectTasks(event.projectId);
  const rowByTaskId = new Map(rows.map((r) => [r.taskId, r]));
  let fired = 0;
  for (const succ of successors) {
    const phaseId = phaseIdByTaskId(phases, succ.id);
    const templateTask = phases.find((phase) => phase.id === phaseId)?.tasks
      .find((task) => task.id === succ.id);
    const row = rowByTaskId.get(succ.id);
    if (!templateTask || !row || row.status !== "todo" || !row.assigneeUserId) continue;
    const unresolved = (succ.dependsOn ?? []).some((d) => {
      const dep = rowByTaskId.get(d);
      return !dep || (dep.status !== "done" && dep.status !== "skipped" && !dep.completed);
    });
    if (unresolved) continue;

    const evidence = getTaskEvidenceLevel(project, phaseId, succ.id);
    const entityId = taskActionEntityId(event.projectId, phaseId, succ.id);
    await notifyActionItem({
      kind: "task_ready", projectId: event.projectId, entityType: "task", entityId,
      recipientUserId: row.assigneeUserId, level: "owner",
      title: `可以开始了：${templateTask.name}`,
      dedupeKey: actionDedupeKey({
        kind: "task_ready", projectId: event.projectId, entityId,
        recipientUserId: row.assigneeUserId,
      }),
      metadata: { phaseId, taskId: succ.id, evidenceLevel: evidence },
    }, deps);
    fired += 1;
  }
  return { fired };
}
```

`buildActionItemButtons` 根据 `metadata.evidenceLevel` 生成固定三槽：▶开始 / ✅完成或📎去上传 / ⏰延两天，并把 `actionItemId` 带入 token/深链。重复命中相同 dedupeKey 时保留已有 `snoozedUntil`，不把用户的延后选择清空。

`tasks.start`、`tasks.setCompleted`（含提交审批）、`tasks.decideApproval(approved)` 都用同一组合 `entityId` 关闭 `task_ready`。`tasks.setMeta` 改派责任人时先关闭旧项，再调用 `notifyTaskReadyTask(project, phaseId, taskId)`；该函数与事件扇出共享候选派发实现，只在任务仍为 todo、前置齐套且新责任人存在时重建。

`rules.ts`：`AUTOMATION_RULE_KEYS` 加 `"task_ready_notify"`；规则描述子 `matches: (e) => e.action === "task.update_meta" && e.after?.status === "done"`，`recipientRoles: ["assignee"]`，`defaultEnabled: true`。`engine.ts` 派发处仿 `delay_impact_notify` 特例：命中 `task_ready_notify` 时调 `notifyTaskReadyActionItems(event, deps)` 而非通用 `notifyPersonal`。`shared/notification-matrix.ts` 补 `task_ready_notify` 条目（事件键与默认通道对照既有条目格式）。

- [ ] **Step 5: 跑测试确认通过 + Commit**

Run: `npm test -- server/automation/task-ready.test.ts server/automation/engine.test.ts server/automation/rules.test.ts`
Expected: PASS。

```bash
git add drizzle/ server/automation/ shared/notification-matrix.ts
git commit -m "feat(automation): task_ready rule — predecessor-done pushes can-start card, status untouched"
```

---

### Task 5: 证据分流辅助函数（shared）

**Files:**
- Modify: `shared/npd-v3.ts`（追加 getTaskEvidenceLevel——Task 4 已引用）
- Test: `shared/npd-v3.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

```ts
import { getTaskEvidenceLevel } from "./npd-v3";

describe("getTaskEvidenceLevel", () => {
  const v3 = { category: "npd", sopTemplateVersion: "2026-07-v3", customFields: { npdTemplate: { tier: "standard", packs: [] } } };
  it("v3 任务按模板 evidence；缺省与老模板一律 light", () => {
    expect(getTaskEvidenceLevel(v3, "planning", "np1")).toBe("heavy");
    expect(getTaskEvidenceLevel(v3, "planning", "np2")).toBe("light");
    expect(getTaskEvidenceLevel({ category: "npd", sopTemplateVersion: "2026-07-v2" }, "concept", "c1")).toBe("light");
    expect(getTaskEvidenceLevel(v3, "nope", "nope")).toBe("light");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- shared/npd-v3.test.ts` — FAIL。

- [ ] **Step 3: 实现（`shared/npd-v3.ts` 追加）**

```ts
export function getTaskEvidenceLevel(
  projectLike: ProjectTemplateLike, phaseId: string, taskId: string
): "light" | "heavy" {
  const phase = getEffectivePhasesForProjectLike(projectLike).find((p) => p.id === phaseId);
  return phase?.tasks.find((t) => t.id === taskId)?.evidence ?? "light";
}
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `npm test -- shared/npd-v3.test.ts` — PASS。

```bash
git add shared/npd-v3.ts shared/npd-v3.test.ts
git commit -m "feat(sop): evidence level lookup for card action routing"
```

---

### Task 6: 客户端 — 完成页一句话结论 + 重证据上传后「标记完成？」（自动化规则 1）

**Files:**
- Modify: `client/src/pages/ActionPage.tsx`（task-complete 页加 note 输入）
- Modify: `client/src/components/views/ProjectDetailView.tsx`（普通任务 FileUploadArea/TaskDetail 上传成功回调；Gate 交付物明确排除）
- Test: `npx tsc --noEmit` + 预览验证（无 client 测试基建）

- [ ] **Step 1: ActionPage 完成页加输入框**

`ActionPage.tsx` task-complete 分支：提交按钮上方加

```tsx
<textarea
  className="w-full rounded-md border border-border p-2 text-sm"
  rows={2} maxLength={500}
  placeholder="一句话结论（轻证据任务的完成证据，如：测试通过，报告见链接）"
  value={note} onChange={(e) => setNote(e.target.value)}
/>
```

提交调用改为 `trpc.tasks.setCompleted.useMutation` 入参附 `completionNote: note.trim() || undefined`。

- [ ] **Step 2: 重证据上传成功 → 完成确认（规则 1 后半）**

普通任务 `FileUploadArea` 上传成功回到 `TaskDetail` 后，仅当项目有效模板判定为 heavy、任务未完成且不是 Gate 时弹确认 toast。`DeliverableEvidenceUploadButton` 属于 Gate 交付物路径，不得挂任务完成动作；Gate 也被服务端完成守卫禁止直接推进：

```tsx
toast({
  title: "证据已上传",
  description: "顺手把任务标记完成？",
  action: (
    <ToastAction altText="标记完成" onClick={() =>
      setCompletedMutation.mutate({ projectId, phaseId, taskId, completed: true })
    }>标记完成</ToastAction>
  ),
});
```

toast 只是便捷入口，不是规则边界：`setCompleted` 会再次验证当前任务属于项目有效模板、不是未来阶段或 Gate、有效前置已完成，并验证 heavy 文件确由当前责任人上传。任何旧勾选、卡片或网页入口都不能绕过这套服务端守卫。

- [ ] **Step 3: 类型检查 + 预览验证**

Run: `npx tsc --noEmit` — 0 errors。
预览：任务页传一个证据文件 → toast 出现 → 点"标记完成" → 任务变已完成；`/actions/task-complete?...` 页输入一句话 → 提交 → 任务行 completionNote 落库（任务详情可见）。截图留档。

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ActionPage.tsx client/src/components/views/ProjectDetailView.tsx
git commit -m "feat(ui): completion note input and post-upload mark-complete prompt"
```

---

### Task 7: 通知分层默认值（降噪 + 升级节奏，自动化规则 4）

**Files:**
- Modify: `server/automation/rules.ts`（defaultConfig/defaultEnabled/recipientRoles）
- Test: `server/automation/rules.test.ts`（追加断言）

- [ ] **Step 1: 写失败测试**

```ts
describe("通知分层默认值（2026-07-12 设计）", () => {
  const byKey = Object.fromEntries(AUTOMATION_RULES.map((r) => [r.key, r]));
  it("FYI 类个人推送默认关/转群", () => {
    expect(byKey.status_change_notify.defaultEnabled).toBe(false);
    expect(byKey.phase_advanced_notify.recipientRoles).toEqual(["group"]);
  });
  it("升级节奏：到期日提醒责任人，逾期2天升级PM，7天升级管理层", () => {
    expect(byKey.overdue_reminder.defaultConfig.notifyRoles).toEqual(["assignee"]);
    expect(byKey.exception_escalation.defaultConfig).toMatchObject({
      assigneeAfterDays: 0, pmAfterDays: 2, managerAfterDays: 7,
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server/automation/rules.test.ts` — FAIL（现值 2/5/10、overdue 含 pm）。

- [ ] **Step 3: 实现**

`rules.ts` 改对应规则描述子的 `defaultEnabled`/`defaultConfig`/`recipientRoles` 为上述值；`personal_daily_digest`（digestRules.ts）确认 `defaultEnabled: true`、`sendHour: 9` 不变。文件顶部注释注明：**已部署库的 automation_rules 行不吃新默认值（ensureAutomationRuleDefaults 只 seed 一次），上线时需在管理后台或 SQL 同步调整存量行**——在 PR 描述里附一条 `UPDATE automation_rules SET ...` 运维语句。

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `npm test -- server/automation/rules.test.ts server/automation/engine.test.ts` — PASS。

```bash
git add server/automation/rules.ts server/automation/rules.test.ts
git commit -m "feat(automation): notification layering defaults — FYI off personal, escalation day0/2/7"
```

---

### Task 8: 项目群周摘要（FYI 沉淀层）

**Files:**
- Create: `server/automation/groupWeeklyDigest.ts`
- Modify: `server/automation/scheduler.ts`（注册扫描）
- Test: `server/automation/group-weekly-digest.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
import { runGroupWeeklyDigestScan } from "./groupWeeklyDigest";

describe("项目群周摘要", () => {
  it("周一 09:00 后对配置了群的活跃项目各发一条；同周去重", async () => {
    // seed: 项目 A 带 dingtalkChatId，本周完成 2 任务、逾期 1
    const deps = makeDeps(); // 含 sendToGroupChat 桩
    const monday9 = new Date("2026-07-13T01:30:00Z"); // 上海周一 09:30
    await runGroupWeeklyDigestScan(monday9, deps);
    expect(deps.sentGroup).toHaveLength(1);
    expect(deps.sentGroup[0].markdown).toContain("本周完成");
    await runGroupWeeklyDigestScan(monday9, deps); // 再跑同周
    expect(deps.sentGroup).toHaveLength(1);        // claim 去重
  });
  it("周三不发", async () => {
    const deps = makeDeps();
    await runGroupWeeklyDigestScan(new Date("2026-07-15T01:30:00Z"), deps);
    expect(deps.sentGroup).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server/automation/group-weekly-digest.test.ts` — FAIL。

- [ ] **Step 3: 实现**

`groupWeeklyDigest.ts` 仿 `personalDailyDigest.ts` 骨架：上海时区判定周一且 `hour >= 9`；ISO 周字符串做 claim `hasAutomationRunForEntity({ruleKey:"group_weekly_digest", entityId:`w:${isoWeek}:${projectId}`})`；内容：本周完成任务数（completedAt 落本周）、当前逾期清单（含责任人）、下周到期、当前阶段与 Gate 状态；经 deps 注入的 `sendToGroupChat(chatId, title, markdown)` 发送；结果 `createAutomationRun`。`digestRules.ts` 注册 `group_weekly_digest`（configSchema: `{ sendHour: 9, weekday: 1 }`），`scheduler.ts` 聚合扫描区追加 try/catch 块调用（与 `runPersonalDailyDigestScan` 并排）。

- [ ] **Step 4: 跑测试确认通过 + Commit**

Run: `npm test -- server/automation/group-weekly-digest.test.ts server/automation/scheduler.test.ts` — PASS。

```bash
git add server/automation/groupWeeklyDigest.ts server/automation/digestRules.ts server/automation/scheduler.ts server/automation/group-weekly-digest.test.ts
git commit -m "feat(automation): project group weekly digest for FYI layer"
```

---

### Task 9: 全量回归 + 文档收尾

- [ ] **Step 1:** Run: `npm test` — Expected: 全 PASS。
- [ ] **Step 2:** 设计文档头部状态改为 `状态：✅ 已实现`；§8 标明「延两天直接生效仅记录（已按此实现）」；补齐最终执行守卫、Gate 唯一路径和 `task_ready` 生命周期，避免历史伪代码成为第二套口径。
- [ ] **Step 3:**

```bash
git add docs/superpowers/specs/2026-07-12-status-maintenance-lightening-design.md
git commit -m "docs: link status-maintenance spec to implementation plan"
```

---

## Self-Review 结论

- **Spec 覆盖**：证据分级 A（Task 4 按钮分流 + Task 5 查询 + Task 6 完成页/普通重证据上传提示）✔；NPD v3 light 一句话 / heavy 责任人文件硬门槛且所有入口共用守卫 ✔；规则1（Task 6 两个入口，Gate 路径排除且服务端禁止直接推进）✔；规则2（Task 4，状态不动、只推卡，尊重 blocked 铁律）✔；规则3（Gate 关任务既有 `confirmGateReview`，下阶段首任务经项目有效依赖图覆盖）✔；规则4（责任人每日摘要 + day2 PM/day7 管理层增量升级，零散到期/逾期默认关闭）✔；规则5（Task 3 写 actualStartedAt；assignee/startDate/dueDate 不再派生 in_progress）✔；即时/摘要/FYI 三层（Task 4/既有日摘要/Task 7+8）✔；防重（dedupeKey+claims，Task 4/8 断言）✔。
- **类型一致性**：`task_start`/`task_ready`/`completionNote`/`getTaskEvidenceLevel`/`in_2_days` 在各 Task 间引用一致 ✔。
- **守卫一致性**：开始与完成共用项目有效流程判断；所有模板阻止未来阶段和 Gate，NPD v3 额外阻止未完成的有效依赖；旧模板只豁免新证据/依赖硬门槛，不豁免未来阶段与 Gate 护栏 ✔。
- **行动项一致性**：`task_ready` 使用 `(projectId, phaseId, taskId)` 组合身份；开始/完成/提交审批/审批通过同时关闭行动项和钉钉互动卡，改派关闭旧项并按相同依赖图为新责任人重建，重复命中保留 snooze ✔。
- **占位符扫描**：三处「执行时对照既有调用抄写签名」（upsertUser、createActivityLog、upsertActionItem/notifyActionItem）均指明了对照文件与同类调用位置，是防签名漂移的校验指令而非留白。
- **依赖声明**：本计划依赖姊妹计划（npd-template-slimming）Task 1/3/5 的 `evidence` 字段与 `getEffectivePhasesForProjectLike`——两份计划按顺序执行，或先行独立执行姊妹计划前 5 个 Task。
- **外部前置**：钉钉交互卡片模板（DingTalk 控制台维护，`docs/dingtalk-interactive-card-template.md`）无需新增槽位——本计划所有按钮都落在既有 primary/secondary/detail 三槽内；一句话结论走 `/actions/task-complete` 页而非卡片内输入，规避了模板改造。
