# 双轴架构设计文档 — 项目交付 + 轻量 PLM

> 状态：**已锁版（v1.1 · 与项目轴 v2 平台化对齐）** · 日期：2026-06-13
> 定位：**面向消费电子工厂的「项目交付 + 轻量 PLM」平台** —— 前半段管 NPD 到量产，后半段管产品版本、BOM、变更、质量与资料追溯。
> 本文档锁定数据模型与核心动作；项目轴流程细化见 `2026-06-13-project-axis-modular-sop.md`（v2）。

---

## 1. 核心原则

**数据从 Product 往下挂，而不是从 Project 往下挂。**

- **Product（产品）** = 长期主数据，一个产品活很多年。
- **Project（项目）** = 产品身上一次次阶段性的「战役」，会结项归档。
- 一个 Product 可以有多个 Project：NPD、ECO、降本、质量改善、认证更新、二代升级。
- 一个 Product 沿时间演进出多个 **Revision（版本）**：Rev A → Rev B → Rev C。
- Product 有**类型**：整机 / 零部件（机芯·电机·电池包，可被整机 BOM 引用复用）；整机可派生自一个 **Platform（平台模块集）**。

一句话：**项目轴负责把产品推出来，产品轴负责让它活下去、改得清楚、查得明白。**

```
Platform（平台模块集，版本化）
  └── Product（长期主数据 · 类型 整机/零部件 · 生命周期）
        ├── Revision ×N      冻结版本（PLM 轴）
        │     └── 定义核心 BOM / 受控文档 / 认证 / 测试报告
        ├── Project ×N       阶段性项目（项目轴）
        │     └── 阶段任务 / Gate / Issue / 工作态交付物
        ├── Issue ×N         挂产品（永久）+ 溯源到来源 Project
        └── Change ×N        挂产品（永久）+ 溯源到来源 Project
```

---

## 2. 闭环：Rev ↔ Project ↔ Release

PLM 轴不是静态档案，每次变更都通过一个项目闭环：

```
Rev A（冻结） → ECO/降本/质改 Project（工作态可改） → 量产发布（校验+冻结） → Rev B（冻结） → ⟲
```

- **NPD 项目**：baseRevision = 空（从 0 到 1），首次发布产出 Rev A。
- **量产后项目**（ECO/降本/质改/认证）：baseRevision = 当前生产版本（如 Rev A）。
- 项目过程中 BOM、图纸、测试报告反复改 → 都在 **项目工作态**；
- 只有到 **量产发布 / MP Release** 才冻结成某个 Revision 的正式数据包。

---

## 3. 工作态 vs 冻结态

| | 位置 | 可变性 |
|---|---|---|
| **工作态数据**（working BOM、草稿图纸、过程测试报告） | 挂在 **Project** 下 | 项目期间随便改 |
| **冻结态数据**（已发布版本的定义核心 + 发布快照） | 挂在 **Revision** 下 | 写入一次，永久只读 |

派生时：项目从 Rev A 启动 → **把 Rev A 的冻结 BOM 拷贝一份成「工作 BOM」**，在副本上改，基线不动。
发布时：工作 BOM 冻结成 Rev B 的 BOM。

> **白送的红利**：Rev A 与 Rev B 的 BOM 自动 diff = 本次 ECO 的物料变更清单，不用人手敲。同一份 diff 还用于第 5 节的「是否跳版」判定。

---

## 4. Revision 的三层冻结（重要）

一个 Revision 不是一坨笼统的只读块，分三层，冻结力度不同：

1. **定义核心**（BOM + 受控文档：图纸/规格）—— 出新 Rev 才会变 = 真·只读。这就是「产品定义」。
2. **发布快照**（MP Release 当时冻结的那一份）—— 永久不可变，是「我们到底发了什么」的铁证。
3. **追加记录**（挂当前 Rev 的非跳版项目结项记录、后补的测试报告/认证/客诉）—— 在当前 Rev 下 **append-only，可持续累积**。

即：「冻结」只锁住①②；一个 Rev 的证据/记录③允许往上长。

---

## 5. 项目结项分流（决策 A，已锁）

项目结项时按是否影响产品定义自动分流：

```
Project 结项
  ├─ 不影响产品定义（BOM/受控文档无变化）→ 挂到当前 Rev 下，形成「项目记录」（不跳版）
  └─ 影响 BOM / 受控文档 → 生成新 Rev
```

- **判定方式**：系统自动 diff「工作态 BOM/受控文档」vs 基线 Rev —— 有差异走右支，无差异走左支，结项人确认。
- **配套**：文档分「受控」（图纸/规格，纳入版本判定）与「普通附件」（过程资料，不纳入）。

---

## 6. 量产发布 / MP Release（核心动作）

不是普通按钮，是产品里最硬的一道闸：**带前置校验的原子事务，单向不可逆。**

