# 变更记录 ↔ 版本关联 — 设计文档

日期：2026-06-18
状态：已评审，待实现
范围：PLM 闭环最后一块缺口（backlog P2「变更↔版本关联」）。让"两个版本之间为什么改"可追溯。其余 backlog 项各自独立。相关 memory `automation-feature-roadmap`。

## 目标

当前 `projectChangelog`（design/cost/supplier/eco/ecn… 九类变更）只挂在 `projectId`（+ `productId` 溯源），**没有 `revisionId`**。结果：两个版本能做 BOM diff（看出"改了什么"），但答不出"**为什么改**"。本设计在发布时把项目期间的变更记录盖章到产出版本，并冻一份不可变"发布说明"，关闭这块缺口。

## 现状（已有基础）

- `projectChangelog`（`drizzle/schema.ts`）：`projectId / number(ECR-001) / type(CHANGE_TYPES 9种) / title / description / reason / decisionMaker / affectedPhases / status(CHANGE_STATUSES) / costImpact / scheduleImpact / createdDate / implementedDate / creatorId / productId`。**无 revisionId**。
- `CHANGE_STATUSES = [proposed, approved, rejected, implemented, cancelled]`。
- `server/routers/changelog.ts`：list/create/update/delete，写 `change.*` activityLog。无版本维度。
- `mpReleases`（`drizzle/schema.ts`）：`productId / revisionId / snapshotBom(jsonb) / snapshotDocs(jsonb) / releasedAt …`——**已有快照模式先例**。
- `releaseProject`（`server/db.ts`）：事务内建 `resultRevision(status=released)`、冻结 BOM、写 `mpReleases` 快照、产品转量产、项目回填 `resultRevisionId` 并归档。已有 advisory lock 防重复发布、conditional override 留痕。
- `ProductLibraryView.tsx`：「版本时间线弹窗」按产品列 revision（`trpc.products.revisions`，展示 revisionLabel/status/releasedAt/createdByProjectId）。
- `bomDiff(revA, revB)` 路由已暴露（`server/routers/bom.ts` `diff`），但前端暂无 UI。

缺口：changelog 无 revisionId；发布时不沉淀"本版变更"；版本时间线看不到"为什么改"。

## 关键设计决策（已评审确认）

1. **发布时自动盖章**：项目期间 changelog 的 `revisionId` 为空；`releaseProject` 事务里把本项目变更盖上新的 `resultRevisionId`。贴合"项目→一个产出版本"的现有流程，零手工。
2. **盖章范围 = implemented + approved**：排除 proposed/rejected/cancelled（"这版实际包含的变更"）。
3. **版本关联字段 + 发布快照双写**：`changelog.revisionId`（应用层关联字段，可反查）+ `mpReleases.snapshotChangelog`（不可变发布说明，与 snapshotBom 一致）。**快照是历史真相源，`revisionId` 仅辅助反查**：版本时间线**读快照**，发布后即便编辑/删除 changelog 也不篡改已冻结的历史。
4. **不引入 DB 级 FK**：全库 schema 现状零 `.references()`（连 `mpReleases.revisionId` 也是裸 integer），外键一律应用层维护。本字段沿用此惯例——`revisionId` 不加 DB FK 约束，但**加索引**支持反查。
5. **存量豁免**：已发布版本不回填（缺口本就是新的）。

## 设计

### A. 纯函数 `shared/changelog-snapshot.ts`（新增）

无 IO，便于单测。负责"哪些变更进版本"的过滤 + 快照形状映射，发布盖章与快照共用同一口径，避免漂移。

```ts
export const REVISION_CHANGE_STATUSES = ["implemented", "approved"] as const;

export type RevisionChangeEntry = {
  number: string;
  type: string;        // CHANGE_TYPES
  title: string;
  reason: string | null;
  decisionMaker: string | null;
  costImpact: string | null;
  scheduleImpact: string | null;
  implementedDate: string | null;
};

// 输入 changelog 行，输出快照条目：过滤 REVISION_CHANGE_STATUSES + 排序 + 映射。
// 排序确定（UI/测试依赖数组顺序）：createdDate asc(null 末尾) → number asc → id asc。
export function buildRevisionChangelogSnapshot(
  records: Array<{ id: number; status: string; number: string; type: string; title: string;
    reason: string | null; decisionMaker: string | null; createdDate: string | null;
    costImpact: string | null; scheduleImpact: string | null; implementedDate: string | null }>
): RevisionChangeEntry[];
```

口径单源：快照过滤与盖章 SQL 的状态集合**都从 `REVISION_CHANGE_STATUSES` 派生**（`inArray(projectChangelog.status, REVISION_CHANGE_STATUSES)`），不各写一份。函数的过滤对已过滤输入幂等（见 C：快照由 UPDATE RETURNING 的行喂入，函数再做排序+映射，过滤为安全兜底）。

### B. Schema 变更（drizzle generate 迁移）

- `projectChangelog` 加 `revisionId: integer("revisionId")`（可空，版本关联字段）。**不加 `.references()`**（沿用全库零 FK 惯例），但加索引 `idxRevision: index("idx_changelog_revision").on(table.revisionId)` 支持反查。
- `mpReleases` 加 `snapshotChangelog: jsonb("snapshotChangelog").$type<RevisionChangeEntry[]>().default([])`。

> 迁移按统一机制：`drizzle-kit generate` 生成 SQL + 程序化 migrate，不手写裸 SQL（见 memory `migration-mechanism-unified`）。

