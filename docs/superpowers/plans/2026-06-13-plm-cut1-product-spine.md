# PLM 第一刀 · Product 脊梁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把双轴 PLM 的「Product 脊梁」插进现有库：新增 platforms / products / product_revisions 三张表，给 projects 加 productId/mode/objectType/baseRevisionId/resultRevisionId，角色枚举加 pe/mfg/sales/cert/battery_safety；后端 db + tRPC + 前端「产品库/平台库」导航。全为加法，不删改现有列、不碰现有项目功能。

**Architecture:** 沿用现有栈：Drizzle(pg-core) schema → drizzle-kit 迁移 → `server/db.ts` 读写函数 → tRPC 路由(`server/routers/products.ts`)→ 客户端 wouter 页面 + DashboardLayout 导航。顶层实体(product/platform) 用 nanoid varchar(32) 主键，子表(product_revisions) 用 serial。测试沿用 `server/*.test.ts` 直连本地 docker PG 的模式。

**Tech Stack:** drizzle-orm/pg-core、drizzle-kit、@trpc/server、nanoid、vitest、React + wouter。

**前置：** 本地 docker `cehub-pg`(:55432) 运行中；`.env` 指向它；分支 `plm-cut1-product-spine`；工作区干净。设计依据：`docs/design/2026-06-13-two-axis-plm-architecture.md` §11。

---

### Task 1: Schema — 三张新表 + projects 新列 + 角色枚举

**Files:**
- Modify: `drizzle/schema.ts`（在 `organizations` 表后追加新表；改 `PROJECT_MEMBER_ROLES`；改 `projects`）

- [ ] **Step 1: 角色枚举加 5 个值**

`drizzle/schema.ts` 的 `PROJECT_MEMBER_ROLES` 数组，在 `"scm",` 之后、`"viewer",` 之前插入：

```ts
  "scm",
  "pe",
  "mfg",
  "sales",
  "cert",
  "battery_safety",
  "viewer",
```

- [ ] **Step 2: projects 表加 5 列**

在 `projects` 的 `orgId: integer("orgId"),` 之后插入：

```ts
  /** 派生自哪个产品（PLM 脊梁）。现有项目为空。 */
  productId: varchar("productId", { length: 32 }),
  /** 开发模式：npd_new_category | npd_new_platform | npd_derivative | eco | idr */
  mode: varchar("mode", { length: 32 }).notNull().default("npd"),
  /** 开发对象：finished | component */
  objectType: varchar("objectType", { length: 16 }).notNull().default("finished"),
  /** 派生起点版本（量产后项目指向当前 Rev） */
  baseRevisionId: integer("baseRevisionId"),
  /** 发布时回填的产出版本 */
  resultRevisionId: integer("resultRevisionId"),
```

- [ ] **Step 3: 在文件末尾（organizations 表与其 type 之后）追加三张新表**

```ts
// ─────────────────────────────────────────────────────────────────────────────
// PLM Spine: Platforms / Products / Product Revisions
// ─────────────────────────────────────────────────────────────────────────────

/** 平台 = 一组可复用核心模块版本的捆绑；整机派生自平台 */
export const platforms = pgTable("platforms", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  category: varchar("category", { length: 64 }).notNull().default(""),
  description: text("description"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type Platform = typeof platforms.$inferSelect;
export type InsertPlatform = typeof platforms.$inferInsert;

/** 产品 = 长期主数据；type 区分整机/零部件 */
export const products = pgTable("products", {
  id: varchar("id", { length: 32 }).primaryKey(),
  productNumber: varchar("productNumber", { length: 64 }).notNull().default(""),
  name: varchar("name", { length: 256 }).notNull(),
  /** finished（整机）| component（零部件：机芯/电机/电池包） */
  type: varchar("type", { length: 16 }).notNull().default("finished"),
  /** 开放品类：风扇 / 充气泵 / … */
  category: varchar("category", { length: 64 }).notNull().default(""),
  /** 派生自哪个平台（可空） */
  platformId: varchar("platformId", { length: 32 }),
  /** 目标市场字符串数组 EU/US/JP… */
  targetMarkets: jsonb("targetMarkets").$type<string[]>().default([]),
  /** concept | development | mass_production | maintenance | eol */
  lifecycleState: varchar("lifecycleState", { length: 32 }).notNull().default("concept"),
  /** 当前生产版本（FK product_revisions.id，可空） */
  currentRevisionId: integer("currentRevisionId"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});
export type ProductRow = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

/** 产品版本 = 冻结版本（PLM 轴）；版本链由项目串起 */
export const productRevisions = pgTable(
  "product_revisions",
  {
    id: serial("id").primaryKey(),
    productId: varchar("productId", { length: 32 }).notNull(),
    /** Rev A / B / C */
    revisionLabel: varchar("revisionLabel", { length: 16 }).notNull(),
    /** 父版本（自引用，量产后版本链） */
    parentRevisionId: integer("parentRevisionId"),
    /** 产出该版本的来源项目 */
    createdByProjectId: varchar("createdByProjectId", { length: 32 }),
    /** draft | released | superseded */
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    releasedAt: timestamp("releasedAt"),
    releasedBy: integer("releasedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    uniqProductRevision: uniqueIndex("uniq_product_revision").on(
      table.productId,
      table.revisionLabel
    ),
    idxProduct: index("idx_product_revisions_product").on(table.productId),
  })
);
export type ProductRevision = typeof productRevisions.$inferSelect;
export type InsertProductRevision = typeof productRevisions.$inferInsert;
```

