# MP Release 硬闸口 实现计划（Step 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MP Release 成为服务端强制的真闸口——前置 Gate 必须 approved（conditional 仅 owner/PM/manager/admin 留痕强制），交付物齐、P0/P1 关闭、已关联产品为不可绕的硬卡。

**Architecture:** 在 SOP 模板上加显式 `isReleaseGate` 锚点定位前置 Gate；`server/db.ts` 集中实现「取最新 Gate 记录 + 交付物缺口 + override 授权」三个纯函数 + 重写 `releaseProject()` 强制矩阵；`mp_releases` 加列留痕；`releasePrecheck` 扩展返回供前端渲染；`ReleaseDialog` 按矩阵渲染普通/强制/禁用三态。

**Tech Stack:** TypeScript、Drizzle ORM（PostgreSQL）、tRPC、Vitest（真实 Postgres，`npm test`）、React。

设计依据：`docs/design/2026-06-16-mp-release-hard-gate-design.md`。

---

## 文件结构（创建/修改一览）

- Modify `shared/sop-templates.ts` — `SOPPhase` 加 `isReleaseGate?`；NPD/ECO 的 `pvt`、IDR 的 `mp` 各标记；新增 `getReleaseGatePhase()`。
- Modify `drizzle/schema.ts` — `mpReleases` 加 7 列。
- Run `npm run db:push` — 生成并应用迁移。
- Modify `server/db.ts` — 新增 `pickLatestReview()`、`getReleaseGateStatus()`、`isReleaseOverrideAuthorized()`、`ReleaseGateStatus` 类型；重写 `releaseProject()`（签名 `releasedBy`→`actor`）。
- Modify `server/routers/products.ts` — `releasePrecheck` 扩展返回；`release` 传 `actor` + `override`。
- Create `server/release-gate.test.ts` — 闸口矩阵单测。
- Modify `server/release.test.ts` — 适配新签名与新前置条件。
- Modify `client/src/components/views/ReleaseDialog.tsx` — 三态渲染 + 强制发布表单。

**判定口径（贯穿全计划，务必一致）：**
- 「最新 Gate 记录」= 同 `phaseId` 下 `roundNumber` 最大；并列取 `createdAt` 最新。
- 「交付物齐」= 前置 Gate phase 内**除 `gateTaskId` 外**每个模板任务、其 `getTaskDeliverables(task.id, phase.deliverables)` 的每个名字，都在该任务 `projectTasks.deliverables` 中为 `true`（与前端 `computeGateReadiness` 一致）。
- 四道绝对硬卡：已关联产品 / P0P1=0 / 交付物齐 / Gate 非 `rejected` 且有记录。强制发布只能覆盖「decision 为 `conditional` 而非 `approved`」这一格。
- override 授权：`actor.role==="admin"` || `project.createdBy===actor.id` || `project.pmUserId===actor.id` || 项目成员角色 ∈ {`owner`,`manager`}。

---

## Task 1: 模板语义锚点 `isReleaseGate` + `getReleaseGatePhase`

**Files:**
- Modify: `shared/sop-templates.ts`（`SOPPhase` 约 36-51；NPD `pvt`、ECO `pvt`、IDR `mp` 的 phase 对象；文件末尾加 helper）
- Test: `shared/sop-templates.test.ts`（新建；vitest include 仅 `server/**`，见步骤 2 说明）

- [ ] **Step 1: 给 `SOPPhase` 接口加字段**

在 `shared/sop-templates.ts` 的 `SOPPhase` 接口内（`bufferDays?` 附近）加：

```ts
  /** 标记本阶段的 Gate 为 MP Release 的前置闸口（每个 category 仅一个）。 */
  isReleaseGate?: boolean;
```

- [ ] **Step 2: 在三套模板对应 phase 上标记**

找到 NPD 模板里 `id: 'pvt'` 的 phase 对象，加一行 `isReleaseGate: true,`。
对 ECO 模板里 `id: 'pvt'` 的 phase、IDR 模板里 `id: 'mp'` 的 phase 各加 `isReleaseGate: true,`。

> 校验：NPD/ECO 标的是 `pvt`，IDR 标的是 `mp`。三者各且仅一个标记。

- [ ] **Step 3: 新增 helper（文件末尾，紧跟 `getPhasesForCategory` 之后）**