### C. 发布盖章（`server/db.ts` `releaseProject` 事务内）

在建完 `resultRevision`、冻结 BOM 之后、写 `mpReleases` 之时，**先盖章再用盖章结果生成快照**（保证盖章集合 ≡ 快照集合）：

1. `const stamped = UPDATE project_changelog SET revisionId = :revId WHERE projectId = :pid AND status IN (REVISION_CHANGE_STATUSES) RETURNING *`（事务内，状态集合从常量派生）。
2. `const snapshot = buildRevisionChangelogSnapshot(stamped)`（排序+映射；过滤对已盖章行幂等）。
3. 写 `mpReleases.snapshotChangelog = snapshot`（与 snapshotBom/snapshotDocs 同一 insert）。

> 为什么用 `UPDATE … RETURNING` 而非"先 SELECT 生成快照、再 UPDATE"：发布事务有 advisory lock，但 changelog 的 update/delete 接口**不吃这把锁**，两步之间若有并发改动会让快照与 `revisionId` 不一致。`RETURNING` 让快照直接由被盖章的行生成，天然一致。

全部在现有 release 事务内，保持原子性；无 changelog → `stamped=[]` → 快照空数组、不报错。

### D. 读路径

- 版本时间线展示**读 `mpReleases.snapshotChangelog`**（不可变、无需 join）。
- `products.revisions` 查询（或新增 `products.releaseDetail`）随 revision 一并返回其 `snapshotChangelog`（按 revisionId 关联 mpReleases）。优先扩展现有 `revisions` 返回体，避免新路由。
- FK `revisionId` 本期仅落库，反查 UI（"这条变更进了哪版"）留后续。

### E. UI（扩展 `ProductLibraryView` 版本时间线弹窗）

每个 `released` 版本节点下加一段可展开 **「本版本变更（N 条）」**：列 `type 徽标 + title + reason`，N=0 时显示"无登记变更"。`ChangeLog.tsx`（项目期间编辑视图）不动。

### F. 已盖章记录的编辑/删除约束（`server/routers/changelog.ts`）

快照是历史真相、不受影响；但 `revisionId` 反查链若被删除会断链。最小守卫：

- **delete**：已盖章记录（`revisionId != null`）**禁止删除**，返回 `FORBIDDEN("已并入发布版本的变更记录不可删除")`。未盖章记录维持原逻辑（创建者/有权限者可删）。
- **update**：维持原逻辑允许编辑——快照已冻结，改动只影响活记录、不篡改发布历史。`update` 入参本就不含 `revisionId`，无法手工改挂版本。

这是对 `changelog.ts` 的**唯一**改动（delete 加一行守卫），其余路由不动。

### 数据流

```
releaseProject(事务)
  → 建 resultRevision(released)
  → 冻结 BOM
  → records = 查项目 changelog
  → snapshot = buildRevisionChangelogSnapshot(records)   // 过滤 implemented+approved
  → UPDATE changelog SET revisionId WHERE status in(implemented,approved)
  → INSERT mpReleases(... snapshotChangelog = snapshot)
  → 回填 project.resultRevisionId + 归档

ProductLibraryView 版本时间线
  → trpc.products.revisions({productId})  // 返回体含 snapshotChangelog
  → 展开"本版本变更" 读快照渲染
```

## 模块边界

- `shared/changelog-snapshot.ts`（新增）：纯过滤+映射，无 IO。盖章与快照共用，口径单源。
- `drizzle/schema.ts`：+2 列。
- `server/db.ts`：`releaseProject` 事务内加盖章+快照三步；`getProductRevisions`（或等价）补 `snapshotChangelog`。
- `server/routers/products.ts`：`revisions` 返回体加 `snapshotChangelog`。
- `client/.../ProductLibraryView.tsx`：时间线节点加可展开变更段。
- `server/routers/changelog.ts`：仅 delete 加"已盖章不可删"守卫（见 F）；list/create/update 不动。
- 不改 `ChangeLog.tsx`。

## 测试

- `server/changelog-snapshot.test.ts`（新增，纯函数）：
  - 只保留 implemented + approved；proposed/rejected/cancelled 被排除。
  - **排序**：乱序输入 → 输出按 `createdDate asc(null 末尾) → number asc → id asc`。
  - 字段映射正确（number/type/title/reason/decisionMaker/costImpact/scheduleImpact/implementedDate）。
  - 空 changelog → 空数组。
- `server/release.test.ts` 扩展（DB 集成）：
  - **先补 cleanup**：当前 `cleanup()` 未删 `project_changelog`（见 release.test.ts），新增集成用例前必须加 `DELETE FROM project_changelog WHERE "projectId" = ${PRJ}`，否则失败重跑会把旧记录带进新快照。
  - 发布后，项目 implemented+approved 的 changelog 行 `revisionId` = 新版本 id；proposed/rejected 行 `revisionId` 仍为 null。
  - `mpReleases.snapshotChangelog` 内容 = 过滤后的条目，顺序符合排序口径。
  - 无 changelog 的项目发布不报错，快照为空。
  - delete 守卫：已盖章记录 delete → FORBIDDEN；未盖章记录可删。

## 明确排除（YAGNI）

- 手动改挂/移除某条变更的版本归属。
- 存量已发布版本回填。
- BOM diff + changelog 并排的"完整版本对比"视图（bomDiff 路由在，UI 留后续）。
- 跨版本变更聚合报表、变更影响到任务工期的链路。
- "这条变更进了哪版"的反查 UI（FK 已落库，按需再做）。
