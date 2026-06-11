# PostgreSQL + Self-Host Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate ce-project-hub off the Manus platform: MySQL → PostgreSQL (Aliyun RDS), Manus Forge storage → S3-compatible storage (MinIO / Aliyun OSS), remove all Manus runtime/OAuth/dead code, and add Docker deployment so it runs on the user's own server behind beepump.io.

**Architecture:** Keep the existing Express + tRPC + Drizzle + React stack untouched at the feature level. Swap only the infrastructure seams: `drizzle/schema.ts` (mysql-core → pg-core), `server/db.ts` (driver + 3 MySQL-only query patterns), `server/storage.ts` + `server/_core/storageProxy.ts` (Forge presign → `@aws-sdk/client-s3` presign), `server/_core/env.ts`. Delete dead Manus modules. Fonts currently loaded from Manus storage get vendored into `client/public/fonts/`. No data migration (user confirmed no data worth keeping).

**Tech Stack:** drizzle-orm/node-postgres + `pg`, `@aws-sdk/client-s3` (already a dependency), Docker + docker-compose (app + postgres + minio), Caddy for HTTPS at deploy time.

---

## Pre-flight

- Work on branch `migrate-postgres-selfhost` (repo is already a git repo).
- Verification DB: local PostgreSQL via Docker (`docker run postgres:16`). If Docker is unavailable on this machine, typecheck + unit tests still run; DB smoke tests run on the server later.

---

### Task 1: Branch + vendor fonts locally

**Files:**
- Create: `client/public/fonts/*.woff2` (11 files, downloaded from beepump.io while it is still up)
- Modify: `client/src/index.css:11-85` (font URLs)
- Modify: `client/index.html:10` (comment)

- [ ] **Step 1: Create branch**

```bash
cd /Users/huhanwei/Desktop/ce-project-hub && git checkout -b migrate-postgres-selfhost
```

- [ ] **Step 2: Download the 11 font files referenced in index.css**

```bash
mkdir -p client/public/fonts
for f in playfair_display_400_f85691b1 playfair_display_500_285fe5f5 playfair_display_600_84b3a618 playfair_display_700_a1b9223b jetbrains_mono_400_f4f5c8ec jetbrains_mono_500_c11871b7 jetbrains_mono_600_657b6bb5 source_sans_3_300_41f3b924 source_sans_3_400_ab09eb33 source_sans_3_500_7acbf8f8 source_sans_3_600_dc715d8b; do
  curl -fsS "https://beepump.io/manus-storage/${f}.woff2" -o "client/public/fonts/${f}.woff2"
done
ls -la client/public/fonts   # expect 11 .woff2 files, each > 10KB
```

- [ ] **Step 3: Rewrite URLs in index.css**

Replace every `url('/manus-storage/NAME.woff2')` with `url('/fonts/NAME.woff2')` (11 occurrences). Update the comment in `client/index.html` line 10 to `<!-- Fonts are self-hosted under /fonts/ for China mainland accessibility -->`.

- [ ] **Step 4: Commit**

```bash
git add client/public/fonts client/src/index.css client/index.html
git commit -m "feat: vendor fonts locally instead of Manus storage"
```

---

### Task 2: Convert Drizzle schema to PostgreSQL

**Files:**
- Modify: `drizzle/schema.ts` (full rewrite of imports + table builders; all column names, table names, JSDoc and exported const arrays/types stay identical)
- Delete: old MySQL migration artifacts in `drizzle/` (everything except `schema.ts`)

- [ ] **Step 1: Delete MySQL migration files**

```bash
cd /Users/huhanwei/Desktop/ce-project-hub && ls drizzle/   # note what's there
git rm -r drizzle/*.sql drizzle/meta 2>/dev/null || true
```

- [ ] **Step 2: Rewrite schema.ts with pg-core**

Conversion rules (apply to every table; keep all comments and exported types):