```ts
/** 定位某 category 的「MP Release 前置 Gate」所在 phase；未定义返回 null。 */
export const getReleaseGatePhase = (category?: string): SOPPhase | null =>
  getPhasesForCategory(category).find((p) => p.isReleaseGate) ?? null;
```

- [ ] **Step 4: 写校验脚本验证锚点（临时，跑完即弃）**

因为 vitest 只扫 `server/**`，用一次性脚本验证模板正确：

Run:
```bash
npx tsx -e "import {getReleaseGatePhase} from './shared/sop-templates'; for (const c of ['npd','eco','idr']) { const p=getReleaseGatePhase(c); console.log(c, p?.id, p?.gateTaskId); }"
```
Expected 输出三行：
```
npd pvt pv8
eco pvt epv5
idr mp im6
```
若任意一行 `undefined` 或 phase id 不符，回 Step 2 修正。

- [ ] **Step 5: Commit**

```bash
git add shared/sop-templates.ts
git commit -m "feat: SOPPhase.isReleaseGate 锚点 + getReleaseGatePhase 定位前置 Gate"
```

---

## Task 2: `mp_releases` 加列（强制发布留痕）

**Files:**
- Modify: `drizzle/schema.ts`（`mpReleases` 块，约 773-791）

- [ ] **Step 1: 加 7 列**

在 `mpReleases` 的 `notes: text("notes"),` 之后、`releasedBy` 之前插入：

```ts
  /** 是否为 conditional 留痕强制发布 */
  overridden: boolean("overridden").notNull().default(false),
  /** 强制发布理由（override 时必填） */
  overrideReason: text("overrideReason"),
  /** 强制发布操作人（服务端登录态写入） */
  acceptedBy: integer("acceptedBy"),
  /** 强制发布时间（服务端时间戳写入） */
  acceptedAt: timestamp("acceptedAt"),
  /** 发布时 Gate 条件快照 */
  conditionsSnapshot: text("conditionsSnapshot"),
  /** 后续条件跟进负责人 userId（override 时必填） */
  followUpOwner: integer("followUpOwner"),
  /** 条件跟进截止日（override 时必填） */
  dueDate: varchar("dueDate", { length: 32 }),
```

> `boolean` / `integer` / `timestamp` / `varchar` / `text` 均已在该文件 import（其余表已用）。无需新增 import。

- [ ] **Step 2: 生成并应用迁移**

Run:
```bash
npm run db:push
```
Expected: drizzle-kit 检测到 `mp_releases` 新增 7 列，生成迁移 SQL 并 apply 成功，无报错。

- [ ] **Step 3: 验证列已存在**

Run:
```bash
npx tsx -e "import {getDb} from './server/db'; const db=await getDb(); const {sql}=await import('drizzle-orm'); const r=await db.execute(sql\`select column_name from information_schema.columns where table_name='mp_releases' order by 1\`); console.log(r.rows.map(x=>x.column_name).join(','));"
```
Expected: 输出含 `overridden,overrideReason,acceptedBy,acceptedAt,conditionsSnapshot,followUpOwner,dueDate`。

- [ ] **Step 4: Commit**

```bash
git add drizzle/schema.ts drizzle/
git commit -m "feat: mp_releases 加强制发布留痕列 (overridden/acceptedBy/...)"
```

---

## Task 3: 闸口纯函数（最新记录 / 交付物缺口 / override 授权）

**Files:**
- Modify: `server/db.ts`（在 `getOpenP0P1Count`（约 1398）之后、`releaseProject` 之前新增）
- Test: `server/release-gate.test.ts`（新建）

需要的 import 已在 `server/db.ts` 顶部存在：`eq`, `and`, `getProjectGateReviews`(同文件)、`getProjectTasks`(同文件)、`getProjectMember`(同文件)。新增对 shared 的 import。

- [ ] **Step 1: 在 `server/db.ts` 顶部补 shared import**

在 `server/db.ts` 已有的 import 区加（若已 import 同模块则合并）：

```ts
import { getReleaseGatePhase } from "../shared/sop-templates";
import { getTaskDeliverables } from "../shared/task-deliverables";
import type { GateDecision, ProjectGateReview, ProjectRow } from "../drizzle/schema";
```

> 若 `ProjectRow` / `GateDecision` / `ProjectGateReview` 已从 `../drizzle/schema` 导入，则只补缺失的名字，勿重复。

