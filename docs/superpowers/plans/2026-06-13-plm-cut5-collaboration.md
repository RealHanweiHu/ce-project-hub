# PLM 第五刀 · 评论 + @提及 + 通知 Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans。

**Goal:** 让工具从"事后填表"变"协作发生地"：通用评论（挂任意实体：issue/task/project/product…）+ @提及 → 站内通知 + 钉钉/飞书群机器人推送（配置驱动，未配则只站内）。客户端：评论线程组件（先接 issue）+ 顶栏通知铃铛（未读数+下拉）。

**Architecture:** 新增 `comments`、`notifications` 表。`server/_core/notify.ts`（webhook 推送，按 NOTIFY_WEBHOOK_TYPE 适配钉钉/飞书，未配 no-op）。`server/db.ts` 加评论/通知 helpers（含 @解析→通知）。tRPC `comments`/`notifications` 路由。客户端 CommentThread + NotificationBell。TDD 直连本地 PG。全加法。

**前置：** docker `cehub-pg`；`.env`；在 `main`，Cut 1-4 已合并、已 push。

---

### Task 0: 分支
```bash
git checkout main && git checkout -b plm-cut5-collaboration
```

### Task 1: Schema
**Files:** Modify `drizzle/schema.ts`（末尾追加）
```ts
/** 通用评论：挂在任意实体上（entityType+entityId） */
export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  entityType: varchar("entityType", { length: 24 }).notNull(), // issue|task|project|product|change|gate
  entityId: varchar("entityId", { length: 64 }).notNull(),
  projectId: varchar("projectId", { length: 32 }),   // 权限/范围（可空）
  authorId: integer("authorId").notNull(),
  body: text("body").notNull(),
  mentions: jsonb("mentions").$type<number[]>().default([]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({ idxEntity: index("idx_comments_entity").on(t.entityType, t.entityId) }));
export type Comment = typeof comments.$inferSelect;
export type InsertComment = typeof comments.$inferInsert;

/** 站内通知 */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),       // 接收人
  type: varchar("type", { length: 24 }).notNull(), // mention|assigned|gate|release|...
  title: varchar("title", { length: 256 }).notNull(),
  body: text("body"),
  entityType: varchar("entityType", { length: 24 }),
  entityId: varchar("entityId", { length: 64 }),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({ idxUser: index("idx_notifications_user").on(t.userId, t.read) }));
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
```
`pnpm check` → commit。

### Task 2: 迁移
`pnpm db:push` → 验证 comments/notifications 表 → commit。

### Task 3: notify.ts + db helpers + 测试
**Files:** Create `server/_core/notify.ts`、`server/collab.test.ts`；Modify `server/db.ts`、`server/_core/env.ts`

- env.ts 加 `notifyWebhookUrl`(NOTIFY_WEBHOOK_URL)、`notifyWebhookType`(NOTIFY_WEBHOOK_TYPE: dingtalk|feishu, 默认 dingtalk)。
- `server/_core/notify.ts`：`pushWebhook(text: string)` —— 未配 URL 直接 return；钉钉 body `{msgtype:'text',text:{content}}`、飞书 `{msg_type:'text',content:{text}}`；fetch POST，错误吞掉只 warn（通知失败不阻断主流程）。
- db helpers：
  - `parseMentions(body, candidates)` → 从 `@username` 提取，匹配 candidates(用户名→id) 返回 id[]。导出便于测试。
  - `addComment({entityType,entityId,projectId,authorId,body})` → 解析 @（候选=全部用户或项目成员）、插评论、为每个被提及者建 notification + 调 pushWebhook。返回评论。
  - `listComments(entityType,entityId)` → 带作者名 join。
  - `createNotification(...)`、`listNotifications(userId,unreadOnly?)`、`unreadCount(userId)`、`markRead(id)`、`markAllRead(userId)`。
- 测试 `server/collab.test.ts`：
  - parseMentions 解析 `@alice @bob` → 命中候选 id。
  - addComment 带 @ → listComments 含该条；被提及者 unreadCount=1；markAllRead 后=0。