**前置校验（可配置清单）：**
- [ ] 末道 Gate 已通过（含强制守门人会签，见 §9）
- [ ] P0 / P1 问题全部关闭
- [ ] 认证矩阵要求的取证项就绪（按目标市场）
- [ ] （可按产品线增减规则）

**执行（单个 DB 事务，全有或全无）：**
1. 冻结 BOM → 写入新 Revision 的定义核心
2. 冻结图纸/规格/测试报告/认证 → 写入发布快照
3. 生成版本号（见决策 B）
4. 生成发布记录（mp_releases）
5. 把项目工作态交付物沉淀到 Revision
6. 记录发布时未关闭问题清单 + 风险说明 + 量产注意事项
7. 项目转「已发布」可归档；产品生命周期 → 量产/维护态

发布后该 Revision 的①②永久冻结，不可撤销；要再改 = 走下一个项目、出下一个 Rev。

---

## 7. 版本号规则（决策 B，已锁）

- 每个产品用 **Rev A / B / C** 字母，**定义核心变更的发布**进一格。
- 不影响定义的项目（左支）不跳号。
- 二代升级这种大改可另立新产品（可仍派生自同一 Platform），而非新 Rev。

---

## 8. 溯源（双向键）

Issue、Change、Document 挂在 **Product** 上（永久），**同时保留对来源 Project 的引用**。

- 开发期问题（EVT/DVT/PVT）：productId + projectId 都有。
- 量产后问题（客诉/退货）：只有 productId，无 projectId。
- 好处：量产两年后回查「这个客诉对应的设计问题当初哪个项目、哪个 Gate 放行的」，链路拉得到底。

---

## 9. 跨职能并行研发与角色

**统一角色（与项目轴 v2 一致）：**

| 角色 code | 职责 | 强制守门人 |
|---|---|---|
| `pm` | 统筹 / 范围 / 进度 | ✓ |
| `manager` | 决策拍板（立项 / ID / 量产） | ID & MP Gate |
| `rd_hw` / `rd_sw` / `rd_mech` | 硬件 / 软件固件 / 结构·ID | |
| `qa` | 测试 / 可靠性 /（认证默认含） | ✓ |
| `cert` | 法规 / 认证（可并入 qa） | ✓（多市场 / 锂电） |
| `pe` | 工艺 / 治具 / 模具 / 设备 | ✓ |
| `mfg` | 产线 / 量产 / 良率 | ✓ |
| `scm` | 采购 / 供应商 / 物料 / 成本 | ✓ |
| `sales` | 需求 / 客户 / 卖点 / 市场 | ID Gate |
| `battery_safety` | 锂电安全·会签帽子（暂由 rd_hw 兼） | ✓（锂电） |
| `viewer` | 查看 | |

**门禁会签 = 强制守门人（恒签） ∪ 活跃模块责任职能（条件签）。**
即使模块「完全复用」，强制守门人仍签兼容性 / 供应 / 量产 / 安全风险——**安全与合规不因复用被跳过**。

- 一个阶段可挂多道命名评审（ID 评审 / DFM / 安全评审 / 认证评审），每道 = 会签盘 + 检查清单。
- 目标：让问题在**设计阶段**被各职能发现，而不是拖到试产（早发现成本是后期的百分之一）—— 同时提速与提质。

详见 `2026-06-13-project-axis-modular-sop.md`（模块化 SOP、变更等级、Gate 模型、认证矩阵）。

---

## 10. 两个入口（导航）

- **项目入口**：我现在要推进什么 —— 过程驾驶视图。
- **产品入口**：这个产品什么状态、怎么变过、依据在哪 —— 资产档案视图。
- 产品页主视图 = **版本时间线**：每个节点一个 Revision，每条边一个项目（含非跳版项目记录），点开就是当时冻结的发布包。

导航：仪表盘 · 项目管理 · 产品库（按品类）· 平台库 · BOM 管理 · 变更管理 · 质量问题 · 文档资料 · 测试验证 · 认证管理 · Gate/SOP · 系统管理。

---

## 11. 数据模型（表级，建造基线）

沿用现有约定：顶层实体用 `varchar(32)` nanoid 主键，子记录用 `serial` 自增 + FK。

**新增表：**

