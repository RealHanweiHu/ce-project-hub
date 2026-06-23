# 看板 Phase 2 交互增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Linear 风看板加上拖拽推进/回退、跨泳道改派（负责人/产品线）、WIP 硬限制、撤销 toast、泳道折叠持久化。

**Architecture:** 新增轻量服务端 patch mutation `projects.move`（只 patch 传入字段，避免误清空 progress；PM/admin 权限；写 activity log）。前端用 `@dnd-kit/core` 在看板视图加拖拽，`onDragEnd` 派发推进/改派/WIP 阻止，乐观更新 + 失败回滚 + 撤销 toast。WIP 上限与折叠态存 localStorage（`useBoardPrefs` hook）。

**Tech Stack:** React 19 + tRPC + drizzle + @dnd-kit/core + sonner（现有 toast）+ shadcn Dialog。验证：vitest（server）+ preview（前端拖拽）+ `pnpm check`。

**规格：** `docs/superpowers/specs/2026-06-23-board-phase2-design.md`。
**分支：** `feat-board-phase2`（Phase 1 已在 main）。
**前置事实（已核对）：**
- `projectsRouter` in `server/routers/projects.ts`（`export const projectsRouter = router({...})`，line 244）。
- 权限：`getEffectiveRole(projectId, userId)`（import 自 `../project-access` as `getEffectiveRole`）+ `ROLE_PERMISSIONS[role].canEditProjectInfo`（import 自 `./members`）；admin 兜底 `ctx.user.role === "admin"`。
- `updateProject(id, patch)`（`server/db.ts`）是真 partial patch（`db.update(projects).set(patch)`）。
- `createActivityLog({ projectId, userId, action, entityType, entityId, meta })`。
- 测试用 `projectsRouter.createCaller(ctx)`；ctx 形如 `{ user: { id, role, ... } }`（见 `server/tasks-router-validation.test.ts`）。
- 前端 board = `client/src/components/views/ProjectListView.tsx`（看板视图组件 `KanbanView`，分组态 `groupBy: 'none'|'line'|'cat'|'pm'`，折叠态当前是内存 `useState<Set>`）。

---

## Task 1: 服务端 `projects.move` patch mutation（TDD）

**Files:**
- Modify: `server/routers/projects.ts`（在 `projectsRouter` 内加 `move`）
- Test: `server/projects-move.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/projects-move.test.ts`：

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projects } from "../drizzle/schema";
import { getDb } from "./db";
import { projectsRouter } from "./routers/projects";

const ADMIN = 778101;
const OUTSIDER = 778102;
const PROJ = `move-test-${Date.now()}`;

const ctx = (id: number, role = "user") => ({
  user: { id, role, name: "x", email: null, username: null, passwordHash: null,
    canCreateProject: false, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null },
}) as any;

beforeAll(async () => {
  const db = await getDb(); if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJ, name: "move 测试", projectNumber: PROJ, category: "npd",
    risk: "low", currentPhase: "concept", progress: 42, pmUserId: ADMIN, createdBy: ADMIN,
  });
});
afterAll(async () => {
  const db = await getDb(); if (!db) return;
  await db.delete(projects).where(eq(projects.id, PROJ));
});

