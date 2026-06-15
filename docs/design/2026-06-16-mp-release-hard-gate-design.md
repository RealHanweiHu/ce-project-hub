# MP Release 硬闸口设计 — 把 Gate 从「记录型」变「控制型」

> 状态：**草拟（待评审）** · 日期：2026-06-16
> 定位：让 **MP Release** 成为服务端强制的真闸口，关键交付/质量门槛不可被前端绕过。
> 范围：本文档只覆盖 **Step 1（服务端硬卡 + 留痕例外）**；结构化会签表与钉钉审批为 **Step 2**，见末尾「明确不做」。
> 关联：`2026-06-13-two-axis-plm-architecture.md`（MP Release 作为双轴交汇的原子闸口）。

---

## 1. 背景与问题

现状（已核对代码）：

- **Gate 记录**：`projectGateReviews` 表有 `decision`(approved/conditional/rejected)、`conditions`、`roundNumber`、`participants`，但 `participants` 是**自由文本**，没有结构化的「会签角色签署状态」。
- **就绪检查**：`computeGateReadiness()`（`client/src/components/views/ProjectDetailView.tsx`）在**前端**计算 blockers，仅作 UX 提示，不卡流程。
- **MP Release 服务端校验**：`releaseProject()`（`server/db.ts`）**已有硬卡，但只卡两条**——`productId` 存在 + P0/P1 = 0。**没有**校验「前置 Gate 是否 approved / 必备交付物是否齐」。

**核心风险**：流程看起来严谨，但关键闸口仍可能被绕过——MP Release 的服务端校验只查了 2 项，漏了 Gate 本身。

本设计把缺口补齐，并明确「绝对硬卡」与「可留痕例外」的边界。

---

## 2. 关键判定：「MP Release 前置 Gate」怎么稳定识别

### 2.1 为什么不能用位置推断

| 类型 | phases | 业务上的「MP Release 前置 Gate」 | phaseId | gateTaskId |
|---|---|---|---|---|
| NPD | Concept→…→PVT→**MP** | PVT 出口「MP准备就绪评审」 | `pvt` | `pv8` |
| ECO | Planning→…→PVT→**MP** | PVT「变更量产切换评审」 | `pvt` | `epv5` |
| IDR | Design→Engineering→DVT→**MP** | **MP 阶段「MP Release评审」** | `mp` | `im6` |

- 「取最后一个 phase 的 Gate」→ NPD/ECO 会被卡到量产后的 EOL/持续改善，**错**（发布语义不对）。
- 「取倒数第二个 phase 的 Gate」→ **IDR 会被卡到 DVT，也错**。

**没有任何单一位置规则能同时覆盖三类。** 发布语义必须**显式声明**，不能靠位置推断。

### 2.2 方案：模板语义锚点

在 `shared/sop-templates.ts` 的 `SOPPhase` 上新增 `isReleaseGate?: boolean`，在三套模板各标一处：

| 类型 | 标记的 phase | phaseId |
|---|---|---|
| NPD | PVT | `pvt` |
| ECO | PVT | `pvt` |
| IDR | MP | `mp` |

新增帮助函数：

```ts
export const getReleaseGatePhase = (category?: string): SOPPhase | null =>
  getPhasesForCategory(category).find((p) => p.isReleaseGate) ?? null;
```

代价极小（纯模板字段 + 一个 helper），换来：规则自解释、三类型各自正确、未来新增流程类型只需在模板标记。

---

## 3. 闸口判定矩阵（最终）

| 条件 | 普通发布 | owner/PM/manager 强制发布 |
|---|---|---|
| 未关联产品 | ❌ | ❌ **绝对硬卡** |
| P0/P1 未关闭 | ❌ | ❌ **绝对硬卡** |
| 前置 Gate 必备交付物未齐 | ❌ | ❌ **绝对硬卡** |
| 前置 Gate `rejected` / 无记录 | ❌ | ❌ 不提供强制 |
| 前置 Gate `conditional`（其余硬卡均过） | ❌ 禁用 + 展示条件 | ✅ 留痕后可发 |
| 前置 Gate `approved`（其余硬卡均过） | ✅ | — |