实现关键（db.ts 追加，import comments/notifications/类型 + notify）：
```ts
export function parseMentions(body: string, candidates: { id: number; username: string | null }[]): number[] {
  const names = new Set((body.match(/@([A-Za-z0-9_.\-]+)/g) || []).map((m) => m.slice(1).toLowerCase()));
  return candidates.filter((c) => c.username && names.has(c.username.toLowerCase())).map((c) => c.id);
}
export async function addComment(input: { entityType: string; entityId: string; projectId?: string | null; authorId: number; body: string }): Promise<Comment> {
  const db = await getDb(); if (!db) throw new Error("no db");
  const users = await db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable); // 见下：usersTable=users
  const mentions = parseMentions(input.body, users);
  const [c] = await db.insert(comments).values({ ...input, projectId: input.projectId ?? null, mentions }).returning();
  const author = await getUserById(input.authorId);
  for (const uid of mentions) {
    if (uid === input.authorId) continue;
    await createNotification({ userId: uid, type: "mention", title: `${author?.name || "有人"} 在评论中提到了你`, body: input.body.slice(0, 140), entityType: input.entityType, entityId: input.entityId });
  }
  if (mentions.length) { const { pushWebhook } = await import("./_core/notify"); await pushWebhook(`💬 ${author?.name || "有人"} @了 ${mentions.length} 人：${input.body.slice(0,100)}`); }
  return c;
}
export async function createNotification(n: { userId: number; type: string; title: string; body?: string|null; entityType?: string|null; entityId?: string|null }): Promise<void> {
  const db = await getDb(); if (!db) return;
  await db.insert(notifications).values({ ...n, body: n.body ?? null, entityType: n.entityType ?? null, entityId: n.entityId ?? null });
}
export async function listComments(entityType: string, entityId: string) {
  const db = await getDb(); if (!db) return [];
  return db.select({ id: comments.id, body: comments.body, authorId: comments.authorId, authorName: users.name, mentions: comments.mentions, createdAt: comments.createdAt })
    .from(comments).leftJoin(users, eq(comments.authorId, users.id))
    .where(and(eq(comments.entityType, entityType), eq(comments.entityId, entityId))).orderBy(comments.createdAt);
}
export async function listNotifications(userId: number, unreadOnly = false) {
  const db = await getDb(); if (!db) return [];
  const cond = unreadOnly ? and(eq(notifications.userId, userId), eq(notifications.read, false)) : eq(notifications.userId, userId);
  return db.select().from(notifications).where(cond).orderBy(desc(notifications.createdAt)).limit(50);
}
export async function unreadCount(userId: number): Promise<number> {
  const db = await getDb(); if (!db) return 0;
  const r = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return r.length;
}
export async function markRead(id: number): Promise<void> { const db = await getDb(); if (!db) return; await db.update(notifications).set({ read: true }).where(eq(notifications.id, id)); }
export async function markAllRead(userId: number): Promise<void> { const db = await getDb(); if (!db) return; await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId)); }
```
（注：db.ts 已 import `users`；上面 usersTable 即 users，直接用 users。）
跑测试 pass；全量；commit。

### Task 4: tRPC
**Files:** Create `server/routers/collab.ts`；Modify `server/routers.ts`
- `comments.list({entityType,entityId})`、`comments.add({entityType,entityId,projectId?,body})`(用 ctx.user.id 作 author)。
- `notifications.list({unreadOnly?})`、`notifications.unreadCount`、`notifications.markRead({id})`、`notifications.markAllRead`。
- 挂载 `collab`?——分两个路由 `comments` + `notifications` 挂 appRouter。check。commit。

### Task 5: 客户端
**Files:** Create `client/src/components/CommentThread.tsx`、`client/src/components/NotificationBell.tsx`；Modify `IssueList.tsx`(每个 issue 加评论)；`Home.tsx`(顶栏铃铛)
- CommentThread({entityType,entityId,projectId})：列评论（作者+时间+正文，@高亮）+ 输入框（提交调 comments.add，成功 invalidate）。
- NotificationBell：`notifications.unreadCount` 轮询(30s)，铃铛+红点；点开下拉 `notifications.list`，点条目 markRead，「全部已读」markAllRead。放 Home 顶栏 header（搜索旁）。
- IssueList：问题展开/详情处嵌 CommentThread(entityType='issue', entityId=issue.id)。
- preview 验证：登录两个用户场景较繁，简化为：在某 issue 评论 `@admin 看下`，admin 通知未读+1；铃铛显示。截图。
- check；commit。

### Task 6: RDS + 部署
- RDS 幂等建 comments/notifications + 索引 + 补迁移记录。部署。烟雾测试。
- （NOTIFY_WEBHOOK_URL 暂不配 → 仅站内通知；用户拿到钉钉/飞书群机器人 URL 后填 .env 重启即推送。）

---
## Self-Review
- 覆盖：评论 ✓ @提及→站内通知 ✓ webhook(配置驱动) ✓ 铃铛 ✓。先接 issue，task/其它实体复用同组件后续接。
- 类型一致：parseMentions/addComment/listComments/createNotification/listNotifications/unreadCount/markRead/markAllRead 定义=引用。
- 降级：webhook 未配 no-op；通知失败不阻断评论。
