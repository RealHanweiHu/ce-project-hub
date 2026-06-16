# Gate 就绪度自动检查 (2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate 前自动检查 4 维（前置任务/必需交付物/本阶段 P0P1/遗留评审条件），给出「还差哪几项不能过会」，并提供每个必需交付物的多版本上传入口；把现有 gate 提醒升级为列出具体缺项。

**Architecture:** 纯判定核心 `shared/gate-readiness.ts`（`computeGateReadiness`，无 IO）+ `server/db.ts` 取数（`getGateReadiness`/`getPhaseOpenP0P1`/`getApproachingGates`）+ tRPC `gateReviews.readiness` + 前端 `GateReviewModal` 就绪清单与交付物上传 + 自动化 gate 规则升级。交付物「已上传」口径 = `project_files` 按新 `deliverableName` 列存在文件（单一真相，2b 再升级为「已审核合格」）。

**Tech Stack:** TypeScript, tRPC, Drizzle/Postgres, Zod, Vitest, React。运行期 server 文件用相对路径 `"../shared/..."`/`"../../shared/..."` import shared；测试用 `@shared/*` 别名。

**通用约定（每个 Task）：** 类型检查 `pnpm check`（期望 0 errors）；单测 `node scripts/test.mjs <file>`（不识别路径参数则回退 `npx vitest run <file>`）。**并发提交纪律**：仓库可能有并行会话；提交前 `git status --short`，只按显式路径 `git add` 自己改的文件，绝不 `git add -A`/`commit -a`；若目标文件外出现你没改的改动，停下报告。

---

## File Structure

- `shared/gate-readiness.ts`（新）：`computeGateReadiness` 纯核心 + 类型。
- `drizzle/0018_add_deliverable_name.sql`（新）+ `drizzle/schema.ts`（改）：`project_files.deliverableName`。
- `server/routers/files.ts`（改）：上传路由解析 `deliverableName` 透传。
- `server/db.ts`（改）：`getGateReadiness`/`getPhaseOpenP0P1`/`getApproachingGates`；`pickLatestReview` 加 id tiebreak。
- `server/routers/gateReviews.ts`（改）：加 `readiness` 查询。
- `server/automation/{scheduler,rules}.ts`（改）：gate 规则升级为就绪度。
- `client/src/components/views/GateReviewModal.tsx`（改）+ 子组件（新）：就绪清单 + 交付物上传。
- 测试：`shared/gate-readiness.test.ts`、`server/gate-readiness-db.test.ts`、`server/gate-readiness-router.test.ts`、`server/automation/rules.test.ts`（扩展）。

---

## Task 1: 就绪度纯核心 `shared/gate-readiness.ts`

**Files:**
- Create: `shared/gate-readiness.ts`
- Test: `shared/gate-readiness.test.ts`

- [ ] **Step 1: 写失败测试** `shared/gate-readiness.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { computeGateReadiness, type GateReadinessInput } from "@shared/gate-readiness";

const base: GateReadinessInput = {
  phaseId: "design", gateName: "设计冻结评审",
  prereq: { incompleteTaskIds: [] },
  deliverables: { required: ["ID外观图", "BOM v1.0"], uploaded: ["ID外观图", "BOM v1.0"] },
  criticalIssues: { titles: [] },
  latestReview: null,
};

describe("computeGateReadiness", () => {
  it("全就绪 → ready, 无 blocker", () => {
    const r = computeGateReadiness(base);
    expect(r.ready).toBe(true);
    expect(r.blockerCount).toBe(0);
    expect(r.dimensions.every((d) => d.ok)).toBe(true);
  });
  it("前置未完 → prereq 阻塞", () => {
    const r = computeGateReadiness({ ...base, prereq: { incompleteTaskIds: ["d2", "d4"] } });
    expect(r.ready).toBe(false);
    const dim = r.dimensions.find((d) => d.dimension === "prereq")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["d2", "d4"]);
  });
  it("缺交付物 → deliverables 阻塞，列缺失名", () => {
    const r = computeGateReadiness({ ...base, deliverables: { required: ["ID外观图", "BOM v1.0"], uploaded: ["ID外观图"] } });
    const dim = r.dimensions.find((d) => d.dimension === "deliverables")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["BOM v1.0"]);
  });
  it("本阶段 P0/P1 未关 → critical_issues 阻塞", () => {
    const r = computeGateReadiness({ ...base, criticalIssues: { titles: ["上电烧机"] } });
    const dim = r.dimensions.find((d) => d.dimension === "critical_issues")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["上电烧机"]);
  });
  it("评审 conditional → 阻塞用 conditions", () => {
    const r = computeGateReadiness({ ...base, latestReview: { decision: "conditional", conditions: "补充可靠性数据", notes: null } });
    const dim = r.dimensions.find((d) => d.dimension === "review_conditions")!;
    expect(dim.ok).toBe(false);
    expect(dim.blockers).toEqual(["补充可靠性数据"]);
  });
  it("评审 rejected → 阻塞用 notes，缺则 conditions", () => {
    const r1 = computeGateReadiness({ ...base, latestReview: { decision: "rejected", conditions: null, notes: "结构强度不达标" } });
    expect(r1.dimensions.find((d) => d.dimension === "review_conditions")!.blockers).toEqual(["结构强度不达标"]);
    const r2 = computeGateReadiness({ ...base, latestReview: { decision: "rejected", conditions: "整改项A", notes: null } });
    expect(r2.dimensions.find((d) => d.dimension === "review_conditions")!.blockers).toEqual(["整改项A"]);
  });
  it("评审 approved → review 维 ok", () => {
    const r = computeGateReadiness({ ...base, latestReview: { decision: "approved", conditions: null, notes: null } });
    expect(r.dimensions.find((d) => d.dimension === "review_conditions")!.ok).toBe(true);
  });
  it("多维阻塞 → blockerCount 累计", () => {
    const r = computeGateReadiness({
      ...base, prereq: { incompleteTaskIds: ["d2"] },
      deliverables: { required: ["A", "B"], uploaded: [] },
      criticalIssues: { titles: ["x"] },
    });
    expect(r.blockerCount).toBe(1 + 2 + 1);
    expect(r.ready).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs shared/gate-readiness.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 `shared/gate-readiness.ts`**

```ts
export type GateDim = "prereq" | "deliverables" | "critical_issues" | "review_conditions";

