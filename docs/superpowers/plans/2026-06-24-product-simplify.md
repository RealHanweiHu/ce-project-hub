# 产品库简化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把产品页（RevisionsDialog）简化为折叠手风琴（5 块，默认只展开基本信息），删除 PRD快照历史/偏离检查 两块、SKU计划/竞品 两组字段、确认定义流程。纯前端，后端不动。

**Architecture:** 仅改 `client/src/components/views/ProductLibraryView.tsx` 的 `RevisionsDialog`。先删（2 块 + 2 字段组 + 确认流程 + 随之无用的查询/state），再把剩余 5 块包进 shadcn Accordion。后端表/mutation 与项目立项逻辑不动。

**Tech Stack:** React + tRPC + shadcn Accordion。验证：`pnpm check` + preview 走查 + 「立项关联产品仍可用」回归。

**规格：** `docs/superpowers/specs/2026-06-24-product-simplify-design.md`。**分支：** `feat-product-simplify`。

**前置事实（已核对）：**
- `RevisionsDialog`（`client/src/components/views/ProductLibraryView.tsx:622`）。
- 待删查询：`trpc.products.definitionSnapshots`（line 625 + invalidate 648）、`trpc.products.definitionDeviation`（627 + invalidate 647）。
- `confirmDefinition`（667）+ 「确认定义」按钮 UI。
- 表单字段含 `competitors`（51/271/320/721）、`skuPlan`（61/281/342/748）。`buildPatch`（~719）拼这些。`save = saveDefinition`（759）。
- 6 块标题：产品定义基线(923)、PRD快照历史(1006)、偏离检查(1075)、产品需求变更(1137)、版本时间线(1251)、客户版本/SKU(1355)。
- shadcn Accordion：`@/components/ui/accordion` 导出 `Accordion/AccordionItem/AccordionTrigger/AccordionContent`。

---

## Task 1: 删除两块 + 两组字段 + 确认流程 + 无用查询

**Files:** `client/src/components/views/ProductLibraryView.tsx`

- [ ] **Step 1: 删「PRD 快照历史」整块** —— 移除 ~line 1006 起的 PRD 快照历史 section 的 JSX，以及 `trpc.products.definitionSnapshots.useQuery`（625）与对它的 invalidate（648）。`snapshotsLoading` 等随之删。
- [ ] **Step 2: 删「产品定义偏离检查」整块** —— 移除 ~line 1075 起的偏离检查 section JSX，以及 `trpc.products.definitionDeviation.useQuery`（627）与对它的 invalidate（647）。`deviation` 相关 state/渲染删净。
- [ ] **Step 3: 删 SKU计划 + 竞品 字段** —— 在产品定义基线表单里移除 SKU 计划（SkuRows）与 竞品（CompetitorRows）两组输入 UI；从 `buildPatch`（~719）里移除 `competitors`（721）与 `skuPlan`（748）的拼装（若 `saveDefinition` 入参这两个字段必填，传 `[]`；查 server `saveDefinition` 的 zod input，能省则省、不能省传空数组保持兼容）。表单 state 里的 `competitors`/`skuPlan` 及其默认值、`definitionToForm` 里对它们的映射一并删。
- [ ] **Step 4: 删「确认定义」流程** —— 移除「确认定义」按钮 + `confirmDefinition` mutation（667）的前端定义与调用 + 草稿/已确认状态徽标/提示文案。基本信息只留「保存」（`save = saveDefinition`）。若产品页内有 `definition.status === 'confirmed'` 的判断逻辑，降级为始终可保存（不再依赖确认态）。
- [ ] **Step 5: 清理无用 import/state** —— `Sku`/`Competitor` 相关类型、`SkuRows`/`CompetitorRows` 组件若仅此处用则删；`snapshotsLoading`/`deviation` 等。
- [ ] **Step 6: 验证** —— `pnpm check`（tsc）通过。preview 打开一个产品 → 确认 PRD快照/偏离检查 两块不见、SKU计划/竞品 字段不见、确认定义按钮不见，基本信息「保存」仍可用（toast）。`grep -nE 'stone-|amber-|font-serif|font-mono|\bce-' client/src/components/views/ProductLibraryView.tsx` = 0。
- [ ] **Step 7: 提交** `git add client/src/components/views/ProductLibraryView.tsx && git commit -m "feat(products): 删 PRD快照/偏离检查两块 + SKU计划/竞品字段 + 确认定义流程"`