| MySQL | PostgreSQL |
|---|---|
| `import {...} from "drizzle-orm/mysql-core"` | `import {...} from "drizzle-orm/pg-core"` |
| `mysqlTable(` | `pgTable(` |
| `int("id").autoincrement().primaryKey()` | `serial("id").primaryKey()` |
| `int("x")` (non-PK) | `integer("x")` |
| `mysqlEnum("col", [...])` | `pgEnum` type + usage (see below) |
| `timestamp("updatedAt").defaultNow().onUpdateNow().notNull()` | `timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull()` |
| `json("col")` | `jsonb("col")` |
| `varchar`, `text`, `boolean`, `bigint`, `date`, `uniqueIndex`, `index` | same names exist in pg-core, unchanged |

pgEnum declarations to add near the top (PG enums are named DB types):

```ts
import {
  integer, serial, pgEnum, pgTable, text, timestamp, varchar,
  jsonb, boolean, bigint, uniqueIndex, index, date,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const projectRiskEnum = pgEnum("project_risk", ["low", "medium", "high"]);
export const projectMemberRoleEnum = pgEnum("project_member_role", PROJECT_MEMBER_ROLES);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const taskPriorityEnum = pgEnum("task_priority", TASK_PRIORITIES);
export const issueSeverityEnum = pgEnum("issue_severity", ISSUE_SEVERITIES);
export const issueStatusEnum = pgEnum("issue_status", ISSUE_STATUSES);
export const issueCategoryEnum = pgEnum("issue_category", ISSUE_CATEGORIES);
export const gateDecisionEnum = pgEnum("gate_decision", GATE_DECISIONS);
export const changeTypeEnum = pgEnum("change_type", CHANGE_TYPES);
export const changeStatusEnum = pgEnum("change_status", CHANGE_STATUSES);
```

(Note: the const arrays like `PROJECT_MEMBER_ROLES` must be declared BEFORE the pgEnum that uses them — reorder declarations accordingly. `pgEnum` requires a non-empty tuple; the existing `as const` arrays satisfy this.)

Usage example (users table):

```ts
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 64 }).unique(),
  passwordHash: varchar("passwordHash", { length: 256 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  canCreateProject: boolean("canCreateProject").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
```

Apply the same pattern to: `projects` (risk → `projectRiskEnum("risk")`), `projectMembers` (role → `projectMemberRoleEnum("role")`), `projectPhases`, `projectTasks` (status/priority enums, `visibleRoles: jsonb(...)`), `projectIssues` (severity/status/category enums), `projectGateReviews` (decision enum), `projectChangelog` (type/status enums, `affectedPhases: jsonb(...)`), `projectFiles` (`bigint("size", { mode: "number" })` unchanged), `activityLogs` (`meta: jsonb(...)`), `organizations`.

- [ ] **Step 3: Update drizzle.config.ts**

```ts
export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: connectionString },
});
```

- [ ] **Step 4: Swap drivers in package.json**

```bash
pnpm remove mysql2 && pnpm add pg && pnpm add -D @types/pg
```

- [ ] **Step 5: Typecheck (will fail in db.ts — expected, fixed in Task 3)**

```bash
pnpm check 2>&1 | head -30
```
Expected: errors only in `server/db.ts` / tests (mysql2 import, onDuplicateKeyUpdate), none in `drizzle/schema.ts`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: convert drizzle schema to postgresql"
```

---

### Task 3: Port server/db.ts to node-postgres

**Files:**
- Modify: `server/db.ts`

- [ ] **Step 1: Swap driver import (db.ts:2)**

```ts
import { drizzle } from "drizzle-orm/node-postgres";
```
`drizzle(process.env.DATABASE_URL)` (db.ts:24) works unchanged with node-postgres.

- [ ] **Step 2: upsertUser — onDuplicateKeyUpdate → onConflictDoUpdate (db.ts:83-85)**

```ts
await db.insert(users).values(values).onConflictDoUpdate({
  target: users.openId,
  set: updateSet,
});
```

- [ ] **Step 3: insertId → returning() (4 call sites: createProjectIssue db.ts:448-453, createProjectGateReview :485-490, createProjectChangeRecord :523-528, createProjectFile :553-558)**

Pattern for each (adjust table name):

```ts
export async function createProjectIssue(issue: InsertProjectIssue): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectIssues).values(issue).returning({ id: projectIssues.id });
  return result[0].id;
}
```

- [ ] **Step 4: FIELD() ordering → CASE (db.ts:736 in getMyTasks, db.ts:824 in getBlockedTasks)**

```ts
drizzleSql`CASE ${projectTasks.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
```
(replaces `FIELD(${projectTasks.priority}, 'critical', 'high', 'medium', 'low')`; the `${dueDate} IS NULL` ordering already works on PG, leave it.)

