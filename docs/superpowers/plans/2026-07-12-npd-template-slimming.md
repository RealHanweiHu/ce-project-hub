# NPD 模板瘦身分档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 NPD 模板 v3（核心 25 任务 + 4 附加包 7 任务 + 轻量档 15 任务），新建 NPD 项目按档位/附加包裁剪种子任务，老项目不受影响。

**Architecture:** 新增模板版本 `2026-07-v3`，只对 NPD 生效；存量项目钉在自己的 `sopTemplateVersion`（v1/v2）上，**零数据迁移**。档位+附加包配置存 `projects.customFields.npdTemplate`（复用衍生品策略的 customFields 模式），纯函数 `getNpdV3EffectivePhases(config)` 在 shared 层统一计算生效任务集，种子写入（`createProjectWithSeed`）与读路径（`getGateReadiness`、client `data.ts`）共用。v3 任务用全新 `n`/`p` 前缀 id，避免与 v1/v2 id 在 `TASK_DELIVERABLES` 等按-id-不按-version 的映射里冲突。

**Tech Stack:** TypeScript, tRPC, Drizzle/Postgres, Vitest（DB-backed router 测试 + shared 纯函数测试）, React (wouter, 无表单库的 wizard)。

**设计文档:** `docs/superpowers/specs/2026-07-12-npd-template-slimming-tiering-design.md`（55→25+7 映射表、七条纪律、红线、预算）

**关键既有事实（勘探确认）:**
- `getPhasesForCategory(category?, templateVersion?)` at `shared/sop-templates.ts:1749` 是唯一模板访问器，按 version 路由。
- 种子循环在 `server/db.ts:442` `createProjectWithSeed`（468–479 逐 phase/task insert），经 `server/sop-data.ts` 的 `getSopPhasesForCategory` 薄包装。
- create mutation 在 `server/routers/projects.ts:530`，硬编码 `sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT`（590 行）。
- Gate readiness `server/db.ts:7049` 用 `getPhasesForCategory(project.category, project.sopTemplateVersion)`；`incompleteTaskIds` 排除 gate 任务和 tailored 任务（7084–7088）。Issue P0/P1 检查已内置（`getPhaseOpenP0P1` 6999）。
- `projectTasks.taskId` 存模板 id（schema 556），唯一索引 `(projectId, phaseId, taskId)`。
- 衍生品先例：策略存 `customFields.derivativeReuseStrategy`，纯函数 `getDerivativeEffectivePhases` 过滤 phase.tasks（sop-templates.ts 346）。
- `TASK_DELIVERABLES: Record<string, string[]>` 按任务 id 全局键控（`shared/task-deliverables.ts`），交付物覆盖守卫测试要求词表内每个名称有模板文件——**v3 只复用既有交付物名称字符串，不引入新名称**，守卫无需重新生成。
- 新项目向导：`client/src/components/views/ProjectListView.tsx` 3 步 wizard，Step 1 品类卡片在 966–1000，纯 useState 无表单库；创建经 `Home.tsx:697` `trpc.projects.create`。
- 测试跑法：`npm test`（scripts/test.mjs 起 Postgres + migrate + vitest）；单测 `npx vitest run <file>`（需 DB 环境变量已就绪时用 `npm test -- <file>`）。

---

## 新旧任务 id 对照（实施基准，来自设计文档 §4）

| v3 id | 名称 | 吸收的 v2 任务 | evidence |
|---|---|---|---|
| nc1 | 产品机会与立项论证 | c1+c2+c3+c5 | heavy |
| nc2 | 技术可行性评估 | c4 | heavy |
| nc3 | Gate 1 立项评审 | c6 | — |
| np1 | 产品需求与规格书 | p1+p2 | heavy |
| np2 | 初版 BOM 与关键供应商 | p4+p5 | light |
| np3 | Gate 2 Kickoff | p7 | — |
| nd1 | ID 工业设计 | d1 | heavy |
| nd2 | MD 结构设计 | d2 | heavy |
| nd3 | EE 原理设计 | d3 | heavy |
| nd4 | PCB Layout | d4 | heavy |
| nd5 | 关键料件定型与 BOM 冻结 | d7 | light |
| nd6 | Gate 3 设计冻结（DFM/DFA 为检查项） | d8+d6 | — |
| ne1 | EVT 样机制作（含软硬件联调检查项） | e1+e4 | light |
| ne2 | EVT 功能/性能测试 | e2+e3 | heavy |
| ne3 | Gate 4 EVT 评审（P0/P1 由 Issue List 检查） | e7（e5 删除） | — |
| nv1 | DVT 样机制作 | v1 | light |
| nv2 | 可靠性测试 | v2 | heavy |
| nv3 | Gate 5 DVT 评审 | v8 | — |
| npv1 | 试产准备（排程/SOP·WI/检验标准/PFMEA-CTQ） | pv1+pv2+pv7+v7 | heavy |
| npv2 | 治具与 EOL 100% 测试 🚩红线 | pv3 | heavy |
| npv3 | 包装与物流验证 | v6+pv6 | heavy |
| npv4 | 试产执行与良率 | pv4+pv5 | heavy |
| npv5 | Gate 6 量产放行 🚩红线 | pv8 | — |
| nm1 | 首批量产与客户放行 🚩红线 | mp1+mp2+mp3 | light |
| nm2 | 项目关闭移交评审 | mp6（mp5 为检查项；mp4 删除→Change Log） | — |
| pb1 | 🔋电芯/电池包策略与供应商资质 | p5a+d7a | heavy |
| pb2 | 🔋安全 FMEA 与保护链路评审 | d6a+d7b | heavy |
| pc1 | 📜认证路线图 | p6a | heavy |
| pc2 | 📜认证测试执行 | v3 | heavy |
| ps1 | 💾软件设计与架构 | d5 | heavy |
| ps2 | 💾软件完整测试 | v5+e4 | heavy |
| pmo1 | 🔨模具开发与 T1/T2 验证 | v4 | heavy |

轻量档 15 任务 = nc1(吸收 nc2), nc3, np1(吸收 np2), np3, nd2, nd3(吸收 nd4，改名"电子设计"), nd6, ne1(改名"样机与功能/性能测试"，吸收 ne2+nv1), nv2, nv3(验证 Gate，EVT/DVT 合一——ne3 不出现), npv1(吸收 npv3+npv4，改名"试产准备与执行"), npv2 🚩, npv5 🚩, nm1 🚩, nm2。轻量档 evt 阶段消失（其任务并入 verification 阶段）。

---

### Task 1: SOPTask 增加 evidence 字段 + v3 版本常量与默认版本路由

**Files:**
- Modify: `shared/sop-templates.ts:22-38`（SOPTask interface）、`shared/sop-templates.ts:81-90`（版本常量区）
- Test: `shared/sop-templates.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `shared/sop-templates.test.ts` 末尾追加：

```ts
import {
  SOP_TEMPLATE_VERSION_NPD_V3,
  normalizeSopTemplateVersion,
  getDefaultTemplateVersionForCategory,
} from "./sop-templates";