- [ ] **Step 4: 类型检查通过**

Run: `pnpm check`
Expected: exit 0（schema 只是加表加列，不影响现有代码）。

- [ ] **Step 5: Commit**

```bash
git add drizzle/schema.ts
git commit -m "feat(schema): add platforms/products/product_revisions + projects PLM columns + roles"
```

---

### Task 2: 生成并应用迁移（本地 docker PG）

**Files:**
- Create: `drizzle/0001_*.sql` + `drizzle/meta/*`（drizzle-kit 生成）

- [ ] **Step 1: 生成 + 应用迁移**

Run: `set -a && source .env && set +a && pnpm db:push`
Expected: 生成 `drizzle/0001_*.sql`（含 `CREATE TABLE platforms/products/product_revisions`、`ALTER TABLE projects ADD COLUMN ...`、`ALTER TYPE project_member_role ADD VALUE ...`），并 `applying migrations... migrations applied successfully!`

- [ ] **Step 2: 验证表已建**

Run: `docker exec cehub-pg psql -U postgres -d cehub -c "\dt" | grep -E "platforms|products|product_revisions"`
Expected: 三张表都列出。

- [ ] **Step 3: 验证 projects 新列**

Run: `docker exec cehub-pg psql -U postgres -d cehub -c "\d projects" | grep -E "productId|mode|objectType"`
Expected: 三列存在。

- [ ] **Step 4: Commit**

```bash
git add drizzle
git commit -m "feat: generate PLM spine migration"
```

---

### Task 3: db.ts 读写函数 + 测试

**Files:**
- Modify: `server/db.ts`（末尾追加 products/platforms helpers）
- Create: `server/products.test.ts`

- [ ] **Step 1: 写失败测试**