- [ ] **Step 2: 写失败测试 `server/release-gate.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct, createProjectWithSeed, setProjectProduct,
  createProjectGateReview, setTaskDeliverable,
  getReleaseGateStatus, getProjectById, isReleaseOverrideAuthorized,
} from "./db";
import { getReleaseGatePhase } from "../shared/sop-templates";
import { getTaskDeliverables } from "../shared/task-deliverables";

const PID = "rgate_prod";
const PRJ = "rgate_proj";

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM project_gate_reviews WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_members WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PRJ}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

/** 把前置 Gate phase（pvt）的非门任务交付物全部标记完成 */
async function completeReleaseGateDeliverables() {
  const phase = getReleaseGatePhase("npd")!;
  for (const t of phase.tasks) {
    if (t.id === phase.gateTaskId) continue;
    for (const name of getTaskDeliverables(t.id, phase.deliverables)) {
      await setTaskDeliverable(PRJ, phase.id, t.id, name, true, 1);
    }
  }
}

describe("release gate status", () => {
  beforeAll(async () => {
    await createProduct({ id: PID, name: "网关测试", type: "finished", category: "x", createdBy: 1 });
    await createProjectWithSeed(
      { id: PRJ, name: "网关NPD", projectNumber: "G1", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 2 } as any,
      "npd", 1,
    );
    await setProjectProduct(PRJ, PID);
  });

  it("交付物未齐时 missing 非空、decision 为 null", async () => {
    const prj = await getProjectById(PRJ);
    const s = await getReleaseGateStatus(prj!);
    expect(s.phaseId).toBe("pvt");
    expect(s.deliverables.missing.length).toBeGreaterThan(0);
    expect(s.decision).toBeNull();
  });

  it("补齐交付物后 missing 为空", async () => {
    await completeReleaseGateDeliverables();
    const prj = await getProjectById(PRJ);
    const s = await getReleaseGateStatus(prj!);
    expect(s.deliverables.missing).toEqual([]);
    expect(s.deliverables.done).toBe(s.deliverables.total);
  });

  it("最新记录取 roundNumber 最大那条", async () => {
    await createProjectGateReview({ projectId: PRJ, phaseId: "pvt", phaseName: "PVT", gateName: "MP准备就绪评审", reviewDate: "2026-06-01", decision: "rejected", roundNumber: 1, createdBy: 1 } as any);
    await createProjectGateReview({ projectId: PRJ, phaseId: "pvt", phaseName: "PVT", gateName: "MP准备就绪评审", reviewDate: "2026-06-02", decision: "approved", roundNumber: 2, createdBy: 1 } as any);
    const prj = await getProjectById(PRJ);
    const s = await getReleaseGateStatus(prj!);
    expect(s.decision).toBe("approved");
    expect(s.roundNumber).toBe(2);
  });

  it("override 授权：创建人/PM/admin 允许，其他人拒绝", async () => {
    const prj = await getProjectById(PRJ);
    expect(await isReleaseOverrideAuthorized(prj!, { id: 1, role: "user" })).toBe(true);   // createdBy
    expect(await isReleaseOverrideAuthorized(prj!, { id: 2, role: "user" })).toBe(true);   // pmUserId
    expect(await isReleaseOverrideAuthorized(prj!, { id: 9, role: "admin" })).toBe(true);  // admin
    expect(await isReleaseOverrideAuthorized(prj!, { id: 9, role: "user" })).toBe(false);  // 无关用户
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- server/release-gate.test.ts`
Expected: FAIL —— `getReleaseGateStatus` / `isReleaseOverrideAuthorized` is not a function（未实现）。

- [ ] **Step 4: 实现三个函数（`server/db.ts`，`getOpenP0P1Count` 之后）**

