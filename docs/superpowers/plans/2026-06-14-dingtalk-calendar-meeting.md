# 钉钉日程 + 视频会议集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 项目创建后在 PM 钉钉日历建一条每周循环日程（带视频会议链接、参会人=项目成员），按项目可配；钉钉未配置或解析不到人则降级为现有群推，绝不阻断建项目。

**Architecture:** 新增 `server/_core/dingtalk.ts`（凭据/token）、`server/_core/dingtalkCalendar.ts`（日程 upsert/cancel + RRULE 构造）、用户→钉钉 userId 映射（按手机号查 + 缓存到 users 行）。在项目创建与 meetingConfig 编辑处接入；全部钉钉调用 try/catch 降级。凭据放 `.env`（gitignore）。

**Tech Stack:** Node fetch、Drizzle(pg)、tRPC、vitest（stub fetch，无需真凭据即可单测）；钉钉 OpenAPI v1.0（accessToken / calendar events）+ 通讯录 v2（user/getbymobile）。

**Source spec:** `docs/superpowers/specs/2026-06-14-dingtalk-calendar-meeting-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `drizzle/schema.ts` | users 加 `mobile`/`dingtalkUserId`；projects 加 `meetingConfig`/`dingtalkEventId` |
| `server/_core/env.ts` | 读 `DINGTALK_APP_KEY/SECRET/CORP_ID` |
| `server/_core/dingtalk.ts` | `getAccessToken()`（缓存）、`resolveDingtalkUserId(user)`（按手机号查+回写缓存）、`isDingtalkConfigured()` |
| `server/_core/dingtalkCalendar.ts` | `buildWeeklyRecurrence()`（纯函数）、`upsertWeeklyMeeting()`、`cancelMeeting()` |
| `server/db.ts` | `setUserDingtalkId()`、`updateProjectMeetingConfig()`、`updateProjectDingtalkEvent()` |
| `server/routers/projects.ts` | 建项目 / 改 meetingConfig 时调日程接入（降级安全） |
| `server/routers/meetings.ts`（新） | tRPC：getMeetingConfig / setMeetingConfig（PM 可改） |
| `client/src/components/views/MeetingConfigPanel.tsx`（新） | 项目总揽里的周会编辑器 |

凭据无关任务：Task 1–6、9、10。凭据相关：Task 11（真 E2E）。

---

## Task 1: 迁移与 schema（users.mobile/dingtalkUserId、projects.meetingConfig/dingtalkEventId）

**Files:**
- Modify: `drizzle/schema.ts`（users 表、projects 表）
- Generate: `drizzle/00NN_*.sql`

- [ ] **Step 1: 改 schema —— users 加两列**

在 `drizzle/schema.ts` 的 `users` 表（`canCreateProject` 之后、`createdAt` 之前）加：

```ts
  /** 手机号（与钉钉一致）；自动映射钉钉 userId 的查询键 */
  mobile: varchar("mobile", { length: 32 }),
  /** 反查到的钉钉 userId 缓存 */
  dingtalkUserId: varchar("dingtalkUserId", { length: 64 }),
```

- [ ] **Step 2: 改 schema —— projects 加两列**

在 `projects` 表（`customFields` 之后）加：

```ts
  /** 每项目周会配置：{ enabled, weekday(0-6), time:"HH:MM", durationMin, title } */
  meetingConfig: jsonb("meetingConfig").$type<{ enabled: boolean; weekday: number; time: string; durationMin: number; title: string } | null>(),
  /** 已建钉钉日程 id（用于改/删） */
  dingtalkEventId: varchar("dingtalkEventId", { length: 128 }),
```

- [ ] **Step 3: 生成迁移**

Run: `set -a && source .env && set +a && npx drizzle-kit generate --name dingtalk_meeting`
Expected: 生成一个新的 `drizzle/00NN_*.sql`，内容为 4 条 `ALTER TABLE ... ADD COLUMN`。

- [ ] **Step 4: 本地应用迁移**

Run: `set -a && source .env && set +a && npx drizzle-kit migrate`
Expected: `migrations applied successfully`；`docker exec cehub-pg psql -U postgres -d cehub -c "\d users" | grep -E "mobile|dingtalkUserId"` 有两列。

- [ ] **Step 5: typecheck**

Run: `pnpm check`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add drizzle/schema.ts drizzle/00NN_dingtalk_meeting.sql drizzle/meta/
git commit -m "feat(dingtalk): users.mobile/dingtalkUserId + projects.meetingConfig/dingtalkEventId + 迁移"
```

---

## Task 2: env 读取钉钉凭据

**Files:**
- Modify: `server/_core/env.ts`

- [ ] **Step 1: 加 env 字段**