Create `server/products.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb, createPlatform, createProduct, getProductById,
  listProductsByCategory, createProductRevision, listProductRevisions,
} from "./db";

const SUF = "cut1test";
const PLATFORM_ID = `pf_${SUF}`;
const PRODUCT_ID = `pr_${SUF}`;

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM product_revisions WHERE "productId" = ${PRODUCT_ID}`);
  await db.execute(sql`DELETE FROM products WHERE id = ${PRODUCT_ID}`);
  await db.execute(sql`DELETE FROM platforms WHERE id = ${PLATFORM_ID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

describe("PLM spine db helpers", () => {
  it("creates a platform and a product referencing it", async () => {
    await createPlatform({ id: PLATFORM_ID, name: "锂电充气泵平台", category: "充气泵", createdBy: 1 });
    await createProduct({
      id: PRODUCT_ID, productNumber: "CE-PUMP-001", name: "露营充气泵",
      type: "finished", category: "充气泵", platformId: PLATFORM_ID,
      targetMarkets: ["EU", "US"], createdBy: 1,
    });
    const p = await getProductById(PRODUCT_ID);
    expect(p?.name).toBe("露营充气泵");
    expect(p?.targetMarkets).toEqual(["EU", "US"]);
    expect(p?.platformId).toBe(PLATFORM_ID);
  });

  it("lists products by category", async () => {
    const rows = await listProductsByCategory("充气泵");
    expect(rows.some((r) => r.id === PRODUCT_ID)).toBe(true);
  });

  it("creates and lists product revisions", async () => {
    const id = await createProductRevision({ productId: PRODUCT_ID, revisionLabel: "Rev A", status: "draft" });
    expect(id).toBeGreaterThan(0);
    const revs = await listProductRevisions(PRODUCT_ID);
    expect(revs.map((r) => r.revisionLabel)).toContain("Rev A");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `set -a && source .env && set +a && pnpm vitest run server/products.test.ts`
Expected: FAIL（`createPlatform` 等未导出）。

- [ ] **Step 3: 实现 helpers**

在 `server/db.ts` 末尾追加（并在顶部 import 里加入 `platforms, products, productRevisions, InsertPlatform, InsertProduct, InsertProductRevision, ProductRow, ProductRevision` 来自 `../drizzle/schema`）：

```ts
// ── PLM spine: platforms / products / revisions ───────────────────────────────

export async function createPlatform(p: InsertPlatform): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(platforms).values(p);
}

export async function createProduct(p: InsertProduct): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(products).values(p);
}

export async function getProductById(id: string): Promise<ProductRow | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const r = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return r[0];
}

export async function listProductsByCategory(category?: string): Promise<ProductRow[]> {
  const db = await getDb();
  if (!db) return [];
  const q = db.select().from(products);
  const rows = category
    ? await q.where(eq(products.category, category)).orderBy(desc(products.updatedAt))
    : await q.orderBy(desc(products.updatedAt));
  return rows;
}

export async function createProductRevision(r: InsertProductRevision): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const res = await db.insert(productRevisions).values(r).returning({ id: productRevisions.id });
  return res[0].id;
}

export async function listProductRevisions(productId: string): Promise<ProductRevision[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productRevisions)
    .where(eq(productRevisions.productId, productId))
    .orderBy(productRevisions.id);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `set -a && source .env && set +a && pnpm vitest run server/products.test.ts`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 全量测试无回归**

Run: `set -a && source .env && set +a && pnpm test`
Expected: 所有套件 PASS。

- [ ] **Step 6: Commit**

```bash
git add server/db.ts server/products.test.ts
git commit -m "feat(db): products/platforms/revisions helpers + tests"
```

---

### Task 4: tRPC 路由 products

**Files:**
- Create: `server/routers/products.ts`
- Modify: `server/routers.ts`（挂载 productsRouter）

- [ ] **Step 1: 写路由**

Create `server/routers/products.ts`:

```ts
import { z } from "zod";
import { nanoid } from "nanoid";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createProduct, getProductById, listProductsByCategory,
  createPlatform, listProductRevisions,
} from "../db";

export const productsRouter = router({
  list: protectedProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(({ input }) => listProductsByCategory(input?.category)),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getProductById(input.id)),

  revisions: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(({ input }) => listProductRevisions(input.productId)),

  create: protectedProcedure
    .input(z.object({
      productNumber: z.string().default(""),
      name: z.string().min(1),
      type: z.enum(["finished", "component"]).default("finished"),
      category: z.string().default(""),
      platformId: z.string().optional(),
      targetMarkets: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      await createProduct({ id, createdBy: ctx.user.id, ...input });
      return { id };
    }),

  createPlatform: protectedProcedure
    .input(z.object({ name: z.string().min(1), category: z.string().default(""), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      await createPlatform({ id, createdBy: ctx.user.id, ...input });
      return { id };
    }),
});
```

- [ ] **Step 2: 挂载到 appRouter**

`server/routers.ts`：import 后在 router 对象里加一行。在 `import { filesRouter } from "./routers/files";` 后加：

```ts
import { productsRouter } from "./routers/products";
```

在 appRouter 的 `files: filesRouter,` 后加：

```ts
  products: productsRouter,
```

- [ ] **Step 3: 类型检查**

Run: `pnpm check`
Expected: exit 0。