- `platforms` — `id varchar(32) PK`, `name`, `category`, `description`, `createdAt`（平台 = 一组可复用核心模块版本的捆绑；整机派生自平台）
- `products` — `id varchar(32) PK`, `productNumber`, `name`, **`type`(finished/component)**, `category`（开放品类）, **`platformId NULL`**（派生平台）, **`targetMarkets jsonb`**（市场数组 EU/US/JP…）, `lifecycleState`(concept/development/mass_production/maintenance/eol), `currentRevisionId`, `createdBy`, `createdAt`, `updatedAt`
- `product_revisions` — `id serial PK`, `productId FK`, `revisionLabel`(Rev A/B/C), `parentRevisionId`(自引用), `createdByProjectId`(来源项目), `status`(draft/released/superseded), `releasedAt`, `releasedBy`
- `mp_releases` — `id serial PK`, `productId`, `revisionId`, `projectId`, `snapshotBom jsonb`, `snapshotDocs jsonb`, `openIssues jsonb`, `specs jsonb`, `notes`, `releasedBy`, `releasedAt`
- `bom_items` — `id serial PK`, `revisionId FK NULL`(冻结归属), `projectId FK NULL`(工作态归属), `partNumber`, `name`, `spec`, `quantity`, `refDesignator`, **`componentProductId NULL` / `componentRevisionId NULL`**（BOM 行引用零部件/平台模块，而非裸料 → where-used 基础）, `supplierId NULL`, `unitCost`, `createdAt`
- `documents` — `id serial PK`, `productId`, `revisionId NULL`, `projectId NULL`, `name`, `isControlled bool`, `version`, `supersedesId NULL`, `storageKey`, `uploadedBy`, `createdAt`
- `suppliers` — `id serial PK`, `name`, `contact`, `createdAt`
- `project_modules` — `id serial PK`, `projectId FK`, `moduleKey`, **`changeLevel`(carryover/reuse_verify/minor/redesign/new)**, `reusedRevisionId NULL`（项目的复用集声明，驱动任务/会签）
- `module_library` — `id serial PK`, `moduleKey`, `name`, `scope`(shared/platform), `category NULL`, `ownerRoles jsonb`
- `module_tasks` — `id serial PK`, `moduleKey`, `phase`, `task`, `executor`(internal/supplier/lab), `ownerRoles jsonb`(内部责任·审核), `gateName NULL`, `checklist jsonb`（任务×阶段×执行方×责任职能×门禁×检查项）
- `cert_matrix` — `id serial PK`, `market`, `changeTrigger`, `regulations jsonb`（市场 × 变更 → 检查项）

**改动表：**

- `projects` — 加 `productId`, **`mode`**(npd_new_category / npd_new_platform / npd_derivative / eco / idr), **`objectType`**(finished/component), `baseRevisionId NULL`（派生起点）, `resultRevisionId NULL`（发布时回填）
- `project_issues` → 加 `productId`（保留 `projectId` 做溯源键，可空）
- `project_changelog` → 加 `productId`（保留 `projectId`）
- `project_gate_reviews` → 升级为「**命名评审** + **会签盘（强制守门人 ∪ 模块责任）** + **检查清单（逐项签字）**」
- `PROJECT_MEMBER_ROLES` → 统一为 §9 全表（现有 + `pe` `mfg` `sales` `cert` `battery_safety`）
- `project_files` → 并入 `documents`，补 `productId`

---

## 12. 分阶段迁移（四刀，趁数据近零）

> 关键时机：线上数据近乎为零，是把 Product 脊梁插进去最便宜的窗口。此项优先级排在「评论/通知」等协作功能**之前**。

1. **第一刀 — Product 脊梁**：建 `platforms` + `products`(含 type/category/platformId/targetMarkets) + `product_revisions`；`projects` 加 `productId` + `mode`/`objectType`；做「产品库（按品类）+ 平台库」导航 + 生命周期状态。不碰现有项目功能。
2. **第二刀 — MP Release**：建 `mp_releases`；实现发布动作（校验→冻结→生成 Rev→项目归档→产品转态）。两轴交接点成型。
3. **第三刀 — 模块化 SOP + 溯源**：建 `module_library`/`module_tasks`/`project_modules`/`cert_matrix`；Gate 升级（守门人+检查清单）；`issues`/`changelog` 加 `productId` 双向键。
4. **第四刀 — PLM 血肉**：`bom_items`（含零部件/平台引用 + 轻量 where-used）+ `documents` 受控版本 + 自动 BOM diff + 产品时间线视图。

---

## 13. v1 范围边界（明确不做）

- **并发分支合并**：两个项目同时从 Rev A 改 → v1 先串行发布，不做 git 式分支合并。
- **BOM 层级**：支持 BOM 行引用零部件/平台模块版本（单层）+ 轻量 where-used 反查（平台复用需要）；多级递归展开 deferred。
- **完整文档审批流**：先简单版本链，不做多级审批路由。
- **重型 PLM**（跨产品自动变更影响传播、合规 REACH 全套、PLM-ERP 集成）：不在 v1；但**变更等级、认证矩阵、平台复用已纳入**。

---

## 14. 待细化

- **项目轴细化**：✅ 已完成 → `2026-06-13-project-axis-modular-sop.md`（v2）。
- **产品轴细化**：待办 —— 产品/平台主数据字段、BOM 平铺字段集、文档受控流程、认证矩阵市场×变更映射、发布包内容清单、产品时间线视图、客诉/售后闭环。