在 `ENV` 对象末尾（`appBaseUrl` 后）加：

```ts
  // 钉钉企业内部应用（用于真日程+视频会议；未配则降级群推）
  dingtalkAppKey: process.env.DINGTALK_APP_KEY ?? "",
  dingtalkAppSecret: process.env.DINGTALK_APP_SECRET ?? "",
  dingtalkCorpId: process.env.DINGTALK_CORP_ID ?? "",
```

- [ ] **Step 2: typecheck + commit**

Run: `pnpm check`（Expected: 无错误）

```bash
git add server/_core/env.ts
git commit -m "feat(dingtalk): env 读取 DINGTALK_APP_KEY/SECRET/CORP_ID"
```

---

## Task 3: token 模块（getAccessToken 缓存 + isDingtalkConfigured）

**Files:**
- Create: `server/_core/dingtalk.ts`
- Test: `server/_core/dingtalk.test.ts`

- [ ] **Step 1: 写失败测试**

`server/_core/dingtalk.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { __setDingtalkConfigForTest, getAccessToken, _resetTokenCacheForTest } from "./dingtalk";

beforeEach(() => { _resetTokenCacheForTest(); vi.restoreAllMocks(); });

describe("dingtalk token", () => {
  it("returns null when not configured", async () => {
    __setDingtalkConfigForTest({ appKey: "", appSecret: "" });
    expect(await getAccessToken()).toBeNull();
  });

  it("fetches and caches the token", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accessToken: "tok-1", expireIn: 7200 }), { status: 200 })
    );
    expect(await getAccessToken()).toBe("tok-1");
    expect(await getAccessToken()).toBe("tok-1"); // 命中缓存
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run server/_core/dingtalk.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 dingtalk.ts**

`server/_core/dingtalk.ts`：

```ts
import { ENV } from "./env";

let cfg = { appKey: ENV.dingtalkAppKey, appSecret: ENV.dingtalkAppSecret };
let tokenCache: { token: string; expiresAt: number } | null = null;

/** 测试用：覆盖配置 */
export function __setDingtalkConfigForTest(c: { appKey: string; appSecret: string }) { cfg = c; }
export function _resetTokenCacheForTest() { tokenCache = null; }

export function isDingtalkConfigured(): boolean {
  return !!(cfg.appKey && cfg.appSecret);
}

/** 取 access token；未配置返回 null；带过期缓存（提前 5 分钟刷新） */
export async function getAccessToken(now = Date.now()): Promise<string | null> {
  if (!isDingtalkConfigured()) return null;
  if (tokenCache && tokenCache.expiresAt - 5 * 60_000 > now) return tokenCache.token;
  const resp = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: cfg.appKey, appSecret: cfg.appSecret }),
  });
  if (!resp.ok) { console.warn("[dingtalk] token http", resp.status); return null; }
  const j = (await resp.json()) as { accessToken?: string; expireIn?: number };
  if (!j.accessToken) return null;
  tokenCache = { token: j.accessToken, expiresAt: now + (j.expireIn ?? 7200) * 1000 };
  return tokenCache.token;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npx vitest run server/_core/dingtalk.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add server/_core/dingtalk.ts server/_core/dingtalk.test.ts
git commit -m "feat(dingtalk): access token 模块(缓存+未配置降级) + 测试"
```

---

## Task 4: 用户→钉钉 userId 映射（按手机号查 + 缓存回写）

**Files:**
- Modify: `server/_core/dingtalk.ts`（加 `resolveDingtalkUserId`）
- Modify: `server/db.ts`（加 `setUserDingtalkId`）
- Modify: `server/_core/dingtalk.test.ts`

- [ ] **Step 1: db 加缓存回写 helper**

`server/db.ts`（User helpers 区）：

```ts
export async function setUserDingtalkId(userId: number, dingtalkUserId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ dingtalkUserId }).where(eq(users.id, userId));
}
```

- [ ] **Step 2: 写失败测试（映射）**

追加到 `server/_core/dingtalk.test.ts`：

```ts
import { resolveDingtalkUserId } from "./dingtalk";