---

## Task 2: 剩余 5 块包进折叠手风琴

**Files:** `client/src/components/views/ProductLibraryView.tsx`

- [ ] **Step 1: 引入 Accordion** —— `import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';`
- [ ] **Step 2: 用 Accordion 包裹 RevisionsDialog 主体** —— `<Accordion type="multiple" defaultValue={["basic"]} className="...">`，把剩余 5 块各包成一个 `AccordionItem`：
  - `value="basic"` 基本信息（名称/编号/类型/品类/市场/定位/PRD摘要/成本/售价 + 保存）—— 默认展开。
  - `value="specs"` 规格（SpecRows 编辑，无独立保存，随基本信息「保存」一起提交）。
  - `value="revisions"` 主版本时间线（Rev A/B/C 只读）。
  - `value="changes"` 产品需求变更（现有变更登记/列表）。
  - `value="variants"` 客户版本 / SKU（现有客户版本登记/列表）。
  - 每个 `AccordionTrigger` 用该块标题；`AccordionContent` 放原块内容。用 Linear 风样式，标题层级与现有一致。
- [ ] **Step 3: 「保存」按钮归位** —— 「保存」按钮放在基本信息块内（或弹窗底部固定），点它 `saveDefinition`（提交 basic 字段 + specs）。确保展开/折叠任意块时保存仍可用。
- [ ] **Step 4: 验证** —— `pnpm check` 通过。preview：点产品卡 → 默认只展开「基本信息」，其余 4 块折叠；逐块点开 规格/主版本时间线/变更/客户版本 内容正常；基本信息改个字段点保存 → toast、刷新后保留。截图。`grep` 旧类 = 0。
- [ ] **Step 5: 提交** `git add client/src/components/views/ProductLibraryView.tsx && git commit -m "feat(products): 产品页改折叠手风琴（基本信息默认展开，其余按需点开）"`

---

## Task 3: 收尾 + 立项不回归验证

- [ ] **Step 1: 全量检查** —— `export $(grep -E '^DATABASE_URL=' .env | xargs) && pnpm check && pnpm test`（现有不回归；portfolio-health 是已知 flake，单独跑通即可）。`grep -rnE 'stone-|amber-|font-serif|font-mono|\bce-' client/src/components/views/ProductLibraryView.tsx | grep -vE 'xlsx-host|docx-host'` = 0。
- [ ] **Step 2: 立项关联产品回归（关键）** —— preview：走「新建项目」向导，关联一个产品（demo 里 5 个项目已关联产品，或新建一个关联 BLDC-40），确认立项成功、项目详情能进。验证移除前端确认/快照后，立项自动快照仍工作（后端 `getConfirmedProductDefinitionSnapshotIfAvailable`）。
- [ ] **Step 3: 产品删除回归** —— preview：删一个未被引用产品仍成功、删被引用产品仍被拦（`products.delete` 不受本次影响）。
- [ ] **Step 4: 提交（如有收尾）** `git commit -m "chore(products): 简化收尾验证"`

---

## Self-Review 备注（已核对规格覆盖）

- §2 保留 5 块 → Task 2；删 2 块 → Task 1 Step1-2；删 SKU/竞品 → Task 1 Step3；删确认流程 → Task 1 Step4。
- §5 数据流：不再调 confirm/snapshots/deviation（Task 1 删）；saveDefinition 保留（Task 1/2）。
- §8 测试：tsc + preview 走查（Task 1/2）+ 立项不回归（Task 3 Step2，硬验收）+ 删除不回归（Task 3 Step3）。
- §9 非目标：后端不动（全程只改 ProductLibraryView.tsx）；创建对话框不改。
- 一致性：Accordion value 命名（basic/specs/revisions/changes/variants）Task 2 内自洽；saveDefinition 入参在 Task 1 Step3 处理 skuPlan/competitors 兼容（传空或省）。