**一句话边界**：四道绝对硬卡（产品 / P0P1 / 交付物 / 非 rejected）任何人都不可绕；强制发布唯一能覆盖的是「决议是 `conditional` 而非 `approved`」这一格。

### 3.1 「最新 Gate 记录」的定义

同一 `phaseId` 下：`roundNumber` 最大者；并列时取 `createdAt` 最新者。取这条的 `decision` 作为闸口判定依据。

---

## 4. 授权口径（Release override 专用）

> 注意：这是**发布场景的扩展授权**，不是修改全局权限矩阵，也不改 `getEffectiveRole()` 现有行为。

现有权限事实：
- 系统角色：`admin / user`（无 global manager）。
- 项目角色：`owner / manager / pm / ...`（存 `project_members.role`）。
- `getEffectiveRole()` 口径：`project.createdBy === userId` → `owner`；否则查 `project_members.role`；**不会**因 `project.pmUserId === userId` 自动变 owner/manager。

允许带条件强制发布的人：**项目创建人、项目 PM、项目成员角色为 `manager` 的用户**。服务端判断单独写，不只依赖 `getEffectiveRole()`：

```ts
const canOverrideConditionalRelease =
  project.createdBy === ctx.user.id ||
  project.pmUserId   === ctx.user.id ||
  effectiveRole === "owner" ||
  effectiveRole === "manager";
```

`pmUserId` 显式加入是业务决定（「项目 owner = 创建人/PM」说得通），spec 在此明示这是 override 专用扩展。

**admin break-glass**：系统 `admin` 允许作为 break-glass 走强制发布，但**只走同一条留痕通道**（同样写 `overrideReason/acceptedBy/...`），且**四道绝对硬卡对 admin 一样不可绕**。即 admin 相对普通用户唯一多出的权力，就是和 owner/PM/manager 一样能对 `conditional` 做留痕 override，不多不少。

---

## 5. 数据模型改动

### 5.1 `shared/sop-templates.ts`
- `SOPPhase` 增 `isReleaseGate?: boolean`；NPD `pvt`、ECO `pvt`、IDR `mp` 各标记。
- 新增 `getReleaseGatePhase(category)`。

### 5.2 `mp_releases`（加列，强制发布留痕）

| 列 | 类型 | 说明 |
|---|---|---|
| `overridden` | boolean, default false | 是否为 conditional 留痕强制发布 |
| `overrideReason` | text | 强制发布理由（override 时必填） |
| `acceptedBy` | integer (userId) | 服务端取登录态，不信前端 |
| `acceptedAt` | timestamp | 服务端取时间戳 |
| `conditionsSnapshot` | text | 从 gate review 的 `conditions` 快照 |
| `followUpOwner` | integer (userId) | 后续条件跟进负责人（override 时必填） |
| `dueDate` | varchar(32) | 条件跟进截止日（override 时必填） |

> 不改 `projectGateReviews` 结构（Step 1 不动会签）。

---

## 6. 服务端逻辑

### 6.1 `server/db.ts` — `releaseProject()`

入参增 `override?: { overrideReason: string; followUpOwner: number; dueDate: string }`。

校验顺序（任一失败即 throw，前端传来的一切重新校验）：

1. 项目存在。
2. **绝对硬卡**：`project.productId` 存在；否则 `项目未关联产品，无法发布`。
3. **绝对硬卡**：`getOpenP0P1Count() === 0`；否则 `存在 N 个未关闭的 P0/P1 问题，不能发布`。
4. 定位前置 Gate：`getReleaseGatePhase(project.category)`；为空则 `未定义 MP Release 前置 Gate`。
5. 取该 `phaseId` 最新 gate review（§3.1）。
   - 无记录或 `rejected` → throw，不提供强制。