- [ ] **Step 4: Commit**

```bash
git add server/routers/products.ts server/routers.ts
git commit -m "feat(trpc): products/platforms router"
```

---

### Task 5: 客户端「产品库」页面 + 导航

**Files:**
- Read first: `client/src/components/DashboardLayout.tsx`、`client/src/pages/Home.tsx`、`client/src/App.tsx`（WIP 已改为 lazy 路由）
- Create: `client/src/pages/ProductLibrary.tsx`
- Modify: `client/src/App.tsx`（加 `/products` 路由）、`DashboardLayout.tsx`（加导航项）

- [ ] **Step 1: 读现状**

Read `client/src/App.tsx`、`client/src/components/DashboardLayout.tsx`、`client/src/pages/Home.tsx`，确认 lazy 路由写法与导航项结构（侧边栏按钮如何注册、如何跳转）。

- [ ] **Step 2: 建产品库页**

Create `client/src/pages/ProductLibrary.tsx`：用 `trpc.products.list.useQuery()` 列出产品，按 `category` 分组展示（产品号/名称/类型/生命周期/目标市场 badge）；顶部「新建产品」按钮调用 `trpc.products.create.useMutation`（字段：name、productNumber、type、category、targetMarkets）。复用现有 UI 组件（Card/Button/Dialog/Input，参照 `AdminPanel.tsx` 的弹窗写法）。页面用 `DashboardLayout` 包裹保持一致外观。

- [ ] **Step 3: 加路由**

`client/src/App.tsx`：仿照现有 lazy 页面，加
```ts
const ProductLibrary = lazy(() => import("./pages/ProductLibrary"));
```
并在 `<Switch>` 内加 `<Route path={"/products"} component={ProductLibrary} />`。

- [ ] **Step 4: 加导航项**

`DashboardLayout.tsx`：在导航列表加「产品库 / PRODUCTS」入口，点击 `navigate("/products")`（沿用现有导航项写法与图标，如 lucide `Package`）。

- [ ] **Step 5: 起服务验证**

用 preview 工具起 `cehub-dev`（端口冲突则用 3010），登录后访问 `/products`：新建一个产品（露营充气泵 / 充气泵 / EU,US），确认出现在列表；`docker exec cehub-pg psql -U postgres -d cehub -c "SELECT id,name,category FROM products;"` 确认落库。

- [ ] **Step 6: 类型检查 + Commit**

Run: `pnpm check`
```bash
git add client/src/pages/ProductLibrary.tsx client/src/App.tsx client/src/components/DashboardLayout.tsx
git commit -m "feat(client): product library page + nav"
```

---

### Task 6: 上 RDS（生产迁移）

- [ ] **Step 1: 对 RDS 应用迁移**

Run: `DATABASE_URL="postgres://ce_hub:<DB_PASSWORD>@pgm-2ze135h6045td5uj.pg.rds.aliyuncs.com:5432/cehub?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=$(pwd)/certs/ApsaraDB-CA-Chain.pem" npx drizzle-kit migrate`
Expected: migrations applied。（数据近零，加法迁移安全。）

- [ ] **Step 2: 验证 RDS**

Run: `node -e` 连接 RDS 查询 `SELECT count(*) FROM products;`（应为 0，表存在即可）。

- [ ] **Step 3: 部署应用**（含 products 路由 + 产品库页）

Run: `bash scripts/deploy-ecs.sh`，烟雾测试 hub.beepump.net 正常、`/products` 可访问。

---

## Self-Review

- **Spec 覆盖**（架构 §11 第一刀相关）：platforms/products/product_revisions ✓(T1)、projects 加列 ✓(T1)、角色 ✓(T1)、迁移 ✓(T2/T6)、db+router ✓(T3/T4)、产品库导航 ✓(T5)。MP Release / 模块库 / BOM 属后续刀，不在本计划。
- **类型一致**：helper 名 `createPlatform/createProduct/getProductById/listProductsByCategory/createProductRevision/listProductRevisions` 在 T3 定义、T4 引用，一致；表/类型名与 schema 一致。
- **无占位**：每步含实际代码/命令。T5 client 因 WIP 改过文件，首步显式要求先读现状再写（非占位，是必要前置）。