describe("resolveDingtalkUserId", () => {
  it("uses cached dingtalkUserId without calling api", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    const spy = vi.spyOn(globalThis, "fetch");
    const id = await resolveDingtalkUserId({ id: 1, dingtalkUserId: "u-cached", mobile: "138" }, async () => {});
    expect(id).toBe("u-cached");
    expect(spy).not.toHaveBeenCalled();
  });

  it("looks up by mobile then caches", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    _resetTokenCacheForTest();
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ errcode: 0, result: { userid: "u-99" } }), { status: 200 });
    });
    let cached = "";
    const id = await resolveDingtalkUserId({ id: 2, dingtalkUserId: null, mobile: "13800000000" }, async (uid, dd) => { calls.push(`${uid}:${dd}`); cached = dd; });
    expect(id).toBe("u-99");
    expect(cached).toBe("u-99"); // 已回写缓存
  });

  it("returns null when no cache and no mobile", async () => {
    const id = await resolveDingtalkUserId({ id: 3, dingtalkUserId: null, mobile: null }, async () => {});
    expect(id).toBeNull();
  });
});
```

- [ ] **Step 3: 运行验证失败**

Run: `npx vitest run server/_core/dingtalk.test.ts`
Expected: FAIL（`resolveDingtalkUserId` 未定义）。

- [ ] **Step 4: 实现 resolveDingtalkUserId**

`server/_core/dingtalk.ts` 追加（依赖注入缓存回写，方便测试）：

```ts
type MappableUser = { id: number; dingtalkUserId?: string | null; mobile?: string | null };

/**
 * 解析用户的钉钉 userId：优先用缓存；否则按手机号查通讯录并回写缓存；都没有返回 null。
 * @param cacheBack 回写缓存的副作用（生产传 setUserDingtalkId）
 */
export async function resolveDingtalkUserId(
  user: MappableUser,
  cacheBack: (userId: number, dingtalkUserId: string) => Promise<void>
): Promise<string | null> {
  if (user.dingtalkUserId) return user.dingtalkUserId;
  if (!user.mobile) return null;
  const token = await getAccessToken();
  if (!token) return null;
  const resp = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/getbymobile?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: user.mobile }),
  });
  if (!resp.ok) return null;
  const j = (await resp.json()) as { errcode?: number; result?: { userid?: string } };
  const uid = j.result?.userid;
  if (j.errcode !== 0 || !uid) return null;
  await cacheBack(user.id, uid);
  return uid;
}
```

- [ ] **Step 5: 运行验证通过 + typecheck**

Run: `npx vitest run server/_core/dingtalk.test.ts`（Expected: PASS，5 tests）
Run: `pnpm check`（Expected: 无错误）

- [ ] **Step 6: Commit**

```bash
git add server/_core/dingtalk.ts server/_core/dingtalk.test.ts server/db.ts
git commit -m "feat(dingtalk): 按手机号反查 userId + 缓存回写 + 测试"
```

---

## Task 5: 循环日程 RRULE / payload 构造（纯函数）

**Files:**
- Create: `server/_core/dingtalkCalendar.ts`
- Test: `server/_core/dingtalkCalendar.test.ts`

- [ ] **Step 1: 写失败测试**

`server/_core/dingtalkCalendar.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { buildWeeklyEvent } from "./dingtalkCalendar";