6. **绝对硬卡**：前置 Gate phase 的必备交付物全部完成；否则 `前置 Gate 交付物未齐（done/total）`，且**不可强制**。
7. 决议判定：
   - `approved` → 放行。
   - `conditional` → 必须 `override` 非空 **且** `canOverrideConditionalRelease` 为真 **且** override 三字段齐全；否则 throw。放行时把 `conditions` 快照进 `conditionsSnapshot`，写 `overridden/overrideReason/acceptedBy/acceptedAt/followUpOwner/dueDate`。
8. 进入原有事务：生成 Rev + 写 `mp_releases` + 产品 → mass_production + 项目 → archived。

### 6.2 `server/routers/products.ts` — `releasePrecheck`

返回结构扩展为：

```ts
{
  hasProduct: boolean;
  productId: string | null;
  openP0P1: number;
  releaseGate: {
    phaseId: string; gateName: string;
    decision: "approved" | "conditional" | "rejected" | null;
    conditions: string | null; roundNumber: number;
  } | null;
  deliverables: { done: number; total: number; missing: string[] };
  blockers: string[];                // 人类可读的拦截原因
  canRelease: boolean;               // 四硬卡过 && decision==="approved"
  canForceRelease: boolean;          // 四硬卡过 && decision==="conditional" && canOverrideConditionalRelease
}
```

---

## 7. 前端 — `ReleaseDialog.tsx`

- 按矩阵渲染 checklist 与禁用态。
- `canRelease` → 显示普通「发布」按钮。
- `!canRelease && canForceRelease`（即 conditional 且当前用户有权）→ 展开「强制发布」区：展示 Gate 条件、必填 `overrideReason / followUpOwner / dueDate`，提交走带 `override` 的 `releaseProject`。
- conditional 但**无权**的用户 → 只看到禁用 + 条件说明 + 「需 owner/PM/manager 强制发布」提示。
- `rejected`/无记录/任一绝对硬卡未过 → 禁用，列出 `blockers`，不显示强制入口。
- **会签角色**：仅 advisory 展示（来自 SOP 模板 `responsibleRoles`），**不参与 Step 1 任何硬卡**。

---

## 8. 测试（服务端为主）

`releaseProject()` 单测覆盖矩阵：

- 三种 category（NPD/ECO/IDR）× `getReleaseGatePhase` 命中正确 phase。
- decision ∈ {approved, conditional, rejected, 无记录}。
- P0/P1 ∈ {0, >0}。
- 交付物 ∈ {齐, 不齐}。
- override ∈ {无, 齐全} × 用户 ∈ {授权(creator/pm/manager/admin), 未授权}。

关键断言：
- 任一绝对硬卡未过 → 必 throw，即便 override + admin。
- `conditional` + 授权 + override 齐全 → 成功且 `mp_releases` 留痕字段正确写入。
- `conditional` + 未授权 → throw。
- `approved` + 四硬卡过 → 成功，`overridden=false`。
- 「最新记录」选取：同 phase 多轮时取 `roundNumber` 最大。

---

## 9. 明确不做（留给 Step 2）

- `project_gate_signoffs` 结构化会签表（projectId/phaseId/gateReviewId/role/userId/decision/signedAt/comment）。
- 角色会签到齐的硬卡（Step 1 角色仅 advisory 展示）。
- 钉钉审批发起（`processinstance/create`）+ 审批事件回调写回。
- 认证矩阵校验、BOM/文档冻结快照。

**Step 1 → Step 2 衔接**：`project_gate_signoffs` 将成为「角色会签」的单一真相源，应用内会签与钉钉审批回调都写它；届时 `releaseProject` 增加「必备会签角色到齐」这道硬卡，读这张表，不依赖钉钉是否在线、不靠文本猜。本设计已为此预留边界（参与人文本在 Step 1 全程不做硬卡）。
