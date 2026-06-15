# 项目健康度自动判定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用进度/逾期/阻塞/P0P1/Gate就绪/目标日偏差自动算每个项目 RAG，并按可配频率（日/周）把异常项目推送给 PM 个人与管理群。

**Architecture:** 纯判定逻辑放 `shared/health.ts`（`computeRag` 短路取最严重 + `ragReasons` 不短路收集全部原因）；`server/automation/healthDigest.ts` 负责时点/去重判定、聚合、分组、分发；`server/db.ts` 提供全量活跃项目的健康聚合 `getPortfolioHealthForDigest(todayISO)`；digest 配置经 `digestRules.ts` 描述符接入现有自动化管理页（generic JSON 编辑），但 `runAutomation` 引擎不执行它。

**Tech Stack:** TypeScript, tRPC, Drizzle ORM (Postgres), Zod, Vitest。运行期 server 文件用相对路径 `"../shared/..."` import shared；测试用 `@shared/*` 别名。

**约定（每个 Task 通用）：**
- 类型检查：`pnpm check`（tsc --noEmit），期望 `0 errors`。
- 单测：`node scripts/test.mjs <文件路径>` 跑单个测试文件（脚本透传给 vitest）。若该命令不识别单文件参数，回退 `npx vitest run <文件路径>`。
- 阈值常量、字段名、函数名在后续 Task 中必须与前面 Task 定义保持完全一致。

---

## File Structure

- `shared/health.ts`（改）：`RagInput` 增 2 个可选字段；新增 `daysBetween`、`ragReasons`、阈值常量；`computeRag` 接入新信号。纯逻辑，无 IO。
- `server/automation/digestRules.ts`（新）：`healthDigestConfigSchema`、`DIGEST_RULES`、`DIGEST_RULE_KEYS`、`isDigestRuleKey`、`parseDigestRuleConfig`。纯声明。
- `server/db.ts`（改）：新增 `PortfolioHealthRow` 类型、`getPortfolioHealthForDigest(todayISO)`、`hasAutomationRunForEntity`。
- `server/automation/healthDigest.ts`（新）：纯时点/分组/消息 helper + `runHealthDigestScan(now, deps)` 编排（deps 可注入）。
- `server/automation/scheduler.ts`（改）：扫描末尾调一次 `runHealthDigestScan(now)`。
- `server/automation/engine.ts`（改）：`ensureAutomationRuleDefaults` 一并 seed `DIGEST_RULES`。
- `server/routers/automation.ts`（改）：`listRules`/`updateRule` 合入 digest 规则；`runAutomation` 不动。
- 测试：`server/health.test.ts`（扩）、`server/automation/digestRules.test.ts`（新）、`server/portfolio-health.test.ts`（新，集成 DB）、`server/automation/healthDigest.test.ts`（新，注入 deps，无 DB/网络）。

前端 `AutomationSettings.tsx` 用 generic JSON textarea 渲染 `rule.config`，无需改动；`RagHealthPanel.tsx` 因新字段为可选，调用处不变。

---

## Task 1: 增强 RAG 纯判定逻辑（`shared/health.ts`）

**Files:**
- Modify: `shared/health.ts`
- Test: `server/health.test.ts`

- [ ] **Step 1: 写失败测试（追加到 `server/health.test.ts` 现有 `describe` 之后）**

在文件末尾追加：

```ts
describe("computeRag 新信号", () => {
  it("目标日偏差 > 7 天 → red", () => {
    expect(computeRag({ ...base, projectedEnd: "2026-08-09", targetDate: "2026-08-01" })).toBe("red");
  });
  it("目标日偏差 1..7 天 → amber", () => {
    expect(computeRag({ ...base, projectedEnd: "2026-08-06", targetDate: "2026-08-01" })).toBe("amber");
  });
  it("目标日偏差 0 天 → green", () => {
    expect(computeRag({ ...base, projectedEnd: "2026-08-01", targetDate: "2026-08-01" })).toBe("green");
  });
  it("进度落后 > 20pt → red", () => {
    expect(computeRag({ ...base, progressBehindPct: 25 })).toBe("red");
  });
  it("进度落后 10..20pt → amber", () => {
    expect(computeRag({ ...base, progressBehindPct: 15 })).toBe("amber");
  });
  it("进度落后 < 10pt → green", () => {
    expect(computeRag({ ...base, progressBehindPct: 5 })).toBe("green");
  });
  it("进度 null → green（不误报）", () => {
    expect(computeRag({ ...base, progressBehindPct: null })).toBe("green");
  });
  it("gateNotReady red/amber", () => {
    expect(computeRag({ ...base, gateNotReady: "red" })).toBe("red");
    expect(computeRag({ ...base, gateNotReady: "amber" })).toBe("amber");
  });
});

describe("ragReasons 不短路", () => {
  it("多触发返回全部原因", () => {
    const r = ragReasons({
      ...base, risk: "high", overdueTasks: 2, criticalIssues: 1,
      projectedEnd: "2026-08-10", targetDate: "2026-08-01", progressBehindPct: 15, gateNotReady: "amber",
    });
    expect(r).toContain("风险:高");
    expect(r).toContain("逾期×2");
    expect(r).toContain("P0/P1×1");
    expect(r).toContain("预计晚9天");
    expect(r).toContain("进度落后15pt");
    expect(r.some((x) => x.startsWith("Gate"))).toBe(true);
  });
  it("绿项目返回空数组", () => {
    expect(ragReasons(base)).toEqual([]);
  });
});
```

并把测试顶部 import 改为同时引入 `ragReasons`：

```ts
import { computeRag, ragReasons, type RagInput } from "@shared/health";
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs server/health.test.ts`
Expected: FAIL（`ragReasons` 未导出 / 新字段不存在 / 断言不符）。

- [ ] **Step 3: 改写 `shared/health.ts` 全文**