describe("NPD v3 版本路由", () => {
  it("v3 常量与 normalize", () => {
    expect(SOP_TEMPLATE_VERSION_NPD_V3).toBe("2026-07-v3");
    expect(normalizeSopTemplateVersion("2026-07-v3")).toBe("2026-07-v3");
  });
  it("新建默认版本：npd 用 v3，其余用 current", () => {
    expect(getDefaultTemplateVersionForCategory("npd")).toBe("2026-07-v3");
    expect(getDefaultTemplateVersionForCategory("eco")).toBe(SOP_TEMPLATE_VERSION_CURRENT);
    expect(getDefaultTemplateVersionForCategory("derivative")).toBe(SOP_TEMPLATE_VERSION_CURRENT);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- shared/sop-templates.test.ts`
Expected: FAIL — `SOP_TEMPLATE_VERSION_NPD_V3` 未导出。

- [ ] **Step 3: 最小实现**

`shared/sop-templates.ts`——SOPTask 加可选字段（22–38 行 interface 内）：

```ts
export interface SOPTask {
  id: string;
  name: string;
  desc: string;
  owner: string;
  guide: string;
  visibleRoles?: string[];
  durationDays?: number;
  dependsOn?: string[];
  /** 证据级别：light=一句话/照片/链接可在钉钉卡片内闭环；heavy=需网页上传文件。缺省视为 light。 */
  evidence?: "light" | "heavy";
}
```

版本常量区（81–90 附近）：

```ts
export const SOP_TEMPLATE_VERSION_NPD_V3 = "2026-07-v3";

export function getDefaultTemplateVersionForCategory(category?: string | null): string {
  return category === "npd" ? SOP_TEMPLATE_VERSION_NPD_V3 : SOP_TEMPLATE_VERSION_CURRENT;
}
```

`normalizeSopTemplateVersion` 增加对 v3 的识别（保持未知值回退 CURRENT 的现有行为，新增显式分支）：

```ts
export function normalizeSopTemplateVersion(version?: string | null): string {
  if (version === SOP_TEMPLATE_VERSION_LEGACY) return SOP_TEMPLATE_VERSION_LEGACY;
  if (version === SOP_TEMPLATE_VERSION_NPD_V3) return SOP_TEMPLATE_VERSION_NPD_V3;
  return SOP_TEMPLATE_VERSION_CURRENT;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- shared/sop-templates.test.ts`
Expected: PASS（含既有用例，确认 normalize 旧行为未破坏）。

- [ ] **Step 5: Commit**

```bash
git add shared/sop-templates.ts shared/sop-templates.test.ts
git commit -m "feat(sop): add evidence field and 2026-07-v3 version routing constants"
```

---

### Task 2: 新建 `shared/npd-v3.ts` — 核心 25 任务模板

**Files:**
- Create: `shared/npd-v3.ts`
- Test: `shared/npd-v3.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `shared/npd-v3.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { NPD_V3_CORE_PHASES } from "./npd-v3";
import { NPD_PHASES, PROJECT_CATEGORIES } from "./sop-templates";

const coreTasks = NPD_V3_CORE_PHASES.flatMap((p) => p.tasks);

describe("NPD v3 核心模板", () => {
  it("复杂度预算：核心恰好 25 个任务、7 个阶段、每阶段有 gateTaskId", () => {
    expect(coreTasks).toHaveLength(25);
    expect(NPD_V3_CORE_PHASES).toHaveLength(7);
    for (const phase of NPD_V3_CORE_PHASES) {
      expect(phase.tasks.some((t) => t.id === phase.gateTaskId)).toBe(true);
    }
  });
  it("任务 id 全局唯一，且不与任何既有模板 id 冲突", () => {
    const existing = new Set(
      PROJECT_CATEGORIES.flatMap((c) => c.phases.flatMap((p) => p.tasks.map((t) => t.id)))
    );
    const seen = new Set<string>();
    for (const t of coreTasks) {
      expect(seen.has(t.id), `duplicate ${t.id}`).toBe(false);
      expect(existing.has(t.id), `collides with legacy ${t.id}`).toBe(false);
      seen.add(t.id);
    }
  });
  it("dependsOn 只引用核心模板内存在的 id", () => {
    const ids = new Set(coreTasks.map((t) => t.id));
    for (const t of coreTasks) for (const dep of t.dependsOn ?? []) {
      expect(ids.has(dep), `${t.id} depends on missing ${dep}`).toBe(true);
    }
  });
  it("红线任务存在：npv2 / npv5 / nm1", () => {
    const ids = new Set(coreTasks.map((t) => t.id));
    for (const id of ["npv2", "npv5", "nm1"]) expect(ids.has(id)).toBe(true);
  });
  it("非 gate 任务都有 evidence 标注", () => {
    const gateIds = new Set(NPD_V3_CORE_PHASES.map((p) => p.gateTaskId));
    for (const t of coreTasks) {
      if (!gateIds.has(t.id)) expect(t.evidence, `${t.id} missing evidence`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- shared/npd-v3.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 `shared/npd-v3.ts`**

完整内容（阶段颜色/时长沿用 v2；gateStandard 为 v3 专属、requiredDeliverables 只含核心交付物，附加包的 Gate 必交项由 Task 3 的包定义合并进来；交付物名称一律复用既有词表字符串）：

```ts
// NPD 模板 v3（2026-07-v3）——瘦身分档版。
//
// ⚠️ 复杂度预算（准入纪律，勿删）：核心档 ≤25 任务；核心+常规包组合 ≤30；四包全激活上限 32。
// 任务准入四项判据（至少满足其一，全不满足的职能动作进操作指南/检查项）：
//   ①改变状态 ②明确责任（独立责任人+截止） ③形成决策 ④产生审计证据。
// 过了判据还须回答：为什么不能作为①任务内检查项 ②操作指南 ③附加包？答不上来就不准进核心。
// 55→25 映射依据：docs/superpowers/specs/2026-07-12-npd-template-slimming-tiering-design.md
import type { SOPPhase, SOPGateStandard } from "./sop-templates";

const gs = (over: Partial<SOPGateStandard>): SOPGateStandard => ({
  entryCriteria: [], exitCriteria: [], requiredDeliverables: [],
  responsibleRoles: [], evidenceRequirements: [], exceptionStrategy: [], ...over,
});

export const NPD_V3_CORE_PHASES: SOPPhase[] = [
  {
    id: "concept", code: "P1", name: "概念阶段", nameEn: "Concept", duration: "2-4周",
    desc: "市场洞察与产品立项", gate: "立项评审 / Project Charter", gateTaskId: "nc3", color: "#78716c",
    deliverables: ["立项申请书", "认证路线图初判"],
    gateStandard: gs({
      exitCriteria: ["立项论证完成（市场/概念/商业模型）", "技术可行性结论明确", "认证/电池安全硬卡完成初判"],
      requiredDeliverables: ["立项申请书"],
      responsibleRoles: ["产品经理", "R&D Lead", "管理层"],
    }),
    tasks: [
      { id: "nc1", name: "产品机会与立项论证", desc: "市场/竞品/用户需求/概念/商业模型，汇为一份立项论证", owner: "产品经理", evidence: "heavy",
        visibleRoles: ["pm", "sales", "manager", "owner"], durationDays: 10,
        guide: "检查项：1) 竞品对比矩阵（TOP3-5） 2) 用户痛点与场景（访谈/问卷规模按项目体量自定） 3) 一句话产品定义+核心卖点 4) 销量/成本/毛利模型。全部落入一份立项申请书。" },
      { id: "nc2", name: "技术可行性评估", desc: "关键技术验证、专利检索、认证路线初判", owner: "R&D Lead", evidence: "heavy",
        visibleRoles: ["rd_hw", "rd_sw", "rd_mech", "cert", "battery_safety", "pm", "manager", "owner"], durationDays: 7,
        guide: "1) 关键技术挑战清单与核心 POC 2) 专利检索与规避 3) 目标市场认证路线、电池安全和运输硬卡初判。" },
      { id: "nc3", name: "立项评审 (Gate 1)", desc: "正式立项决策评审", owner: "管理层", visibleRoles: [], durationDays: 1,
        dependsOn: ["nc1", "nc2"],
        guide: "评审材料：立项申请书 + 技术可行性结论。通过后在立项配置中完成成员角色指派与排期初始化（原 p3/p6 已移出任务清单）。" },
    ],
  },
  {
    id: "planning", code: "P2", name: "规划阶段", nameEn: "Planning", duration: "2-3周",
    desc: "需求规格与供应基础", gate: "Kickoff评审", gateTaskId: "np3", color: "#a16207",
    deliverables: ["产品需求文档 PRD", "产品规格书 PSD", "BOM v0.1"],
    gateStandard: gs({
      exitCriteria: ["需求与规格评审通过", "初版 BOM 与关键供应商明确"],
      requiredDeliverables: ["产品需求文档 PRD", "产品规格书 PSD", "BOM v0.1"],
      responsibleRoles: ["产品经理", "R&D", "采购"],
    }),
    tasks: [
      { id: "np1", name: "产品需求与规格书", desc: "PRD/PSD 合一：功能/非功能需求、技术规格、性能与安全边界", owner: "产品经理/R&D", evidence: "heavy",
        visibleRoles: ["pm", "rd_hw", "rd_sw", "rd_mech", "battery_safety", "manager", "owner"], durationDays: 7, dependsOn: ["nc3"],
        guide: "检查项：1) 功能需求与验收标准 2) 硬件/软件规格与性能指标 3) 锂电、电机、受压腔体的安全边界与验收指标（必填）。" },
      { id: "np2", name: "初版 BOM 与关键供应商", desc: "关键料件清单+供应商列，预估成本", owner: "EE/采购", evidence: "light",
        visibleRoles: ["rd_hw", "scm", "pm", "manager", "owner"], durationDays: 5, dependsOn: ["nc3"],
        guide: "一张表：料件/供应商(2-3家)/单价/长交期与单一来源标注；安全件标注资质与替代来源风险。" },
      { id: "np3", name: "Kickoff 会议 (Gate 2)", desc: "项目正式启动，目标对齐", owner: "项目经理/产品经理", visibleRoles: [], durationDays: 1,
        dependsOn: ["np1", "np2"],
        guide: "议程：目标/规格 Walk-through/里程碑/角色职责。" },
    ],
  },
  {
    id: "design", code: "P3", name: "设计阶段", nameEn: "Design", duration: "6-12周",
    desc: "ID/MD/EE 并行设计（独立工作线，不合并）", gate: "设计冻结评审 (Design Freeze)", gateTaskId: "nd6", color: "#0369a1",
    deliverables: ["ID 外观设计稿", "结构 3D 设计", "电子原理图", "PCB Layout 文件", "BOM v1.0"],
    gateStandard: gs({
      exitCriteria: ["ID/MD/EE 设计完成", "DFM/DFA 检查项闭环", "BOM 成本 vs 目标达标", "关键料件规格冻结"],
      requiredDeliverables: ["ID 外观设计稿", "结构 3D 设计", "电子原理图", "PCB Layout 文件", "BOM v1.0"],
      responsibleRoles: ["ID", "MD", "EE", "采购"],
    }),
    tasks: [
      { id: "nd1", name: "ID 工业设计", desc: "外观造型、材质、CMF", owner: "ID", evidence: "heavy",
        visibleRoles: ["rd_mech", "pm", "manager", "owner"], durationDays: 15, dependsOn: ["np3"],
        guide: "草图发散→候选精化→CMF 定义→渲染图。外观方向冻结是结构展开前提。" },
      { id: "nd2", name: "MD 结构设计", desc: "堆叠、装配、公差", owner: "MD", evidence: "heavy",
        visibleRoles: ["rd_mech", "pm", "manager", "owner"], durationDays: 20, dependsOn: ["nd1"],
        guide: "内部堆叠→装配工艺→公差分析。堆叠输出是 Layout 板框前提。" },
      { id: "nd3", name: "EE 原理设计", desc: "电源/MCU/传感/保护链路架构与原理图", owner: "EE", evidence: "heavy",
        visibleRoles: ["rd_hw", "battery_safety", "pm", "manager", "owner"], durationDays: 15, dependsOn: ["np3"],
        guide: "系统框图→原理图→电源树与功耗；过充/过放/过流/过温/短路保护链路与测试点为必填检查项。" },
      { id: "nd4", name: "PCB Layout", desc: "布线、阻抗、EMC", owner: "EE", evidence: "heavy",
        visibleRoles: ["rd_hw", "pm", "manager", "owner"], durationDays: 10, dependsOn: ["nd3", "nd2"],
        guide: "板层规划→关键信号阻抗→EMC/EMI→DRC。依赖原理图+结构板框，单独追踪以暴露跨线停等。" },
      { id: "nd5", name: "关键料件定型与 BOM 冻结", desc: "主料规格冻结、供货协议、BOM v1.0", owner: "EE/采购", evidence: "light",
        visibleRoles: ["rd_hw", "scm", "battery_safety", "pm", "manager", "owner"], durationDays: 7, dependsOn: ["nd3"],
        guide: "2nd Source 验证→供货协议→锁定规格；安全件单独记录批准版本与限制条件。" },
      { id: "nd6", name: "设计冻结评审 (Gate 3)", desc: "Design Freeze，进入打样", owner: "跨部门", visibleRoles: [], durationDays: 1,
        dependsOn: ["nd1", "nd2", "nd3", "nd4", "nd5"],
        guide: "评审检查项：1) 各设计线完成度 2) DFM/DFA Checklist（原 d6 转入） 3) BOM 成本 vs 目标 4) EVT 计划。" },
    ],
  },
  {
    id: "evt", code: "P4", name: "EVT 工程验证", nameEn: "EVT", duration: "4-6周",
    desc: "工程样机功能验证", gate: "EVT评审", gateTaskId: "ne3", color: "#7c3aed",
    deliverables: ["EVT 样机", "功能测试报告 (FT)"],
    gateStandard: gs({
      exitCriteria: ["主要功能 Pass Rate ≥ 95%", "Issue List 无未关闭 P0/P1（系统自动检查）", "性能初测达标"],
      requiredDeliverables: ["功能测试报告 (FT)"],
      responsibleRoles: ["EE", "QA"],
    }),
    tasks: [
      { id: "ne1", name: "EVT 样机制作", desc: "手工样机 ≥10 台（含软硬件联调）", owner: "EE/EMS", evidence: "light",
        visibleRoles: ["rd_hw", "rd_sw", "pm", "manager", "owner"], durationDays: 10, dependsOn: ["nd6"],
        guide: "PCBA 打样→整机组装→版本序号标注；软硬件联调（Bringup/驱动/协议）为内部检查项。证据：样机照片+Build Record 链接。" },
      { id: "ne2", name: "EVT 功能/性能测试", desc: "FT+PT 一份报告：功能逐项、续航、热、跌落初测", owner: "QA", evidence: "heavy",
        visibleRoles: ["qa", "rd_hw", "pm", "manager", "owner"], durationDays: 10, dependsOn: ["ne1"],
        guide: "Test Plan→逐项 Pass/Fail→问题直接进系统 Issue List（原 e5 问题清单任务已删除）；改板由 Issue/ECR 驱动（原 e6）。" },
      { id: "ne3", name: "EVT 评审 (Gate 4)", desc: "是否达到进入 DVT 条件", owner: "跨部门", visibleRoles: [], durationDays: 1,
        dependsOn: ["ne2"],
        guide: "P0/P1 关闭状态由系统读 Issue List 自动检查，无需人工汇总问题清单。" },
    ],
  },
  {
    id: "dvt", code: "P5", name: "DVT 设计验证", nameEn: "DVT", duration: "4-8周",
    desc: "设计成熟度全面验证", gate: "DVT评审", gateTaskId: "nv3", color: "#0f766e",
    deliverables: ["DVT 样机", "可靠性测试报告"],
    gateStandard: gs({
      exitCriteria: ["可靠性测试全部 Pass", "Issue List 无未关闭 P0/P1"],
      requiredDeliverables: ["可靠性测试报告"],
      responsibleRoles: ["EMS", "QA"],
    }),
    tasks: [
      { id: "nv1", name: "DVT 样机制作", desc: "半正式产线 ≥30 台", owner: "EMS", evidence: "light",
        visibleRoles: ["rd_hw", "pm", "manager", "owner"], durationDays: 10, dependsOn: ["ne3"],
        guide: "半正式产线 SMT→整机组装→模拟量产工艺。证据：Build Record 链接。" },
      { id: "nv2", name: "可靠性测试", desc: "跌落/高低温/湿热/振动/老化", owner: "QA", evidence: "heavy",
        visibleRoles: ["qa", "pm", "manager", "owner"], durationDays: 15, dependsOn: ["nv1"],
        guide: "标准矩阵：跌落 1.5m×26 面、-20~60℃、40℃/95%RH×96h、振动。" },
      { id: "nv3", name: "DVT 评审 (Gate 5)", desc: "进入 PVT 前的关键评审", owner: "跨部门", visibleRoles: [], durationDays: 1,
        dependsOn: ["nv2"],
        guide: "通过标准：可靠性全 Pass；激活的认证/模具/软件包任务闭环。" },
    ],
  },
  {
    id: "pvt", code: "P6", name: "PVT 试产验证", nameEn: "PVT", duration: "3-6周",
    desc: "生产工艺与良率验证", gate: "MP准备就绪评审", gateTaskId: "npv5", isReleaseGate: true, color: "#b45309",
    deliverables: ["SOP/WI作业指导书", "良率报告", "EOL 100%测试能力验收记录", "包装与物流验证报告"],
    gateStandard: gs({
      exitCriteria: ["试产良率达标（整机直通率≥95%）", "工艺/检验文件完整", "EOL 100% 测试能力就绪", "物料供应稳定"],
      requiredDeliverables: ["SOP/WI作业指导书", "良率报告", "EOL 100%测试能力验收记录", "包装与物流验证报告"],
      responsibleRoles: ["ME", "QA", "测试工程", "SCM"],
    }),
    tasks: [
      { id: "npv1", name: "试产准备", desc: "排程/物料齐套/SOP·WI/检验标准/PFMEA-CTQ 一套文件包", owner: "ME/工厂", evidence: "heavy",
        visibleRoles: ["rd_mech", "rd_hw", "qa", "scm", "pe", "mfg", "pm", "manager", "owner"], durationDays: 10, dependsOn: ["nv3"],
        guide: "检查项：试产排程与齐套、每工位 SOP/WI、IPQC/OQC/AQL 检验标准、PFMEA 与 CTQ（原 pv1+pv2+pv7+v7 合一）。" },
      { id: "npv2", name: "治具与 EOL 100% 测试", desc: "🚩红线：ATE/FCT/老化治具与逐台安全检测能力", owner: "测试工程", evidence: "heavy",
        visibleRoles: ["rd_hw", "qa", "pe", "battery_safety", "pm", "manager", "owner"], durationDays: 10, dependsOn: ["nv3"],
        guide: "逐台检测：气压精度、自动停泵/过压保护、连续工作温升；电池项目叠加 Hi-pot/绝缘/保护功能/OCV-IR。输出限值与验收记录。任何档位不得裁剪。" },
      { id: "npv3", name: "包装与物流验证", desc: "包装结构+ISTA 运输测试+装箱物流方案（承接 DVT 初验）", owner: "SCM/物流", evidence: "heavy",
        visibleRoles: ["scm", "pm", "manager", "owner"], durationDays: 7, dependsOn: ["nv3"],
        guide: "包装结构确认→ISTA 跌落/振动/堆叠→装箱单唛头→物流路径。同一证据只传一次，Gate 直接引用。" },
      { id: "npv4", name: "试产执行与良率", desc: "50-300 台试产 + 良率分析一份报告", owner: "工厂/QE", evidence: "heavy",
        visibleRoles: ["rd_mech", "rd_hw", "qa", "pe", "mfg", "pm", "manager", "owner"], durationDays: 10, dependsOn: ["npv1", "npv2"],
        guide: "FAI 首件→全程良率监控（SMT≥99%/组装≥98%/FCT≥97%/直通率≥95% 为检查项）→试产报告含良率分析。" },
      { id: "npv5", name: "PVT 评审 (Gate 6)", desc: "🚩红线：量产放行（Ready for MP）", owner: "跨部门", visibleRoles: [], durationDays: 1,
        dependsOn: ["npv1", "npv2", "npv3", "npv4"],
        guide: "量产 GO：良率达标、文件完整、EOL 能力就绪、（电池包激活时）UN38.3/MSDS/安全认证证据齐套、物料稳定。" },
    ],
  },
  {
    id: "mp", code: "P7", name: "量产稳定与移交", nameEn: "MP Stabilization & Handover", duration: "2-8周",
    desc: "爬坡、稳定性验证与项目关闭移交", gate: "项目关闭移交评审", gateTaskId: "nm2", isCloseGate: true, color: "#166534",
    deliverables: ["良率报告"],
    gateStandard: gs({
      exitCriteria: ["首批量产良率稳定", "客户放行完成", "售后/RMA 无未闭环重大问题"],
      requiredDeliverables: [],
      responsibleRoles: ["工厂", "项目经理", "QA"],
    }),
    tasks: [
      { id: "nm1", name: "首批量产与客户放行", desc: "🚩红线：爬坡+良率监控+客户样品确认", owner: "工厂/项目经理", evidence: "light",
        visibleRoles: ["scm", "qa", "mfg", "pe", "pm", "manager", "owner"], durationDays: 15, dependsOn: ["npv5"],
        guide: "检查项：首批爬坡、日良率监控与 CAR（原 mp2）、产能爬坡曲线（原 mp3）、客户样品确认与放行记录。变更走系统 Change Log/ECR 模块（原 mp4 已删除）。" },
      { id: "nm2", name: "项目关闭移交评审", desc: "Close Gate：移交量产运营", owner: "跨部门", visibleRoles: [], durationDays: 1,
        dependsOn: ["nm1"],
        guide: "检查项：良率稳定证据、RMA/售后数据（原 mp5）、移交清单、经验教训。" },
    ],
  },
];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- shared/npd-v3.test.ts`
Expected: PASS（5 个用例全绿）。

- [ ] **Step 5: Commit**

```bash
git add shared/npd-v3.ts shared/npd-v3.test.ts
git commit -m "feat(sop): NPD v3 core template — 25 tasks with dependency chain and evidence tiers"
```

---

### Task 3: 附加包 + 轻量档 + 生效阶段计算函数

**Files:**
- Modify: `shared/npd-v3.ts`（追加）
- Test: `shared/npd-v3.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

`shared/npd-v3.test.ts` 追加：

```ts
import {
  NPD_ADDON_PACKS, NPD_V3_LITE_PHASES, getNpdV3EffectivePhases,
  normalizeNpdTemplateConfig, type NpdTemplateConfig,
} from "./npd-v3";

const count = (phases: { tasks: unknown[] }[]) => phases.reduce((n, p) => n + p.tasks.length, 0);

describe("NPD v3 附加包与档位", () => {
  it("四个包共 7 个任务；battery/cert 标红线", () => {
    expect(NPD_ADDON_PACKS.flatMap((p) => p.tasks)).toHaveLength(7);
    expect(NPD_ADDON_PACKS.find((p) => p.id === "battery")?.redline).toBe(true);
    expect(NPD_ADDON_PACKS.find((p) => p.id === "cert")?.redline).toBe(true);
    expect(NPD_ADDON_PACKS.find((p) => p.id === "software")?.redline).toBeFalsy();
  });
  it("轻量档 15 任务、6 阶段（evt 并入 verification），红线任务保留", () => {
    expect(count(NPD_V3_LITE_PHASES)).toBe(15);
    expect(NPD_V3_LITE_PHASES.map((p) => p.id)).toEqual([
      "concept", "planning", "design", "verification", "pvt", "mp",
    ]);
    const ids = new Set(NPD_V3_LITE_PHASES.flatMap((p) => p.tasks.map((t) => t.id)));
    for (const id of ["npv2", "npv5", "nm1"]) expect(ids.has(id)).toBe(true);
    expect(ids.has("ne3")).toBe(false); // EVT gate 合入 nv3
  });
  it("standard 无包 = 25；standard+battery+cert = 29；full 全包 = 32", () => {
    expect(count(getNpdV3EffectivePhases({ tier: "standard", packs: [] }))).toBe(25);
    expect(count(getNpdV3EffectivePhases({ tier: "standard", packs: ["battery", "cert"] }))).toBe(29);
    expect(count(getNpdV3EffectivePhases({ tier: "full", packs: ["battery", "cert", "software", "mold"] }))).toBe(32);
  });
  it("包任务插入目标阶段且排在 gate 任务之前", () => {
    const phases = getNpdV3EffectivePhases({ tier: "standard", packs: ["battery"] });
    const planning = phases.find((p) => p.id === "planning")!;
    const idx = planning.tasks.map((t) => t.id);
    expect(idx).toContain("pb1");
    expect(idx.indexOf("pb1")).toBeLessThan(idx.indexOf("np3"));
  });
  it("lite + battery：pb1 落到 planning、pb2 落到 design，共 17", () => {
    const phases = getNpdV3EffectivePhases({ tier: "lite", packs: ["battery"] });
    expect(count(phases)).toBe(17);
    expect(phases.find((p) => p.id === "design")!.tasks.map((t) => t.id)).toContain("pb2");
  });
  it("包激活时其 Gate 必交项并入对应阶段 gateStandard.requiredDeliverables", () => {
    const phases = getNpdV3EffectivePhases({ tier: "standard", packs: ["battery"] });
    const pvt = phases.find((p) => p.id === "pvt")!;
    expect(pvt.gateStandard.requiredDeliverables).toContain("UN38.3运输测试报告或复用确认");
  });
  it("normalize：非法值回退 standard/空包", () => {
    expect(normalizeNpdTemplateConfig(undefined)).toEqual({ tier: "standard", packs: [] });
    expect(normalizeNpdTemplateConfig({ tier: "x", packs: ["nope", "battery"] } as unknown as NpdTemplateConfig))
      .toEqual({ tier: "standard", packs: ["battery"] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- shared/npd-v3.test.ts`
Expected: FAIL — 新导出不存在。

- [ ] **Step 3: 实现（`shared/npd-v3.ts` 追加）**

```ts
// ── 附加包 ────────────────────────────────────────────────────────────────
export type NpdAddonPackId = "battery" | "cert" | "software" | "mold";
export type NpdTemplateTier = "lite" | "standard" | "full";
export interface NpdTemplateConfig { tier: NpdTemplateTier; packs: NpdAddonPackId[]; }

export interface NpdAddonPack {
  id: NpdAddonPackId;
  name: string;
  desc: string;
  /** 激活后红线：包任务不得再被裁剪/跳过 */
  redline?: boolean;
  /** 包任务插入的核心阶段 id（lite 档 evt/dvt 目标自动映射到 verification） */
  tasks: Array<{ phaseId: string; task: SOPTask }>;
  /** 激活时并入对应阶段 gateStandard.requiredDeliverables 的 Gate 必交项 */
  gateRequiredDeliverables?: Record<string, string[]>;
}

export const NPD_ADDON_PACKS: NpdAddonPack[] = [
  {
    id: "battery", name: "电池安全包", desc: "含锂电/受压腔体的项目激活", redline: true,
    tasks: [
      { phaseId: "planning", task: { id: "pb1", name: "电芯/电池包策略与供应商资质", desc: "复用/定点/二供策略 + 电芯厂审核或复用资质确认（原 p5a+d7a）", owner: "EE/采购/电池安全", evidence: "heavy",
        visibleRoles: ["rd_hw", "scm", "qa", "cert", "battery_safety", "pm", "manager", "owner"], durationDays: 7, dependsOn: ["nc3"],
        guide: "1) 判定复用等级（成熟电芯/平台电池包/新电芯） 2) 主供/二供与切换条件 3) 复用走平台/年度审核证据，新供应商/新化学体系执行完整电芯厂审核。" } },
      { phaseId: "design", task: { id: "pb2", name: "安全 FMEA 与保护链路评审", desc: "DFMEA/危害分析 + BMS/保护板链路校核或复用边界确认（原 d6a+d7b）", owner: "QA/电池安全/EE", evidence: "heavy",
        visibleRoles: ["qa", "battery_safety", "rd_hw", "rd_mech", "rd_sw", "cert", "pm", "manager", "owner"], durationDays: 7, dependsOn: ["nd3"],
        guide: "1) DFMEA 覆盖热失控/过压爆破/连续过热/保护失效 2) 过充过放过流过温短路链路校核 3) P0/P1 安全风险未关闭不得进设计冻结。" } },
    ],
    gateRequiredDeliverables: {
      design: ["安全FMEA与危害分析", "电芯厂质量审核或复用资质确认", "保护电路设计评审或复用确认"],
      pvt: ["UN38.3运输测试报告或复用确认", "MSDS", "电芯/电池包安全认证报告或复用确认"],
    },
  },
  {
    id: "cert", name: "认证包", desc: "有目标市场认证需求的项目激活", redline: true,
    tasks: [
      { phaseId: "planning", task: { id: "pc1", name: "认证路线图", desc: "目标市场证书清单、前置依赖、送样节奏（原 p6a）", owner: "认证/QA", evidence: "heavy",
        visibleRoles: ["qa", "cert", "battery_safety", "rd_hw", "scm", "pm", "manager", "owner"], durationDays: 5, dependsOn: ["nc3"],
        guide: "按目标市场列证书清单（IEC 62133/GB 31241/UL 2054/UN38.3/CCC/CE/FCC/PSE/KC/EMC/RoHS-REACH 适用项），标注卡设计冻结/开模/送样/出口的依赖。" } },
      { phaseId: "dvt", task: { id: "pc2", name: "认证测试执行", desc: "电池安全、运输、整机、EMC、材料合规送测（原 v3）", owner: "QA/认证", evidence: "heavy",
        visibleRoles: ["qa", "cert", "battery_safety", "rd_hw", "pm", "manager", "owner"], durationDays: 20, dependsOn: ["nv1"],
        guide: "每项记录样品版本、BOM/软硬件版本、报告编号和前置依赖。" } },
    ],
    gateRequiredDeliverables: { dvt: ["认证报告"] },
  },
  {
    id: "software", name: "软件包", desc: "含固件/APP 的项目激活",
    tasks: [
      { phaseId: "design", task: { id: "ps1", name: "软件设计与架构", desc: "固件架构、通信协议、OTA（原 d5）", owner: "SW", evidence: "heavy",
        visibleRoles: ["rd_sw", "pm", "manager", "owner"], durationDays: 15, dependsOn: ["nd3"],
        guide: "系统架构图（固件+云+APP）、协议定义、OTA 方案。独立工作线，激活后按独立任务追踪。" } },
      { phaseId: "dvt", task: { id: "ps2", name: "软件完整测试", desc: "回归/压力/OTA/多设备并发（原 v5，含 e4 联调收尾）", owner: "SW/QA", evidence: "heavy",
        visibleRoles: ["rd_sw", "qa", "pm", "manager", "owner"], durationDays: 10, dependsOn: ["nv1"],
        guide: "完整回归+压力+OTA 升级+多 APP/多设备并发。" } },
    ],
    gateRequiredDeliverables: { dvt: ["软件完整测试报告"] },
  },
  {
    id: "mold", name: "模具包", desc: "需开新模的项目激活",
    tasks: [
      { phaseId: "dvt", task: { id: "pmo1", name: "模具开发与 T1/T2 验证", desc: "开模、试模、修模（原 v4；投模评审为检查项）", owner: "MD/模厂", evidence: "heavy",
        visibleRoles: ["rd_mech", "pm", "manager", "owner"], durationDays: 30, dependsOn: ["nd6"],
        guide: "投模评审批准（检查项）→开模 4-6 周→T1 试模备认证样品→T2 修模。" } },
    ],
    gateRequiredDeliverables: { dvt: ["模具T1样品"] },
  },
];

// ── 轻量档（15 任务，evt+dvt 合并为 verification）────────────────────────
const coreTask = (id: string): SOPTask => {
  for (const phase of NPD_V3_CORE_PHASES) {
    const found = phase.tasks.find((t) => t.id === id);
    if (found) return found;
  }
  throw new Error(`npd-v3 core task not found: ${id}`);
};
const corePhase = (id: string): SOPPhase => {
  const found = NPD_V3_CORE_PHASES.find((p) => p.id === id);
  if (!found) throw new Error(`npd-v3 core phase not found: ${id}`);
  return found;
};
const override = (id: string, patch: Partial<SOPTask>): SOPTask => ({ ...coreTask(id), ...patch });

export const NPD_V3_LITE_PHASES: SOPPhase[] = [
  { ...corePhase("concept"), tasks: [
    override("nc1", { name: "产品机会与立项论证（含技术可行性检查项）", evidence: "light", dependsOn: [],
      guide: coreTask("nc1").guide + " 5) 技术可行性与认证/电池硬卡初判（吸收原技术可行性任务为检查项）。" }),
    override("nc3", { dependsOn: ["nc1"] }),
  ] },
  { ...corePhase("planning"), tasks: [
    override("np1", { name: "产品需求与规格一页纸（含 BOM 初版检查项）", evidence: "light",
      guide: "一页纸：需求/规格/安全边界；BOM 初版与关键供应商作为检查项附上。" }),
    override("np3", { dependsOn: ["np1"] }),
  ] },
  { ...corePhase("design"), tasks: [
    coreTask("nd2"),
    override("nd3", { name: "电子设计（原理图+Layout）",
      guide: "小改款合并追踪：原理图→Layout 一条线；保护链路检查项照旧必填。" }),
    override("nd6", { dependsOn: ["nd2", "nd3"] }),
  ] },
  { id: "verification", code: "P4", name: "样机验证", nameEn: "Verification", duration: "4-8周",
    desc: "EVT/DVT 合一验证（轻量档）", gate: "验证评审", gateTaskId: "nv3", color: "#0f766e",
    deliverables: ["功能测试报告 (FT)", "可靠性测试报告"],
    gateStandard: gs({
      exitCriteria: ["功能/性能测试通过", "可靠性测试全部 Pass", "Issue List 无未关闭 P0/P1"],
      requiredDeliverables: ["功能测试报告 (FT)", "可靠性测试报告"],
      responsibleRoles: ["EE", "QA"],
    }),
    tasks: [
      override("ne1", { name: "样机与功能/性能测试", desc: "样机制作+FT/PT 合一（轻量档）", evidence: "heavy",
        guide: "样机制作（含联调检查项）→功能/性能测试一份报告。" }),
      override("nv2", { dependsOn: ["ne1"] }),
      override("nv3", { name: "验证评审 (Gate)", desc: "EVT/DVT 合一评审（轻量档）", dependsOn: ["ne1", "nv2"] }),
    ] },
  { ...corePhase("pvt"), tasks: [
    override("npv1", { name: "试产准备与执行", desc: "准备+执行+良率+包装验证合一（轻量档）", dependsOn: ["nv3"],
      guide: "检查项：排程齐套、SOP/WI 与检验标准、试产良率、包装与运输验证。" }),
    override("npv2", { dependsOn: ["nv3"] }),
    override("npv5", { dependsOn: ["npv1", "npv2"] }),
  ] },
  { ...corePhase("mp") },
];

// ── 生效阶段计算 ──────────────────────────────────────────────────────────
const TIERS: NpdTemplateTier[] = ["lite", "standard", "full"];
const PACK_IDS = NPD_ADDON_PACKS.map((p) => p.id);

export function normalizeNpdTemplateConfig(raw?: unknown): NpdTemplateConfig {
  const obj = (raw ?? {}) as Partial<NpdTemplateConfig>;
  const tier = TIERS.includes(obj.tier as NpdTemplateTier) ? (obj.tier as NpdTemplateTier) : "standard";
  const packs = Array.isArray(obj.packs)
    ? (obj.packs.filter((p) => PACK_IDS.includes(p as NpdAddonPackId)) as NpdAddonPackId[])
    : [];
  return { tier, packs: [...new Set(packs)] };
}

/** lite 档没有 evt/dvt 阶段，包任务的目标阶段映射到 verification */
function litePhaseTarget(phaseId: string): string {
  return phaseId === "evt" || phaseId === "dvt" ? "verification" : phaseId;
}

export function getNpdV3EffectivePhases(config?: unknown): SOPPhase[] {
  const { tier, packs } = normalizeNpdTemplateConfig(config);
  const base = tier === "lite" ? NPD_V3_LITE_PHASES : NPD_V3_CORE_PHASES;
  if (packs.length === 0) return base;

  const activePacks = NPD_ADDON_PACKS.filter((p) => packs.includes(p.id));
  return base.map((phase) => {
    const extraTasks = activePacks.flatMap((pack) =>
      pack.tasks
        .filter((entry) => (tier === "lite" ? litePhaseTarget(entry.phaseId) : entry.phaseId) === phase.id)
        .map((entry) => entry.task)
    );
    const extraDeliverables = activePacks.flatMap(
      (pack) => pack.gateRequiredDeliverables?.[phase.id] ?? []
    );
    if (extraTasks.length === 0 && extraDeliverables.length === 0) return phase;

    const gateIdx = phase.tasks.findIndex((t) => t.id === phase.gateTaskId);
    const tasks = gateIdx === -1
      ? [...phase.tasks, ...extraTasks]
      : [...phase.tasks.slice(0, gateIdx), ...extraTasks, ...phase.tasks.slice(gateIdx)];
    return {
      ...phase,
      tasks,
      deliverables: [...phase.deliverables, ...extraDeliverables],
      gateStandard: {
        ...phase.gateStandard,
        requiredDeliverables: [...phase.gateStandard.requiredDeliverables, ...extraDeliverables],
      },
    };
  });
}
```

注意 `import type { SOPPhase, SOPGateStandard, SOPTask } from "./sop-templates";`（Task 2 的 import 行补上 `SOPTask`）。lite 包任务的 dependsOn 引用（如 pb2→nd3）在 lite 档均存在，无需重映射；pmo1→nd6 在 lite 也存在。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- shared/npd-v3.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add shared/npd-v3.ts shared/npd-v3.test.ts
git commit -m "feat(sop): NPD v3 addon packs, lite tier, effective-phase computation"
```

---

### Task 4: v3 任务交付物词表（只复用既有名称）

**Files:**
- Modify: `shared/task-deliverables.ts`
- Test: `shared/npd-v3.test.ts`（追加）；守卫 `shared/deliverable-template-coverage.test.ts`（既有，不改）

- [ ] **Step 1: 写失败测试**

`shared/npd-v3.test.ts` 追加：

```ts
import { TASK_DELIVERABLES } from "./task-deliverables";

describe("NPD v3 交付物词表", () => {
  it("每个非 gate 任务（核心+包）都有 TASK_DELIVERABLES 条目", () => {
    const gateIds = new Set([...NPD_V3_CORE_PHASES, ...NPD_V3_LITE_PHASES].map((p) => p.gateTaskId));
    const allTasks = [
      ...NPD_V3_CORE_PHASES.flatMap((p) => p.tasks),
      ...NPD_ADDON_PACKS.flatMap((p) => p.tasks.map((e) => e.task)),
    ];
    for (const t of allTasks) {
      if (gateIds.has(t.id)) continue;
      expect(TASK_DELIVERABLES[t.id]?.length, `missing deliverables for ${t.id}`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- shared/npd-v3.test.ts`
Expected: FAIL — v3 id 无词表条目。

- [ ] **Step 3: 实现**

`shared/task-deliverables.ts` 的 `TASK_DELIVERABLES` 末尾追加（**全部字符串必须与既有词表逐字相同**，这样交付物模板覆盖守卫不需要新增模板文件；对照上方 v1/v2 条目复制粘贴）：

```ts
  // ── NPD v3（2026-07-v3，瘦身分档版；名称复用既有词表，勿新造）──────────
  nc1: ["竞品对比矩阵", "市场调研报告", "产品概念书", "销量预测模型"],
  nc2: ["关键技术挑战清单", "核心技术 POC 报告", "专利检索与规避分析", "认证路线图初判"],
  np1: ["产品需求文档 PRD", "产品规格书 PSD"],
  np2: ["BOM v0.1", "长交期/单一来源料件清单", "供应商评估表"],
  nd1: ["ID 外观设计稿", "CMF 方案"],
  nd2: ["结构 3D 设计", "模具可行性评估"],
  nd3: ["电子原理图", "保护电路设计输入"],
  nd4: ["PCB Layout 文件"],
  nd5: ["关键料件规格确认", "安全件批准版本记录", "BOM v1.0"],
  ne1: ["EVT 样机", "Build Record"],
  ne2: ["功能测试报告 (FT)", "性能测试报告 (PT)"],
  nv1: ["DVT 样机", "Build Record"],
  nv2: ["可靠性测试报告"],
  npv1: ["SOP/WI作业指导书", "PFMEA/CTQ控制计划"],
  npv2: ["EOL 100%测试能力验收记录", "治具与测试程序"],
  npv3: ["包装与物流验证报告"],
  npv4: ["良率报告"],
  nm1: ["良率报告"],
  pb1: ["电芯复用/定点与二供策略", "电芯厂质量审核或复用资质确认"],
  pb2: ["安全FMEA与危害分析", "保护电路设计评审或复用确认"],
  pc1: ["认证路线图", "认证前置依赖与送样计划"],
  pc2: ["认证报告"],
  ps1: ["软件架构文档"],
  ps2: ["软件完整测试报告"],
  pmo1: ["模具T1样品", "T1/T2试模报告"],
```

> 执行时逐条 grep 校验名称存在于文件上半部（如 `grep -c "治具与测试程序" shared/task-deliverables.ts` ≥2）；若某名称在既有词表中拼写不同（例如全半角括号），以既有拼写为准修正本条目。

- [ ] **Step 4: 跑测试 + 守卫**

Run: `npm test -- shared/npd-v3.test.ts shared/deliverable-template-coverage.test.ts`
Expected: 两个文件全 PASS（守卫通过 = 未引入新名称）。

- [ ] **Step 5: Commit**

```bash
git add shared/task-deliverables.ts shared/npd-v3.test.ts
git commit -m "feat(sop): v3 task deliverable vocabulary reusing existing names"
```

---

### Task 5: 版本路由接入 `getPhasesForCategory` + 项目级生效阶段访问器

**Files:**
- Modify: `shared/sop-templates.ts:1749`（getPhasesForCategory）
- Modify: `shared/npd-v3.ts`（追加项目级访问器）
- Test: `shared/npd-v3.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

```ts
import { getPhasesForCategory } from "./sop-templates";
import { getEffectivePhasesForProjectLike } from "./npd-v3";

describe("v3 版本路由与项目级访问器", () => {
  it("getPhasesForCategory('npd','2026-07-v3') 返回 v3 核心（25 任务）", () => {
    expect(count(getPhasesForCategory("npd", "2026-07-v3"))).toBe(25);
  });
  it("非 npd 品类传 v3 回退 current；npd 传 v2/v1 不受影响（55 任务）", () => {
    expect(getPhasesForCategory("eco", "2026-07-v3")).toEqual(getPhasesForCategory("eco"));
    expect(count(getPhasesForCategory("npd", "2026-07-v2"))).toBe(55);
    expect(count(getPhasesForCategory("npd", "2026-07-v1"))).toBe(55);
  });
  it("getEffectivePhasesForProjectLike：v3 npd 项目按 customFields 裁剪；老项目走原模板", () => {
    const v3 = getEffectivePhasesForProjectLike({
      category: "npd", sopTemplateVersion: "2026-07-v3",
      customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
    });
    expect(count(v3)).toBe(17);
    const v2 = getEffectivePhasesForProjectLike({
      category: "npd", sopTemplateVersion: "2026-07-v2", customFields: {},
    });
    expect(count(v2)).toBe(55);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- shared/npd-v3.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`shared/sop-templates.ts` `getPhasesForCategory`（1749 行）在解析 version 后加分支（文件顶部 `import { NPD_V3_CORE_PHASES } from "./npd-v3";`——npd-v3.ts 只 `import type` 本文件，无运行时环依赖）：

```ts
export function getPhasesForCategory(category?: string | null, templateVersion?: string | null): SOPPhase[] {
  const cat = (category && CATEGORY_MAP[category] ? category : "npd") as ProjectCategory;
  const version = normalizeSopTemplateVersion(templateVersion);
  if (version === SOP_TEMPLATE_VERSION_NPD_V3) {
    if (cat === "npd") return NPD_V3_CORE_PHASES;
    return CURRENT_PHASES_BY_CATEGORY[cat];   // 非 npd 品类 v3 回退 current
  }
  return version === SOP_TEMPLATE_VERSION_LEGACY
    ? LEGACY_PHASES_BY_CATEGORY[cat]
    : CURRENT_PHASES_BY_CATEGORY[cat];
}
```

> 执行时以现有函数体为准做最小改动：仅插入 v3 分支，保留 legacy/current 现有逻辑原样。

`shared/npd-v3.ts` 追加：

```ts
import { getPhasesForCategory, SOP_TEMPLATE_VERSION_NPD_V3 } from "./sop-templates";

export interface ProjectTemplateLike {
  category?: string | null;
  sopTemplateVersion?: string | null;
  customFields?: unknown;
}

/** 服务端/客户端共用：按项目的版本+档位+附加包返回生效阶段。非 v3 项目原样返回其模板。 */
export function getEffectivePhasesForProjectLike(project: ProjectTemplateLike) {
  if (project.category === "npd" && project.sopTemplateVersion === SOP_TEMPLATE_VERSION_NPD_V3) {
    const cf = (project.customFields ?? {}) as Record<string, unknown>;
    return getNpdV3EffectivePhases(cf.npdTemplate);
  }
  return getPhasesForCategory(project.category, project.sopTemplateVersion);
}
```

（此时 npd-v3.ts 与 sop-templates.ts 形成运行时环：sop-templates → npd-v3 只在 `getPhasesForCategory` 函数体内使用 `NPD_V3_CORE_PHASES` 值；npd-v3 → sop-templates 使用 `getPhasesForCategory` 函数。ESM 循环下函数声明可安全互引，但**模块顶层不得互取对方的 const**——`getEffectivePhasesForProjectLike` 在函数体内调用，安全。若 vitest 报 TDZ 错误，把 v3 分支改为惰性 `require`/动态查表即可，测试会立刻暴露。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- shared/npd-v3.test.ts shared/sop-templates.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add shared/sop-templates.ts shared/npd-v3.ts shared/npd-v3.test.ts
git commit -m "feat(sop): route 2026-07-v3 through getPhasesForCategory and add project-aware accessor"
```

---

### Task 6: 创建链路 — create mutation 接收档位/包，种子按生效阶段裁剪

**Files:**
- Modify: `server/routers/projects.ts:157-188`（input schema）、`server/routers/projects.ts:530-649`（create）
- Modify: `server/db.ts:442-483`（createProjectWithSeed）
- Test: `server/npd-v3-create.test.ts`（新建，DB-backed）

- [ ] **Step 1: 写失败测试**

创建 `server/npd-v3-create.test.ts`（seed/cleanup 模式仿照 `server/tasks-router-validation.test.ts`：`getDb()`、插入测试用户、`createCaller({ user })`、afterAll 删项目）：

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectWithSeed } from "./db";
import { projects, projectTasks } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

const PIDS = ["npdv3lite01", "npdv3std01"];

describe("NPD v3 create seeding", () => {
  afterAll(async () => {
    const db = await getDb();
    await db!.delete(projectTasks).where(inArray(projectTasks.projectId, PIDS));
    await db!.delete(projects).where(inArray(projects.id, PIDS));
  });

  it("lite + battery 只种 17 行，且含 pb1/pb2、不含 ne3", async () => {
    await createProjectWithSeed(
      { id: PIDS[0], name: "v3 lite test", sopTemplateVersion: "2026-07-v3",
        customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } } } as never,
      "npd", 1
    );
    const db = await getDb();
    const rows = await db!.select().from(projectTasks).where(eq(projectTasks.projectId, PIDS[0]));
    expect(rows).toHaveLength(17);
    const ids = rows.map((r) => r.taskId);
    expect(ids).toContain("pb1");
    expect(ids).toContain("pb2");
    expect(ids).not.toContain("ne3");
    expect(rows.filter((r) => r.phaseId === "verification").length).toBeGreaterThan(0);
  });

  it("standard 无包种 25 行", async () => {
    await createProjectWithSeed(
      { id: PIDS[1], name: "v3 std test", sopTemplateVersion: "2026-07-v3",
        customFields: { npdTemplate: { tier: "standard", packs: [] } } } as never,
      "npd", 1
    );
    const db = await getDb();
    const rows = await db!.select().from(projectTasks).where(eq(projectTasks.projectId, PIDS[1]));
    expect(rows).toHaveLength(25);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server/npd-v3-create.test.ts`
Expected: FAIL — 种子仍按 `getSopPhasesForCategory` 全量（v3 未接入时报 55 行或版本回退行为）。

- [ ] **Step 3: 实现**

`server/db.ts` `createProjectWithSeed`（450 行附近），把阶段来源换成项目感知访问器：

```ts
import { getEffectivePhasesForProjectLike } from "../shared/npd-v3";
// 450 行原:  const phases = getSopPhasesForCategory(category, project.sopTemplateVersion);
const phases = getEffectivePhasesForProjectLike({
  category,
  sopTemplateVersion: project.sopTemplateVersion,
  customFields: project.customFields,
});
```

（`seedProjectPhasesAndTasks` db.ts:2912 同样替换来源，保持两个种子入口一致。）

`server/routers/projects.ts`：

```ts
// projectInputSchema（157–188）追加：
npdTemplate: z.object({
  tier: z.enum(["lite", "standard", "full"]).default("standard"),
  packs: z.array(z.enum(["battery", "cert", "software", "mold"])).default([]),
}).optional(),

// create mutation（530+）内，构造 createProjectWithSeed 入参处：
// 原: sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
sopTemplateVersion: getDefaultTemplateVersionForCategory(input.category),
customFields: input.category === "npd"
  ? { ...(existingCustomFields ?? {}), npdTemplate: normalizeNpdTemplateConfig(input.npdTemplate) }
  : (existingCustomFields ?? {}),
```

import 处加 `getDefaultTemplateVersionForCategory`（from `../../shared/sop-templates`）与 `normalizeNpdTemplateConfig`（from `../../shared/npd-v3`）。执行时对照 create mutation 现有的 customFields 组装逻辑（若入参 schema 本无 customFields，则直接传 `{ npdTemplate: ... }`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- server/npd-v3-create.test.ts`
Expected: PASS。再跑回归：`npm test -- server/kickoff-e2e.test.ts server/project-lifecycle.test.ts server/derivative-strategy-apply.test.ts`，Expected: PASS（老品类/老版本种子行为不变）。

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/routers/projects.ts server/npd-v3-create.test.ts
git commit -m "feat(projects): seed NPD v3 projects by tier/pack effective phases"
```

---

### Task 7: 读路径 — Gate readiness / 状态派生 / 依赖图切到生效阶段

**Files:**
- Modify: `server/db.ts:7049-7107`（getGateReadiness）、`server/db.ts:5033-5037`（getTaskDependencyMap）、`server/db.ts:5115+`（refreshProjectTaskStatuses 的调用链已经传 project——确认即可）
- Test: `server/npd-v3-gate-readiness.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, afterAll } from "vitest";
import { getDb, createProjectWithSeed, getGateReadiness } from "./db";
import { projects, projectTasks } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PID = "npdv3gate01";

describe("NPD v3 gate readiness", () => {
  afterAll(async () => {
    const db = await getDb();
    await db!.delete(projectTasks).where(eq(projectTasks.projectId, PID));
    await db!.delete(projects).where(eq(projects.id, PID));
  });

  it("lite 项目 Gate1 只看 lite 任务：完成 nc1 后 incompleteTaskIds 为空", async () => {
    await createProjectWithSeed(
      { id: PID, name: "v3 gate test", sopTemplateVersion: "2026-07-v3",
        customFields: { npdTemplate: { tier: "lite", packs: [] } } } as never,
      "npd", 1
    );
    const db = await getDb();
    await db!.update(projectTasks)
      .set({ status: "done", completed: true, completedAt: new Date() })
      .where(eq(projectTasks.projectId, PID)); // 全部完成
    const readiness = await getGateReadiness(PID, "concept");
    // v2 模板有 c1-c5 六任务；若 readiness 仍按 v2/v3核心 解析，会把未种的任务算作 incomplete
    expect(readiness.incompleteTaskIds ?? []).toHaveLength(0);
  });
});
```

（`getGateReadiness` 返回结构以现有 `server/gate-readiness-db.test.ts` 的断言字段为准——执行时先读该测试对齐字段名。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server/npd-v3-gate-readiness.test.ts`
Expected: FAIL（readiness 把 lite 中不存在的核心任务算进 incomplete，或找不到 verification 阶段）。若 Step 6 的种子已让它意外通过，改为断言 `verification` 阶段的 readiness 可解析（`getGateReadiness(PID, "verification")` 不抛错）——lite 的合并阶段在 v2 模板中不存在，必然暴露解析路径问题。

- [ ] **Step 3: 实现**

`server/db.ts` 内所有"按项目解析模板"的点统一换访问器（文件内 grep `getPhasesForCategory(project` 逐个替换）：

```ts
// getGateReadiness 7057 行原:
//   const phases = getPhasesForCategory(project.category, project.sopTemplateVersion);
const phases = getEffectivePhasesForProjectLike(project);
```

`getTaskDependencyMap`（5033）签名从 `(category, templateVersion)` 改为接收 project-like（其唯一调用方 `applyAutomaticTaskStatuses` 已持有 project 字段——`refreshProjectTaskStatuses` 5115 处把 `project` 整体传下去）：

```ts
function getTaskDependencyMap(projectLike: ProjectTemplateLike): Map<string, string[]> {
  return new Map(
    buildSchedTasks(getEffectivePhasesForProjectLike(projectLike)).map((t) => [t.id, t.dependsOn ?? []])
  );
}
// applyAutomaticTaskStatuses 增加可选 projectLike 参数，refreshProjectTaskStatuses 调用处传
// { category: project.category, sopTemplateVersion: project.sopTemplateVersion, customFields: project.customFields }
// 未传时保持旧行为（getPhasesForCategory(category, templateVersion)），避免波及其它调用方。
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- server/npd-v3-gate-readiness.test.ts server/gate-readiness-db.test.ts server/gate-readiness-router.test.ts`
Expected: 全 PASS（老项目 readiness 回归不破）。

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/npd-v3-gate-readiness.test.ts
git commit -m "feat(gates): resolve readiness and dependency map via tier-aware effective phases"
```

---

### Task 8: 客户端 — 向导档位/包选择 + 读路径切换

**Files:**
- Modify: `client/src/components/views/ProjectListView.tsx`（Step 1，966-1000 区域 + form state + handleCreate 398-441）
- Modify: `client/src/pages/Home.tsx:762-775`（handleAddProject 透传）
- Modify: `client/src/lib/data.ts:366` 附近（项目阶段解析处，与衍生品同点位）
- Test: 无 client 测试基建 → `npx tsc --noEmit` + 浏览器预览验证

- [ ] **Step 1: data.ts 读路径**

在 `client/src/lib/data.ts` 项目阶段解析处（366 行附近、`getDerivativeEffectivePhases` 调用同一函数内），NPD v3 分支优先：

```ts
import { getEffectivePhasesForProjectLike } from "@shared/npd-v3";
// 解析 phases 的入口处：
if (project.category === "npd" && project.sopTemplateVersion === "2026-07-v3") {
  return getEffectivePhasesForProjectLike(project);
}
// 其后保持衍生品/默认逻辑原样
```

- [ ] **Step 2: 向导状态与 UI**

`ProjectListView.tsx`：

```tsx
import { NPD_ADDON_PACKS, type NpdAddonPackId, type NpdTemplateTier } from "@shared/npd-v3";

// wizard state（385 行附近）：
const [npdTier, setNpdTier] = useState<NpdTemplateTier>("standard");
const [npdPacks, setNpdPacks] = useState<NpdAddonPackId[]>([]);

// Step 1 品类卡片之后，selectedCategory === "npd" 时渲染：
{selectedCategory === "npd" && (
  <div className="mt-4 space-y-3">
    <div className="text-sm font-medium">流程档位</div>
    <div className="grid grid-cols-3 gap-2">
      {([
        ["lite", "轻量", "15 个骨干任务 · 小改款/低风险"],
        ["standard", "标准", "25 个核心任务 · 常规新品"],
        ["full", "完整", "核心 + 建议全选附加包 · 全新平台"],
      ] as const).map(([tier, label, hint]) => (
        <button key={tier} type="button"
          onClick={() => { setNpdTier(tier); if (tier === "full") setNpdPacks(["battery", "cert", "software", "mold"]); }}
          className={`rounded-lg border p-3 text-left ${npdTier === tier ? "border-primary ring-1 ring-primary" : "border-border"}`}>
          <div className="font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </button>
      ))}
    </div>
    <div className="text-sm font-medium">附加包（按项目实际勾选）</div>
    <div className="grid grid-cols-2 gap-2">
      {NPD_ADDON_PACKS.map((pack) => (
        <label key={pack.id} className="flex items-start gap-2 rounded-lg border border-border p-2 text-sm">
          <input type="checkbox" checked={npdPacks.includes(pack.id)}
            onChange={(e) => setNpdPacks((prev) =>
              e.target.checked ? [...prev, pack.id] : prev.filter((p) => p !== pack.id))} />
          <span>
            <span className="font-medium">{pack.name}{pack.redline ? " 🚩" : ""}</span>
            <span className="block text-xs text-muted-foreground">{pack.desc}{pack.redline ? "（激活后红线，不可再裁）" : ""}</span>
          </span>
        </label>
      ))}
    </div>
  </div>
)}
```

`handleCreate`（398–441）组装项目对象时附带 `npdTemplate: selectedCategory === "npd" ? { tier: npdTier, packs: npdPacks } : undefined`；`Home.tsx` `handleAddProject`/`projectToApiInput` 把该字段透传到 `projects.create` input（对照 Task 6 的 schema 字段名 `npdTemplate`）。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 4: 预览验证**

启动 dev server（`.claude/launch.json` 既有配置），浏览器走一遍：新建项目 → 选 NPD → 选"轻量"+勾"电池安全包" → 创建成功 → 项目详情任务列表 = 17 个任务、阶段含"样机验证"、pb1/pb2 出现在对应阶段且排在 Gate 前。截图留档。

- [ ] **Step 5: Commit**

```bash
git add client/src/components/views/ProjectListView.tsx client/src/pages/Home.tsx client/src/lib/data.ts
git commit -m "feat(ui): NPD tier and addon-pack selection in project creation wizard"
```

---

### Task 9: 收尾 — SOP 库展示 v3 + 文档交叉引用

**Files:**
- Modify: `shared/sop-templates.ts:1649+`（PROJECT_CATEGORIES npd 条目保持 v2 current 供老项目展示——**不切换**；SOPLibraryView 等按项目版本渲染已由 Task 8 data.ts 覆盖）
- Modify: `docs/superpowers/specs/2026-07-12-npd-template-slimming-tiering-design.md`（头部加"实施计划"链接）

- [ ] **Step 1: 验证展示路径**

确认 `SOPLibraryView.tsx` / `ProjectDetailView.tsx` 对**项目**的渲染走 data.ts（Task 8 已覆盖）；`PROJECT_CATEGORIES` 静态库仅用于品类介绍卡片，保持 v2 不动（避免交付物覆盖守卫词表联动）。跑全量测试确认无回归：

Run: `npm test`
Expected: 全 PASS。

- [ ] **Step 2: 文档交叉引用**

设计文档头部状态行改为 `状态：实施中 — 计划见 docs/superpowers/plans/2026-07-12-npd-template-slimming.md`。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-12-npd-template-slimming-tiering-design.md
git commit -m "docs: link npd slimming spec to implementation plan"
```

---

### Task 10: 自动分档推导 — `recommendNpdTemplateConfig` + 向导接入 + 服务端锁定校验

**Files:**
- Modify: `shared/npd-v3.ts`（推导函数）
- Modify: `client/src/components/views/ProjectListView.tsx`（Task 8 的档位/包 UI 之上加属性问答与推荐）
- Modify: `server/routers/projects.ts`（create 校验锁定包）
- Test: `shared/npd-v3.test.ts`、`server/npd-v3-create.test.ts`（追加）

- [ ] **Step 1: 写失败测试（shared 推导规则）**

`shared/npd-v3.test.ts` 追加：

```ts
import { recommendNpdTemplateConfig } from "./npd-v3";

describe("recommendNpdTemplateConfig 自动分档", () => {
  it("含锂电+出口 → 强监管(full)，电池/认证锁定", () => {
    const r = recommendNpdTemplateConfig({
      hasBattery: true, needsCert: true, hasFirmware: true, needsNewMold: false,
      safetyRiskLevel: "standard", regulatoryRiskLevel: "standard", isNewPlatform: false,
    });
    expect(r.tier).toBe("full");
    expect(r.packs).toEqual(expect.arrayContaining(["battery", "cert", "software"]));
    expect(r.lockedPacks).toEqual(["battery", "cert"]);
    expect(r.reasons.join("")).toContain("锂电");
  });
  it("高安全风险单独触发强监管", () => {
    const r = recommendNpdTemplateConfig({
      hasBattery: false, needsCert: false, hasFirmware: false, needsNewMold: false,
      safetyRiskLevel: "high", regulatoryRiskLevel: "standard", isNewPlatform: false,
    });
    expect(r.tier).toBe("full");
  });
  it("无电池无新模低风险简单新品 → 轻量", () => {
    const r = recommendNpdTemplateConfig({
      hasBattery: false, needsCert: false, hasFirmware: true, needsNewMold: false,
      safetyRiskLevel: "standard", regulatoryRiskLevel: "standard", isNewPlatform: false,
    });
    expect(r.tier).toBe("lite");
    expect(r.packs).toEqual(["software"]);
    expect(r.lockedPacks).toEqual([]);
  });
  it("其余落标准：有新模但风险 standard", () => {
    const r = recommendNpdTemplateConfig({
      hasBattery: false, needsCert: false, hasFirmware: false, needsNewMold: true,
      safetyRiskLevel: "standard", regulatoryRiskLevel: "standard", isNewPlatform: false,
    });
    expect(r.tier).toBe("standard");
    expect(r.packs).toEqual(["mold"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- shared/npd-v3.test.ts`
Expected: FAIL — 函数不存在。

- [ ] **Step 3: 实现（`shared/npd-v3.ts` 追加）**

```ts
export interface NpdProjectAttributes {
  hasBattery: boolean;       // 含锂电/受压腔体
  needsCert: boolean;        // 目标市场认证需求（出口/强制认证）
  hasFirmware: boolean;      // 含固件/APP
  needsNewMold: boolean;     // 需开新模
  safetyRiskLevel?: string | null;
  regulatoryRiskLevel?: string | null;
  isNewPlatform: boolean;    // 全新平台（非成熟平台衍生的简单新品）
}

export interface NpdTemplateRecommendation {
  tier: NpdTemplateTier;
  packs: NpdAddonPackId[];
  /** 红线锁定：向导中不可取消、服务端强制校验 */
  lockedPacks: NpdAddonPackId[];
  reasons: string[];
}

/** 设计 §7：最小必要流程推导。纯函数，前端实时预览与服务端校验共用。 */
export function recommendNpdTemplateConfig(attrs: NpdProjectAttributes): NpdTemplateRecommendation {
  const packs: NpdAddonPackId[] = [];
  const lockedPacks: NpdAddonPackId[] = [];
  const reasons: string[] = [];

  if (attrs.hasBattery) { packs.push("battery"); lockedPacks.push("battery"); reasons.push("含锂电/受压腔体 → 电池安全包锁定（红线）"); }
  if (attrs.needsCert) { packs.push("cert"); lockedPacks.push("cert"); reasons.push("有目标市场认证需求 → 认证包锁定（红线）"); }
  if (attrs.hasFirmware) { packs.push("software"); reasons.push("含固件/APP → 软件包默认勾选"); }
  if (attrs.needsNewMold) { packs.push("mold"); reasons.push("需开新模 → 模具包默认勾选"); }

  const highRisk = attrs.safetyRiskLevel === "high" || attrs.regulatoryRiskLevel === "high";
  let tier: NpdTemplateTier;
  if (highRisk || (attrs.hasBattery && attrs.needsCert) || attrs.isNewPlatform) {
    tier = "full";
    reasons.push(highRisk ? "安全/法规风险为高 → 强监管档" : attrs.isNewPlatform ? "全新平台 → 强监管档" : "电池+认证双红线 → 强监管档");
  } else if (!attrs.hasBattery && !attrs.needsNewMold) {
    tier = "lite";
    reasons.push("无电池、无新模、常规风险 → 轻量档");
  } else {
    tier = "standard";
    reasons.push("常规组合 → 标准档");
  }
  return { tier, packs, lockedPacks, reasons };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- shared/npd-v3.test.ts` — PASS。

- [ ] **Step 5: 写失败测试（服务端锁定校验）**

`server/npd-v3-create.test.ts` 追加：

```ts
it("含锂电项目缺电池包 → 拒绝创建", async () => {
  await expect(caller.projects.create({
    ...baseInput, category: "npd",
    npdAttributes: { hasBattery: true, needsCert: false, hasFirmware: false, needsNewMold: false, isNewPlatform: false },
    npdTemplate: { tier: "lite", packs: [] },   // 恶意/失误：不带 battery
  })).rejects.toThrow(/电池安全包/);
});
it("降档需理由：推荐 full 提交 lite 且无理由 → 拒绝", async () => {
  await expect(caller.projects.create({
    ...baseInput, category: "npd",
    npdAttributes: { hasBattery: true, needsCert: true, hasFirmware: false, needsNewMold: false, isNewPlatform: false },
    npdTemplate: { tier: "lite", packs: ["battery", "cert"] },  // 无 downgradeReason
  })).rejects.toThrow(/降档.*理由/);
});
```

（`baseInput` 为该测试文件既有的最小合法 create 入参对象。）

- [ ] **Step 6: 实现（服务端）**

`server/routers/projects.ts`：input schema 追加：

```ts
npdAttributes: z.object({
  hasBattery: z.boolean(), needsCert: z.boolean(), hasFirmware: z.boolean(),
  needsNewMold: z.boolean(), isNewPlatform: z.boolean(),
}).optional(),
npdTemplateDowngradeReason: z.string().trim().min(4).optional(),
```

create mutation 内、组装 customFields 之前：

```ts
if (input.category === "npd" && input.npdAttributes) {
  const rec = recommendNpdTemplateConfig({
    ...input.npdAttributes,
    safetyRiskLevel: input.safetyRiskLevel, regulatoryRiskLevel: input.regulatoryRiskLevel,
  });
  const chosen = normalizeNpdTemplateConfig(input.npdTemplate);
  const missingLocked = rec.lockedPacks.filter((p) => !chosen.packs.includes(p));
  if (missingLocked.length) {
    throw new TRPCError({ code: "BAD_REQUEST",
      message: `红线附加包不可取消：${missingLocked.map((p) => p === "battery" ? "电池安全包" : "认证包").join("、")}` });
  }
  const TIER_RANK = { lite: 0, standard: 1, full: 2 } as const;
  if (TIER_RANK[chosen.tier] < TIER_RANK[rec.tier] && !input.npdTemplateDowngradeReason) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "降档需填写理由（推荐档位高于所选档位）" });
  }
  // customFields.npdTemplate 存 { ...chosen, recommended: rec, attributes: input.npdAttributes,
  //   downgradeReason: input.npdTemplateDowngradeReason ?? null } 并在创建后写活动日志。
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npm test -- server/npd-v3-create.test.ts shared/npd-v3.test.ts` — PASS。

- [ ] **Step 8: 向导接入（前端）**

`ProjectListView.tsx` Task 8 的档位 UI 之前插入属性问答（5 个开关：含锂电/受压、出口认证、含固件、开新模、全新平台），`useMemo` 调 `recommendNpdTemplateConfig` 实时算推荐：档位卡片预选推荐值并标"推荐"徽标，锁定包 checkbox `disabled + checked`，理由列表渲染在下方（`rec.reasons.map(...)`）；用户选择低于推荐档位时弹出必填"降档理由"输入框，随 create 入参提交 `npdAttributes` + `npdTemplateDowngradeReason`。UI 文案：full 档显示名"强监管"。

Run: `npx tsc --noEmit` — 0 errors；预览走查：勾"含锂电"→电池包锁定不可取消、推荐档变化、理由实时更新。

- [ ] **Step 9: Commit**

```bash
git add shared/npd-v3.ts shared/npd-v3.test.ts server/routers/projects.ts server/npd-v3-create.test.ts client/src/components/views/ProjectListView.tsx
git commit -m "feat(sop): auto-derive minimal process — tier/pack recommendation with red-line locks"
```

---

## Self-Review 结论

- **Spec 覆盖**：25 核心/7 包/15 轻量 ✔（Task 2/3）；自动分档推导（spec §7）✔（Task 10：推导纯函数前后端共用、红线锁定服务端强制、降档留痕）；复杂度预算入测试+文件头注释 ✔；红线三项测试 ✔；e5/mp4 删除→Gate 读模块状态（既有 `getPhaseOpenP0P1`，ne3 guide 注明）✔；p3/p6 移出 SOP→nc3 guide 注明立项配置 ✔；同证据传一次（npv3 合并 v6+pv6）✔；立项配置页扩展 ✔（Task 8；成员指派/排期初始化本就是既有创建流程的一部分，无需新做）；衍生品机制统一抽象——**降级为不做**：v3 用同型模式（customFields+纯函数），真正合并两套引擎留待衍生品模板自身瘦身时处理（YAGNI）。
- **类型一致性**：`NpdTemplateConfig`/`getNpdV3EffectivePhases`/`getEffectivePhasesForProjectLike`/`normalizeNpdTemplateConfig` 名称在 Task 3/5/6/7/8 中一致 ✔。
- **占位符扫描**：无 TBD/TODO；两处"执行时对照现有代码"均给出了 grep/文件行号与判定标准，属于防伪差异校验而非留白。