describe("buildWeeklyEvent", () => {
  it("computes first occurrence on/after start matching weekday + time, weekly recurrence until target", () => {
    // 2026-06-14 是周日(0)；weekday=3(周三) → 首次 2026-06-17 15:00
    const ev = buildWeeklyEvent({
      title: "项目周会", weekday: 3, time: "15:00", durationMin: 60,
      startDate: "2026-06-14", targetDate: "2026-08-01",
      timeZone: "Asia/Shanghai", attendees: ["u-1", "u-2"],
    });
    expect(ev.summary).toBe("项目周会");
    expect(ev.start.dateTime.startsWith("2026-06-17T15:00")).toBe(true);
    expect(ev.end.dateTime.startsWith("2026-06-17T16:00")).toBe(true);
    expect(ev.recurrence?.pattern?.repeatType).toBe("WEEKLY");
    expect(ev.recurrence?.range?.endDate).toBe("2026-08-01");
    expect(ev.attendees.map((a) => a.id)).toEqual(["u-1", "u-2"]);
    expect(ev.onlineMeetingInfo?.type).toBe("dingtalk"); // 视频会议
  });

  it("defaults recurrence to 13 weeks when no targetDate", () => {
    const ev = buildWeeklyEvent({
      title: "周会", weekday: 1, time: "10:00", durationMin: 30,
      startDate: "2026-06-14", targetDate: null, timeZone: "Asia/Shanghai", attendees: [],
    });
    // 首次 2026-06-15(周一)，+13 周 ≈ 2026-09-14
    expect(ev.recurrence?.range?.endDate).toBe("2026-09-14");
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run server/_core/dingtalkCalendar.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 buildWeeklyEvent（纯函数）**

`server/_core/dingtalkCalendar.ts`：

```ts
export type WeeklyEventInput = {
  title: string; weekday: number; time: string; durationMin: number;
  startDate: string; targetDate: string | null; timeZone: string; attendees: string[];
};

export type DingtalkEvent = {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  recurrence: { pattern: { repeatType: "WEEKLY" }; range: { endDate: string } };
  attendees: { id: string }[];
  onlineMeetingInfo: { type: "dingtalk" };
};

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
function weekdayOf(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
}
function addMinutes(time: string, mins: number): string {
  const [h, mi] = time.split(":").map(Number);
  const total = h * 60 + mi + mins;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** 首次会议日 = start 当天或之后、第一个匹配 weekday 的日期 */
export function firstOccurrence(startDate: string, weekday: number): string {
  let d = startDate;
  for (let i = 0; i < 7; i++) { if (weekdayOf(d) === weekday) return d; d = addDaysISO(d, 1); }
  return startDate;
}

export function buildWeeklyEvent(input: WeeklyEventInput): DingtalkEvent {
  const first = firstOccurrence(input.startDate, input.weekday);
  const endTime = addMinutes(input.time, input.durationMin);
  const endDate = input.targetDate ?? addDaysISO(first, 13 * 7);
  return {
    summary: input.title,
    start: { dateTime: `${first}T${input.time}:00`, timeZone: input.timeZone },
    end: { dateTime: `${first}T${endTime}:00`, timeZone: input.timeZone },
    recurrence: { pattern: { repeatType: "WEEKLY" }, range: { endDate } },
    attendees: input.attendees.map((id) => ({ id })),
    onlineMeetingInfo: { type: "dingtalk" },
  };
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npx vitest run server/_core/dingtalkCalendar.test.ts`
Expected: PASS（2 tests）。注意核对首次日期/endDate 与测试断言一致，不一致则调 `firstOccurrence`/`addDaysISO`。

- [ ] **Step 5: Commit**

```bash
git add server/_core/dingtalkCalendar.ts server/_core/dingtalkCalendar.test.ts
git commit -m "feat(dingtalk): 每周日程 payload 构造(首次日期/周循环/视频会议) 纯函数 + 测试"
```

---

## Task 6: 日程 upsert / cancel（调钉钉 API，带降级）

**Files:**
- Modify: `server/_core/dingtalkCalendar.ts`（加 `upsertWeeklyMeeting`/`cancelMeeting`）
- Test: `server/_core/dingtalkCalendar.test.ts`

> 钉钉日历 createEvent 端点：`POST https://api.dingtalk.com/v1.0/calendar/users/{userId}/calendars/primary/events`，header `x-acs-dingtalk-access-token: <token>`；更新用 `PUT .../events/{eventId}`；删除用 `DELETE .../events/{eventId}`。具体字段名实现时对照官方文档微调（测试用 stub 不受影响）。

- [ ] **Step 1: 写失败测试（stub fetch）**

追加到 `server/_core/dingtalkCalendar.test.ts`：

```ts
import { upsertWeeklyMeeting } from "./dingtalkCalendar";
import { vi, beforeEach } from "vitest";
import { __setDingtalkConfigForTest, _resetTokenCacheForTest } from "./dingtalk";

beforeEach(() => { _resetTokenCacheForTest(); vi.restoreAllMocks(); });

it("returns null (degrade) when dingtalk not configured", async () => {
  __setDingtalkConfigForTest({ appKey: "", appSecret: "" });
  const res = await upsertWeeklyMeeting({
    organizerUserId: "pm-1", existingEventId: null,
    event: { summary: "x", start: { dateTime: "2026-06-17T15:00:00", timeZone: "Asia/Shanghai" }, end: { dateTime: "2026-06-17T16:00:00", timeZone: "Asia/Shanghai" }, recurrence: { pattern: { repeatType: "WEEKLY" }, range: { endDate: "2026-08-01" } }, attendees: [], onlineMeetingInfo: { type: "dingtalk" } },
  });
  expect(res).toBeNull();
});

it("creates event and returns eventId", async () => {
  __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
    return new Response(JSON.stringify({ id: "evt-123" }), { status: 200 });
  });
  const res = await upsertWeeklyMeeting({
    organizerUserId: "pm-1", existingEventId: null,
    event: { summary: "x", start: { dateTime: "2026-06-17T15:00:00", timeZone: "Asia/Shanghai" }, end: { dateTime: "2026-06-17T16:00:00", timeZone: "Asia/Shanghai" }, recurrence: { pattern: { repeatType: "WEEKLY" }, range: { endDate: "2026-08-01" } }, attendees: [], onlineMeetingInfo: { type: "dingtalk" } },
  });
  expect(res).toBe("evt-123");
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run server/_core/dingtalkCalendar.test.ts`
Expected: FAIL（`upsertWeeklyMeeting` 未定义）。

- [ ] **Step 3: 实现 upsertWeeklyMeeting / cancelMeeting**

`server/_core/dingtalkCalendar.ts` 追加：

```ts
import { getAccessToken, isDingtalkConfigured } from "./dingtalk";

const CAL_BASE = "https://api.dingtalk.com/v1.0/calendar/users";

/** 建或更新组织者日历上的循环日程；返回 eventId；未配置/失败返回 null（上层降级） */
export async function upsertWeeklyMeeting(params: {
  organizerUserId: string;
  existingEventId: string | null;
  event: DingtalkEvent;
}): Promise<string | null> {
  if (!isDingtalkConfigured()) return null;
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const base = `${CAL_BASE}/${encodeURIComponent(params.organizerUserId)}/calendars/primary/events`;
    const url = params.existingEventId ? `${base}/${encodeURIComponent(params.existingEventId)}` : base;
    const resp = await fetch(url, {
      method: params.existingEventId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": token },
      body: JSON.stringify(params.event),
    });
    if (!resp.ok) { console.warn("[dingtalk] upsert event http", resp.status); return null; }
    const j = (await resp.json()) as { id?: string };
    return j.id ?? params.existingEventId ?? null;
  } catch (e) {
    console.warn("[dingtalk] upsert event failed (degrade):", e);
    return null;
  }
}

export async function cancelMeeting(organizerUserId: string, eventId: string): Promise<void> {
  if (!isDingtalkConfigured()) return;
  try {
    const token = await getAccessToken();
    if (!token) return;
    await fetch(`${CAL_BASE}/${encodeURIComponent(organizerUserId)}/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { "x-acs-dingtalk-access-token": token },
    });
  } catch (e) {
    console.warn("[dingtalk] cancel event failed (non-fatal):", e);
  }
}
```

- [ ] **Step 4: 运行验证通过 + typecheck**

Run: `npx vitest run server/_core/dingtalkCalendar.test.ts`（Expected: PASS）
Run: `pnpm check`（Expected: 无错误）

- [ ] **Step 5: Commit**

```bash
git add server/_core/dingtalkCalendar.ts server/_core/dingtalkCalendar.test.ts
git commit -m "feat(dingtalk): 日程 upsert/cancel(降级安全) + 测试"
```

---

## Task 7: db helpers（meetingConfig / dingtalkEventId）

**Files:**
- Modify: `server/db.ts`

- [ ] **Step 1: 加 helpers**

`server/db.ts`（Project helpers 区）：

```ts
export async function updateProjectMeetingConfig(
  projectId: string,
  meetingConfig: { enabled: boolean; weekday: number; time: string; durationMin: number; title: string }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(projects).set({ meetingConfig }).where(eq(projects.id, projectId));
}