```ts
/** 项目健康度等级。绿=正常，黄=需关注，红=需介入。 */
export type RagLevel = "green" | "amber" | "red";

/** computeRag 的输入：均来自上层聚合，避免依赖具体数据层类型。 */
export type RagInput = {
  risk: "low" | "medium" | "high";
  /** = max(task.dueDate)，当前计划结束日（非预测算法）。 */
  projectedEnd: string | null;
  targetDate: string | null;
  overdueTasks: number;
  blockedTasks: number;
  openIssues: number;
  /** P0/P1 未关闭问题数 */
  criticalIssues: number;
  /** 进度落后百分点；无计划项→null（不参与判定）。 */
  progressBehindPct?: number | null;
  /** Gate 临近未就绪等级；无→null。 */
  gateNotReady?: "red" | "amber" | null;
};

// 阈值（先写死，后续如需再做后台可配）
const SLIP_RED = 7; // 目标日偏差 > 7 天 → 红
const SLIP_AMBER = 1; // 1..7 天 → 黄
const PROGRESS_RED = 20; // 进度落后 > 20pt → 红
const PROGRESS_AMBER = 10; // 10..20pt → 黄

/** 两个 YYYY-MM-DD 相减得天数（toISO - fromISO，正=晚）；任一为空/非法→null。与时区无关。 */
export function daysBetween(fromISO: string | null, toISO: string | null): number | null {
  if (!fromISO || !toISO) return null;
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** 预计完成晚于目标日 → 视为超期。保留为工具函数供他处复用。 */
export function isProjectedOverdue(projectedEnd: string | null, targetDate: string | null): boolean {
  return !!(projectedEnd && targetDate && projectedEnd > targetDate);
}

/**
 * 计算项目 RAG。优先级从高到低短路：先判红，再判黄，否则绿。
 * 目标日偏差由 projectedEnd/targetDate 内部推导（targetSlipDays = projectedEnd - targetDate）。
 */
export function computeRag(input: RagInput): RagLevel {
  const slip = daysBetween(input.targetDate, input.projectedEnd);
  const behind = input.progressBehindPct;
  if (
    input.risk === "high" ||
    input.overdueTasks > 0 ||
    input.criticalIssues > 0 ||
    (slip !== null && slip > SLIP_RED) ||
    (behind != null && behind > PROGRESS_RED) ||
    input.gateNotReady === "red"
  ) {
    return "red";
  }
  if (
    input.risk === "medium" ||
    input.blockedTasks > 0 ||
    input.openIssues > 0 ||
    (slip !== null && slip >= SLIP_AMBER) ||
    (behind != null && behind >= PROGRESS_AMBER) ||
    input.gateNotReady === "amber"
  ) {
    return "amber";
  }
  return "green";
}

/**
 * 收集所有触发原因（不短路），供摘要解释「为什么红/黄」。绿项目返回空数组。
 * 与 computeRag 共用同一组阈值，避免漂移。
 */
export function ragReasons(input: RagInput): string[] {
  const reasons: string[] = [];
  if (input.risk === "high") reasons.push("风险:高");
  else if (input.risk === "medium") reasons.push("风险:中");
  if (input.overdueTasks > 0) reasons.push(`逾期×${input.overdueTasks}`);
  if (input.criticalIssues > 0) reasons.push(`P0/P1×${input.criticalIssues}`);
  if (input.blockedTasks > 0) reasons.push(`阻塞×${input.blockedTasks}`);
  if (input.openIssues > 0) reasons.push(`开放问题×${input.openIssues}`);
  const slip = daysBetween(input.targetDate, input.projectedEnd);
  if (slip !== null && slip >= SLIP_AMBER) reasons.push(`预计晚${slip}天`);
  if (input.progressBehindPct != null && input.progressBehindPct >= PROGRESS_AMBER) {
    reasons.push(`进度落后${Math.round(input.progressBehindPct)}pt`);
  }
  if (input.gateNotReady === "red") reasons.push("Gate未就绪(临近)");
  else if (input.gateNotReady === "amber") reasons.push("Gate未就绪");
  return reasons;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test.mjs server/health.test.ts`
Expected: PASS（含原有 9 个 + 新增用例）。

- [ ] **Step 5: 类型检查**

Run: `pnpm check`
Expected: `0 errors`（`RagHealthPanel.tsx` 因新字段可选仍可编译）。

- [ ] **Step 6: 提交**

```bash
git add shared/health.ts server/health.test.ts
git commit -m "feat(health): RAG 增进度/Gate/目标日偏差信号 + ragReasons 全量原因"
```

---

## Task 2: digest 规则描述符（`server/automation/digestRules.ts`）

**Files:**
- Create: `server/automation/digestRules.ts`
- Test: `server/automation/digestRules.test.ts`

- [ ] **Step 1: 写失败测试**

`server/automation/digestRules.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import {
  DIGEST_RULE_KEYS, DIGEST_RULES, healthDigestConfigSchema,
  isDigestRuleKey, parseDigestRuleConfig,
} from "./digestRules";

describe("digestRules", () => {
  it("默认配置", () => {
    const c = healthDigestConfigSchema.parse({});
    expect(c).toEqual({ cadence: "daily", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true });
  });
  it("DIGEST_RULES 含 health_digest 且默认关闭", () => {
    const r = DIGEST_RULES.find((x) => x.key === "health_digest");
    expect(r?.defaultEnabled).toBe(false);
    expect(r?.triggerType).toBe("digest");
  });
  it("isDigestRuleKey", () => {
    expect(isDigestRuleKey("health_digest")).toBe(true);
    expect(isDigestRuleKey("overdue_reminder")).toBe(false);
  });
  it("parseDigestRuleConfig 合并部分配置", () => {
    const c = parseDigestRuleConfig("health_digest", { cadence: "weekly", sendHour: 8 });
    expect(c.cadence).toBe("weekly");
    expect(c.sendHour).toBe(8);
    expect(c.weekday).toBe(1);
  });
  it("DIGEST_RULE_KEYS 只含 health_digest", () => {
    expect([...DIGEST_RULE_KEYS]).toEqual(["health_digest"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs server/automation/digestRules.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

`server/automation/digestRules.ts`：

```ts
import { z } from "zod";

export const DIGEST_RULE_KEYS = ["health_digest"] as const;
export type DigestRuleKey = (typeof DIGEST_RULE_KEYS)[number];

export const healthDigestConfigSchema = z.object({
  cadence: z.enum(["daily", "weekly"]).default("daily"),
  sendHour: z.number().int().min(0).max(23).default(9), // Asia/Shanghai
  weekday: z.number().int().min(1).max(7).default(1), // ISO: 1=周一（cadence=weekly 生效）
  pushPmPersonal: z.boolean().default(true),
  pushManagerGroup: z.boolean().default(true),
});
export type HealthDigestConfig = z.infer<typeof healthDigestConfigSchema>;

export const DIGEST_RULES = [
  {
    key: "health_digest",
    label: "健康度摘要推送",
    triggerType: "digest", // 标记：不进 runAutomation
    defaultEnabled: false, // 默认关，配好 webhook/钉钉再开
    defaultConfig: healthDigestConfigSchema.parse({}),
    configSchema: healthDigestConfigSchema,
  },
] as const;

