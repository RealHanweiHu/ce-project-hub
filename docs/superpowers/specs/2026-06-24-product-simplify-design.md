# 产品库简化（创建 + 产品页）设计规格

> 状态：已确认（用户批准设计）
> 分支：`feat-product-simplify`
> 日期：2026-06-24

## 1. 目标

把产品库的「产品页面」（点产品卡打开的 `RevisionsDialog`，1629 行）从一长串平铺的 6 大块 PLM 内容，简化为**折叠手风琴**，并**砍掉过重的几块/字段**；创建产品保持精简一步。**纯前端简化，后端表/mutation 不动。**

## 2. 已确认决策

| 决策点 | 选择 |
|---|---|
| 产品页保留的块 | **基本信息 / 规格 / 主版本时间线 / 产品需求变更 / 客户版本(SKU)** 五块，折叠呈现，默认只展开「基本信息」 |
| 删除的块 | **PRD 快照历史**、**产品定义偏离检查** —— 前端移除（后端保留） |
| 删除的字段 | 产品定义基线里的 **SKU 计划**、**竞品** 两组字段 —— 前端移除 |
| 「确认定义/快照」双态流程 | 去掉。基本信息只保留「保存」（存草稿）。立项不受影响（后端立项时自动取/生成定义快照，逻辑没动） |
| 创建产品 | 对话框保持精简（名称/编号/类型/品类/目标市场，一步建好），不变 |

## 3. 现状（已核对）

- `client/src/components/views/ProductLibraryView.tsx`（1629 行）。点产品卡 → `RevisionsDialog`，内含 6 大块平铺：
  1. 产品定义基线（line ~923）：名称/定位/PRD摘要/规格/SKU计划/竞品/成本售价 + 保存草稿 + 确认定义
  2. PRD 快照历史（~1006）
  3. 产品定义偏离检查（~1075）
  4. 产品需求变更（~1137）
  5. 版本时间线（~1251）：主版本 Rev A/B/C 只读
  6. 客户版本 / SKU（~1355）：OEM 客户版本登记/列表
- 后端：`products.saveDefinition/confirmDefinition/definitionSnapshots/definitionDeviation/...` 都在；项目立项用 `getConfirmedProductDefinitionSnapshotIfAvailable`（无快照时自动确认生成）。**本次不动后端。**
- shadcn `@/components/ui/accordion` 可用（`Accordion/AccordionItem/AccordionTrigger/AccordionContent`）。

## 4. 设计：产品页改折叠手风琴

`RevisionsDialog` 内容主体改为 shadcn `Accordion`（`type="multiple"`，`defaultValue={["basic"]}` 只展开基本信息）：

- **基本信息**（value `basic`，默认展开）
  - 字段：名称、产品编号、类型(finished/component)、品类、目标市场、定位(positioning)、PRD 摘要(prdSummary)、成本目标、售价目标。
  - 一个「保存」按钮 → `products.saveDefinition`（存草稿）。**移除**「确认定义」按钮与"草稿/已确认"状态徽标提示。
  - **移除字段**：SKU 计划(skuPlan)、竞品(competitors) —— 不再渲染、不再提交。
- **规格**（value `specs`，折叠）：规格行编辑（现有 SpecRows）。规格与基本信息同属一份定义，**共用「基本信息」块那个「保存」按钮**一次性 `saveDefinition`（basic 字段 + specs 一起提交）。规格块内只做编辑、不单独放保存按钮。
- **主版本时间线**（value `revisions`，折叠）：Rev A/B/C 只读展示（现有版本时间线渲染）。
- **产品需求变更**（value `changes`，折叠）：现有变更登记/列表（`createDefinitionChange`/`updateDefinitionChange`/`definitionChanges`）。
- **客户版本 / SKU**（value `variants`，折叠）：现有客户版本登记/列表（`createVariant`/`variantsByProduct`）。

**删除（前端）**：
- 「PRD 快照历史」整块（含 `definitionSnapshots` 查询的渲染；查询调用可一并去掉以免空跑）。
- 「产品定义偏离检查」整块（含 `definitionDeviation` 查询的渲染）。
- 基本信息里的 SKU 计划、竞品 两组字段输入。
- 「确认定义」按钮 + `confirmDefinition` 的前端调用 + 草稿/已确认状态 UI。

> 保存语义：基本信息「保存」= `saveDefinition`（草稿）。不再前端确认。`saveDefinition` 的入参若必填 skuPlan/competitors，则传空数组/空（保持后端兼容）。

## 5. 数据流

读：`products.list`、`products.definition`、`products.revisions`、`products.definitionChanges`、`products.variantsByProduct` 等照旧。
写：`saveDefinition`（基本信息+规格）、变更/客户版本各自现有 mutation。**不再调** `confirmDefinition`/`definitionSnapshots`/`definitionDeviation`（前端不再用）。
立项链路：项目立项仍走 `getConfirmedProductDefinitionSnapshotIfAvailable`（后端自动确认），**不依赖前端确认**，故移除前端确认不破坏立项。

## 6. 单元 / 架构

- 仅改 `client/src/components/views/ProductLibraryView.tsx`：`RevisionsDialog` 的主体 JSX 重构为 Accordion；删除 2 块 + 2 组字段 + 确认流程；清理随之无用的查询/state/import（`definitionSnapshots`/`definitionDeviation`/`confirmDefinition`/skuPlan/competitors 相关）。
- 文件较大（1629 行），按块改、保 tsc 绿，可多次 commit。
- 后端 `server/routers/products.ts` 与 db 不动。

## 7. 错误处理

- 保存失败 → toast（沿用现有）。
- 折叠块内的列表/表单 loading/empty 态沿用现有。
- 移除 confirm 后，若某处读 `definition.status === 'confirmed'` 做判断，确认其在产品页内不再被依赖（或降级为始终可保存）。

## 8. 测试 / 验收

- `pnpm check`（tsc）通过；现有测试不回归（含已加的 `products-delete` 测试）。
- preview 走查（已登录 test_pm、有 demo 产品）：点产品卡 → 折叠页，默认只展开基本信息；逐块展开 规格/主版本时间线/变更/客户版本 正常；基本信息保存生效；**确认 PRD快照/偏离检查 两块已不见、SKU计划/竞品字段已不见、确认定义按钮已不见**。
- 关键不回归：**新建一个项目并关联该产品仍成功**（验证立项自动快照不受影响）。
- 全屏 0 残留 stone/amber/ce-*。

## 9. 非目标（YAGNI）

- 不删后端表/mutation（snapshots/deviation/confirm 仍在，只是前端不用）。
- 不改创建产品对话框（已够简）。
- 不改产品卡网格/列表/筛选。
- 不动项目侧的产品引用/快照逻辑。

## 10. 不回归

- 项目立项关联产品仍可用（自动快照）。
- 产品删除（`products.delete`，被引用禁止）仍可用。
- 产品库卡片网格/筛选/响应式 不受影响。