- [ ] **Step 5: Typecheck server/db.ts clean**

```bash
pnpm check 2>&1 | grep -v "test" | head -20
```
Expected: no errors in `server/db.ts` (test files fixed in Task 4).

- [ ] **Step 6: Commit**

```bash
git add server/db.ts && git commit -m "feat: port db layer to node-postgres"
```

---

### Task 4: Fix MySQL-isms in tests

**Files:**
- Modify: `server/smoke.test.ts` (`SHOW TABLES` + mysql2 result shape)
- Inspect & fix: `server/unique-constraints.test.ts`, `server/relational-tables.test.ts`, `server/infra-improvements.test.ts`, `server/auth.logout.test.ts`

- [ ] **Step 1: smoke.test.ts getTableNames → pg_tables**

```ts
async function getTableNames(): Promise<string[]> {
  const db = await getDb();
  const result = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  return (result.rows as Array<{ tablename: string }>).map((r) => r.tablename);
}
```
(node-postgres `execute` returns a `QueryResult` with `.rows`, unlike mysql2's `[rows, fields]` tuple.)

- [ ] **Step 2: Grep all test files for other MySQL assumptions and fix with the same patterns**

```bash
grep -n "SHOW TABLES\|insertId\|ER_DUP\|Duplicate entry\|mysql" server/*.test.ts
```
Fix each hit: duplicate-key error assertions should match PG error text (`duplicate key value violates unique constraint`) — if a test asserts on MySQL error strings/codes, loosen it to check that an error is thrown on duplicate insert (e.g. `await expect(insertDuplicate()).rejects.toThrow()`).

- [ ] **Step 3: Full typecheck clean**

```bash
pnpm check
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/*.test.ts && git commit -m "fix: port tests to postgresql"
```

---

### Task 5: Replace Forge storage with S3-compatible storage

**Files:**
- Modify: `server/_core/env.ts` (drop forge/oauth vars, add S3 vars)
- Rewrite: `server/storage.ts` (Forge presign → @aws-sdk/client-s3)
- Rewrite: `server/_core/storageProxy.ts` (`/manus-storage/*` → `/storage/*` presigned redirect)
- Modify: `server/routers/files.ts:56-73` (tryInvalidateS3Object → storageDelete)
- Modify: `client/src/lib/data.ts:50` (comment only)

- [ ] **Step 1: New env.ts**

```ts
export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // S3-compatible object storage (MinIO / Aliyun OSS / AWS S3)
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  // path-style is required for MinIO; Aliyun OSS uses virtual-hosted style
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
};
```
Keep `appId`/`oAuthServerUrl` OUT — Task 6 removes their consumers first if ordering bites; if `pnpm check` complains here, do Task 6 Step 1-2 before this step. (`appId` is referenced by `server/_core/sdk.ts`.)

- [ ] **Step 2: Rewrite server/storage.ts**

```ts
// S3-compatible object storage (MinIO / Aliyun OSS / AWS S3).
// Uploads go directly through the SDK; downloads are served via
// /storage/{key} which 307-redirects to a presigned GET URL.

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

let _client: S3Client | null = null;

function getS3Config() {
  if (!ENV.s3Bucket || !ENV.s3AccessKeyId || !ENV.s3SecretAccessKey) {
    throw new Error(
      "Storage config missing: set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY",
    );
  }
  if (!_client) {
    _client = new S3Client({
      region: ENV.s3Region,
      ...(ENV.s3Endpoint ? { endpoint: ENV.s3Endpoint } : {}),
      forcePathStyle: ENV.s3ForcePathStyle,
      credentials: {
        accessKeyId: ENV.s3AccessKeyId,
        secretAccessKey: ENV.s3SecretAccessKey,
      },
    });
  }
  return { client: _client, bucket: ENV.s3Bucket };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const { client, bucket } = getS3Config();
  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data) : data;
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return { key, url: `/storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string, expiresInSeconds = 3600): Promise<string> {
  const { client, bucket } = getS3Config();
  const key = normalizeKey(relKey);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

export async function storageDelete(relKey: string): Promise<void> {
  const { client, bucket } = getS3Config();
  const key = normalizeKey(relKey);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
```

- [ ] **Step 3: Write a unit test for storage (no network needed — presigning is offline)**

Create `server/storage.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_ACCESS_KEY_ID = "test-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_FORCE_PATH_STYLE = "true";
});