export function isDigestRuleKey(key: string): key is DigestRuleKey {
  return (DIGEST_RULE_KEYS as readonly string[]).includes(key);
}

export function parseDigestRuleConfig(key: DigestRuleKey, config: unknown): HealthDigestConfig {
  if (key !== "health_digest") throw new Error(`Unknown digest rule: ${key}`);
  const base = healthDigestConfigSchema.parse({});
  const overrides = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  return healthDigestConfigSchema.parse({ ...base, ...overrides });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test.mjs server/automation/digestRules.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/automation/digestRules.ts server/automation/digestRules.test.ts
git commit -m "feat(automation): health_digest 配置型规则描述符"
```

---

## Task 3: 全量项目健康聚合 + 当期 run 去重（`server/db.ts`）

**Files:**
- Modify: `server/db.ts`
- Test: `server/portfolio-health.test.ts`（集成，需 DB；遵循 `server/assign-by-role.test.ts` 清理模式）

- [ ] **Step 1: 写失败测试**

`server/portfolio-health.test.ts`：

```ts
import { describe, it, expect, afterAll } from "vitest";
import {
  getDb, getPortfolioHealthForDigest, hasAutomationRunForEntity,
  upsertProjectTask, createAutomationRun,
} from "./db";
import { projects, projectTasks, automationRuns } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `pf-health-${Date.now()}`;
const TODAY = "2026-06-16";

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(automationRuns).where(eq(automationRuns.ruleKey, "health_digest_test"));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("getPortfolioHealthForDigest", () => {
  it("聚合活跃项目的进度信号（分母=有计划日期的任务）", async () => {
    const db = await getDb();
    if (!db) return; // 无 DB 环境跳过
    await db.insert(projects).values({
      id: PROJ, name: "健康聚合测试", projectNumber: PROJ, category: "npd",
      risk: "low", currentPhase: "concept", archived: false, createdBy: 1,
    }).onConflictDoNothing();
    // 3 个有计划日期：2 个已过期(到今天应完成)，其中 1 个已 done；1 个无 dueDate(不计入分母)
    await upsertProjectTask(PROJ, "concept", "c1", { dueDate: "2026-06-10", status: "done" });
    await upsertProjectTask(PROJ, "concept", "c2", { dueDate: "2026-06-12", status: "in_progress" });
    await upsertProjectTask(PROJ, "concept", "c3", { dueDate: "2026-06-30", status: "in_progress" });
    await upsertProjectTask(PROJ, "concept", "c4", { dueDate: null, status: "in_progress" });

    const rows = await getPortfolioHealthForDigest(TODAY);
    const row = rows.find((r) => r.id === PROJ);
    expect(row).toBeDefined();
    expect(row!.plannedItems).toBe(3); // c1,c2,c3 有 dueDate
    expect(row!.dueItems).toBe(2); // c1,c2 <= today
    expect(row!.donePlannedItems).toBe(1); // c1 done
    expect(row!.plannedEnd).toBe("2026-06-30");
    expect(row!.overdueTasks).toBe(1); // c2 过期未完成（c1 已 done 不算）
  });

  it("hasAutomationRunForEntity 任意状态都算", async () => {
    const db = await getDb();
    if (!db) return;
    await createAutomationRun({
      ruleKey: "health_digest_test", projectId: null, eventType: "scheduled",
      entityType: "portfolio", entityId: "d:2026-06-16", status: "skipped", recipients: [], detail: "t",
    });
    expect(await hasAutomationRunForEntity({ ruleKey: "health_digest_test", entityId: "d:2026-06-16" })).toBe(true);
    expect(await hasAutomationRunForEntity({ ruleKey: "health_digest_test", entityId: "d:2099-01-01" })).toBe(false);
  });
});
```

> 注：`createProject`/`upsertProjectTask` 的精确签名实现时以 `server/db.ts` 为准；若 `createProject` 需更多必填字段，按 `server/assign-by-role.test.ts` 与 db 中 `projects` 插入用法补齐。`upsertProjectTask(projectId, phaseId, taskId, patch)` 已在 assign-by-role 测试中使用。

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs server/portfolio-health.test.ts`
Expected: FAIL（`getPortfolioHealthForDigest` / `hasAutomationRunForEntity` 未导出）。

- [ ] **Step 3: 在 `server/db.ts` 顶部 import 区加入 `daysBetween`**

找到现有 `import { getPhasesForCategory } from "../shared/sop-templates";` 一行，其下新增：

```ts
import { daysBetween } from "../shared/health";
```

- [ ] **Step 4: 在 `server/db.ts` 的 `getPortfolio` 函数定义之后，新增类型与函数**

```ts
/** digest 用：全量活跃项目的健康聚合（不依赖用户视角）。SQL 一律用传入 todayISO。 */
export type PortfolioHealthRow = {
  id: string; name: string; projectNumber: string; category: string; risk: string;
  currentPhase: string; targetDate: string | null; pmUserId: number | null; pmName: string | null;
  overdueTasks: number; blockedTasks: number; openIssues: number; criticalIssues: number;
  plannedEnd: string | null;          // = max(task.dueDate)，当前计划结束日
  plannedItems: number;               // 有 dueDate 的任务数（进度落后分母）
  dueItems: number;                   // dueDate <= todayISO
  donePlannedItems: number;           // 有 dueDate 且 done/skipped
  gateNotReady: "red" | "amber" | null;
};

export async function getPortfolioHealthForDigest(todayISO: string): Promise<PortfolioHealthRow[]> {
  const db = await getDb();
  if (!db) return [];
  const projRows = await db.select().from(projects).where(eq(projects.archived, false));
  if (projRows.length === 0) return [];
  const ids = projRows.map((p) => p.id);

  const taskAgg = await db.select({
    projectId: projectTasks.projectId,
    overdue: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null and ${projectTasks.dueDate} < ${todayISO} and ${projectTasks.status} not in ('done','skipped'))::int`,
    blocked: drizzleSql<number>`count(*) filter (where ${projectTasks.status} = 'blocked')::int`,
    plannedItems: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null)::int`,
    dueItems: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null and ${projectTasks.dueDate} <= ${todayISO})::int`,
    donePlannedItems: drizzleSql<number>`count(*) filter (where ${projectTasks.dueDate} is not null and ${projectTasks.status} in ('done','skipped'))::int`,
    plannedEnd: drizzleSql<string | null>`max(${projectTasks.dueDate})::text`,
  }).from(projectTasks).where(inArray(projectTasks.projectId, ids)).groupBy(projectTasks.projectId);

  const issueAgg = await db.select({
    projectId: projectIssues.projectId,
    open: drizzleSql<number>`count(*) filter (where ${projectIssues.status} in ('open','in_progress'))::int`,
    critical: drizzleSql<number>`count(*) filter (where ${projectIssues.status} in ('open','in_progress') and ${projectIssues.severity} in ('P0','P1'))::int`,
  }).from(projectIssues).where(inArray(projectIssues.projectId, ids)).groupBy(projectIssues.projectId);

  // Gate 就绪：复用 getAutomationGatePrereqs（已限 archived=false），按项目取最严重；含已过期(负数)。
  const gateRows = await getAutomationGatePrereqs();
  const idSet = new Set(ids);
  const gateByProject = new Map<string, "red" | "amber">();
  for (const g of gateRows) {
    if (!idSet.has(g.projectId) || !g.dueDate) continue;
    const d = daysBetween(todayISO, g.dueDate); // 正=未来，负=已过期
    if (d === null) continue;
    const level: "red" | "amber" | null = d <= 3 ? "red" : d <= 7 ? "amber" : null;
    if (level === null) continue;
    if (gateByProject.get(g.projectId) === "red") continue;
    if (level === "red" || !gateByProject.has(g.projectId)) gateByProject.set(g.projectId, level);
  }

  const pmIds = Array.from(new Set(projRows.map((p) => p.pmUserId).filter((x): x is number => !!x)));
  const pmRows = pmIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, pmIds)) : [];
  const pmName = new Map(pmRows.map((r) => [r.id, r.name]));
  const taskMap = new Map(taskAgg.map((t) => [t.projectId, t]));
  const issueMap = new Map(issueAgg.map((i) => [i.projectId, i]));

  return projRows.map((p) => {
    const t = taskMap.get(p.id);
    const i = issueMap.get(p.id);
    return {
      id: p.id, name: p.name, projectNumber: p.projectNumber, category: p.category, risk: p.risk,
      currentPhase: p.currentPhase, targetDate: p.targetDate, pmUserId: p.pmUserId ?? null,
      pmName: p.pmUserId ? (pmName.get(p.pmUserId) ?? null) : null,
      overdueTasks: t?.overdue ?? 0, blockedTasks: t?.blocked ?? 0,
      openIssues: i?.open ?? 0, criticalIssues: i?.critical ?? 0,
      plannedEnd: t?.plannedEnd ?? null,
      plannedItems: t?.plannedItems ?? 0, dueItems: t?.dueItems ?? 0, donePlannedItems: t?.donePlannedItems ?? 0,
      gateNotReady: gateByProject.get(p.id) ?? null,
    };
  });
}