describe("projects.move", () => {
  it("只 patch currentPhase，不动 progress", async () => {
    const caller = projectsRouter.createCaller(ctx(ADMIN, "admin"));
    await caller.move({ id: PROJ, currentPhase: "design" });
    const db = await getDb();
    const [row] = await db!.select().from(projects).where(eq(projects.id, PROJ));
    expect(row.currentPhase).toBe("design");
    expect(row.progress).toBe(42); // 未被清空
  });

  it("非授权用户 FORBIDDEN", async () => {
    const caller = projectsRouter.createCaller(ctx(OUTSIDER, "user"));
    await expect(caller.move({ id: PROJ, currentPhase: "evt" })).rejects.toThrow(/FORBIDDEN|权限|forbidden/i);
  });

  it("同时改 currentPhase + pmUserId 都生效", async () => {
    const caller = projectsRouter.createCaller(ctx(ADMIN, "admin"));
    await caller.move({ id: PROJ, currentPhase: "evt", pmUserId: ADMIN });
    const db = await getDb();
    const [row] = await db!.select().from(projects).where(eq(projects.id, PROJ));
    expect(row.currentPhase).toBe("evt");
    expect(row.pmUserId).toBe(ADMIN);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `export $(grep -E '^DATABASE_URL=' .env | xargs) && npx vitest run server/projects-move.test.ts`
Expected: FAIL —— `caller.move is not a function`。

- [ ] **Step 3: 实现 `move` mutation**

在 `server/routers/projects.ts` 的 `projectsRouter` 里（紧挨 `update` 之后）加：

```ts
  move: protectedProcedure
    .input(z.object({
      id: z.string(),
      currentPhase: z.string().optional(),
      pmUserId: z.number().int().nullable().optional(),
      productId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getProjectById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.id, ctx.user.id);
      const allowed = ctx.user.role === "admin" || (role && ROLE_PERMISSIONS[role].canEditProjectInfo);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const patch: Record<string, unknown> = {};
      if (input.currentPhase !== undefined) patch.currentPhase = input.currentPhase;
      if (input.pmUserId !== undefined) patch.pmUserId = input.pmUserId;
      if (input.productId !== undefined) patch.productId = input.productId;
      if (Object.keys(patch).length === 0) return { success: true };

      await updateProject(input.id, patch);

      // 改派 PM 时确保新 PM 是项目成员（与 update 行为一致）
      if (input.pmUserId != null && input.pmUserId !== existing.pmUserId && input.pmUserId !== existing.createdBy) {
        try { await ensureProjectMember(input.id, input.pmUserId, "pm", ctx.user.id); }
        catch (e) { console.warn("[move] add pm failed (non-fatal):", e); }
      }

      await createActivityLog({
        projectId: input.id,
        userId: ctx.user.id,
        action: "project.move",
        entityType: "project",
        entityId: input.id,
        meta: {
          fromPhase: existing.currentPhase, toPhase: input.currentPhase ?? existing.currentPhase,
          fromPm: existing.pmUserId, toPm: input.pmUserId === undefined ? existing.pmUserId : input.pmUserId,
          fromProduct: existing.productId, toProduct: input.productId === undefined ? existing.productId : input.productId,
        },
      });
      return { success: true };
    }),
```

（`getProjectById`、`updateProject`、`ensureProjectMember`、`createActivityLog`、`getEffectiveRole`、`ROLE_PERMISSIONS`、`TRPCError`、`z` 均已在该文件 import；若 `ensureProjectMember` 未 import，照 `update` 里的用法补上 import。）

- [ ] **Step 4: 跑测试确认通过**

Run: `export $(grep -E '^DATABASE_URL=' .env | xargs) && npx vitest run server/projects-move.test.ts`
Expected: PASS（3 测试）。再跑 `pnpm check` 确认无 TS 报错。

- [ ] **Step 5: 提交**

```bash
git add server/routers/projects.ts server/projects-move.test.ts
git commit -m "feat(projects): 新增 projects.move patch mutation（只改阶段/负责人/产品线，PM/admin，写 activity log）+ 测试"
```

---

## Task 2: 依赖 `@dnd-kit/core` + `useBoardPrefs` hook

**Files:**
- Modify: `package.json`（加依赖）
- Create: `client/src/hooks/useBoardPrefs.ts`

- [ ] **Step 1: 安装 dnd-kit**

```bash
pnpm add @dnd-kit/core
```
Expected: package.json 出现 `@dnd-kit/core`，lockfile 更新。

- [ ] **Step 2: 实现 useBoardPrefs（localStorage：wipLimits + collapsedLanes）**

新建 `client/src/hooks/useBoardPrefs.ts`：

```ts
import { useCallback, useEffect, useState } from 'react';

const KEY = 'ce-board-prefs-v1';

type BoardPrefs = {
  wipLimits: Record<string, number>;     // stageId -> limit（无 key = 不限制）
  collapsedLanes: string[];              // 折叠的泳道 key
};

const EMPTY: BoardPrefs = { wipLimits: {}, collapsedLanes: [] };

function read(): BoardPrefs {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw);
    return { wipLimits: p.wipLimits ?? {}, collapsedLanes: p.collapsedLanes ?? [] };
  } catch { return EMPTY; }
}

export function useBoardPrefs() {
  const [prefs, setPrefs] = useState<BoardPrefs>(read);

  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore quota */ }
  }, [prefs]);

  const setWipLimit = useCallback((stageId: string, limit: number | null) => {
    setPrefs((p) => {
      const next = { ...p.wipLimits };
      if (limit == null || limit <= 0) delete next[stageId];
      else next[stageId] = limit;
      return { ...p, wipLimits: next };
    });
  }, []);

  const toggleLane = useCallback((laneKey: string) => {
    setPrefs((p) => {
      const has = p.collapsedLanes.includes(laneKey);
      return { ...p, collapsedLanes: has ? p.collapsedLanes.filter((k) => k !== laneKey) : [...p.collapsedLanes, laneKey] };
    });
  }, []);

  return {
    wipLimits: prefs.wipLimits,
    collapsedLanes: prefs.collapsedLanes,
    isLaneCollapsed: (k: string) => prefs.collapsedLanes.includes(k),
    setWipLimit,
    toggleLane,
  };
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm check`
Expected: 无 TS 报错。

- [ ] **Step 4: 提交**

```bash
git add package.json pnpm-lock.yaml client/src/hooks/useBoardPrefs.ts
git commit -m "feat(board): 加 @dnd-kit/core + useBoardPrefs hook（localStorage 存 WIP 上限/折叠态）"
```

---

## Task 3: 看板拖拽推进/回退（核心）

**Files:**
- Modify: `client/src/components/views/ProjectListView.tsx`（KanbanView + 顶层）

> 阅读当前 KanbanView 结构：阶段列如何渲染、卡片如何渲染、`projects` 数据形状、是否已有 `onSelectProject`、当前用户/权限怎么拿（看 Phase 1 是否已有 `canManage`/`isAdmin`；克隆/删除按钮的权限判断可参考）。`trpc` 已在文件内可用。

- [ ] **Step 1: 引入 dnd + move mutation + 当前用户权限**

在 KanbanView（或其父）顶部：
```tsx
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { useBoardPrefs } from '@/hooks/useBoardPrefs';
import { toast } from 'sonner';
// move mutation：
const utils = trpc.useUtils();
const moveMut = trpc.projects.move.useMutation();
```
拿当前用户是否可拖（PM/admin）：复用项目已有的权限信号。每个 project 若带 `canEditProjectInfo`/`canManage` 字段就用它；否则用全局 `useAuth().user.role === 'admin'`。把"是否可拖"算成 `canDrag(project)`。

- [ ] **Step 2: 包 DndContext，列设 droppable，卡设 draggable**

- 看板根包 `<DndContext sensors={sensors} onDragEnd={handleDragEnd}>`，`const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))`（5px 后才算拖，避免和点击冲突）。
- 每个阶段列容器调 `const { setNodeRef } = useDroppable({ id: dropId })`，`dropId = groupBy==='none' ? stageId : \`${laneKey}::${stageId}\``。把 `ref={setNodeRef}` 挂到列容器。
- 每张卡用一个子组件 `<DraggableCard project={p} disabled={!canDrag(p)}>`，内部 `const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: p.id, disabled })`，把 `ref/attributes/listeners` 挂到卡根、`transform` 转 `style`。**卡片点击打开抽屉的 onClick 仍保留**（PointerSensor 的 distance 约束让"点击"不触发拖拽）。

- [ ] **Step 3: handleDragEnd —— 解析落点并派发（本任务先做"推进/回退"）**

```tsx
function parseDrop(id: string): { stageId: string; laneKey: string | null } {
  const s = String(id);
  if (s.includes('::')) { const [lane, stage] = s.split('::'); return { stageId: stage, laneKey: lane }; }
  return { stageId: s, laneKey: null };
}

async function handleDragEnd(e: DragEndEvent) {
  if (!e.over) return;
  const projectId = String(e.active.id);
  const project = projects.find((p) => p.id === projectId);
  if (!project || !canDrag(project)) return;
  const { stageId: toStage } = parseDrop(String(e.over.id));
  const fromStage = project.currentPhase;
  if (toStage === fromStage) return; // 同列不处理（改派在 Task 4）

  // 推进/回退：确认框
  const fromLabel = phaseLabel(project, fromStage), toLabel = phaseLabel(project, toStage);
  setMoveConfirm({ project, toStage, fromStage, fromLabel, toLabel });
}
```
新增确认态 `const [moveConfirm, setMoveConfirm] = useState<null | {...}>(null)`，渲染一个 shadcn `AlertDialog`：标题「推进项目阶段」，正文「手动覆盖：{project.name}（{编号}）{fromLabel} → {toLabel}。此操作直接改变阶段，不生成 Gate 通过记录。确认？」，确认按钮调 `doMove`。

- [ ] **Step 4: doMove —— 乐观更新 + 调 move + 失败回滚 + 撤销 toast**

```tsx
async function doMove(project, patch, undoPatch, label) {
  // patch = { currentPhase: toStage } 之类；undoPatch = 反向
  try {
    await moveMut.mutateAsync({ id: project.id, ...patch });
    await utils.projects.list.invalidate();    // 用看板实际依赖的 query key
    toast.success(label, {
      action: { label: '撤销', onClick: async () => {
        try { await moveMut.mutateAsync({ id: project.id, ...undoPatch }); await utils.projects.list.invalidate(); }
        catch { toast.error('撤销失败'); }
      } },
    });
  } catch {
    toast.error('操作失败，已回滚');
    await utils.projects.list.invalidate();
  }
}
```
确认框确认时：`doMove(project, { currentPhase: toStage }, { currentPhase: fromStage }, \`已将 ${project.name} 推进到 ${toLabel} · 可撤销\`)`，然后 `setMoveConfirm(null)`。
（注意：把 `utils.projects.list` 换成看板真正用的 query —— 读当前文件确认数据来源后用对应的 invalidate；若数据来自父组件 props，则改为调用父级刷新回调。）

- [ ] **Step 5: 验证（preview，已登录 test_pm/admin + demo 数据）**

`pnpm check` 通过。dev server "cehub-dev" 运行；preview 到 `/?view=projects` 切看板，把一张卡从「概念」拖到「设计」→ 出确认框 → 确认 → 卡片移列、toast 出现、点撤销卡片回原列。preview_console_logs 无 KanbanView 报错。截图看板拖拽后的状态。

- [ ] **Step 6: 提交**

```bash
git add client/src/components/views/ProjectListView.tsx
git commit -m "feat(board): dnd-kit 拖拽推进/回退（PM/admin 覆盖 + 确认框 + 乐观更新 + 撤销 toast）"
```

---

## Task 4: 跨泳道拖拽改派（负责人 / 产品线）

**Files:**
- Modify: `client/src/components/views/ProjectListView.tsx`（扩展 handleDragEnd）

- [ ] **Step 1: 扩展 handleDragEnd 处理 laneKey 变化**

在 `handleDragEnd` 里，解析出 `toLaneKey` 后：
```tsx
const { stageId: toStage, laneKey: toLane } = parseDrop(String(e.over.id));
const stageChanged = toStage !== project.currentPhase;
let reassignPatch: any = null, undoReassign: any = null, reassignLabel = '';

if (toLane != null && (groupBy === 'pm' || groupBy === 'line')) {
  const fromLane = laneKeyOf(project, groupBy);   // 现有分组取键的函数
  if (toLane !== fromLane) {
    if (groupBy === 'pm') {
      const newPm = toLane === '__none__' ? null : Number(toLane);
      reassignPatch = { pmUserId: newPm }; undoReassign = { pmUserId: project.pmUserId ?? null };
      reassignLabel = `改派负责人`;
    } else { // line
      const newProduct = toLane === '__none__' ? null : toLane;
      reassignPatch = { productId: newProduct }; undoReassign = { productId: project.productId ?? null };
      reassignLabel = `改派产品线`;
    }
  }
}
```
（`laneKeyOf` / 泳道 key 的构造要和列渲染时用的 `laneKey` 完全一致——读现有分组渲染代码对齐；空泳道用统一哨兵如 `__none__`。groupBy==='cat' 或 'none' 时不改派。）

- [ ] **Step 2: 合并推进 + 改派为一次 move**

- 若 `stageChanged` 且有 `reassignPatch`：弹推进确认框（Task 3），确认时 `doMove(project, { currentPhase: toStage, ...reassignPatch }, { currentPhase: fromStage, ...undoReassign }, '已推进并改派 · 可撤销')`。
- 若**仅**改派（阶段没变）：不需推进确认框（改派较轻），直接 `doMove(project, reassignPatch, undoReassign, \`已${reassignLabel} · 可撤销\`)`。
- 若仅推进：走 Task 3 原路径。

- [ ] **Step 3: 验证（preview）**

`pnpm check` 通过。preview：把 分组 切到「负责人」，跨泳道拖一张卡到另一负责人泳道 → toast「已改派负责人」，卡片落到新泳道；刷新后保持（数据已落库）。切「产品线」同理。切「项目类型」分组时跨泳道拖**不**改派（验证不触发）。截图。

- [ ] **Step 4: 提交**

```bash
git add client/src/components/views/ProjectListView.tsx
git commit -m "feat(board): 跨泳道拖拽改派（负责人/产品线，类型分组不触发）"
```

---

## Task 5: WIP 上限（列头控件 + 硬限制）

**Files:**
- Modify: `client/src/components/views/ProjectListView.tsx`（列头 + handleDragEnd）

- [ ] **Step 1: 列头显示 当前/上限 + −/＋ 调整**

接 `const { wipLimits, setWipLimit } = useBoardPrefs()`。每个阶段列头：显示 `{count}{limit ? ` / ${limit}` : ''}`；旁边两个小按钮 −/＋ 调 `setWipLimit(stageId, (wipLimits[stageId] ?? count) ± 1)`（下限 0 = 取消上限）。超限时列头数字标红（`text-[color:var(--destructive)]`）。用 Linear 风（小 iconbtn）。

- [ ] **Step 2: 硬限制 —— 拖入已满阶段时阻止落下**

在 `handleDragEnd` 解析出 `toStage` 后、派发推进前加：
```tsx
const limit = wipLimits[toStage];
if (limit != null && toStage !== project.currentPhase) {
  const countInTarget = projects.filter((p) => p.currentPhase === toStage).length; // 与列计数一致
  if (countInTarget >= limit) {
    toast.error(`${phaseLabelByStage(toStage)} 已达 WIP 上限 ${limit}`);
    return; // 不执行 move
  }
}
```
（仅对"跨阶段推进"判 WIP；纯改派不受 WIP 限制。计数口径与列头显示一致。）

- [ ] **Step 3: 验证（preview）**

`pnpm check` 通过。preview：给「设计」列设上限 = 当前数（点 − 到等于现有卡数）；从别列拖一张到「设计」→ toast「已达 WIP 上限」，卡片不动。上限 +1 后再拖能成功。刷新后上限保持（localStorage）。截图。

- [ ] **Step 4: 提交**

```bash
git add client/src/components/views/ProjectListView.tsx
git commit -m "feat(board): WIP 上限列头控件 + 硬限制（拖入已满阶段阻止）"
```

---

## Task 6: 泳道折叠态持久化

**Files:**
- Modify: `client/src/components/views/ProjectListView.tsx`

- [ ] **Step 1: 把 Phase 1 的内存折叠态换成 useBoardPrefs**

找到 Phase 1 里泳道折叠的 `useState<Set<string>>`（及其 toggle）。改为用 `const { isLaneCollapsed, toggleLane } = useBoardPrefs()`：渲染时 `collapsed = isLaneCollapsed(laneKey)`，折叠按钮 `onClick={() => toggleLane(laneKey)}`。删除旧的本地 Set 状态。laneKey 用与改派一致的稳定 key。

- [ ] **Step 2: 验证（preview）**

`pnpm check` 通过。preview：分组到「负责人」，折叠一个泳道 → 刷新页面 → 仍折叠。展开 → 刷新 → 仍展开。截图。

- [ ] **Step 3: 提交**

```bash
git add client/src/components/views/ProjectListView.tsx
git commit -m "feat(board): 泳道折叠态持久化（localStorage）"
```

---

## Task 7: 收尾验证

- [ ] **Step 1: 全量检查**

```bash
export $(grep -E '^DATABASE_URL=' .env | xargs)
pnpm check
npx vitest run server/projects-move.test.ts
pnpm test           # 现有 365 不回归
grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' client/src/components/views/ProjectListView.tsx | grep -vE 'xlsx-host|docx-host'   # 仍为 0，没在新代码里引入旧类
```
Expected：tsc 过、move 测试过、全量测试过、grep 0。

- [ ] **Step 2: preview 全流程走查**

看板：拖拽推进（确认框）、回退、跨泳道改派（负责人/产品线）、类型分组不改派、WIP 硬限制阻止、撤销还原、折叠刷新保持、非 admin 用户不能拖（可临时把 test_pm 降 role=user 验证后再升回 admin，或用别的测试账号）。截图汇总。

- [ ] **Step 3: 提交（如有收尾改动）**

```bash
git add -A && git commit -m "chore(board): Phase 2 收尾验证"
```

---

## Self-Review 备注（已核对规格覆盖）

- §3 `projects.move` → Task 1（含权限 FORBIDDEN、只 patch、activity log，测试覆盖三点）。
- §4.1 拖拽推进 → Task 3；§4.2 改派 → Task 4；§4.3 WIP → Task 5；§4.4 撤销 → Task 3 doMove 的 toast（Task 4 复用）；§4.5 折叠持久化 → Task 6。
- §5 单元：`projects.move`（T1）、`useBoardPrefs`（T2）、KanbanView dnd（T3-6）。
- §8 测试：server TDD（T1）、前端 preview（T3-7）、不回归（T7）。
- §9 非目标：类型不可拖（T4 明确）、不联动 Gate（T1/T3 覆盖语义）、WIP 本地（T2/T5）、仅看板视图。
- 类型一致：`projects.move` 输入 `{id, currentPhase?, pmUserId?, productId?}` 在 T1 定义，T3/T4 调用一致；`useBoardPrefs` 暴露 `wipLimits/collapsedLanes/isLaneCollapsed/setWipLimit/toggleLane`，T2 定义、T5/T6 使用一致。