export async function updateProjectDingtalkEvent(projectId: string, dingtalkEventId: string | null): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(projects).set({ dingtalkEventId }).where(eq(projects.id, projectId));
}
```

- [ ] **Step 2: typecheck + commit**

Run: `pnpm check`（Expected: 无错误）

```bash
git add server/db.ts
git commit -m "feat(dingtalk): db helpers — meetingConfig / dingtalkEventId"
```

---

## Task 8: 日程同步编排（建项目/改配置时 upsert，降级群推）

**Files:**
- Create: `server/_core/meetingSync.ts`
- Test: `server/_core/meetingSync.test.ts`

- [ ] **Step 1: 写失败测试（注入依赖，验证降级与正常两路）**

`server/_core/meetingSync.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { syncProjectMeeting } from "./meetingSync";

const baseProject = { id: "p1", name: "测试项目", startDate: "2026-06-14", targetDate: "2026-08-01", pmUserId: 1, dingtalkEventId: null };
const config = { enabled: true, weekday: 3, time: "15:00", durationMin: 60, title: "项目周会" };

it("degrades to group push when PM has no dingtalk id", async () => {
  const pushed: string[] = [];
  const res = await syncProjectMeeting({
    project: baseProject, config, members: [{ id: 1, dingtalkUserId: null, mobile: null }],
    deps: {
      resolveUserId: async () => null,
      upsert: async () => "should-not-be-called",
      saveEventId: async () => {},
      groupPush: async (t) => { pushed.push(t); },
    },
  });
  expect(res.mode).toBe("group_push");
  expect(pushed.length).toBe(1);
});

it("creates dingtalk event when PM resolvable", async () => {
  let savedEvent = "";
  const res = await syncProjectMeeting({
    project: baseProject, config, members: [{ id: 1, dingtalkUserId: "pm-x", mobile: null }],
    deps: {
      resolveUserId: async (u) => u.dingtalkUserId ?? null,
      upsert: async () => "evt-1",
      saveEventId: async (_pid, id) => { savedEvent = id ?? ""; },
      groupPush: async () => {},
    },
  });
  expect(res.mode).toBe("dingtalk");
  expect(savedEvent).toBe("evt-1");
});