/** digest 当期去重：某 ruleKey+entityId(periodKey) 是否已有任意状态的 run（fired 或 skipped 都算已处理）。 */
export async function hasAutomationRunForEntity(input: { ruleKey: string; entityId: string }): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: automationRuns.id }).from(automationRuns)
    .where(and(eq(automationRuns.ruleKey, input.ruleKey), eq(automationRuns.entityId, input.entityId)))
    .limit(1);
  return rows.length > 0;
}
```

> 实现注意：`getPortfolioHealthForDigest` 必须定义在 `getAutomationGatePrereqs` 之后（或同文件任意位置——JS 函数提升使顺序不影响调用）；`drizzleSql`、`inArray`、`and`、`eq`、`projects`、`projectTasks`、`projectIssues`、`users`、`automationRuns` 在 `db.ts` 顶部均已 import（与 `getPortfolio` 一致）。

- [ ] **Step 5: 跑测试确认通过**

Run: `node scripts/test.mjs server/portfolio-health.test.ts`
Expected: PASS（有 DB 时断言成立；无 DB 时 `if (!db) return` 跳过仍算通过）。

- [ ] **Step 6: 类型检查**

Run: `pnpm check`
Expected: `0 errors`。

- [ ] **Step 7: 提交**

```bash
git add server/db.ts server/portfolio-health.test.ts
git commit -m "feat(db): getPortfolioHealthForDigest 全量项目健康聚合 + 当期 run 去重"
```

---

## Task 4: healthDigest 纯逻辑 helper（`server/automation/healthDigest.ts` 第一部分）

**Files:**
- Create: `server/automation/healthDigest.ts`
- Test: `server/automation/healthDigest.test.ts`

本 Task 只建文件 + 导出纯 helper（时点、聚分组、消息）；编排函数在 Task 5。

- [ ] **Step 1: 写失败测试**

`server/automation/healthDigest.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import {
  shanghaiParts, addDaysISO, isoWeekdayOf, computeDigestTiming,
  scorePortfolio, groupByPm, buildPmMarkdown, buildGroupMarkdown,
} from "./healthDigest";
import type { PortfolioHealthRow } from "../db";

function row(over: Partial<PortfolioHealthRow>): PortfolioHealthRow {
  return {
    id: "p1", name: "项目1", projectNumber: "NPD-001", category: "npd", risk: "low",
    currentPhase: "concept", targetDate: null, pmUserId: 1, pmName: "张三",
    overdueTasks: 0, blockedTasks: 0, openIssues: 0, criticalIssues: 0,
    plannedEnd: null, plannedItems: 0, dueItems: 0, donePlannedItems: 0, gateNotReady: null, ...over,
  };
}