```ts
/** 取最新 Gate 记录：roundNumber 最大；并列取 createdAt 最新。 */
function pickLatestReview(reviews: ProjectGateReview[]): ProjectGateReview | null {
  if (reviews.length === 0) return null;
  return reviews.reduce((best, r) => {
    if (r.roundNumber > best.roundNumber) return r;
    if (r.roundNumber === best.roundNumber && r.createdAt > best.createdAt) return r;
    return best;
  });
}

export interface ReleaseGateStatus {
  phaseId: string | null;
  gateName: string;
  decision: GateDecision | null;
  conditions: string | null;
  roundNumber: number;
  deliverables: { done: number; total: number; missing: string[] };
}

/** 计算某项目「MP Release 前置 Gate」的最新决议与交付物缺口。 */
export async function getReleaseGateStatus(project: ProjectRow): Promise<ReleaseGateStatus> {
  const phase = getReleaseGatePhase(project.category);
  if (!phase) {
    return { phaseId: null, gateName: "", decision: null, conditions: null, roundNumber: 0, deliverables: { done: 0, total: 0, missing: [] } };
  }
  const reviews = await getProjectGateReviews(project.id, phase.id);
  const latest = pickLatestReview(reviews);
  const taskRows = await getProjectTasks(project.id, phase.id);
  const statusByTask: Record<string, Record<string, boolean>> = {};
  for (const r of taskRows) statusByTask[r.taskId] = r.deliverables ?? {};
  let total = 0, done = 0;
  const missing: string[] = [];
  for (const t of phase.tasks) {
    if (t.id === phase.gateTaskId) continue;
    for (const name of getTaskDeliverables(t.id, phase.deliverables)) {
      total++;
      if (statusByTask[t.id]?.[name]) done++;
      else missing.push(name);
    }
  }
  return {
    phaseId: phase.id,
    gateName: latest?.gateName || phase.gate,
    decision: latest?.decision ?? null,
    conditions: latest?.conditions ?? null,
    roundNumber: latest?.roundNumber ?? 0,
    deliverables: { done, total, missing },
  };
}

/** Release override 专用授权（非全局权限矩阵）：创建人 / PM / 项目 owner|manager / 系统 admin。 */
export async function isReleaseOverrideAuthorized(
  project: ProjectRow,
  actor: { id: number; role: string },
): Promise<boolean> {
  if (actor.role === "admin") return true;
  if (project.createdBy === actor.id) return true;
  if (project.pmUserId === actor.id) return true;
  const member = await getProjectMember(project.id, actor.id);
  return member?.role === "owner" || member?.role === "manager";
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- server/release-gate.test.ts`
Expected: PASS（4 个 it 全绿）。

- [ ] **Step 6: Commit**

```bash
git add server/db.ts server/release-gate.test.ts
git commit -m "feat: 闸口纯函数 getReleaseGateStatus/isReleaseOverrideAuthorized + 测试"
```

---

## Task 4: 重写 `releaseProject()` 强制矩阵 + 留痕

**Files:**
- Modify: `server/db.ts`（`releaseProject`，约 1410-1456）
- Modify: `server/release.test.ts`（适配新签名 + 新前置条件 + 矩阵用例）

- [ ] **Step 1: 改写现有 `server/release.test.ts` 的失败用例（先让它表达新契约）**

整体替换 `server/release.test.ts` 为：

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createProduct, createProjectWithSeed,
  setProjectProduct, getOpenP0P1Count, releaseProject,
  getProductById, getProjectById, listProductRevisions,
  createProjectGateReview, setTaskDeliverable,
} from "./db";
import { getReleaseGatePhase } from "../shared/sop-templates";
import { getTaskDeliverables } from "../shared/task-deliverables";

const PID = "rel_test_product";
const PRJ = "rel_test_project";
const ACTOR = { id: 1, role: "user" };

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM mp_releases WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PID}`);
  await db.execute(sql`DELETE FROM project_gate_reviews WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM project_issues WHERE "projectId" = ${PRJ}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PRJ}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

async function addGate(decision: "approved" | "conditional" | "rejected", roundNumber: number, conditions?: string) {
  await createProjectGateReview({
    projectId: PRJ, phaseId: "pvt", phaseName: "PVT", gateName: "MP准备就绪评审",
    reviewDate: "2026-06-01", decision, conditions: conditions ?? null, roundNumber, createdBy: 1,
  } as any);
}
async function completeDeliverables() {
  const phase = getReleaseGatePhase("npd")!;
  for (const t of phase.tasks) {
    if (t.id === phase.gateTaskId) continue;
    for (const name of getTaskDeliverables(t.id, phase.deliverables)) {
      await setTaskDeliverable(PRJ, phase.id, t.id, name, true, 1);
    }
  }
}