export type GateReadinessInput = {
  phaseId: string;
  gateName: string;
  prereq: { incompleteTaskIds: string[] };
  deliverables: { required: string[]; uploaded: string[] };
  criticalIssues: { titles: string[] };
  latestReview: { decision: "approved" | "conditional" | "rejected"; conditions: string | null; notes: string | null } | null;
};

export type GateDimResult = { dimension: GateDim; ok: boolean; summary: string; blockers: string[] };
export type GateReadiness = { phaseId: string; gateName: string; ready: boolean; dimensions: GateDimResult[]; blockerCount: number };

/** Gate 就绪度纯判定。交付物「已上传」口径由上层传入（2a=文件存在；2b 升级为已审核）。 */
export function computeGateReadiness(input: GateReadinessInput): GateReadiness {
  const dimensions: GateDimResult[] = [];

  // 前置任务
  const prereqBlockers = input.prereq.incompleteTaskIds;
  dimensions.push({
    dimension: "prereq",
    ok: prereqBlockers.length === 0,
    summary: prereqBlockers.length === 0 ? "前置任务全部完成" : `还差 ${prereqBlockers.length} 项前置任务`,
    blockers: prereqBlockers,
  });

  // 必需交付物：missing = required \ uploaded
  const uploadedSet = new Set(input.deliverables.uploaded);
  const missing = input.deliverables.required.filter((name) => !uploadedSet.has(name));
  const total = input.deliverables.required.length;
  dimensions.push({
    dimension: "deliverables",
    ok: missing.length === 0,
    summary: missing.length === 0 ? `交付物齐全 (${total}/${total})` : `缺 ${missing.length}/${total} 项交付物`,
    blockers: missing,
  });

  // 本阶段 P0/P1
  const issueTitles = input.criticalIssues.titles;
  dimensions.push({
    dimension: "critical_issues",
    ok: issueTitles.length === 0,
    summary: issueTitles.length === 0 ? "无未关闭 P0/P1" : `${issueTitles.length} 个未关闭 P0/P1`,
    blockers: issueTitles,
  });

  // 遗留评审条件：null(首轮)/approved → ok；conditional→conditions；rejected→notes||conditions
  const review = input.latestReview;
  let reviewOk = true;
  let reviewBlockers: string[] = [];
  let reviewSummary = "无遗留评审条件";
  if (review && review.decision === "conditional") {
    reviewOk = false;
    reviewBlockers = [review.conditions || "上轮评审有遗留条件"];
    reviewSummary = "上轮评审有遗留条件";
  } else if (review && review.decision === "rejected") {
    reviewOk = false;
    reviewBlockers = [review.notes || review.conditions || "上轮评审被驳回"];
    reviewSummary = "上轮评审被驳回";
  }
  dimensions.push({ dimension: "review_conditions", ok: reviewOk, summary: reviewSummary, blockers: reviewBlockers });

  const blockerCount = dimensions.reduce((sum, d) => sum + d.blockers.length, 0);
  return { phaseId: input.phaseId, gateName: input.gateName, ready: dimensions.every((d) => d.ok), dimensions, blockerCount };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test.mjs shared/gate-readiness.test.ts`
Expected: PASS（8 用例）。

- [ ] **Step 5: 类型检查**

Run: `pnpm check`
Expected: 0 errors。

- [ ] **Step 6: 提交（先 `git status --short` 只 stage 这两个文件）**

```bash
git add shared/gate-readiness.ts shared/gate-readiness.test.ts
git commit -m "feat(gate): computeGateReadiness 纯核心（4 维就绪判定）"
```

---

## Task 2: `project_files.deliverableName` 列 + 上传路由透传

**Files:**
- Create: `drizzle/0018_add_deliverable_name.sql`
- Modify: `drizzle/schema.ts`（project_files 表）, `server/routers/files.ts`（上传路由）
- Test: `server/gate-readiness-db.test.ts`（本任务先建文件，验证 createProjectFile/getProjectFiles 透传 deliverableName）

- [ ] **Step 1: 写失败测试** `server/gate-readiness-db.test.ts`（本任务只加文件持久化用例；Task 3 再追加就绪用例到同文件）：

```ts
import { describe, it, expect, afterAll } from "vitest";
import { getDb, createProjectFile, getProjectFiles } from "./db";
import { projects, projectFiles } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `gate-rdy-${Date.now()}`;

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("project_files.deliverableName", () => {
  it("createProjectFile 持久化 deliverableName，getProjectFiles 返回", async () => {
    const db = await getDb();
    if (!db) return;
    await db.insert(projects).values({
      id: PROJ, name: "gate就绪测试", projectNumber: PROJ, category: "npd",
      risk: "low", currentPhase: "design", createdBy: 1,
    }).onConflictDoNothing();
    await createProjectFile({
      projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: "ID外观图",
      name: "id.pdf", mimeType: "application/pdf", size: 10, storageKey: "k1", storageUrl: "u1", uploadedBy: 1,
    });
    const files = await getProjectFiles(PROJ, "design", "d8");
    expect(files.length).toBe(1);
    expect(files[0].deliverableName).toBe("ID外观图");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs server/gate-readiness-db.test.ts`
Expected: FAIL（`deliverableName` 不是 createProjectFile/列的已知字段）。

- [ ] **Step 3: schema 加列**。在 `drizzle/schema.ts` 的 `projectFiles` 表里，`taskId` 列之后加：

```ts
    /** Optional: associate file with a specific gate deliverable by name (2a). */
    deliverableName: varchar("deliverableName", { length: 256 }),
```

- [ ] **Step 4: 建迁移 SQL** `drizzle/0018_add_deliverable_name.sql`：

```sql
ALTER TABLE "project_files" ADD COLUMN "deliverableName" varchar(256);
```

> 说明：测试 harness（`scripts/test.mjs`）按 `drizzle/*.sql` 顺序执行，故新增列必须有此 .sql。生产用 `pnpm db:push`；如需 drizzle 元数据一致，可在本机另跑 `npx drizzle-kit generate`，但本计划以 .sql + schema.ts 为准（测试与 ORM 类型都满足）。
>
> **迁移号确认**：现有最高 `0017`，全分支无 0018，故 0018 安全。
> **索引决策（延后到 2b）**：2a 的就绪查询走 `getProjectFiles(projectId, phaseId, gateTaskId)`，按 `taskId` 过滤、`deliverableName` 在 JS 里过滤；现有 `idx_project_files_project_phase` 已够，每个 gate 任务下交付物文件数为个位数，2a 不加新索引。2b 审核工作流会「按 deliverableName 直接查/改审核态」，届时再加 `(projectId, phaseId, deliverableName)` 索引（访问模式才匹配）。

- [ ] **Step 5: 上传路由透传 deliverableName**。在 `server/routers/files.ts` 的 `registerFileUploadRoute` 内：

把解构改为：
```ts
        const { projectId, phaseId, taskId, deliverableName } = req.body as {
          projectId?: string;
          phaseId?: string;
          taskId?: string;
          deliverableName?: string;
        };
```
把 `createProjectFile({...})` 调用里补一行（在 `taskId: taskId || null,` 之后）：
```ts
          deliverableName: deliverableName || null,
```

- [ ] **Step 6: 跑测试确认通过**

Run: `node scripts/test.mjs server/gate-readiness-db.test.ts`
Expected: PASS。

- [ ] **Step 7: 类型检查**

Run: `pnpm check`
Expected: 0 errors。

- [ ] **Step 8: 提交（只 stage 这 4 个文件）**

```bash
git add drizzle/0018_add_deliverable_name.sql drizzle/schema.ts server/routers/files.ts server/gate-readiness-db.test.ts
git commit -m "feat(files): project_files 加 deliverableName + 上传路由透传"
```

---

## Task 3: db 取数 `getGateReadiness` / `getPhaseOpenP0P1` / `getApproachingGates`

**Files:**
- Modify: `server/db.ts`
- Test: `server/gate-readiness-db.test.ts`（追加用例）

- [ ] **Step 1: 追加失败测试** 到 `server/gate-readiness-db.test.ts`。顶部 import 改为：

```ts
import {
  getDb, createProjectFile, getProjectFiles,
  getGateReadiness, getPhaseOpenP0P1, getApproachingGates,
  upsertProjectTask, createGateReview,
} from "./db";
import { projects, projectFiles, projectTasks, projectIssues, projectGateReviews } from "../drizzle/schema";
import { eq } from "drizzle-orm";
```

并把 `afterAll` 扩展为也清理 tasks/issues/reviews：
```ts
afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, PROJ));
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});
```

追加 describe（注意：NPD 的 design 阶段 gateTaskId 是 `d8`，gateStandard.requiredDeliverables 来自模板；测试不假设具体交付物名，改用「上传 required 里的第一个」来验证缺口减少）：
```ts
describe("getGateReadiness", () => {
  it("聚合 4 维 + 删文件回退就绪", async () => {
    const db = await getDb();
    if (!db) return;
    await db.insert(projects).values({
      id: PROJ, name: "gate就绪测试", projectNumber: PROJ, category: "npd",
      risk: "low", currentPhase: "design", createdBy: 1,
    }).onConflictDoNothing();

    const r0 = await getGateReadiness(PROJ, "design");
    expect(r0).not.toBeNull();
    const required = r0!.dimensions.find((d) => d.dimension === "deliverables")!;
    // 初始：无文件、前置未完、无 issue、无评审
    expect(required.ok).toBe(false);

    // 传一个必需交付物文件到 gate 任务 d8
    const firstDeliverable = required.blockers[0];
    const fileId = await createProjectFile({
      projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: firstDeliverable,
      name: "f.pdf", mimeType: "application/pdf", size: 1, storageKey: "k", storageUrl: "u", uploadedBy: 1,
    });
    const r1 = await getGateReadiness(PROJ, "design");
    const d1 = r1!.dimensions.find((d) => d.dimension === "deliverables")!;
    expect(d1.blockers).not.toContain(firstDeliverable); // 该项已上传

    // 删除该文件 → 回退未上传
    await db.delete(projectFiles).where(eq(projectFiles.id, fileId));
    const r2 = await getGateReadiness(PROJ, "design");
    const d2 = r2!.dimensions.find((d) => d.dimension === "deliverables")!;
    expect(d2.blockers).toContain(firstDeliverable);
  });

  it("getPhaseOpenP0P1 只数本阶段未关闭 P0/P1", async () => {
    const db = await getDb();
    if (!db) return;
    await db.insert(projectIssues).values([
      { projectId: PROJ, phaseId: "design", title: "本阶段P0", severity: "P0", status: "open" },
      { projectId: PROJ, phaseId: "design", title: "本阶段已关", severity: "P1", status: "closed" },
      { projectId: PROJ, phaseId: "evt", title: "他阶段P0", severity: "P0", status: "open" },
    ]);
    const res = await getPhaseOpenP0P1(PROJ, "design");
    expect(res.count).toBe(1);
    expect(res.titles).toEqual(["本阶段P0"]);
  });

  it("getApproachingGates 含有 dueDate 未完成的 gate", async () => {
    const db = await getDb();
    if (!db) return;
    await upsertProjectTask(PROJ, "design", "d8", { dueDate: "2026-09-01", status: "in_progress" });
    const gates = await getApproachingGates();
    expect(gates.some((g) => g.projectId === PROJ && g.gateTaskId === "d8")).toBe(true);
  });
});
```

> 注：若 `createGateReview` 的精确签名与下面不符，以 `server/db.ts`/`gateReviews` 路由实际为准；本测试未直接用它，可从 import 中移除以免未用告警。

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs server/gate-readiness-db.test.ts`
Expected: FAIL（`getGateReadiness` 等未导出）。

- [ ] **Step 3: 在 `server/db.ts` 顶部 import 区补充**（确认 `getPhasesForCategory` 已从 `../shared/sop-templates` 导入；新增 gate-readiness 纯核心）：

```ts
import { computeGateReadiness, type GateReadiness } from "../shared/gate-readiness";
```

- [ ] **Step 4: `pickLatestReview` 加 id tiebreak**。找到现有 `function pickLatestReview`，把其 reduce 比较改为含 id：

```ts
function pickLatestReview(reviews: ProjectGateReview[]): ProjectGateReview | null {
  if (reviews.length === 0) return null;
  return reviews.reduce((best, r) => {
    if (r.roundNumber !== best.roundNumber) return r.roundNumber > best.roundNumber ? r : best;
    if (r.createdAt.getTime() !== best.createdAt.getTime()) return r.createdAt > best.createdAt ? r : best;
    return r.id > best.id ? r : best;
  });
}
```
（若 `createdAt` 是字符串而非 Date，则用 `r.createdAt > best.createdAt` 字符串比较替换 `.getTime()` 那两处——以该文件中 `ProjectGateReview` 的实际类型为准。）

- [ ] **Step 5: 新增三个函数到 `server/db.ts`**（放在 `getReleaseGateStatus` 附近；`projects`/`projectIssues`/`projectGateReviews`/`getPhasesForCategory`/`getProjectById`/`getProjectTasks`/`getProjectFiles`/`getProjectGateReviews`/`drizzleSql`/`eq`/`and`/`inArray` 均已可用）：

```ts
/** 阶段级未关闭 P0/P1（不动项目级 getOpenP0P1Count）。 */
export async function getPhaseOpenP0P1(projectId: string, phaseId: string): Promise<{ count: number; titles: string[] }> {
  const db = await getDb();
  if (!db) return { count: 0, titles: [] };
  const rows = await db.select({ title: projectIssues.title })
    .from(projectIssues)
    .where(and(
      eq(projectIssues.projectId, projectId),
      eq(projectIssues.phaseId, phaseId),
      inArray(projectIssues.severity, ["P0", "P1"]),
      inArray(projectIssues.status, ["open", "in_progress"]),
    ));
  return { count: rows.length, titles: rows.map((r) => r.title) };
}

/** 跨活跃项目，gate 任务有 dueDate 且未完成（供就绪度推送扫描；与 getAutomationGatePrereqs 并存）。 */
export async function getApproachingGates(): Promise<Array<{
  projectId: string; phaseId: string; gateTaskId: string; gateName: string; dueDate: string; status: string;
}>> {
  const db = await getDb();
  if (!db) return [];
  const projs = await db.select({ id: projects.id, category: projects.category }).from(projects).where(eq(projects.archived, false));
  const out: Array<{ projectId: string; phaseId: string; gateTaskId: string; gateName: string; dueDate: string; status: string }> = [];
  for (const p of projs) {
    const phases = getPhasesForCategory(p.category);
    const rows = await db.select({ taskId: projectTasks.taskId, status: projectTasks.status, dueDate: projectTasks.dueDate, completed: projectTasks.completed })
      .from(projectTasks).where(eq(projectTasks.projectId, p.id));
    const byTask = new Map(rows.map((r) => [r.taskId, r]));
    for (const phase of phases) {
      const gate = byTask.get(phase.gateTaskId);
      if (!gate?.dueDate) continue;
      const done = gate.status === "done" || gate.status === "skipped" || !!gate.completed;
      if (done) continue;
      out.push({ projectId: p.id, phaseId: phase.id, gateTaskId: phase.gateTaskId, gateName: phase.gate, dueDate: gate.dueDate, status: gate.status });
    }
  }
  return out;
}

/** 计算某项目某 phase 的 Gate 就绪度（4 维）。phase 不存在→null。 */
export async function getGateReadiness(projectId: string, phaseId: string): Promise<GateReadiness | null> {
  const db = await getDb();
  if (!db) return null;
  const project = await getProjectById(projectId);
  if (!project) return null;
  const phase = getPhasesForCategory(project.category).find((p) => p.id === phaseId);
  if (!phase) return null;

  const tasks = await getProjectTasks(projectId, phaseId);
  const byTask = new Map(tasks.map((t) => [t.taskId, t]));
  const isDone = (id: string) => {
    const t = byTask.get(id);
    return t ? (t.status === "done" || t.status === "skipped" || !!t.completed) : false;
  };
  // 前置 = phase 模板任务除 gateTaskId 外未完成
  const incompleteTaskIds = phase.tasks.filter((t) => t.id !== phase.gateTaskId && !isDone(t.id)).map((t) => t.id);

  // 交付物：required = gateStandard.requiredDeliverables；uploaded = gate 任务下存在该 deliverableName 文件
  const required = phase.gateStandard.requiredDeliverables;
  const gateFiles = await getProjectFiles(projectId, phaseId, phase.gateTaskId);
  const uploaded = Array.from(new Set(
    gateFiles.map((f) => f.deliverableName).filter((n): n is string => !!n && required.includes(n))
  ));

  const critical = await getPhaseOpenP0P1(projectId, phaseId);

  const reviews = await getProjectGateReviews(projectId, phaseId);
  const latest = pickLatestReview(reviews);

  return computeGateReadiness({
    phaseId, gateName: phase.gate,
    prereq: { incompleteTaskIds },
    deliverables: { required, uploaded },
    criticalIssues: { titles: critical.titles },
    latestReview: latest ? { decision: latest.decision as "approved" | "conditional" | "rejected", conditions: latest.conditions ?? null, notes: latest.notes ?? null } : null,
  });
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `node scripts/test.mjs server/gate-readiness-db.test.ts`
Expected: PASS（含 Task 2 的文件用例 + 本任务 3 用例）。

- [ ] **Step 7: 类型检查**

Run: `pnpm check`
Expected: 0 errors。（若 `inArray(projectIssues.severity, [...])` 因 enum 类型报错，按该列 enum 的字面量类型调整数组类型断言。）

- [ ] **Step 8: 提交（只 stage db.ts + 测试）**

```bash
git add server/db.ts server/gate-readiness-db.test.ts
git commit -m "feat(db): getGateReadiness/getPhaseOpenP0P1/getApproachingGates + pickLatestReview id tiebreak"
```

---

## Task 4: tRPC `gateReviews.readiness` 查询

**Files:**
- Modify: `server/routers/gateReviews.ts`
- Test: `server/gate-readiness-router.test.ts`

- [ ] **Step 1: 写失败测试** `server/gate-readiness-router.test.ts`（仿 `server/auth.logout.test.ts` 的 createCaller 模式）：

```ts
import { describe, it, expect, afterAll } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `gate-rdy-rt-${Date.now()}`;

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("gateReviews.readiness", () => {
  it("成员可取就绪度；返回 4 维", async () => {
    const db = await getDb();
    if (!db) return;
    await db.insert(projects).values({
      id: PROJ, name: "rt就绪", projectNumber: PROJ, category: "npd",
      risk: "low", currentPhase: "design", createdBy: 42,
    }).onConflictDoNothing();
    // createdBy=42 → getEffectiveRole 返回 owner
    const caller = appRouter.createCaller({ user: { id: 42, name: "t", email: "t@t" } } as any);
    const r = await caller.gateReviews.readiness({ projectId: PROJ, phaseId: "design" });
    expect(r).not.toBeNull();
    expect(r!.dimensions.length).toBe(4);
  });
});
```

> 注：`createCaller` 的 ctx 形状以 `auth.logout.test.ts` 实际为准（如 ctx 还需 req/res，则照搬其构造）。若该测试库无法构造 ctx，则改为直接断言 `getGateReadiness`（已在 Task 3 覆盖）并把本 router 仅做编译验证——但优先用 createCaller。

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs server/gate-readiness-router.test.ts`
Expected: FAIL（`readiness` 过程不存在）。

- [ ] **Step 3: 加 `readiness` 查询**。在 `server/routers/gateReviews.ts` import 区补 `getGateReadiness`（来自 `../db`），并在 `gateReviewsRouter = router({ ... })` 里 `list` 之后加：

```ts
  /** Gate 就绪度（4 维：前置/交付物/本阶段P0P1/遗留评审条件） */
  readiness: protectedProcedure
    .input(z.object({ projectId: z.string(), phaseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return getGateReadiness(input.projectId, input.phaseId);
    }),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test.mjs server/gate-readiness-router.test.ts`
Expected: PASS。

- [ ] **Step 5: 类型检查**

Run: `pnpm check`
Expected: 0 errors。

- [ ] **Step 6: 提交（只 stage 这两个文件）**

```bash
git add server/routers/gateReviews.ts server/gate-readiness-router.test.ts
git commit -m "feat(api): gateReviews.readiness 查询"
```

---

## Task 5: 推送升级 `gate_prereq_incomplete` → 就绪度

**Files:**
- Modify: `server/automation/rules.ts`, `server/automation/scheduler.ts`
- Test: `server/automation/rules.test.ts`（扩展）

- [ ] **Step 1: 写失败测试** 追加到 `server/automation/rules.test.ts` 末尾（先看文件顶部已有的 import；`isAutomationRuleMatch` 与 `getAutomationRule` 通常已导入，若无则补 `import { isAutomationRuleMatch, getAutomationRule } from "./rules";`）：

```ts
describe("gate_prereq_incomplete 升级为就绪度", () => {
  const evt = (over: Record<string, unknown>) => ({
    action: "scheduled" as const, entityType: "task" as const, projectId: "p1",
    now: new Date("2026-06-16T00:00:00Z"),
    after: { isGate: true, gateName: "设计冻结", dueDate: "2026-06-18", status: "in_progress", notReady: true, blockerSummaries: ["还差 2 项前置任务", "缺 1/4 项交付物"], ...over },
  });
  it("临近且未就绪 → 触发", () => {
    expect(isAutomationRuleMatch("gate_prereq_incomplete", evt({}), { leadDays: 3 })).toBe(true);
  });
  it("已就绪 → 不触发", () => {
    expect(isAutomationRuleMatch("gate_prereq_incomplete", evt({ notReady: false, blockerSummaries: [] }), { leadDays: 3 })).toBe(false);
  });
  it("超出 leadDays → 不触发", () => {
    expect(isAutomationRuleMatch("gate_prereq_incomplete", evt({ dueDate: "2026-07-01" }), { leadDays: 3 })).toBe(false);
  });
  it("消息含具体缺项", () => {
    const rule = getAutomationRule("gate_prereq_incomplete")!;
    const msg = rule.buildMessage(evt({}) as any, { leadDays: 3 } as any, { projectName: "充气泵" });
    expect(msg.markdown).toContain("还差 2 项前置任务");
    expect(msg.markdown).toContain("缺 1/4 项交付物");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs server/automation/rules.test.ts`
Expected: FAIL（当前 matches 依赖 `incompletePrereqCount`，buildMessage 不含 blockerSummaries）。

- [ ] **Step 3: 升级 rules.ts**。在 `AUTOMATION_RULES` 里找到 `gate_prereq_incomplete` 条目，把 `label` 改为 `"Gate 就绪度提醒"`。把 `matchesGatePrereq` 改为：

```ts
function matchesGatePrereq(event: AutomationEvent, config: GatePrereqConfig): boolean {
  if (event.action !== "scheduled" || event.entityType !== "task") return false;
  if (event.after?.isGate !== true) return false;
  if (isClosedStatus("task", String(event.after?.status ?? ""))) return false;
  if (event.after?.notReady !== true) return false;
  const d = daysUntilDue(event);
  return d !== null && d >= 0 && d <= config.leadDays; // gate 临近且未就绪
}
```

把 `buildGatePrereqMessage` 改为列出 blockerSummaries：

```ts
function buildGatePrereqMessage(event: AutomationEvent, ctx: AutomationMessageContext): AutomationMessage {
  const title = ctx.entityTitle || String(event.after?.gateName ?? event.after?.taskId ?? "Gate");
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const d = daysUntilDue(event);
  const summaries = Array.isArray(event.after?.blockerSummaries) ? (event.after?.blockerSummaries as string[]) : [];
  const lines = summaries.length ? summaries.map((s) => `- ${s}`).join("\n") : "- 仍有未就绪项";
  const messageTitle = "Gate 就绪度提醒";
  const text = `${project}评审「${title}」${d === 0 ? "今天" : `还有 ${d} 天`}到期，尚未就绪：${summaries.join("；") || "仍有未就绪项"}。`;
  return { title: messageTitle, text, markdown: `#### ${messageTitle}\n${project}评审「${title}」${d === 0 ? "今天" : `还有 ${d} 天`}到期，还差以下项不能过会：\n${lines}` };
}
```

（`gatePrereqConfigSchema` 保留 `leadDays`/`cadenceHours`/`pushGroup`；其余规则代码不动。）

- [ ] **Step 4: scheduler 改用就绪度扫描**。在 `server/automation/scheduler.ts`：
  - import 增加 `getApproachingGates, getGateReadiness`（来自 `../db`）。
  - 把现有「Gate 前置未完提醒」那段（`for (const g of gates)` 基于 `getAutomationGatePrereqs`）替换为基于就绪度的扫描。先在 `Promise.all` 里**移除** `getAutomationGatePrereqs()`（它仍被 #1 健康度用，但 scheduler 这里不再需要），改为单独取 approaching gates 并逐个算就绪度：

把原来的：
```ts
  const [tasks, issues, gates] = await Promise.all([
    getAutomationDueTasks(),
    getAutomationDueIssues(),
    getAutomationGatePrereqs(),
  ]);
```
改为：
```ts
  const [tasks, issues] = await Promise.all([
    getAutomationDueTasks(),
    getAutomationDueIssues(),
  ]);
  const approachingGates = await getApproachingGates();
```
并把原 `for (const g of gates) { ... }` 段整体替换为：
```ts
  // Gate 就绪度提醒：对临近 gate 算就绪度，未就绪才发（规则再按 leadDays 精确过滤）
  for (const g of approachingGates) {
    const readiness = await getGateReadiness(g.projectId, g.phaseId);
    if (!readiness) continue;
    await runAutomation({
      action: "scheduled",
      entityType: "task",
      projectId: g.projectId,
      entityId: `gate:${g.projectId}:${g.gateTaskId}`,
      now,
      after: {
        isGate: true,
        taskId: g.gateTaskId,
        gateName: g.gateName,
        title: g.gateName,
        dueDate: g.dueDate,
        status: g.status,
        notReady: !readiness.ready,
        blockerSummaries: readiness.dimensions.filter((d) => !d.ok).map((d) => d.summary),
      },
    });
  }
```
（确认 `getAutomationGatePrereqs` 仍从 db 导出、未被删除——只是 scheduler 不再调用它。）

- [ ] **Step 5: 跑测试确认通过**

Run: `node scripts/test.mjs server/automation/rules.test.ts`
Expected: PASS。

- [ ] **Step 6: 类型检查 + 自动化引擎回归**

Run: `pnpm check && node scripts/test.mjs server/automation/engine.test.ts`
Expected: 0 errors；engine 测试通过。

- [ ] **Step 7: 提交（只 stage 这 3 个文件）**

```bash
git add server/automation/rules.ts server/automation/scheduler.ts server/automation/rules.test.ts
git commit -m "feat(automation): gate_prereq_incomplete 升级为就绪度提醒（列具体缺项）"
```

---

## Task 6: 前端 — 就绪清单 + 交付物上传（`GateReviewModal`）

**Files:**
- Create: `client/src/components/views/GateReadinessChecklist.tsx`
- Modify: `client/src/components/views/GateReviewModal.tsx`
- 验证：preview（无前端单测）

- [ ] **Step 1: 建就绪清单组件** `client/src/components/views/GateReadinessChecklist.tsx`：

```tsx
import { useRef } from "react";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, XCircle, Upload, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const DIM_LABEL: Record<string, string> = {
  prereq: "前置任务", deliverables: "必需交付物", critical_issues: "本阶段 P0/P1", review_conditions: "遗留评审条件",
};

export function GateReadinessChecklist({ projectId, phaseId, gateTaskId }: { projectId: string; phaseId: string; gateTaskId: string }) {
  const utils = trpc.useUtils();
  const { data: readiness } = trpc.gateReviews.readiness.useQuery({ projectId, phaseId });
  const { data: files = [] } = trpc.files.list.useQuery({ projectId, phaseId, taskId: gateTaskId });

  const refresh = async () => {
    await Promise.all([
      utils.gateReviews.readiness.invalidate({ projectId, phaseId }),
      utils.files.list.invalidate({ projectId, phaseId, taskId: gateTaskId }),
    ]);
  };

  const uploadFor = async (deliverableName: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", projectId);
    fd.append("phaseId", phaseId);
    fd.append("taskId", gateTaskId);
    fd.append("deliverableName", deliverableName);
    const resp = await fetch("/api/files/upload", { method: "POST", body: fd, credentials: "include" });
    if (!resp.ok) { toast.error("上传失败"); return; }
    toast.success(`已上传：${deliverableName}`);
    await refresh();
  };

  const del = trpc.files.delete.useMutation({ onSuccess: refresh, onError: (e) => toast.error(e.message) });

  if (!readiness) return <div className="text-xs text-stone-400 font-mono p-3">就绪度加载中…</div>;

  return (
    <div className="border border-stone-200 bg-stone-50/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono uppercase tracking-widest text-stone-400">GATE 就绪度</span>
        <span className={`text-xs font-medium ${readiness.ready ? "text-emerald-600" : "text-rose-600"}`}>
          {readiness.ready ? "已就绪" : `还差 ${readiness.blockerCount} 项`}
        </span>
      </div>
      {readiness.dimensions.map((dim) => (
        <div key={dim.dimension} className="text-sm">
          <div className="flex items-center gap-2">
            {dim.ok ? <CheckCircle2 size={14} className="text-emerald-500" /> : <XCircle size={14} className="text-rose-500" />}
            <span className="font-medium text-stone-700">{DIM_LABEL[dim.dimension]}</span>
            <span className="text-stone-400">· {dim.summary}</span>
          </div>
          {dim.dimension === "deliverables" && (
            <DeliverableRows
              required={readiness.dimensions.find((d) => d.dimension === "deliverables")!.blockers}
              all={files}
              onUpload={uploadFor}
              onDelete={(id) => del.mutate({ id, projectId })}
            />
          )}
          {dim.dimension !== "deliverables" && !dim.ok && dim.blockers.length > 0 && (
            <ul className="ml-6 mt-0.5 text-xs text-stone-500 list-disc">
              {dim.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function DeliverableRows({
  required, all, onUpload, onDelete,
}: {
  required: string[]; // 缺失的交付物名（来自 blockers）
  all: Array<{ id: number; name: string; deliverableName: string | null; storageUrl: string }>;
  onUpload: (name: string, file: File) => void;
  onDelete: (id: number) => void;
}) {
  // 必需交付物全集 = 已上传(文件里出现过的 deliverableName) ∪ 缺失(required)
  const uploadedNames = Array.from(new Set(all.map((f) => f.deliverableName).filter((n): n is string => !!n)));
  const names = Array.from(new Set([...uploadedNames, ...required]));
  return (
    <div className="ml-6 mt-1 space-y-1">
      {names.map((name) => {
        const versions = all.filter((f) => f.deliverableName === name).sort((a, b) => b.id - a.id);
        const has = versions.length > 0;
        return (
          <div key={name} className="text-xs">
            <div className="flex items-center gap-2">
              {has ? <CheckCircle2 size={12} className="text-emerald-500" /> : <XCircle size={12} className="text-rose-400" />}
              <span className={has ? "text-stone-700" : "text-stone-500"}>{name}</span>
              <UploadButton onPick={(f) => onUpload(name, f)} />
            </div>
            {versions.map((v, idx) => (
              <div key={v.id} className="flex items-center gap-1 ml-5 text-stone-500">
                <FileText size={11} />
                <a href={v.storageUrl} target="_blank" rel="noreferrer" className="hover:underline truncate max-w-[160px]">{v.name}</a>
                {idx === 0 && <span className="text-[10px] text-emerald-600">最新</span>}
                <button onClick={() => onDelete(v.id)} className="text-stone-300 hover:text-rose-500"><Trash2 size={11} /></button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function UploadButton({ onPick }: { onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
      <button onClick={() => ref.current?.click()} className="inline-flex items-center gap-0.5 text-amber-600 hover:text-amber-700">
        <Upload size={11} /> 上传
      </button>
    </>
  );
}
```

- [ ] **Step 2: 接入 `GateReviewModal`**。在 `client/src/components/views/GateReviewModal.tsx`：
  - import：`import { GateReadinessChecklist } from "./GateReadinessChecklist";`
  - 给 `GateReviewModal` props 增加 `projectId: string;` 与 `gateTaskId: string;`（在现有 props 类型里加这两个字段，并在函数签名解构）。
  - 在模态内容顶部（评审表单上方）渲染：
    ```tsx
    {projectId && gateTaskId && (
      <GateReadinessChecklist projectId={projectId} phaseId={phaseId} gateTaskId={gateTaskId} />
    )}
    ```
  - 在调用 `GateReviewModal` 的父组件（搜索 `<GateReviewModal`，应在 `ProjectDetailView.tsx`）补传 `projectId={project.id}` 与 `gateTaskId={<该 phase 的 gateTaskId>}`（phase 对象上有 `gateTaskId`；若父组件已有 phase 变量则取 `phase.gateTaskId`）。

- [ ] **Step 3: 类型检查**

Run: `pnpm check`
Expected: 0 errors（如父组件缺 gateTaskId 来源，从该 phase 模板对象取 `gateTaskId`；确认 `trpc.files.list`/`files.delete`/`gateReviews.readiness` 客户端类型可用）。

- [ ] **Step 4: preview 验证**

启动 preview，打开一个项目的某 Gate 评审弹窗：确认就绪清单显示 4 维、交付物可上传（上传后该项变 ✅ 且「还差 N 项」减少）、可删除（删到 0 该项变 ❌）。用 preview_screenshot 留证。

- [ ] **Step 5: 提交（只 stage 这两个前端文件 + 父组件）**

```bash
git add client/src/components/views/GateReadinessChecklist.tsx client/src/components/views/GateReviewModal.tsx client/src/components/views/ProjectDetailView.tsx
git commit -m "feat(ui): GateReviewModal 就绪清单 + 交付物多版本上传"
```

---

## Task 7: 全量验证

- [ ] **Step 1:** `pnpm check` → 0 errors。
- [ ] **Step 2:** `node scripts/test.mjs` → 全绿（含 gate-readiness 纯核心/db/router、rules 扩展；既有无回归）。
- [ ] **Step 3:** 如有快照/锁文件变动则提交：
```bash
git status --short && git add -p   # 仅自己的改动
git commit -m "chore: Gate 就绪度 2a 全量验证通过" --allow-empty
```

---

## Self-Review

**Spec 覆盖：**
- 4 维就绪 → Task 1（纯核心）+ Task 3（取数）。✅
- 交付物源=gateStandard.requiredDeliverables、已上传=gate 任务 deliverableName 文件存在 → Task 3。✅
- 前置排除 gate 任务、done/skipped/completed → Task 3 `isDone`。✅
- 本阶段 P0/P1 → Task 3 `getPhaseOpenP0P1`。✅
- 最新评审 roundNumber/createdAt/id desc + null/approved/conditional/rejected → Task 1 + Task 3 `pickLatestReview`。✅
- 与 release 严格区分（不动 release/health 函数）→ Task 3 只新增。✅
- deliverableName 列 + 迁移 + 多版本 + 删到 0 取消 → Task 2 + Task 6（删除）+ Task 3 测试（删文件回退）。✅
- 清单 UI + 上传入口 → Task 6。✅
- 推送升级保留 key/改 label/列缺项 → Task 5。✅
- 2b 扩展点（deliverableName 锚点、口径集中 getGateReadiness 一处）→ 已具备。✅

**Placeholder 扫描：** 无 TBD；每步含完整代码。少量「以实际类型为准」是真实的签名核对指令（ProjectGateReview.createdAt 是否 Date、enum 数组断言、createCaller ctx 形状），非占位。

**类型一致性：** `GateReadiness`/`GateReadinessInput`/`GateDimResult` 在 Task 1 定义，Task 3/4/6 一致引用；`getGateReadiness`/`getPhaseOpenP0P1`/`getApproachingGates` 跨 Task 命名一致；事件字段 `notReady`/`blockerSummaries` 在 Task 5 scheduler 产出与 rules 消费一致。