describe("时点/日期 helper", () => {
  it("addDaysISO", () => {
    expect(addDaysISO("2026-06-16", 0)).toBe("2026-06-16");
    expect(addDaysISO("2026-06-16", -1)).toBe("2026-06-15");
    expect(addDaysISO("2026-06-30", 1)).toBe("2026-07-01");
  });
  it("isoWeekdayOf（2026-06-16 是周二=2）", () => {
    expect(isoWeekdayOf("2026-06-16")).toBe(2);
  });
  it("shanghaiParts 用 UTC 22:00 → 上海次日 06:00", () => {
    const p = shanghaiParts(new Date("2026-06-15T22:00:00Z"));
    expect(p.todayISO).toBe("2026-06-16");
    expect(p.hour).toBe(6);
  });
  it("daily 到点：上海 09:xx → reached", () => {
    const t = computeDigestTiming(new Date("2026-06-16T01:30:00Z"), { cadence: "daily", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true });
    expect(t.periodKey).toBe("d:2026-06-16");
    expect(t.reached).toBe(true); // 上海 09:30
  });
  it("daily 未到点：上海 08:xx → not reached", () => {
    const t = computeDigestTiming(new Date("2026-06-16T00:00:00Z"), { cadence: "daily", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true });
    expect(t.reached).toBe(false); // 上海 08:00
  });
  it("weekly periodKey 为本周目标weekday日期；过点可补发", () => {
    // 2026-06-16 周二；weekday=1(周一) → 本周一 2026-06-15，已过 → reached
    const t = computeDigestTiming(new Date("2026-06-16T02:00:00Z"), { cadence: "weekly", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true });
    expect(t.periodKey).toBe("w:2026-06-15");
    expect(t.reached).toBe(true);
  });
  it("weekly 目标日在未来 → not reached", () => {
    // 周二，weekday=5(周五) → 本周五 2026-06-19 未到
    const t = computeDigestTiming(new Date("2026-06-16T02:00:00Z"), { cadence: "weekly", sendHour: 9, weekday: 5, pushPmPersonal: true, pushManagerGroup: true });
    expect(t.periodKey).toBe("w:2026-06-19");
    expect(t.reached).toBe(false);
  });
});