it("does nothing when meeting disabled", async () => {
  const res = await syncProjectMeeting({
    project: baseProject, config: { ...config, enabled: false }, members: [],
    deps: { resolveUserId: async () => null, upsert: async () => null, saveEventId: async () => {}, groupPush: async () => {} },
  });
  expect(res.mode).toBe("skipped");
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run server/_core/meetingSync.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 meetingSync.ts（编排 + 注入依赖）**

`server/_core/meetingSync.ts`：

```ts
import { buildWeeklyEvent } from "./dingtalkCalendar";

type Cfg = { enabled: boolean; weekday: number; time: string; durationMin: number; title: string };
type Proj = { id: string; name: string; startDate: string | null; targetDate: string | null; pmUserId: number | null; dingtalkEventId: string | null };
type Member = { id: number; dingtalkUserId?: string | null; mobile?: string | null };

export type MeetingSyncDeps = {
  resolveUserId: (u: Member) => Promise<string | null>;
  upsert: (p: { organizerUserId: string; existingEventId: string | null; event: ReturnType<typeof buildWeeklyEvent> }) => Promise<string | null>;
  saveEventId: (projectId: string, eventId: string | null) => Promise<void>;
  groupPush: (text: string) => Promise<void>;
};

export async function syncProjectMeeting(args: {
  project: Proj; config: Cfg | null; members: Member[]; deps: MeetingSyncDeps;
}): Promise<{ mode: "skipped" | "dingtalk" | "group_push" }> {
  const { project, config, members, deps } = args;
  if (!config?.enabled || !project.startDate) return { mode: "skipped" };

  const pm = members.find((m) => m.id === project.pmUserId);
  const pmUserId = pm ? await deps.resolveUserId(pm) : null;

  if (pmUserId) {
    const attendees = (await Promise.all(members.map((m) => deps.resolveUserId(m)))).filter((x): x is string => !!x);
    const event = buildWeeklyEvent({
      title: config.title, weekday: config.weekday, time: config.time, durationMin: config.durationMin,
      startDate: project.startDate, targetDate: project.targetDate, timeZone: "Asia/Shanghai", attendees,
    });
    const eventId = await deps.upsert({ organizerUserId: pmUserId, existingEventId: project.dingtalkEventId, event });
    if (eventId) { await deps.saveEventId(project.id, eventId); return { mode: "dingtalk" }; }
  }

  // 降级：群推文字提醒
  await deps.groupPush(`【${project.name}】项目周会：每周${"日一二三四五六"[config.weekday]} ${config.time}（${config.durationMin} 分钟）`);
  return { mode: "group_push" };
}
```

- [ ] **Step 4: 运行验证通过 + typecheck**

Run: `npx vitest run server/_core/meetingSync.test.ts`（Expected: PASS，3 tests）
Run: `pnpm check`（Expected: 无错误）

- [ ] **Step 5: Commit**

```bash
git add server/_core/meetingSync.ts server/_core/meetingSync.test.ts
git commit -m "feat(dingtalk): 周会同步编排(钉钉日程优先,降级群推) + 测试"
```

---

## Task 9: tRPC + 建项目接入

**Files:**
- Create: `server/routers/meetings.ts`
- Modify: `server/routers.ts`（挂载）
- Modify: `server/routers/projects.ts`（建项目后调 sync）

- [ ] **Step 1: meetings 路由（getConfig / setConfig，仅 canEditProjectInfo）**

`server/routers/meetings.ts`：

```ts
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getProjectById, getProjectMember, updateProjectMeetingConfig, getProjectMembers, setUserDingtalkId, updateProjectDingtalkEvent } from "../db";
import { ROLE_PERMISSIONS } from "./members";
import { resolveDingtalkUserId } from "../_core/dingtalk";
import { upsertWeeklyMeeting } from "../_core/dingtalkCalendar";
import { syncProjectMeeting } from "../_core/meetingSync";
import { pushWebhook } from "../_core/notify";

const cfgSchema = z.object({
  enabled: z.boolean(), weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/), durationMin: z.number().int().min(15).max(480), title: z.string().min(1).max(64),
});

async function effectiveRole(projectId: string, userId: number) {
  const p = await getProjectById(projectId); if (!p) return null;
  if (p.createdBy === userId) return "owner" as const;
  return (await getProjectMember(projectId, userId))?.role ?? null;
}

export const meetingsRouter = router({
  getConfig: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ input }) => {
    const p = await getProjectById(input.projectId);
    return (p as { meetingConfig?: unknown } | undefined)?.meetingConfig ?? null;
  }),
  setConfig: protectedProcedure.input(z.object({ projectId: z.string(), config: cfgSchema })).mutation(async ({ ctx, input }) => {
    const role = await effectiveRole(input.projectId, ctx.user.id);
    if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) throw new TRPCError({ code: "FORBIDDEN" });
    await updateProjectMeetingConfig(input.projectId, input.config);
    const project = await getProjectById(input.projectId);
    const members = await getProjectMembers(input.projectId);
    await syncProjectMeeting({
      project: project as never, config: input.config, members: members as never,
      deps: {
        resolveUserId: (u) => resolveDingtalkUserId(u, setUserDingtalkId),
        upsert: upsertWeeklyMeeting,
        saveEventId: updateProjectDingtalkEvent,
        groupPush: (t) => pushWebhook(t, { title: "项目周会" }),
      },
    });
    return { success: true };
  }),
});
```

- [ ] **Step 2: 挂载路由**

`server/routers.ts`：import `meetingsRouter` 并在 appRouter 加 `meetings: meetingsRouter,`。

- [ ] **Step 3: 建项目后触发一次 sync（projects.create mutation 末尾，return 前）**

`server/routers/projects.ts` 的 `create` mutation，在 `createActivityLog` 之后加：

```ts
      // 默认周会配置 + 尝试建钉钉日程（降级安全，不阻断建项目）
      try {
        const defaultCfg = { enabled: true, weekday: 3, time: "15:00", durationMin: 60, title: "项目周会" };
        await db.updateProjectMeetingConfig(input.id, defaultCfg);
        const project = await db.getProjectById(input.id);
        const members = await db.getProjectMembers(input.id);
        const { syncProjectMeeting } = await import("../_core/meetingSync");
        const { resolveDingtalkUserId } = await import("../_core/dingtalk");
        const { upsertWeeklyMeeting } = await import("../_core/dingtalkCalendar");
        const { pushWebhook } = await import("../_core/notify");
        await syncProjectMeeting({
          project: project as never, config: defaultCfg, members: members as never,
          deps: {
            resolveUserId: (u) => resolveDingtalkUserId(u, db.setUserDingtalkId),
            upsert: upsertWeeklyMeeting, saveEventId: db.updateProjectDingtalkEvent,
            groupPush: (t) => pushWebhook(t, { title: "项目周会" }),
          },
        });
      } catch (e) { console.warn("[meeting] create sync failed (non-fatal):", e); }
```

（注：`projects.ts` 顶部已 `import ... from "../db"` 具名导入；如需 `db.` 形式则改为 `import * as db from "../db"` 或直接具名调用。按文件现有风格调整。）

- [ ] **Step 4: typecheck + 全量测试**

Run: `pnpm check`（Expected: 无错误）
Run: `set -a && source .env && set +a && pnpm test`（Expected: 全绿）

- [ ] **Step 5: Commit**

```bash
git add server/routers/meetings.ts server/routers.ts server/routers/projects.ts
git commit -m "feat(dingtalk): meetings 路由(配置读写) + 建项目默认周会并同步"
```

---

## Task 10: 周会编辑器 UI（项目总揽）

**Files:**
- Create: `client/src/components/views/MeetingConfigPanel.tsx`
- Modify: `client/src/components/views/OverviewPanel.tsx`（嵌入面板）

- [ ] **Step 1: 写 MeetingConfigPanel**

`client/src/components/views/MeetingConfigPanel.tsx`：

```tsx
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { CalendarClock, Save } from 'lucide-react';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
type Cfg = { enabled: boolean; weekday: number; time: string; durationMin: number; title: string };
const DEFAULT: Cfg = { enabled: true, weekday: 3, time: '15:00', durationMin: 60, title: '项目周会' };

export function MeetingConfigPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data } = trpc.meetings.getConfig.useQuery({ projectId });
  const [draft, setDraft] = useState<Cfg | null>(null);
  const cfg = draft ?? (data as Cfg | null) ?? DEFAULT;
  const save = trpc.meetings.setConfig.useMutation({
    onSuccess: () => { utils.meetings.getConfig.invalidate({ projectId }); toast.success('周会已更新'); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="border border-stone-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2"><CalendarClock size={14} className="text-amber-500" /><h3 className="text-sm font-medium text-stone-800 flex-1">项目周会</h3>
        <label className="flex items-center gap-1.5 text-xs text-stone-600"><input type="checkbox" disabled={!canEdit} checked={cfg.enabled} onChange={(e) => setDraft({ ...cfg, enabled: e.target.checked })} className="accent-stone-700" />启用</label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <select disabled={!canEdit} value={cfg.weekday} onChange={(e) => setDraft({ ...cfg, weekday: Number(e.target.value) })} className="border border-stone-300 px-2 py-1.5">
          {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
        </select>
        <input type="time" disabled={!canEdit} value={cfg.time} onChange={(e) => setDraft({ ...cfg, time: e.target.value })} className="border border-stone-300 px-2 py-1.5" />
        <input type="number" disabled={!canEdit} value={cfg.durationMin} min={15} step={15} onChange={(e) => setDraft({ ...cfg, durationMin: Number(e.target.value) })} className="border border-stone-300 px-2 py-1.5" title="时长(分钟)" />
        <input type="text" disabled={!canEdit} value={cfg.title} onChange={(e) => setDraft({ ...cfg, title: e.target.value })} className="border border-stone-300 px-2 py-1.5" />
      </div>
      {canEdit && (
        <button disabled={save.isPending} onClick={() => save.mutate({ projectId, config: cfg })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-stone-800 text-white hover:bg-stone-900 disabled:opacity-40">
          <Save size={12} />保存周会
        </button>
      )}
      <p className="text-[11px] text-stone-400">配了钉钉应用则建真日程+视频会议;否则按周推群提醒。每个项目可各自设定。</p>
    </div>
  );
}
```

- [ ] **Step 2: 在 OverviewPanel 嵌入**

`OverviewPanel.tsx`：import `MeetingConfigPanel`，在「关键指标」区块后渲染 `<MeetingConfigPanel projectId={project.id} canEdit={canEdit} />`。`OverviewPanel` 需接收 `canEdit`（从 ProjectDetailView 传 `perms.canEditProjectInfo`）——若当前 `OverviewPanel` 只收 `project`，则给它加一个 `canEdit` prop 并在 ProjectDetailView 渲染处传入。

- [ ] **Step 3: typecheck**

Run: `pnpm check`（Expected: 无错误）

- [ ] **Step 4: 本地 preview 验证**

启动 preview，进项目→总揽，看到周会面板；改星期/时间→保存→toast 成功；console 无报错（未配钉钉时走降级，不报错）。

- [ ] **Step 5: Commit**

```bash
git add client/src/components/views/MeetingConfigPanel.tsx client/src/components/views/OverviewPanel.tsx client/src/components/views/ProjectDetailView.tsx
git commit -m "feat(dingtalk): 项目总揽周会编辑器(每项目可配)"
```

---

## Task 11:（凭据相关）真钉钉 E2E + 生产部署

> **依赖你提供** AppKey/AppSecret/CorpId + 一个有手机号的测试成员。前 10 个任务（stub 单测）完成后，凭据一到执行本任务。

- [ ] **Step 1:** 把 `DINGTALK_APP_KEY/SECRET/CORP_ID` 写入 `.env`（本地）与 `.env.production`（gitignore）。
- [ ] **Step 2:** 本地起服务，给一个测试用户填 `mobile`（与钉钉一致），建一个项目→观察该 PM 钉钉日历出现循环日程 + 视频会议链接；删除该测试日程。
- [ ] **Step 3:** 核对钉钉 OpenAPI 实际返回字段（eventId 字段名、recurrence/onlineMeeting 结构），与 `dingtalkCalendar.ts` 对齐；如有差异改实现 + 更新对应单测。
- [ ] **Step 4:** RDS 应用本特性迁移（`ADD COLUMN IF NOT EXISTS` 幂等）+ 补 `__drizzle_migrations` 记录。
- [ ] **Step 5:** scp `.env.production` 到 ECS、rsync 代码、`docker compose up -d --build app`、curl 200、查日志无报错。
- [ ] **Step 6:** 合并 main + push。

---

## Self-Review 结论

- **Spec 覆盖**：token(Task3)、按手机号映射+缓存(Task4)、循环日程+视频会议 payload(Task5)、upsert/cancel 降级(Task6)、schema/迁移(Task1)、编排降级(Task8)、配置读写+建项目接入(Task9)、每项目编辑器(Task10)、E2E+部署(Task11)、env(Task2)、db helpers(Task7) —— spec §1–§9 均有对应任务。
- **降级路径**：Task6/8 显式覆盖「未配置/解析不到人/调用失败 → 群推」。
- **凭据隔离**：Task1–10 全部 stub 可测、不需真凭据;真调用集中在 Task11。
- **类型一致**：`DingtalkEvent` / `MeetingSyncDeps` / `Cfg` 字段在 Task5/6/8/9/10 间一致(weekday/time/durationMin/title/enabled)。
- **注意**：钉钉 OpenAPI 字段名以官方文档为准(Task6 已标注),Task11 Step3 专门核对并回改单测。