describe("MP Release 硬闸口", () => {
  beforeAll(async () => {
    await createProduct({ id: PID, name: "测试泵", type: "finished", category: "充气泵", createdBy: 1 });
    await createProjectWithSeed(
      { id: PRJ, name: "测试NPD", projectNumber: "T1", category: "npd", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 2 } as any,
      "npd", 1,
    );
    await setProjectProduct(PRJ, PID);
  });

  it("未关联产品：不可发布", async () => {
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    await db!.execute(sql`UPDATE projects SET "productId"=NULL WHERE id=${PRJ}`);
    await expect(releaseProject({ projectId: PRJ, actor: ACTOR })).rejects.toThrow(/未关联产品/);
    await setProjectProduct(PRJ, PID);
  });

  it("P0/P1 未关闭：绝对硬卡，强制也不行", async () => {
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    await db!.execute(sql`INSERT INTO project_issues ("projectId","phaseId",title,severity,status,category) VALUES (${PRJ},'pvt','blocker','P0','open','other')`);
    await addGate("approved", 1);
    await completeDeliverables();
    await expect(releaseProject({ projectId: PRJ, actor: ACTOR })).rejects.toThrow(/P0\/P1/);
    await expect(releaseProject({ projectId: PRJ, actor: { id: 1, role: "admin" }, override: { overrideReason: "x", followUpOwner: 1, dueDate: "2026-07-01" } })).rejects.toThrow(/P0\/P1/);
    await db!.execute(sql`UPDATE project_issues SET status='closed' WHERE "projectId"=${PRJ}`);
  });

  it("交付物未齐：绝对硬卡", async () => {
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    await db!.execute(sql`UPDATE project_tasks SET deliverables='{}'::jsonb WHERE "projectId"=${PRJ} AND "phaseId"='pvt'`);
    await expect(releaseProject({ projectId: PRJ, actor: { id: 1, role: "admin" }, override: { overrideReason: "x", followUpOwner: 1, dueDate: "2026-07-01" } })).rejects.toThrow(/交付物/);
    await completeDeliverables();
  });

  it("Gate rejected：不可发布且不提供强制", async () => {
    await addGate("rejected", 2);
    await expect(releaseProject({ projectId: PRJ, actor: { id: 1, role: "admin" }, override: { overrideReason: "x", followUpOwner: 1, dueDate: "2026-07-01" } })).rejects.toThrow();
  });

  it("conditional + 无权用户：拒绝", async () => {
    await addGate("conditional", 3, "补一份老化报告");
    await expect(releaseProject({ projectId: PRJ, actor: { id: 9, role: "user" }, override: { overrideReason: "x", followUpOwner: 1, dueDate: "2026-07-01" } })).rejects.toThrow(/权限/);
  });

  it("conditional + 授权 + override 齐全：成功并留痕", async () => {
    const res = await releaseProject({ projectId: PRJ, actor: { id: 2, role: "user" }, override: { overrideReason: "管理层接受", followUpOwner: 2, dueDate: "2026-07-01" } });
    expect(res.revisionLabel).toBe("Rev A");
    const db = await getDb(); const { sql } = await import("drizzle-orm");
    const r = await db!.execute(sql`SELECT overridden, "overrideReason", "acceptedBy", "conditionsSnapshot", "followUpOwner", "dueDate" FROM mp_releases WHERE "projectId"=${PRJ}`);
    const row = r.rows[0] as any;
    expect(row.overridden).toBe(true);
    expect(row.acceptedBy).toBe(2);
    expect(row.conditionsSnapshot).toBe("补一份老化报告");
    expect(row.followUpOwner).toBe(2);
    const prj = await getProjectById(PRJ);
    expect(prj?.archived).toBe(true);
    const product = await getProductById(PID);
    expect(product?.lifecycleState).toBe("mass_production");
    expect((await listProductRevisions(PID)).length).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server/release.test.ts`
Expected: FAIL —— `releaseProject` 还不接受 `actor`/`override`，且尚未实现 Gate/交付物校验，多个用例红。

- [ ] **Step 3: 重写 `releaseProject()`**

把 `server/db.ts` 的 `releaseProject` 整体替换为：

```ts
export async function releaseProject(input: {
  projectId: string;
  actor: { id: number; role: string };
  notes?: string;
  override?: { overrideReason: string; followUpOwner: number; dueDate: string };
}): Promise<{ revisionId: number; revisionLabel: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("项目不存在");

  // —— 绝对硬卡 1：已关联产品 ——
  if (!project.productId) throw new Error("项目未关联产品，无法发布");
  // —— 绝对硬卡 2：P0/P1 全关闭 ——
  const openCount = await getOpenP0P1Count(input.projectId);
  if (openCount > 0) throw new Error(`存在 ${openCount} 个未关闭的 P0/P1 问题，不能发布`);

  // —— 前置 Gate ——
  const gate = await getReleaseGateStatus(project);
  if (!gate.phaseId) throw new Error("未定义 MP Release 前置 Gate，无法发布");
  // —— 绝对硬卡 3：交付物齐 ——
  if (gate.deliverables.missing.length > 0) {
    throw new Error(`前置 Gate 必备交付物未齐（${gate.deliverables.done}/${gate.deliverables.total}）`);
  }
  // —— 绝对硬卡 4：Gate 有记录且非 rejected ——
  if (gate.decision === null || gate.decision === "rejected") {
    throw new Error("前置 Gate 未通过（无评审记录或已驳回），不能发布");
  }

  // —— conditional 仅授权用户留痕强制 ——
  let overridden = false;
  if (gate.decision === "conditional") {
    if (!input.override) throw new Error("前置 Gate 为有条件通过，需 owner/PM/manager 填写理由强制发布");
    const authorized = await isReleaseOverrideAuthorized(project, input.actor);
    if (!authorized) throw new Error("无权限强制发布（需项目创建人/PM/manager 或系统管理员）");
    const ov = input.override;
    if (!ov.overrideReason?.trim() || !ov.followUpOwner || !ov.dueDate?.trim()) {
      throw new Error("强制发布需填写理由、跟进负责人与截止日期");
    }
    overridden = true;
  }

  const productId = project.productId;
  const label = await nextRevisionLabel(productId);

  return db.transaction(async (tx) => {
    const open = await tx.select().from(projectIssues)
      .where(and(eq(projectIssues.projectId, input.projectId),
        drizzleSql`${projectIssues.status} NOT IN ('resolved','closed','wont_fix')`));

    const [rev] = await tx.insert(productRevisions).values({
      productId, revisionLabel: label,
      parentRevisionId: project.baseRevisionId ?? null,
      createdByProjectId: input.projectId,
      status: "released", releasedAt: new Date(), releasedBy: input.actor.id,
    }).returning({ id: productRevisions.id });

    const frozenBom = await freezeBomToRevision(input.projectId, rev.id, tx);

    await tx.insert(mpReleases).values({
      productId, revisionId: rev.id, projectId: input.projectId,
      snapshotBom: frozenBom as unknown[],
      openIssues: open as unknown[], notes: input.notes ?? null,
      releasedBy: input.actor.id,
      overridden,
      overrideReason: overridden ? input.override!.overrideReason : null,
      acceptedBy: overridden ? input.actor.id : null,
      acceptedAt: overridden ? new Date() : null,
      conditionsSnapshot: overridden ? gate.conditions : null,
      followUpOwner: overridden ? input.override!.followUpOwner : null,
      dueDate: overridden ? input.override!.dueDate : null,
    } as InsertMpRelease);

    await tx.update(products)
      .set({ currentRevisionId: rev.id, lifecycleState: "mass_production" })
      .where(eq(products.id, productId));

    await tx.update(projects)
      .set({ resultRevisionId: rev.id, archived: true })
      .where(eq(projects.id, input.projectId));

    return { revisionId: rev.id, revisionLabel: label };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- server/release.test.ts`
Expected: PASS（6 个用例全绿）。

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/release.test.ts
git commit -m "feat: releaseProject 强制闸口矩阵 + conditional 留痕强制发布"
```

---

## Task 5: `releasePrecheck` 扩展返回 + `release` 传 actor/override

**Files:**
- Modify: `server/routers/products.ts`（`releasePrecheck` 59-70；`release` 72-97；import）

- [ ] **Step 1: 扩展 import**

把 `server/routers/products.ts` 顶部对 `../db` 的 import 增加 `getReleaseGateStatus, isReleaseOverrideAuthorized`：

```ts
import {
  createProduct, getProductById, listProductsByCategory,
  createPlatform, listProductRevisions,
  setProjectProduct, getOpenP0P1Count, releaseProject, getProjectById,
  getReleaseGateStatus, isReleaseOverrideAuthorized,
} from "../db";
```

- [ ] **Step 2: 重写 `releasePrecheck`**

```ts
  releasePrecheck: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) {
        return {
          hasProduct: false, productId: null, openP0P1: 0,
          releaseGate: null,
          deliverables: { done: 0, total: 0, missing: [] as string[] },
          blockers: ["项目不存在"], canRelease: false, canForceRelease: false,
        };
      }
      const openP0P1 = await getOpenP0P1Count(input.projectId);
      const gate = await getReleaseGateStatus(project);
      const hasProduct = !!project.productId;

      const hardPass =
        hasProduct && openP0P1 === 0 &&
        gate.phaseId !== null && gate.deliverables.missing.length === 0 &&
        gate.decision !== null && gate.decision !== "rejected";

      const canRelease = hardPass && gate.decision === "approved";
      const canForceRelease = hardPass && gate.decision === "conditional" &&
        await isReleaseOverrideAuthorized(project, { id: ctx.user.id, role: ctx.user.role });

      const blockers: string[] = [];
      if (!hasProduct) blockers.push("未关联产品");
      if (openP0P1 > 0) blockers.push(`${openP0P1} 个未关闭的 P0/P1 问题`);
      if (gate.phaseId === null) blockers.push("未定义 MP Release 前置 Gate");
      if (gate.deliverables.missing.length > 0) blockers.push(`前置 Gate 交付物未齐（${gate.deliverables.done}/${gate.deliverables.total}）`);
      if (gate.decision === null) blockers.push("前置 Gate 无评审记录");
      else if (gate.decision === "rejected") blockers.push("前置 Gate 已驳回");
      else if (gate.decision === "conditional") blockers.push("前置 Gate 为有条件通过，需强制发布");

      return {
        hasProduct,
        productId: project.productId ?? null,
        openP0P1,
        releaseGate: gate.phaseId === null ? null : {
          phaseId: gate.phaseId, gateName: gate.gateName,
          decision: gate.decision, conditions: gate.conditions, roundNumber: gate.roundNumber,
        },
        deliverables: gate.deliverables,
        blockers, canRelease, canForceRelease,
      };
    }),
```

- [ ] **Step 3: 更新 `release` mutation 入参与调用**

把 `release` 的 input 与 `releaseProject` 调用改为：

```ts
  release: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      notes: z.string().optional(),
      override: z.object({
        overrideReason: z.string().min(1),
        followUpOwner: z.number(),
        dueDate: z.string().min(1),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const project = await getProjectById(input.projectId);
        const product = project?.productId ? await getProductById(project.productId) : undefined;
        const result = await releaseProject({
          projectId: input.projectId,
          actor: { id: ctx.user.id, role: ctx.user.role },
          notes: input.notes,
          override: input.override,
        });
        await emitAutomationEvent({
          action: "mp.release",
          projectId: input.projectId,
          entityType: "mp_release",
          entityId: `${input.projectId}:${result.revisionId}`,
          actorId: ctx.user.id,
          after: {
            projectId: input.projectId,
            productId: project?.productId ?? null,
            productName: product?.name ?? null,
            revisionId: result.revisionId,
            revisionLabel: result.revisionLabel,
          },
        });
        return result;
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
    }),
```

- [ ] **Step 4: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误（特别关注 `ctx.user.role` 类型、`releaseProject` 新签名调用处全部更新）。

> 若 `ctx.user` 可能为 null 触发类型错误：沿用本文件既有写法（既有代码已直接用 `ctx.user.id`，protectedProcedure 已保证非空）。

- [ ] **Step 5: 全量服务端测试**

Run: `npm test`
Expected: 全绿（含 `release.test.ts`、`release-gate.test.ts` 及既有用例）。

- [ ] **Step 6: Commit**

```bash
git add server/routers/products.ts
git commit -m "feat: releasePrecheck 扩展闸口返回 + release 传 actor/override"
```

---

## Task 6: `ReleaseDialog` 三态渲染 + 强制发布表单

**Files:**
- Modify: `client/src/components/views/ReleaseDialog.tsx`

> 该组件目前按旧 precheck（`hasProduct/openP0P1/canRelease`）渲染。需改为消费新返回结构。先读组件全文确认 props、mutation 调用、产品选择逻辑，再按下述契约改造。

- [ ] **Step 1: 读组件，定位 precheck 消费点与发布按钮**

Run: `sed -n '1,160p' client/src/components/views/ReleaseDialog.tsx`（仅阅读，不改）。确认：`releasePrecheck` 查询、发布按钮、产品选择 UI 的位置。

- [ ] **Step 2: 渲染新的 checklist + 三态**

按以下契约改造（保留既有产品选择/notes 逻辑）：

- 展示 4 项硬卡状态 + 前置 Gate 决议：
  - 已关联产品：`precheck.hasProduct`
  - P0/P1：`precheck.openP0P1 === 0`
  - 前置 Gate 交付物：`precheck.deliverables.missing.length === 0`（未齐时列出 `missing`）
  - 前置 Gate 决议：`precheck.releaseGate?.decision`（approved ✓ / conditional ⚠ / rejected ✗ / 无记录）
- 当 `precheck.blockers.length > 0`，在按钮上方列出 `precheck.blockers`。

- [ ] **Step 3: 三态按钮逻辑**

```tsx
// 伪代码示意，按本组件既有按钮样式落地
{precheck.canRelease ? (
  <button onClick={() => release.mutate({ projectId, notes })}>发布</button>
) : precheck.canForceRelease ? (
  // conditional 且当前用户有权：展开强制发布表单
  <ForceReleaseForm
    conditions={precheck.releaseGate?.conditions}
    onSubmit={(f) => release.mutate({
      projectId, notes,
      override: { overrideReason: f.overrideReason, followUpOwner: f.followUpOwner, dueDate: f.dueDate },
    })}
  />
) : (
  <button disabled title={precheck.blockers.join("；")}>不可发布</button>
)}
```

`ForceReleaseForm`：展示 `conditions` 只读、三项必填（`overrideReason` 文本、`followUpOwner` 选择项目成员、`dueDate` 日期），三项齐全才允许提交。conditional 但 `!canForceRelease` 的用户走 disabled 分支并提示「需 owner/PM/manager 强制发布」。

- [ ] **Step 4: 会签角色仅 advisory**

若组件展示了 `responsibleRoles`，保持纯展示，**不**参与按钮启用判断（Step 1 不做角色硬卡）。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: 浏览器验证（preview 工具）**

启动 dev server，打开一个 npd 项目的发布对话框，分别构造三态：approved（可发布）、conditional（有权→出强制表单 / 无权→禁用）、交付物未齐（禁用 + 列缺口）。用 `preview_snapshot` 确认文案与按钮态，`preview_screenshot` 留证。

- [ ] **Step 7: Commit**

```bash
git add client/src/components/views/ReleaseDialog.tsx
git commit -m "feat: ReleaseDialog 按闸口矩阵渲染普通/强制/禁用三态"
```

---

## 自检对照（spec → task 覆盖）

- spec §2 模板锚点 → Task 1 ✓
- spec §3 判定矩阵 + §3.1 最新记录 → Task 3（`getReleaseGateStatus`/`pickLatestReview`）+ Task 4（强制顺序）✓
- spec §4 授权口径 + admin break-glass → Task 3（`isReleaseOverrideAuthorized`）+ Task 4（conditional 分支）✓
- spec §5 数据模型（`isReleaseGate` + `mp_releases` 列）→ Task 1 + Task 2 ✓
- spec §6.1 releaseProject 校验顺序 → Task 4 ✓
- spec §6.2 releasePrecheck 返回 → Task 5 ✓
- spec §7 ReleaseDialog 三态 → Task 6 ✓
- spec §8 测试矩阵（三 category 命中 phase / 决议四态 / P0P1 / 交付物 / override 授权×未授权）→ Task 3 + Task 4 测试 ✓
- spec §9 不做项（会签表/钉钉/认证/冻结）→ 不在任何 Task，符合 ✓

> 备注：spec §8 提到「三种 category × getReleaseGatePhase 命中正确 phase」——Task 1 Step 4 脚本验证三 category；Task 3/4 的 release 路径用例以 npd 为代表（eco/idr 的 phase 命中已由 Task 1 覆盖，releaseProject 逻辑与 category 无关，仅依赖 `getReleaseGateStatus`）。如需 eco/idr 的端到端 release 用例，可在 Task 4 仿 npd 增补，但非必需。