describe("storage (S3-compatible)", () => {
  it("storageGetSignedUrl produces a presigned URL for the right object", async () => {
    const { storageGetSignedUrl } = await import("./storage");
    const url = await storageGetSignedUrl("projects/p1/files/a.pdf");
    expect(url).toContain("test-bucket");
    expect(url).toContain("projects/p1/files/a.pdf");
    expect(url).toContain("X-Amz-Signature=");
  });

  it("storageGet returns an app-served /storage/ path", async () => {
    const { storageGet } = await import("./storage");
    const { url, key } = await storageGet("/projects/p1/files/a.pdf");
    expect(key).toBe("projects/p1/files/a.pdf");
    expect(url).toBe("/storage/projects/p1/files/a.pdf");
  });
});
```
CAVEAT: env.ts reads process.env at module load — `beforeAll` must run before the dynamic `import("./storage")`, which the test does. Run: `pnpm vitest run server/storage.test.ts` — expect FAIL before Step 2 is saved, PASS after.

- [ ] **Step 4: Rewrite storageProxy.ts as /storage/ redirect**

```ts
import type { Express } from "express";
import { storageGetSignedUrl } from "../storage";

export function registerStorageProxy(app: Express) {
  app.get("/storage/*", async (req, res) => {
    const key = req.path.replace(/^\/storage\//, "");
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    try {
      const url = await storageGetSignedUrl(key);
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
```

- [ ] **Step 5: files.ts — replace tryInvalidateS3Object body**

Delete the Forge-based implementation (files.ts:56-73), replace with:

```ts
import { storagePut, storageDelete } from "../storage";

async function tryInvalidateS3Object(storageKey: string): Promise<void> {
  try {
    await storageDelete(storageKey);
  } catch (err) {
    console.warn("[FileDelete] S3 invalidation failed (non-fatal):", err);
  }
}
```
Also update the `client/src/lib/data.ts:50` comment from `/manus-storage/{key}` to `/storage/{key}`.

- [ ] **Step 6: Run storage tests + typecheck**

```bash
pnpm vitest run server/storage.test.ts && pnpm check
```
Expected: PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: replace Manus Forge storage with S3-compatible storage"
```

---

### Task 6: Remove Manus OAuth + dead template modules

**Files:**
- Delete: `server/_core/llm.ts`, `notification.ts`, `dataApi.ts`, `map.ts`, `imageGeneration.ts`, `voiceTranscription.ts`, `oauth.ts`, `server/_core/types/manusTypes.ts` (if only used by deleted modules)
- Delete: `client/src/components/ManusDialog.tsx`, `client/public/__manus__/`
- Modify: `server/_core/index.ts` (drop `registerOAuthRoutes`)
- Modify: `server/_core/sdk.ts` (strip OAuth token-exchange; keep JWT session functions)
- Modify: `client/src/pages/Login.tsx` (remove Manus OAuth button block, lines ~107-117 + ~300-318)
- Modify: `client/src/const.ts` (remove `getManusOAuthUrl`)
- Modify: `client/src/_core/hooks/useAuth.ts` (check the `manus-runtime-user-info` reference; remove if it's a postMessage/runtime hook)
- Modify: `vite.config.ts` (remove `vitePluginManusRuntime` + debug collector + manus allowedHosts)
- Modify: `package.json` (remove `vite-plugin-manus-runtime`)

- [ ] **Step 1: Delete dead server modules**

```bash
git rm server/_core/llm.ts server/_core/notification.ts server/_core/dataApi.ts server/_core/map.ts server/_core/imageGeneration.ts server/_core/voiceTranscription.ts server/_core/oauth.ts
git rm client/src/components/ManusDialog.tsx
git rm -r client/public/__manus__
```

- [ ] **Step 2: index.ts — remove OAuth registration**

Remove `import { registerOAuthRoutes } from "./oauth";` (index.ts:6) and the `registerOAuthRoutes(app);` call (index.ts:51).

- [ ] **Step 3: Trim sdk.ts**

Read `server/_core/sdk.ts` first. Keep: `createSessionToken`, `verifySession`, `authenticateRequest` (used by context.ts/routers.ts for the password-auth session JWT). Delete: `exchangeCodeForToken`, `getUserInfo`, and any fetch calls to `ENV.oAuthServerUrl`/`webdev.v1.WebDevAuthPublicService`. Then remove `appId`/`oAuthServerUrl` from env.ts if Task 5 left them. After trimming, `grep -rn "oAuthServerUrl\|appId" server/ shared/` must return nothing.

- [ ] **Step 4: Login.tsx — remove the Manus button**

Remove `import { getManusOAuthUrl } from '@/const';`, `handleManusLogin`, and the entire OAuth button JSX block (divider + button + "Manus 登录在中国大陆可能不可用" caption). Remove `getManusOAuthUrl` from `client/src/const.ts`. Check `useAuth.ts:46` — if `manus-runtime-user-info` is a dead postMessage listener, delete that branch.

- [ ] **Step 5: vite.config.ts cleanup**

Remove the `vitePluginManusRuntime` import and plugin call, the whole `vitePluginManusDebugCollector` plugin (lines 9-151), and the `.manus*` entries in `server.allowedHosts` (keep `localhost`, `127.0.0.1`, add `"beepump.io"`). Then:

```bash
pnpm remove vite-plugin-manus-runtime
```

- [ ] **Step 6: Sweep for leftovers**

```bash
grep -rn -i "manus\|forge" server/ client/src/ shared/ vite.config.ts package.json --include='*.ts' --include='*.tsx' --include='*.json' | grep -v node_modules
```
Expected: no functional hits (historical comments in todo.md are fine; this grep doesn't cover it).

- [ ] **Step 7: Typecheck + all unit tests that don't need a DB**

```bash
pnpm check && pnpm vitest run server/storage.test.ts
```
Expected: exit 0, PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "refactor: remove Manus OAuth and dead platform modules"
```

---

### Task 7: Generate PG migrations + run full test suite against local Postgres

**Files:**
- Create: `drizzle/0000_*.sql` + `drizzle/meta/` (generated)
- Create: `.env` (local dev, gitignored — verify `.gitignore` covers it)

- [ ] **Step 1: Start disposable Postgres + MinIO (Docker)**

```bash
docker run -d --name cehub-pg -e POSTGRES_PASSWORD=cehub -e POSTGRES_DB=cehub -p 55432:5432 postgres:16
docker run -d --name cehub-minio -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin -p 59000:9000 minio/minio server /data
```
If Docker is not installed/running: skip DB-dependent tests in this task, note it, and verify on the server later (record this in the final report).

- [ ] **Step 2: Local .env**

```bash
cat > .env <<'EOF'
DATABASE_URL=postgres://postgres:cehub@localhost:55432/cehub
JWT_SECRET=local-dev-secret-at-least-32-chars-long!!
S3_ENDPOINT=http://localhost:59000
S3_REGION=us-east-1
S3_BUCKET=cehub
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
EOF
grep -q '^\.env' .gitignore || echo '.env' >> .gitignore
```

- [ ] **Step 3: Generate + apply migrations**

```bash
pnpm db:push
```
Expected: drizzle-kit generates `drizzle/0000_*.sql` with `CREATE TYPE` for the 11 enums + `CREATE TABLE` for 12 tables, then applies them.

- [ ] **Step 4: Create the MinIO bucket**

```bash
docker exec cehub-minio mkdir -p /data/cehub
```

- [ ] **Step 5: Full test suite**

```bash
pnpm test
```
Expected: all suites PASS (smoke, unique-constraints, relational-tables, infra-improvements, auth.logout, storage).

- [ ] **Step 6: Boot dev server and smoke the UI**

```bash
pnpm dev   # in background; then verify login page renders, create admin via /api/setup if applicable (check server/setup.ts behavior), create a project, upload a file, fetch it back via /storage/ URL
```
Use preview/browser tooling or curl: `curl -s localhost:3000/login | head`. Verify fonts load from `/fonts/`.

- [ ] **Step 7: Commit**

```bash
git add drizzle .gitignore && git commit -m "feat: postgresql migrations"
```

---

### Task 8: Dockerfile + docker-compose + deploy docs

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml` (app + postgres + minio, each optional via profiles)
- Create: `.env.example`
- Create: `DEPLOY.md`

- [ ] **Step 1: Dockerfile (multi-stage, pnpm)**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: docker-compose.yml**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      - db
      - minio

  # Local Postgres — omit and point DATABASE_URL at Aliyun RDS in production
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: cehub
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-cehub}
    volumes:
      - pgdata:/var/lib/postgresql/data

  minio:
    image: minio/minio
    restart: unless-stopped
    command: server /data
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
    volumes:
      - miniodata:/data

volumes:
  pgdata:
  miniodata:
```

- [ ] **Step 3: .env.example**

```bash
# ── Required ──────────────────────────────────────────────
# Aliyun RDS PostgreSQL, e.g. postgres://user:pass@pgm-xxxx.pg.rds.aliyuncs.com:5432/cehub
DATABASE_URL=postgres://postgres:cehub@db:5432/cehub
# >= 32 chars random string: openssl rand -base64 32
JWT_SECRET=change-me-to-a-random-32+-char-string
NODE_ENV=production

# ── Object storage (S3-compatible: MinIO below, or Aliyun OSS) ──
# Aliyun OSS example: S3_ENDPOINT=https://oss-cn-shenzhen.aliyuncs.com, S3_FORCE_PATH_STYLE=false
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=cehub
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
```

- [ ] **Step 4: DEPLOY.md** — short runbook: server prerequisites (Docker), `docker compose up -d`, run migrations (`docker compose run --rm app npx drizzle-kit migrate` or `pnpm db:push` from local pointing at RDS), first-admin setup, Caddy/Nginx HTTPS reverse proxy snippet for beepump.io, and the DNS cutover step (A record → server IP; keep Manus instance as fallback for a few days). Include the note that S3_ENDPOINT must use the OSS *internal* endpoint when app and OSS are in the same Aliyun region.

- [ ] **Step 5: Verify Docker build**

```bash
docker build -t cehub-test . && docker run --rm cehub-test node --version
```
Expected: build succeeds. (Full compose-up E2E optional locally; primary E2E already done in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example DEPLOY.md && git commit -m "feat: docker deployment for self-hosting"
```

---

## Self-Review Notes

- Spec coverage: PG migration (Tasks 2-4, 7), storage swap (Task 5), Manus removal (Tasks 1, 5, 6), self-host deploy (Task 8). No data migration per user.
- Type consistency: `storageDelete` defined Task 5 Step 2, consumed Task 5 Step 5. `storageGetSignedUrl(key, expiresIn?)` consumed by storageProxy Task 5 Step 4. Enum names defined Task 2 used only within schema.ts.
- Known risk: `setup.ts` (first-admin bootstrap) and `systemRouter.ts` not yet read — Task 6 Step 3 / Task 7 Step 6 must check them for `ENV.appId`/OAuth references and clean accordingly.
