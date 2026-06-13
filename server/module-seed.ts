// 模块库种子数据 —— 取自 docs/design/2026-06-13-project-axis-modular-sop.md
// 阶段键沿用 SOP：concept / planning / design / evt / dvt / pvt / mp
export type SeedTask = {
  phase: string;
  task: string;
  executor?: "internal" | "supplier" | "lab";
  ownerRoles: string[];
  gateName?: string;
  checklist?: string[];
};
export type SeedModule = {
  moduleKey: string;
  name: string;
  scope: "shared" | "core";
  category?: string;
  ownerRoles: string[];
  tasks: SeedTask[];
};

export const MODULE_SEED: SeedModule[] = [
  // ── 共享模块 ───────────────────────────────────────────────
  {
    moduleKey: "housing", name: "外壳 / 模具", scope: "shared", ownerRoles: ["rd_mech", "pe"],
    tasks: [
      { phase: "design", task: "结构/ID 落地、3D 建模", ownerRoles: ["rd_mech"] },
      { phase: "design", task: "ID 评审", ownerRoles: ["rd_mech", "sales", "manager"], gateName: "ID 评审", checklist: ["符合 PI / 设计语言", "人机手感", "外观成本"] },
      { phase: "design", task: "DFM 可制造性评审", ownerRoles: ["pe"], gateName: "设计 Gate", checklist: ["可制造性", "模具可行性"] },
      { phase: "evt", task: "手板(CNC/3D)、试装配合", ownerRoles: ["rd_mech"] },
      { phase: "pvt", task: "开钢模、试模调试", ownerRoles: ["pe"] },
      { phase: "pvt", task: "模具验收、首批件尺寸检", ownerRoles: ["pe", "qa"], gateName: "试产 Gate" },
    ],
  },
  {
    moduleKey: "battery", name: "电池包 + 充电", scope: "shared", ownerRoles: ["rd_hw", "scm", "qa", "battery_safety"],
    tasks: [
      { phase: "planning", task: "目标：容量/续航/充电时间/安全等级/市场法规", ownerRoles: ["rd_hw", "scm", "sales"] },
      { phase: "design", task: "电芯选型（容量·倍率·供应商·安全认证）", ownerRoles: ["rd_hw", "scm"] },
      { phase: "design", task: "电池包结构（固定·绝缘·防短路·防护）", ownerRoles: ["rd_mech", "battery_safety"] },
      { phase: "design", task: "保护板 PCM（过充/过放/过流/短路）", executor: "supplier", ownerRoles: ["rd_hw", "battery_safety"] },
      { phase: "design", task: "充电+保护逻辑（多在整机 PCBA）", ownerRoles: ["rd_hw"] },
      { phase: "design", task: "安全评审", ownerRoles: ["battery_safety", "qa"], gateName: "安全 Gate", checklist: ["过充/过放/短路保护齐全", "隔离绝缘达标"] },
      { phase: "evt", task: "整机工况安全（过充/过放/外短路/高温/跌落/电池仓兼容）", ownerRoles: ["qa", "battery_safety"] },
      { phase: "dvt", task: "电芯/电池包级滥用（挤压/针刺/温度循环/寿命）", executor: "supplier", ownerRoles: ["qa", "battery_safety"], gateName: "DVT Gate" },
      { phase: "dvt", task: "UN38.3 + 市场电池安规", executor: "lab", ownerRoles: ["qa", "cert"] },
      { phase: "pvt", task: "来料检/容量分选/老化/抽检 + 电池仓治具", ownerRoles: ["mfg", "pe", "qa"], gateName: "试产 Gate" },
      { phase: "mp", task: "出货抽检、批次追溯", ownerRoles: ["qa"] },
    ],
  },
  { moduleKey: "pcba", name: "PCBA / 固件", scope: "shared", ownerRoles: ["rd_hw", "rd_sw"], tasks: [
    { phase: "design", task: "原理图、PCB Layout、元器件选型", ownerRoles: ["rd_hw", "scm"] },
    { phase: "evt", task: "打样、焊接、板级测试", executor: "supplier", ownerRoles: ["rd_hw"] },
    { phase: "dvt", task: "EMC / 可靠性", executor: "lab", ownerRoles: ["qa", "cert"] },
  ] },
  { moduleKey: "process", name: "工艺 / 治具", scope: "shared", ownerRoles: ["pe", "mfg"], tasks: [
    { phase: "pvt", task: "工艺文件、治具设计制作、产线导入、节拍/良率", ownerRoles: ["pe", "mfg"], gateName: "试产 Gate" },
  ] },
  { moduleKey: "cert", name: "认证", scope: "shared", ownerRoles: ["qa", "cert"], tasks: [
    { phase: "dvt", task: "按目标市场 × 变更 展开认证测试（CE/FCC/RoHS/电池运输…）", executor: "lab", ownerRoles: ["qa", "cert"], gateName: "认证评审" },
  ] },
  { moduleKey: "packaging", name: "包装 / 说明书", scope: "shared", ownerRoles: ["rd_mech", "sales", "scm"], tasks: [
    { phase: "design", task: "包装设计（销售确认）+ 多语说明书", ownerRoles: ["rd_mech", "sales"] },
    { phase: "dvt", task: "跌落测试", executor: "lab", ownerRoles: ["qa"] },
  ] },
  // ── 品类核心模块 ───────────────────────────────────────────
  {
    moduleKey: "pump_core", name: "气泵机芯", scope: "core", category: "充气泵", ownerRoles: ["rd_mech", "qa", "pe"],
    tasks: [
      { phase: "concept", task: "性能目标：气压/流量/噪音/寿命/温升/气密/电压功率/尺寸接口", ownerRoles: ["rd_mech", "qa"] },
      { phase: "design", task: "泵体设计（缸体/活塞或膜片/进排气阀/传动）", ownerRoles: ["rd_mech"] },
      { phase: "design", task: "电机匹配/选型（扭矩·转速·效率）", executor: "supplier", ownerRoles: ["rd_hw", "rd_mech"] },
      { phase: "design", task: "DFM（泵体注塑/装配可行性）", ownerRoles: ["pe"], gateName: "设计 Gate" },
      { phase: "evt", task: "机芯样件试制、性能初测", executor: "supplier", ownerRoles: ["rd_mech", "qa"] },
      { phase: "dvt", task: "性能/寿命/噪音/气密验证", executor: "lab", ownerRoles: ["qa"], gateName: "验证 Gate" },
      { phase: "dvt", task: "关键供应商/产能确认（电机·气阀·密封件）", ownerRoles: ["scm"] },
      { phase: "mp", task: "小批试制、工艺/治具、定型 release", ownerRoles: ["pe", "mfg", "qa"], gateName: "定型 Gate" },
    ],
  },
  { moduleKey: "fan_motor", name: "风扇电机 / 扇叶", scope: "core", category: "风扇", ownerRoles: ["rd_mech", "qa", "pe"], tasks: [
    { phase: "concept", task: "性能目标：风量/转速/噪音/功耗/寿命", ownerRoles: ["rd_mech", "qa"] },
    { phase: "design", task: "电机选型 + 扇叶/风道设计", ownerRoles: ["rd_mech", "rd_hw"] },
    { phase: "dvt", task: "风量/噪音/寿命验证", executor: "lab", ownerRoles: ["qa"], gateName: "验证 Gate" },
  ] },
  { moduleKey: "manual_pump", name: "机械泵体", scope: "core", category: "手动泵", ownerRoles: ["rd_mech", "pe"], tasks: [
    { phase: "design", task: "泵体/活塞/气阀机械设计", ownerRoles: ["rd_mech"] },
    { phase: "pvt", task: "开模、装配工艺、气密验证", ownerRoles: ["pe", "qa"], gateName: "试产 Gate" },
  ] },
];