describe("评分/分组/消息", () => {
  it("scorePortfolio 过滤绿、红在前、计绿数", () => {
    const rows = [
      row({ id: "g", risk: "low" }), // green
      row({ id: "a", blockedTasks: 1 }), // amber
      row({ id: "r", overdueTasks: 2 }), // red
    ];
    const { abnormal, greenCount } = scorePortfolio(rows);
    expect(greenCount).toBe(1);
    expect(abnormal.map((s) => s.row.id)).toEqual(["r", "a"]);
    expect(abnormal[0].reasons).toContain("逾期×2");
  });
  it("groupByPm 跳过无 PM", () => {
    const { abnormal } = scorePortfolio([
      row({ id: "r1", pmUserId: 1, overdueTasks: 1 }),
      row({ id: "r2", pmUserId: 2, blockedTasks: 1 }),
      row({ id: "r3", pmUserId: null, overdueTasks: 1 }),
    ]);
    const g = groupByPm(abnormal);
    expect(g.get(1)?.length).toBe(1);
    expect(g.get(2)?.length).toBe(1);
    expect([...g.keys()].sort()).toEqual([1, 2]);
  });
  it("buildPmMarkdown / buildGroupMarkdown 含项目名与计数", () => {
    const { abnormal, greenCount } = scorePortfolio([
      row({ id: "r", name: "充气泵", overdueTasks: 1 }),
      row({ id: "g", risk: "low" }),
    ]);
    const pm = buildPmMarkdown(abnormal, "daily");
    expect(pm.title).toBe("项目健康日报");
    expect(pm.markdown).toContain("充气泵");
    const grp = buildGroupMarkdown(abnormal, greenCount, "weekly");
    expect(grp.title).toContain("周报");
    expect(grp.text).toContain("绿 1");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs server/automation/healthDigest.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 `server/automation/healthDigest.ts`（helper 部分）**

```ts
import { computeRag, ragReasons, type RagInput, type RagLevel } from "../../shared/health";
import { ENV } from "../_core/env";
import type { PortfolioHealthRow } from "../db";
import type { HealthDigestConfig } from "./digestRules";

// ── 日期/时区（统一 Asia/Shanghai）─────────────────────────────────────────
export function isoWeekdayOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d; // ISO: 周一=1 .. 周日=7
}

export function addDaysISO(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function shanghaiParts(now: Date): { todayISO: string; hour: number; isoWeekday: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  });
  const m: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) m[p.type] = p.value;
  const todayISO = `${m.year}-${m.month}-${m.day}`;
  const hour = Number(m.hour) % 24; // en-CA 在午夜可能给 "24"
  return { todayISO, hour, isoWeekday: isoWeekdayOf(todayISO) };
}

/** 本期标识 + 是否已到计划发送时点（支持服务晚启动补发：过点且本期无 run 即发）。 */
export function computeDigestTiming(now: Date, config: HealthDigestConfig): { periodKey: string; reached: boolean } {
  const { todayISO, hour, isoWeekday } = shanghaiParts(now);
  if (config.cadence === "weekly") {
    const sendDayISO = addDaysISO(todayISO, config.weekday - isoWeekday); // 本 ISO 周的目标 weekday 日期
    const reached = todayISO > sendDayISO || (todayISO === sendDayISO && hour >= config.sendHour);
    return { periodKey: `w:${sendDayISO}`, reached };
  }
  return { periodKey: `d:${todayISO}`, reached: hour >= config.sendHour };
}

// ── 评分 / 分组 ───────────────────────────────────────────────────────────
export type ScoredProject = { row: PortfolioHealthRow; level: RagLevel; reasons: string[] };

function progressBehind(row: PortfolioHealthRow): number | null {
  if (row.plannedItems <= 0) return null;
  return Math.max(0, ((row.dueItems - row.donePlannedItems) / row.plannedItems) * 100);
}

function rowToRagInput(row: PortfolioHealthRow): RagInput {
  return {
    risk: (["low", "medium", "high"].includes(row.risk) ? row.risk : "low") as RagInput["risk"],
    projectedEnd: row.plannedEnd,
    targetDate: row.targetDate,
    overdueTasks: row.overdueTasks,
    blockedTasks: row.blockedTasks,
    openIssues: row.openIssues,
    criticalIssues: row.criticalIssues,
    progressBehindPct: progressBehind(row),
    gateNotReady: row.gateNotReady,
  };
}

/** 算每项目 RAG，过滤出黄/红（红在前），并返回绿色计数。 */
export function scorePortfolio(rows: PortfolioHealthRow[]): { abnormal: ScoredProject[]; greenCount: number } {
  const abnormal: ScoredProject[] = [];
  let greenCount = 0;
  for (const row of rows) {
    const input = rowToRagInput(row);
    const level = computeRag(input);
    if (level === "green") { greenCount += 1; continue; }
    abnormal.push({ row, level, reasons: ragReasons(input) });
  }
  abnormal.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  return { abnormal, greenCount };
}

export function groupByPm(abnormal: ScoredProject[]): Map<number, ScoredProject[]> {
  const map = new Map<number, ScoredProject[]>();
  for (const s of abnormal) {
    if (s.row.pmUserId == null) continue;
    const arr = map.get(s.row.pmUserId) ?? [];
    arr.push(s);
    map.set(s.row.pmUserId, arr);
  }
  return map;
}

// ── 消息 ─────────────────────────────────────────────────────────────────
const EMOJI: Record<RagLevel, string> = { red: "🔴", amber: "🟡", green: "🟢" };

function projectLine(s: ScoredProject): string {
  return `- ${EMOJI[s.level]} **${s.row.name}**（${s.row.projectNumber}）：${s.reasons.join("、") || "需关注"}`;
}

function appLink(): string {
  return ENV.appBaseUrl ? `\n\n[打开 CE Project Hub](${ENV.appBaseUrl}/)` : "";
}

export function buildPmMarkdown(scored: ScoredProject[], cadence: "daily" | "weekly"): { title: string; markdown: string } {
  const title = cadence === "weekly" ? "项目健康周报" : "项目健康日报";
  const body = scored.map(projectLine).join("\n");
  return { title, markdown: `#### ${title}\n你负责的 ${scored.length} 个项目需关注：\n${body}${appLink()}` };
}

export function buildGroupMarkdown(
  abnormal: ScoredProject[], greenCount: number, cadence: "daily" | "weekly"
): { title: string; markdown: string; text: string } {
  const title = cadence === "weekly" ? "项目健康周报（全部）" : "项目健康日报（全部）";
  const red = abnormal.filter((s) => s.level === "red").length;
  const amber = abnormal.length - red;
  const body = abnormal.map(projectLine).join("\n");
  const text = `健康摘要：红 ${red} / 黄 ${amber} / 绿 ${greenCount}`;
  return { title, text, markdown: `#### ${title}\n🔴 ${red} · 🟡 ${amber} · 🟢 ${greenCount}\n${body}${appLink()}` };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test.mjs server/automation/healthDigest.test.ts`
Expected: PASS。

- [ ] **Step 5: 类型检查**

Run: `pnpm check`
Expected: `0 errors`。

- [ ] **Step 6: 提交**

```bash
git add server/automation/healthDigest.ts server/automation/healthDigest.test.ts
git commit -m "feat(automation): healthDigest 纯逻辑（时点/评分/分组/消息）"
```

---

## Task 5: digest 编排 `runHealthDigestScan`（`healthDigest.ts` 第二部分）

**Files:**
- Modify: `server/automation/healthDigest.ts`（追加编排函数）
- Test: `server/automation/healthDigest.test.ts`（追加注入 deps 的用例）

- [ ] **Step 1: 追加失败测试（到 `healthDigest.test.ts` 末尾）**

文件顶部 import 增加 `runHealthDigestScan`：

```ts
import {
  shanghaiParts, addDaysISO, isoWeekdayOf, computeDigestTiming,
  scorePortfolio, groupByPm, buildPmMarkdown, buildGroupMarkdown,
  runHealthDigestScan,
} from "./healthDigest";
import type { PortfolioHealthRow } from "../db";
import type { HealthDigestConfig } from "./digestRules";
```

末尾追加：

```ts
describe("runHealthDigestScan（注入 deps）", () => {
  const NOW = new Date("2026-06-16T02:00:00Z"); // 上海 10:00
  const cfg: HealthDigestConfig = { cadence: "daily", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true };

  function makeDeps(over: Partial<Parameters<typeof runHealthDigestScan>[1]> & { rows?: PortfolioHealthRow[] } = {}) {
    const calls = { notify: [] as number[][], notifications: [] as number[], group: 0, runs: [] as Array<{ status: string; key: string }> };
    const deps = {
      getConfigRow: async () => ({ enabled: true, config: cfg }),
      getHealth: async (_today: string) => over.rows ?? [row({ id: "r", overdueTasks: 1, pmUserId: 7 })],
      hasRun: async () => false,
      writeRun: async (status: "fired" | "skipped", key: string) => { calls.runs.push({ status, key }); },
      createNotification: async (n: { userId: number }) => { calls.notifications.push(n.userId); },
      notifyDingtalk: async (ids: number[]) => { calls.notify.push(ids); },
      pushWebhook: async () => { calls.group += 1; },
      ...over,
    };
    return { deps, calls };
  }

  it("正常：PM 个人 + 管理群 + 写 fired", async () => {
    const { deps, calls } = makeDeps();
    await runHealthDigestScan(NOW, deps);
    expect(calls.notifications).toEqual([7]);
    expect(calls.notify).toEqual([[7]]);
    expect(calls.group).toBe(1);
    expect(calls.runs).toEqual([{ status: "fired", key: "d:2026-06-16" }]);
  });

  it("enabled=false 不发", async () => {
    const { deps, calls } = makeDeps({ getConfigRow: async () => ({ enabled: false, config: cfg }) });
    await runHealthDigestScan(NOW, deps);
    expect(calls.runs).toEqual([]);
    expect(calls.group).toBe(0);
  });

  it("未到点不发", async () => {
    const { deps, calls } = makeDeps();
    await runHealthDigestScan(new Date("2026-06-16T00:00:00Z"), deps); // 上海 08:00
    expect(calls.runs).toEqual([]);
  });

  it("当期已有 run → 不重复", async () => {
    const { deps, calls } = makeDeps({ hasRun: async () => true });
    await runHealthDigestScan(NOW, deps);
    expect(calls.runs).toEqual([]);
    expect(calls.group).toBe(0);
  });

  it("无异常 → skipped 不发消息", async () => {
    const { deps, calls } = makeDeps({ rows: [row({ id: "g", risk: "low" })] });
    await runHealthDigestScan(NOW, deps);
    expect(calls.runs).toEqual([{ status: "skipped", key: "d:2026-06-16" }]);
    expect(calls.notifications).toEqual([]);
    expect(calls.group).toBe(0);
  });

  it("pushPmPersonal=false 只发群", async () => {
    const { deps, calls } = makeDeps({ getConfigRow: async () => ({ enabled: true, config: { ...cfg, pushPmPersonal: false } }) });
    await runHealthDigestScan(NOW, deps);
    expect(calls.notifications).toEqual([]);
    expect(calls.group).toBe(1);
    expect(calls.runs[0].status).toBe("fired");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test.mjs server/automation/healthDigest.test.ts`
Expected: FAIL（`runHealthDigestScan` 未导出）。

- [ ] **Step 3: 在 `healthDigest.ts` 顶部补 import，并在文件末尾追加编排函数**

顶部 import 区改为（新增 db 与 notify 依赖、digest 解析）：

```ts
import { computeRag, ragReasons, type RagInput, type RagLevel } from "../../shared/health";
import { ENV } from "../_core/env";
import { pushWebhook as defaultPushWebhook } from "../_core/notify";
import { notifyUsersViaDingtalk as defaultNotifyDingtalk } from "../_core/dingtalkMessage";
import {
  createNotification as defaultCreateNotification,
  createAutomationRun,
  hasAutomationRunForEntity,
  listAutomationRuleRows,
  getPortfolioHealthForDigest as defaultGetHealth,
  type PortfolioHealthRow,
} from "../db";
import { parseDigestRuleConfig, type HealthDigestConfig } from "./digestRules";
```

文件末尾追加：

```ts
// ── 编排 ─────────────────────────────────────────────────────────────────
export type HealthDigestDeps = {
  getConfigRow?: () => Promise<{ enabled: boolean; config: HealthDigestConfig } | null>;
  getHealth?: (todayISO: string) => Promise<PortfolioHealthRow[]>;
  hasRun?: (periodKey: string) => Promise<boolean>;
  writeRun?: (status: "fired" | "skipped", periodKey: string, detail: string) => Promise<void>;
  createNotification?: typeof defaultCreateNotification;
  notifyDingtalk?: (userIds: number[], title: string, markdown: string) => Promise<void>;
  pushWebhook?: typeof defaultPushWebhook;
};

async function defaultGetConfigRow(): Promise<{ enabled: boolean; config: HealthDigestConfig } | null> {
  const rows = await listAutomationRuleRows();
  const row = rows.find((r) => r.ruleKey === "health_digest");
  if (!row) return null;
  return { enabled: row.enabled, config: parseDigestRuleConfig("health_digest", row.config) };
}

/**
 * 健康摘要扫描：被 scheduler 每个 interval 调一次。
 * 到点 + 当期无 run 才处理；异常为空写 skipped 不发；否则 PM 个人 + 管理群分发后写 fired。
 */
export async function runHealthDigestScan(now: Date, deps: HealthDigestDeps = {}): Promise<void> {
  const getConfigRow = deps.getConfigRow ?? defaultGetConfigRow;
  const cfgRow = await getConfigRow();
  if (!cfgRow || !cfgRow.enabled) return;
  const config = cfgRow.config;

  const { periodKey, reached } = computeDigestTiming(now, config);
  if (!reached) return;

  const hasRun = deps.hasRun ?? ((pk: string) => hasAutomationRunForEntity({ ruleKey: "health_digest", entityId: pk }));
  if (await hasRun(periodKey)) return;

  const writeRun = deps.writeRun ?? ((status: "fired" | "skipped", pk: string, detail: string) =>
    createAutomationRun({
      ruleKey: "health_digest", projectId: null, eventType: "scheduled", entityType: "portfolio",
      entityId: pk, status, recipients: [], detail: detail.slice(0, 1000),
    }));

  const { todayISO } = shanghaiParts(now);
  const getHealth = deps.getHealth ?? defaultGetHealth;
  const rows = await getHealth(todayISO);
  const { abnormal, greenCount } = scorePortfolio(rows);

  if (abnormal.length === 0) {
    await writeRun("skipped", periodKey, `no abnormal (green ${greenCount})`);
    return;
  }

  const createNotification = deps.createNotification ?? defaultCreateNotification;
  const notifyDingtalk = deps.notifyDingtalk ?? defaultNotifyDingtalk;
  const pushWebhook = deps.pushWebhook ?? defaultPushWebhook;

  if (config.pushPmPersonal) {
    for (const [pmUserId, scored] of groupByPm(abnormal)) {
      const { title, markdown } = buildPmMarkdown(scored, config.cadence);
      await createNotification({
        userId: pmUserId, type: "automation", title,
        body: `${scored.length} 个项目需关注`, entityType: "portfolio", entityId: periodKey,
      });
      await notifyDingtalk([pmUserId], title, markdown);
    }
  }

  if (config.pushManagerGroup) {
    const { title, markdown, text } = buildGroupMarkdown(abnormal, greenCount, config.cadence);
    await pushWebhook(text, { title, markdown });
  }

  const red = abnormal.filter((s) => s.level === "red").length;
  await writeRun("fired", periodKey, `red ${red} amber ${abnormal.length - red} green ${greenCount}`);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test.mjs server/automation/healthDigest.test.ts`
Expected: PASS（含 Task 4 helper 用例 + 本 Task 编排用例）。

- [ ] **Step 5: 类型检查**

Run: `pnpm check`
Expected: `0 errors`。

- [ ] **Step 6: 提交**

```bash
git add server/automation/healthDigest.ts server/automation/healthDigest.test.ts
git commit -m "feat(automation): runHealthDigestScan 编排（到点/去重/分发/补发）"
```

---

## Task 6: 接线（scheduler + engine seed + automation router）

**Files:**
- Modify: `server/automation/scheduler.ts`
- Modify: `server/automation/engine.ts`
- Modify: `server/routers/automation.ts`

- [ ] **Step 1: scheduler 调用 digest 扫描**

`server/automation/scheduler.ts`：顶部 import 增加：

```ts
import { runHealthDigestScan } from "./healthDigest";
```

在 `runScheduledAutomationScan` 函数体最末尾（gate 循环之后）追加：

```ts
  // 健康度摘要（聚合型，自带到点/去重；失败不影响其他扫描）
  try {
    await runHealthDigestScan(now);
  } catch (error) {
    console.warn("[automation] health digest failed (non-fatal):", error);
  }
```

- [ ] **Step 2: engine seed 包含 digest 规则**

`server/automation/engine.ts`：顶部 import 增加：

```ts
import { DIGEST_RULES } from "./digestRules";
```

把 `ensureAutomationRuleDefaults` 里的 `seedAutomationRuleDefaults([...])` 调用改为：

```ts
  await seedAutomationRuleDefaults([
    ...AUTOMATION_RULES.map((rule) => ({
      ruleKey: rule.key,
      enabled: rule.defaultEnabled,
      config: toConfigRecord(rule.defaultConfig),
    })),
    ...DIGEST_RULES.map((rule) => ({
      ruleKey: rule.key,
      enabled: rule.defaultEnabled,
      config: { ...rule.defaultConfig } as Record<string, unknown>,
    })),
  ]);
```

- [ ] **Step 3: automation router 暴露 digest 规则**

`server/routers/automation.ts`：import 区增加：

```ts
import { DIGEST_RULES, DIGEST_RULE_KEYS, isDigestRuleKey, parseDigestRuleConfig } from "../automation/digestRules";
```

`listRules` 的 `return AUTOMATION_RULES.map(...)` 改为先存变量再拼接 digest：

```ts
    const builtIn = AUTOMATION_RULES.map((rule) => {
      const row = rowByKey.get(rule.key);
      return {
        key: rule.key as string,
        label: rule.label,
        triggerType: rule.triggerType as string,
        defaultEnabled: rule.defaultEnabled,
        enabled: row?.enabled ?? rule.defaultEnabled,
        config: parseAutomationRuleConfig(rule.key, row?.config ?? rule.defaultConfig) as Record<string, unknown>,
        recipientRoles: rule.recipientRoles as readonly string[],
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    });
    const digest = DIGEST_RULES.map((rule) => {
      const row = rowByKey.get(rule.key);
      return {
        key: rule.key as string,
        label: rule.label,
        triggerType: rule.triggerType as string,
        defaultEnabled: rule.defaultEnabled,
        enabled: row?.enabled ?? rule.defaultEnabled,
        config: parseDigestRuleConfig(rule.key, row?.config ?? rule.defaultConfig) as Record<string, unknown>,
        recipientRoles: [] as readonly string[],
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    });
    return [...builtIn, ...digest];
```

`updateRule` 的 input `ruleKey` 与 config 解析改为：

```ts
    .input(z.object({
      ruleKey: z.enum([...AUTOMATION_RULE_KEYS, ...DIGEST_RULE_KEYS] as [string, ...string[]]),
      enabled: z.boolean().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureAutomationRuleDefaults();
      const parsedConfig = input.config
        ? (isDigestRuleKey(input.ruleKey)
            ? parseDigestRuleConfig(input.ruleKey, input.config)
            : parseAutomationRuleConfig(input.ruleKey as (typeof AUTOMATION_RULE_KEYS)[number], input.config))
        : undefined;
      await updateAutomationRuleRow({
        ruleKey: input.ruleKey,
        enabled: input.enabled,
        config: parsedConfig ? { ...(parsedConfig as Record<string, unknown>) } : undefined,
        updatedBy: ctx.user.id,
      });
      return { ok: true };
    }),
```

> 说明：`runAutomation`（engine.ts）仍只遍历 `AUTOMATION_RULES`，`health_digest` 永不被当普通规则执行。前端 `AutomationSettings.tsx` 用 generic JSON textarea 渲染 `rule.config`，digest 的 `cadence/sendHour/weekday/pushPmPersonal/pushManagerGroup` 直接可编辑保存，无需改前端。

- [ ] **Step 4: 类型检查**

Run: `pnpm check`
Expected: `0 errors`。若 `listRules` 返回类型联合报错，确认 `builtIn`/`digest` 两个数组的元素字段名与类型完全一致（均已用 `as string` / `as readonly string[]` 对齐）。

- [ ] **Step 5: 跑相关测试确认无回归**

Run: `node scripts/test.mjs server/automation/rules.test.ts server/automation/engine.test.ts`
Expected: PASS（引擎仍只跑内建规则，未受影响）。

- [ ] **Step 6: 提交**

```bash
git add server/automation/scheduler.ts server/automation/engine.ts server/routers/automation.ts
git commit -m "feat(automation): 接线 health_digest（scheduler 调用 + seed + 管理页可配）"
```

---

## Task 7: 全量验证

**Files:** 无（仅运行）

- [ ] **Step 1: 全量类型检查**

Run: `pnpm check`
Expected: `0 errors`。

- [ ] **Step 2: 全量测试**

Run: `node scripts/test.mjs`
Expected: 全绿（新增 `health.test.ts` 用例、`digestRules.test.ts`、`portfolio-health.test.ts`、`healthDigest.test.ts` 全通过；既有测试无回归）。

- [ ] **Step 3: 提交（如有快照/锁文件变动）**

```bash
git add -A
git commit -m "chore: 健康度自动判定 #1 全量验证通过" --allow-empty
```

---

## Self-Review（已执行）

**Spec 覆盖：**
- 进度/逾期/阻塞/P0P1/Gate/目标日偏差 → Task 1（computeRag 接 6 类信号）+ Task 3（聚合）。✅
- 阈值写死常量 → Task 1（`SLIP_RED` 等）。✅
- ragReasons 不短路 → Task 1。✅
- 进度分母=有计划日期任务、无计划→null → Task 3 SQL + Task 4 `progressBehind`。✅
- plannedEnd 语义 → Task 1 注释 + Task 3 字段。✅
- Gate 含已过期(负数) → Task 3 `daysBetween(todayISO, dueDate) <= 3`。✅
- digest 全量 archived=false 项目、按 PM 分组 → Task 3 + Task 4 `groupByPm`。✅
- 管理页可见/可配（描述符 + router） → Task 2 + Task 6；engine 不执行 → Task 6 说明。✅
- periodKey + 补发 + 任意 run 去重 → Task 4 `computeDigestTiming` + Task 3 `hasAutomationRunForEntity` + Task 5。✅
- skipped 算锚点 → Task 5（空写 skipped 即 return；`hasRun` 查任意状态）。✅
- 时区 Asia/Shanghai、SQL 用 todayISO → Task 4 `shanghaiParts` + Task 3 SQL 用 `${todayISO}`。✅
- PM 个人(站内+钉钉) + 管理群(webhook) → Task 5。✅
- 测试矩阵 → Task 1/2/3/4/5 覆盖 spec 列出的全部场景。✅

**Placeholder 扫描：** 无 TBD/TODO；每个代码步骤含完整代码。Task 3 测试对 `createProject`/`upsertProjectTask` 精确签名留了「以 db.ts 为准」的实现提示（非占位，是真实的签名核对指令）。

**类型一致性：** `PortfolioHealthRow` 字段（`plannedItems/dueItems/donePlannedItems/plannedEnd/gateNotReady`）在 Task 3 定义、Task 4/5 一致引用；`HealthDigestConfig` 字段在 Task 2 定义、Task 4/5 一致；`runHealthDigestScan(now, deps)`、`computeDigestTiming`、`scorePortfolio`、`groupByPm`、`buildPmMarkdown`、`buildGroupMarkdown` 跨 Task 名称一致；periodKey 前缀 `d:`/`w:` 在 Task 4/5 一致。
