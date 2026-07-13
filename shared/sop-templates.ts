// SOP Templates for different project categories.
// Shared by frontend display code and backend project seeding.

import { NPD_V3_CORE_PHASES } from './npd-v3';
import { registerDerivativeEffectivePhaseResolver } from './derivative-phase-resolver';

// ─────────────────────────────────────────────────────────────────────────────
// Gate 不通过（rejected）的唯一语义 —— 2026-07-05 拍板（CEH-16）
//
// 「停留本阶段整改重审」：Gate rejected 时项目停留在当前阶段，本阶段 Gate task
// 置 blocked，整改完成后发起下一轮评审（roundNumber+1），全部轮次留痕。
// 系统【不提供】「打回上一阶段」动作：currentPhase 既不前进也不回退，已过 Gate
// 的评审记录、交付物审核态、测试报告一律不级联失效。
// DVT 发现设计问题的正确表达 = DVT 停留 + 发起设计整改任务 / ECO，而非回退 design。
// 用例集 RISK-08「交付物随阶段回退」预期按此语义对齐（不再适用）。
// ─────────────────────────────────────────────────────────────────────────────
export const GATE_REJECTION_SEMANTICS = {
  policy: 'stay-and-rework' as const,
  /** 供被锁阶段整改横幅等 UI 复用的标准文案 */
  banner: '本阶段 Gate 未通过，项目停留在当前阶段整改，不回退。整改完成后请发起重审。',
  detail:
    'Gate 不通过时：停留本阶段、Gate 任务置 blocked、整改后重审（多轮留痕）。系统不提供打回上一阶段的动作，已通过的 Gate 与交付物审核结果不会级联失效。',
};

export interface SOPTask {
  id: string;
  name: string;
  desc: string;
  /** Display-only functional owner text; project-role responsibility comes from visibleRoles. */
  owner: string;
  guide: string;
  /**
   * Which project-member roles can see this task.
   * Empty array (default) = visible to ALL roles.
   */
  visibleRoles?: string[];
  /** 自动排期：任务工期（工厂工作日）。缺省按 1 天处理。 */
  durationDays?: number;
  /** 自动排期：前置任务 id（finish-to-start；可指向上一阶段 gateTaskId）。缺省=阶段入口。 */
  dependsOn?: string[];
  /** light=一句话/照片/链接可闭环；heavy=需上传文件。缺省视为 light。 */
  evidence?: 'light' | 'heavy';
}

export interface SOPGateStandard {
  /** Conditions that must be true before a gate review can be scheduled. */
  entryCriteria: string[];
  /** Conditions that must be true before the phase can be closed or advanced. */
  exitCriteria: string[];
  /** Non-negotiable deliverables reviewed at the gate. */
  requiredDeliverables: string[];
  /** Roles accountable for preparing, reviewing, and approving this gate. */
  responsibleRoles: string[];
  /** Evidence that should be attached to the gate task before review closure. */
  evidenceRequirements: string[];
  /** Management response when the gate is not ready or not approved. */
  exceptionStrategy: string[];
}

export interface SOPPhase {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  duration: string;
  desc: string;
  gate: string;
  gateTaskId: string;
  deliverables: string[];
  gateStandard: SOPGateStandard;
  tasks: SOPTask[];
  color: string;
  /** 自动排期：进入本阶段前的缓冲天数（加在入口任务 start 前）。缺省 0。 */
  bufferDays?: number;
  /** 标记本阶段的 Gate 为 MP Release 的前置闸口（每个 category 仅一个）。 */
  isReleaseGate?: boolean;
  /** 标记本阶段 Gate 为项目关闭移交；通过后才允许归档项目。 */
  isCloseGate?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Category Definition
// ─────────────────────────────────────────────────────────────────────────────
export type ProjectCategory = 'npd' | 'eco' | 'derivative' | 'idr' | 'jdm' | 'obt';

export const SOP_TEMPLATE_VERSION_LEGACY = '2026-07-v1' as const;
export const SOP_TEMPLATE_VERSION_CURRENT = '2026-07-v2' as const;
export const SOP_TEMPLATE_VERSION_NPD_V3 = '2026-07-v3' as const;
export const SOP_TEMPLATE_VERSIONS = [
  SOP_TEMPLATE_VERSION_LEGACY,
  SOP_TEMPLATE_VERSION_CURRENT,
  SOP_TEMPLATE_VERSION_NPD_V3,
] as const;
export type SopTemplateVersion = (typeof SOP_TEMPLATE_VERSIONS)[number];

export function normalizeSopTemplateVersion(version?: string | null): SopTemplateVersion {
  if (version === SOP_TEMPLATE_VERSION_LEGACY) return SOP_TEMPLATE_VERSION_LEGACY;
  if (version === SOP_TEMPLATE_VERSION_NPD_V3) return SOP_TEMPLATE_VERSION_NPD_V3;
  return SOP_TEMPLATE_VERSION_CURRENT;
}

export function getDefaultTemplateVersionForCategory(category?: string | null): SopTemplateVersion {
  return category === 'npd' ? SOP_TEMPLATE_VERSION_NPD_V3 : SOP_TEMPLATE_VERSION_CURRENT;
}

export interface ProjectCategoryConfig {
  id: ProjectCategory;
  name: string;
  nameEn: string;
  badge: string;
  color: string;        // tailwind bg color
  textColor: string;    // tailwind text color
  borderColor: string;  // tailwind border color
  icon: string;         // emoji
  desc: string;
  phaseCount: number;
  typicalDuration: string;
  phases: SOPPhase[];
}

export type DerivativeReuseLevel = 'direct_reuse' | 'adapt_verify' | 'light_modify' | 'redevelop';
export type DerivativeReuseStrategy = Partial<Record<string, DerivativeReuseLevel>>;

export interface DerivativeReuseModuleRule {
  id: string;
  name: string;
  examples: string;
  defaultLevel: DerivativeReuseLevel;
  taskIds: string[];
  deliverables: string[];
  timing: string[];
  cannotCut?: string;
  gateDepth: Record<DerivativeReuseLevel, string>;
}

export const DERIVATIVE_REUSE_LEVEL_LABELS: Record<DerivativeReuseLevel, string> = {
  direct_reuse: '直接复用',
  adapt_verify: '复用但需适配验证',
  light_modify: '轻量修改',
  redevelop: '重新开发',
};

export const DERIVATIVE_REUSE_MODULE_RULES: DerivativeReuseModuleRule[] = [
  {
    id: 'battery',
    name: '电池 / 电芯 / 电池包',
    examples: '电芯、电池包、保护板、充电策略、热路径、UN38.3/MSDS',
    defaultLevel: 'adapt_verify',
    taskIds: ['dd1', 'dd9', 'de2', 'de4', 'dv4', 'dp2', 'dp6'],
    deliverables: ['认证补测/复用确认', 'UN38.3运输测试报告或复用确认', 'MSDS', '电芯/电池包安全认证报告或复用确认', 'EOL 100%测试能力验收记录'],
    timing: ['P1 输出复用等级初版', 'Gate1 冻结安全/认证边界', 'Gate2 复核验证矩阵', 'EVT Gate 确认可选项关闭', 'DVT Gate 冻结 PVT 放行证据'],
    cannotCut: '电芯、电池包、保护方案、热路径或目标市场运输边界变化时，安全/认证验证不得裁掉。',
    gateDepth: {
      direct_reuse: '保留复用证据、适用边界和整机适配确认；PVT Gate 必须确认 UN38.3/MSDS/电池安全证据仍有效。',
      adapt_verify: '保留 EVT 差异验证、DVT 安全/认证边界确认和 PVT EOL 100% 测试能力验收。',
      light_modify: '按中改执行电池专项 EVT/DVT，认证补测路径需在 Gate2 冻结，PVT 不得缺放行证据。',
      redevelop: '按大改执行完整电池安全、可靠性、认证和 PVT 放行深度，视同 NPD 关键模块。',
    },
  },
  {
    id: 'mechanism',
    name: '机芯 / 马达 / 泵体',
    examples: '机芯、马达、泵体、传动、噪音、温升、寿命',
    defaultLevel: 'adapt_verify',
    taskIds: ['dd2', 'de2', 'de3', 'dv4', 'dp3'],
    deliverables: ['关键模块升级方案', '关键模块验证报告', '新旧版本对比报告', '可靠性测试报告', '升级试产报告'],
    timing: ['P1 判定性能和寿命影响', 'Gate1 冻结大/中改等级', 'Gate2 冻结样机和验证矩阵', 'EVT Gate 确认专项验证是否关闭', 'DVT Gate 确认寿命/温升/噪音结论'],
    cannotCut: '性能、噪音、温升、寿命或驱动边界变化时，专项验证和整机回归必须保留。',
    gateDepth: {
      direct_reuse: '保留复用版本证据和整机回归；机芯专项 EVT 可减，但 DVT 需确认无集成影响。',
      adapt_verify: '保留机芯专项 EVT、新旧性能对比和 DVT 关键可靠性确认。',
      light_modify: '按中改保留 EVT 专项、DVT 寿命/温升/噪音验证和 PVT 试产表现确认。',
      redevelop: '按大改执行完整设计、EVT/DVT/PVT 验证，Gate 深度接近 NPD 核心模块。',
    },
  },
  {
    id: 'pcba_power',
    name: 'PCBA / 电源 / 主控',
    examples: 'PCBA、主控、驱动、电源余量、传感器、关键 IC',
    defaultLevel: 'light_modify',
    taskIds: ['dd3', 'dd6', 'de2', 'de3', 'dv5', 'dp2'],
    deliverables: ['升级设计包', 'BOM v2.0', '关键模块验证报告', '软件完整测试报告', '治具/EOL测试程序验收'],
    timing: ['P1 标记硬件差异', 'Gate1 冻结核心架构是否变化', 'Gate2 冻结 BOM/DFMEA/验证计划', 'EVT Gate 确认硬件问题关闭', 'DVT Gate 确认量产测试覆盖'],
    cannotCut: '主控、驱动、电源架构或关键 IC 变化时，EVT 专项、软件回归和 EOL 测试能力不得裁掉。',
    gateDepth: {
      direct_reuse: '保留 BOM 版本、PCBA 复用证据和整机回归；EOL 覆盖需确认。',
      adapt_verify: '保留差异验证、软件/生产测试接口回归和 DVT 完整测试确认。',
      light_modify: '按中改保留硬件设计评审、DFMEA、EVT 专项、DVT 完整测试和 PVT EOL 验收。',
      redevelop: '按大改执行完整硬件设计、验证、可靠性和量产测试放行。',
    },
  },
  {
    id: 'firmware',
    name: '软件 / 固件 / APP 接口',
    examples: '固件、控制策略、APP/OTA、错误码、生产烧录和测试接口',
    defaultLevel: 'adapt_verify',
    taskIds: ['dd4', 'de3', 'dv5', 'dp5'],
    deliverables: ['升级设计包', '整机功能与兼容回归报告', '软件完整测试报告', '版本切换与库存处理方案'],
    timing: ['P1 判定控制策略影响', 'Gate1 冻结软件边界', 'Gate2 冻结版本和回归范围', 'EVT Gate 关闭功能回归问题', 'DVT Gate 冻结量产版本'],
    cannotCut: '控制策略、保护阈值、OTA/APP、生产烧录或 EOL 接口变化时，软件完整测试和版本切换必须保留。',
    gateDepth: {
      direct_reuse: '保留版本复用证据、接口清单和整机回归；可减少软件专项测试。',
      adapt_verify: '保留功能回归、接口回归、异常恢复和 DVT 完整测试。',
      light_modify: '按中改保留设计评审、EVT 回归、DVT 完整测试和 PVT 版本切换。',
      redevelop: '按大改执行完整软件设计、EVT/DVT/PVT 回归和发布控制。',
    },
  },
  {
    id: 'structure_mold',
    name: '结构 / 外壳 / 模具',
    examples: '外壳、机芯仓、电池仓、按键接口、T1/T2、治具和检具',
    defaultLevel: 'light_modify',
    taskIds: ['dd5', 'dd7', 'dd8', 'de2', 'de4', 'dv1', 'dv2', 'dv3', 'dp1'],
    deliverables: ['结构设计包', '投模评审/开模批准记录', '模具开发计划', 'T1/T2试模报告', '模具件验证报告', 'SOP/WI与检验标准更新'],
    timing: ['P1 判定新开模/修模范围', 'Gate1 冻结模具费用和周期', '投模评审批准后开模', 'DVT Gate 关闭 T1/T2 和可靠性问题', 'PVT Gate 确认模具件量产状态'],
    cannotCut: '主承力结构、密封、散热、电池仓、跌落或运输保护边界变化时，可靠性和模具件验证必须保留。',
    gateDepth: {
      direct_reuse: '保留结构复用证据、装配边界和整机回归；模具专项可减。',
      adapt_verify: '保留装配/尺寸/可靠性差异验证和 DVT 模具件确认。',
      light_modify: '按中改保留结构设计、EVT 预验证、DVT 模具件和 PVT 工艺文件更新。',
      redevelop: '按大改执行完整结构/模具设计、T1/T2、可靠性和试产验证。',
    },
  },
  {
    id: 'packaging_cert',
    name: '包装 / 标签 / 认证边界',
    examples: '包装结构、运输测试、渠道标签、目标市场认证、说明书',
    defaultLevel: 'direct_reuse',
    taskIds: ['dd9', 'de4', 'dv5', 'dp5', 'dp6'],
    deliverables: ['包装与物流验证报告', '认证补测/复用确认', '版本切换与库存处理方案', '迭代量产发布评审记录'],
    timing: ['P1 判定目标市场和运输边界', 'Gate1 冻结认证路径', 'Gate2 冻结资料责任人', 'DVT Gate 关闭认证/包装结论', 'PVT Gate 放行上市资料和切换方案'],
    cannotCut: '目标市场、运输边界、电池运输信息、渠道标签或说明书合规内容变化时，认证/包装确认必须保留。',
    gateDepth: {
      direct_reuse: '保留复用确认、标签适用性和版本切换记录；包装测试可按边界减少。',
      adapt_verify: '保留认证复用/补测判断、包装物流差异验证和上市资料复核。',
      light_modify: '按中改保留认证补测或机构确认、包装验证和 PVT 发布证据。',
      redevelop: '按大改执行完整认证、包装物流验证和发布放行。',
    },
  },
];

const DERIVATIVE_REUSE_LEVEL_RANK: Record<DerivativeReuseLevel, number> = {
  direct_reuse: 0,
  adapt_verify: 1,
  light_modify: 2,
  redevelop: 3,
};

const DERIVATIVE_ALWAYS_TASK_IDS = new Set([
  'di1', 'di2', 'di5', 'di6',
  'dd6', 'dd10',
  'de3', 'de5', 'de6',
  'dv6', 'dv7',
  'dp1', 'dp3', 'dp4', 'dp5', 'dp6',
  'dm1', 'dm2', 'dm3',
]);

const DERIVATIVE_TASK_REQUIREMENTS: Array<{ taskId: string; moduleId: string; minLevel: DerivativeReuseLevel }> = [
  { taskId: 'dd1', moduleId: 'battery', minLevel: 'adapt_verify' },
  { taskId: 'dd2', moduleId: 'mechanism', minLevel: 'adapt_verify' },
  { taskId: 'dd3', moduleId: 'pcba_power', minLevel: 'adapt_verify' },
  { taskId: 'dd4', moduleId: 'firmware', minLevel: 'adapt_verify' },
  { taskId: 'dd5', moduleId: 'structure_mold', minLevel: 'adapt_verify' },
  { taskId: 'dd7', moduleId: 'structure_mold', minLevel: 'light_modify' },
  { taskId: 'dd8', moduleId: 'structure_mold', minLevel: 'light_modify' },
  { taskId: 'dd9', moduleId: 'battery', minLevel: 'adapt_verify' },
  { taskId: 'dd9', moduleId: 'packaging_cert', minLevel: 'adapt_verify' },
  { taskId: 'de1', moduleId: 'battery', minLevel: 'adapt_verify' },
  { taskId: 'de1', moduleId: 'mechanism', minLevel: 'adapt_verify' },
  { taskId: 'de1', moduleId: 'pcba_power', minLevel: 'adapt_verify' },
  { taskId: 'de1', moduleId: 'firmware', minLevel: 'adapt_verify' },
  { taskId: 'de1', moduleId: 'structure_mold', minLevel: 'adapt_verify' },
  { taskId: 'de2', moduleId: 'battery', minLevel: 'adapt_verify' },
  { taskId: 'de2', moduleId: 'mechanism', minLevel: 'adapt_verify' },
  { taskId: 'de2', moduleId: 'pcba_power', minLevel: 'adapt_verify' },
  { taskId: 'de2', moduleId: 'structure_mold', minLevel: 'adapt_verify' },
  { taskId: 'de4', moduleId: 'battery', minLevel: 'adapt_verify' },
  { taskId: 'de4', moduleId: 'structure_mold', minLevel: 'light_modify' },
  { taskId: 'de4', moduleId: 'packaging_cert', minLevel: 'adapt_verify' },
  // DVT 样机在任一关键模块达到"适配验证"深度时都必须制作，不只挂结构模块（2026-07-09 合理性修正）
  { taskId: 'dv1', moduleId: 'battery', minLevel: 'adapt_verify' },
  { taskId: 'dv1', moduleId: 'mechanism', minLevel: 'adapt_verify' },
  { taskId: 'dv1', moduleId: 'pcba_power', minLevel: 'adapt_verify' },
  { taskId: 'dv1', moduleId: 'firmware', minLevel: 'adapt_verify' },
  { taskId: 'dv1', moduleId: 'structure_mold', minLevel: 'adapt_verify' },
  { taskId: 'dv2', moduleId: 'structure_mold', minLevel: 'light_modify' },
  { taskId: 'dv3', moduleId: 'structure_mold', minLevel: 'light_modify' },
  { taskId: 'dv4', moduleId: 'battery', minLevel: 'adapt_verify' },
  { taskId: 'dv4', moduleId: 'mechanism', minLevel: 'adapt_verify' },
  { taskId: 'dv4', moduleId: 'pcba_power', minLevel: 'light_modify' },
  { taskId: 'dv4', moduleId: 'structure_mold', minLevel: 'light_modify' },
  { taskId: 'dv5', moduleId: 'pcba_power', minLevel: 'adapt_verify' },
  { taskId: 'dv5', moduleId: 'firmware', minLevel: 'adapt_verify' },
  { taskId: 'dv5', moduleId: 'packaging_cert', minLevel: 'adapt_verify' },
  { taskId: 'dp2', moduleId: 'battery', minLevel: 'adapt_verify' },
  { taskId: 'dp2', moduleId: 'pcba_power', minLevel: 'adapt_verify' },
];

export function normalizeDerivativeReuseStrategy(input: unknown): DerivativeReuseStrategy {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const validLevels = new Set(Object.keys(DERIVATIVE_REUSE_LEVEL_LABELS));
  return Object.fromEntries(
    DERIVATIVE_REUSE_MODULE_RULES.map((rule) => {
      const value = raw[rule.id];
      return [
        rule.id,
        typeof value === 'string' && validLevels.has(value)
          ? value as DerivativeReuseLevel
          : rule.defaultLevel,
      ];
    })
  ) as DerivativeReuseStrategy;
}

export function getDerivativeEffectiveTaskIds(
  strategyInput?: unknown,
  templateVersion: string | null = SOP_TEMPLATE_VERSION_LEGACY,
): Set<string> {
  const strategy = normalizeDerivativeReuseStrategy(strategyInput);
  const ids = new Set(DERIVATIVE_ALWAYS_TASK_IDS);
  for (const rule of DERIVATIVE_TASK_REQUIREMENTS) {
    const level = strategy[rule.moduleId] ?? 'direct_reuse';
    if (DERIVATIVE_REUSE_LEVEL_RANK[level] >= DERIVATIVE_REUSE_LEVEL_RANK[rule.minLevel]) {
      ids.add(rule.taskId);
    }
  }
  if (templateVersion === SOP_TEMPLATE_VERSION_CURRENT) {
    for (const legacyCloseTaskId of ['dm1', 'dm2', 'dm3']) ids.delete(legacyCloseTaskId);
    for (const currentCloseTaskId of ['stability_ramp', 'stability_metrics', 'stability_issues', 'project_close_review']) {
      ids.add(currentCloseTaskId);
    }
  }
  return ids;
}

/** 某些模块等级变化时会受影响的任务集合（用于限定策略重放/局部调整的重置范围）。 */
export function getDerivativeModuleAffectedTaskIds(moduleIds: Iterable<string>): Set<string> {
  const wanted = new Set(Array.from(moduleIds));
  const ids = new Set<string>();
  for (const req of DERIVATIVE_TASK_REQUIREMENTS) {
    if (wanted.has(req.moduleId)) ids.add(req.taskId);
  }
  return ids;
}

export function getDerivativeTailoredTaskIds(strategyInput?: unknown, templateVersion?: string | null): Set<string> {
  const effectiveIds = getDerivativeEffectiveTaskIds(strategyInput, templateVersion);
  const tailoredIds = new Set<string>();
  for (const phase of getPhasesForCategory('derivative', templateVersion)) {
    if (phase.isCloseGate) continue;
    for (const task of phase.tasks) {
      if (!effectiveIds.has(task.id)) tailoredIds.add(task.id);
    }
  }
  return tailoredIds;
}

export function getDerivativeEffectivePhases(strategyInput?: unknown, templateVersion?: string | null): SOPPhase[] {
  const effectiveIds = getDerivativeEffectiveTaskIds(strategyInput, templateVersion);
  return getPhasesForCategory('derivative', templateVersion).map((phase) => ({
    ...phase,
    tasks: phase.isCloseGate ? phase.tasks : phase.tasks.filter((task) => effectiveIds.has(task.id)),
  }));
}

registerDerivativeEffectivePhaseResolver(getDerivativeEffectivePhases);

const NPD_GATE_STANDARDS: Record<string, SOPGateStandard> = {
  concept: {
    entryCriteria: [
      '目标客户、核心场景和商业假设已形成初稿',
      '竞品、用户需求、技术可行性和目标成本已有初步证据',
      '产品经理已确认项目与公司产品策略和资源窗口匹配',
    ],
    exitCriteria: [
      '管理层批准立项范围、目标用户、核心卖点和商业目标',
      '关键技术、专利、供应链和成本风险均已登记责任人与验证计划',
      '项目进入规划阶段所需核心角色和预算窗口已确认',
    ],
    requiredDeliverables: ['市场调研报告', '产品概念书', '商业可行性分析', '立项申请书', '认证路线图初判'],
    responsibleRoles: ['产品经理负责产品定义、材料与结论', 'R&D Lead 负责技术可行性', 'Finance/SCM 负责成本与供应风险', 'cert/battery_safety 负责早期法规与电池安全初判', '管理层/Owner 负责立项决策'],
    evidenceRequirements: ['立项申请书签核记录', '竞品分析与 VoC 原始摘要', '技术 POC/专利检索记录', '目标市场与认证路线图初判', '商业测算表与风险清单'],
    exceptionStrategy: ['信息不足则退回补充调研或 POC', '商业价值不成立则暂停立项或降级为预研', '重大风险需形成管理层接受的豁免或关闭计划'],
  },
  planning: {
    entryCriteria: [
      '立项 Gate 已通过，项目范围和目标市场已冻结',
      '产品经理、项目经理/PMO、核心研发、QA、SCM 等关键角色已明确',
      '关键需求、成本、认证路线图和上市窗口没有未决重大分歧',
    ],
    exitCriteria: [
      'PRD/PSD、项目计划、风险清单、认证路线图和 BOM v0.1 已完成基线',
      '关键供应商、长交期物料、电芯复用/定点与二供策略和资源缺口已有应对计划',
      '团队对里程碑、验收口径和 Gate 节奏达成一致',
    ],
    requiredDeliverables: ['PRD产品需求文档', 'PSD产品规格书', '项目甘特图', 'BOM v0.1', '认证路线图', '电芯复用/定点与二供策略'],
    responsibleRoles: ['产品经理负责需求、PRD 和范围取舍', '项目经理/PMO 负责里程碑、资源和关键路径', 'R&D 负责规格可实现性', 'SCM 负责关键料件与供应商', 'cert 负责认证路线图', 'battery_safety 负责电芯与电池安全策略', '管理层/Owner 负责 Kickoff 决策'],
    evidenceRequirements: ['PRD/PSD 版本记录', '项目甘特图与关键路径', 'RACI/资源确认记录', 'BOM v0.1 与风险登记表', '认证路线图与关键前置依赖', '电芯复用判定、供应商/二供策略记录'],
    exceptionStrategy: ['需求或规格未冻结则禁止进入设计冻结流程', '资源缺口需升级管理层协调', '关键物料风险需建立替代方案或调整计划', '认证路线或电芯复用/定点边界不清不得进入设计冻结流程'],
  },
  design: {
    entryCriteria: [
      'PRD/PSD 和项目计划已完成基线',
      'ID/MD/EE/SW 设计输入、目标成本、认证路线和电池安全要求已明确',
      '关键料件样品、供应商窗口和工程资源已具备',
    ],
    exitCriteria: [
      'ID/MD/EE/SW 设计输出完成并通过跨部门评审',
      'DFM/DFA、BOM v1.0、关键料件定型、电芯厂质量审核/复用资质确认和 EVT 计划已确认',
      '安全 FMEA/危害分析和保护电路设计评审/复用确认已完成',
      '进入 EVT 的开放问题均有责任人、关闭日期或批准豁免',
    ],
    requiredDeliverables: ['ID外观图', 'MD结构图', 'PCB原理图&Layout', 'SW架构文档', 'BOM v1.0', '安全FMEA与危害分析', '电芯厂质量审核或复用资质确认', '保护电路设计评审或复用确认'],
    responsibleRoles: ['R&D Lead 负责设计完整性', '产品经理负责范围取舍和产品体验', '项目经理/PMO 负责节奏、风险和跨部门推进', 'QA/ME 负责可验证性与可制造性', 'battery_safety 负责电池安全与保护方案', 'cert 负责认证前置依赖复核', '管理层/Owner 负责设计冻结批准'],
    evidenceRequirements: ['设计评审纪要', '图纸/原理图/Layout/架构文件版本', 'DFM/DFA Checklist', 'BOM v1.0 与 EVT Build Plan', '安全 FMEA/危害分析记录', '电芯厂审核/复用资质与保护电路评审/复用确认记录'],
    exceptionStrategy: ['设计输出不完整则不得释放 EVT 打样', '关键风险需建立整改清单或 Gate 条件通过', '成本偏离目标需提交管理层取舍决策', '电芯复用边界、供应资质或保护方案未闭环不得设计冻结'],
  },
  evt: {
    entryCriteria: [
      '设计冻结 Gate 已通过，EVT Build Plan 已批准',
      'EVT 样机、测试计划、调试资源和问题跟踪机制已就绪',
      '关键料件、PCB/FW 版本和样机编号规则已确认',
    ],
    exitCriteria: [
      '主要功能 Pass Rate 达到 95% 以上',
      'P0 问题全部关闭，P1 问题关闭或获得明确豁免',
      '设计问题清单、改板计划和 DVT 输入版本已冻结',
    ],
    requiredDeliverables: ['EVT样机 ≥10台', '功能测试报告', '问题清单 (Issue List)', 'PCB v2'],
    responsibleRoles: ['EE/SW/ME 负责问题定位与修正', 'QA 负责测试结论', '项目经理/PMO 负责 Issue 闭环和 Gate 组织', '产品经理负责范围影响确认', '管理层/Owner 负责进入 DVT 决策'],
    evidenceRequirements: ['EVT 样机清单与版本照片', '功能/性能测试报告', 'Issue List 与关闭证据', 'PCB/FW 改版 ECN 或 Release Note'],
    exceptionStrategy: ['未达准出条件则安排 Re-EVT 或专项复测', '开放问题必须形成责任人、期限和影响评估', '影响 DVT 风险需升级为 Gate 条件通过或拒绝通过'],
  },
  dvt: {
    entryCriteria: [
      'EVT Gate 已通过，DVT 样机版本和测试矩阵已冻结',
      '认证、可靠性、模具和包装验证资源已排期，电池安全与运输认证样品版本已确认',
      'EVT 遗留问题已关闭或获得进入 DVT 的批准豁免',
    ],
    exitCriteria: [
      '可靠性、认证、电池安全、模具尺寸/外观和软件回归达到目标',
      '无未关闭 P0/P1 问题，量产关键风险已有控制计划',
      'BOM 成本、关键供应和 PVT 试产条件已确认',
    ],
    requiredDeliverables: ['DVT样机 ≥30台', '可靠性测试报告', '认证报告', '模具T1样品', 'PFMEA/CTQ控制计划'],
    responsibleRoles: ['QA 负责可靠性与认证结论', 'R&D 负责设计整改', 'ME/SCM 负责工艺与供应准备', 'battery_safety/cert 负责电池安全与运输认证结论', '管理层/Owner 负责进入 PVT 决策'],
    evidenceRequirements: ['DVT 样机 Build Record', '可靠性/认证测试报告', '模具 T1/T2 评审记录', 'PFMEA/CTQ 控制计划', 'BOM 成本确认与 PVT Readiness 清单'],
    exceptionStrategy: ['可靠性或认证失败必须复测并记录根因', '模具/外观不达标则冻结修模计划', '重大问题未关闭不得进入 PVT，除非有书面豁免和风险接受人'],
  },
  pvt: {
    entryCriteria: [
      'DVT Gate 已通过，量产工艺、治具和测试程序已准备',
      '试产物料齐套，SOP/WI 草案、培训计划和产线排程已确认',
      '关键质量标准、CTQ、认证放行清单和良率统计口径已冻结',
    ],
    exitCriteria: [
      '试产良率达到目标，关键异常已关闭或有受控计划',
      'SOP/WI、治具、测试程序、EOL 100%检测能力、产能和人员培训全部就绪',
      '供应稳定性、包装物流、电池安全/运输认证和 MP Release 条件已确认',
    ],
    requiredDeliverables: ['试产50-300台', 'SOP/WI作业指导书', '良率报告', '治具与测试程序', 'EOL 100%测试能力验收记录', 'UN38.3运输测试报告或复用确认', 'MSDS', '电芯/电池包安全认证报告或复用确认'],
    responsibleRoles: ['ME/工厂负责试产执行', 'QA 负责质量判定', '测试工程负责 EOL 100%检测能力', 'SCM 负责物料与供应', 'battery_safety/cert 负责电池安全与运输认证放行', '项目经理/PMO 负责发布准备推进', '产品经理/管理层负责 MP Release 决策'],
    evidenceRequirements: ['PVT 试产报告', '分工位良率与 FPY 数据', 'SOP/WI 与培训记录', '治具/测试程序验收记录', 'EOL 100%测试项目与 GR&R/验收记录', 'UN38.3、MSDS 和电池安全证书/报告或复用有效性确认'],
    exceptionStrategy: ['良率未达标则重复 PVT 或追加专项改善', '工艺/治具/EOL 检测能力未就绪不得发布 MP', '缺 UN38.3/MSDS/电池安全证据或复用有效性确认不得发布 MP 或出货', '供应风险需制定保供计划并由管理层确认'],
  },
  mp: {
    entryCriteria: [
      'PVT Gate 已通过，MP Release 文件包完整',
      '首批订单、产能、供应、OQC 和售后反馈机制已准备',
      '量产质量目标、爬坡节奏和异常升级路径已确认',
    ],
    exitCriteria: [
      '量产爬坡达到计划产能和良率目标',
      '关键质量、成本、交付和售后问题进入常态化管理',
      'ECN/ECR、RMA 和持续改善机制运行稳定',
    ],
    requiredDeliverables: ['量产产品', '良率周报', 'ECN/ECR记录', '售后数据分析'],
    responsibleRoles: ['工厂/ME 负责产能与工艺', 'QA 负责出货质量', 'SCM 负责供应连续性', '项目经理/PMO 负责爬坡跟踪', '产品经理/管理层负责量产经营目标'],
    evidenceRequirements: ['MP Release 记录', '周良率/产能/出货数据', 'OQC/RMA 分析', 'ECN/ECR 与 CAR 关闭记录'],
    exceptionStrategy: ['重大质量异常启动围堵、停线或召回评估', '良率/交付偏差进入管理层周会跟踪', '持续不达标需启动专项改善或工程变更'],
  },
};

const ECO_GATE_STANDARDS: Record<string, SOPGateStandard> = {
  planning: {
    entryCriteria: ['ECR 已提交并说明变更原因、范围和目标', '受影响产品、库存、认证和客户影响已初步识别', '产品经理/项目经理已确认变更具备评审价值和资源窗口'],
    exitCriteria: ['CCB 批准 ECO 范围、收益、风险和验证策略', 'BOM 差异、成本影响、时程和资源计划已确认', 'ECO 编号、版本基线和责任分工已冻结'],
    requiredDeliverables: ['ECR变更申请书', '影响分析报告', 'BOM差异对比', '变更时程'],
    responsibleRoles: ['产品经理负责变更价值和范围确认', '项目经理/PMO 负责 ECO 组织、节点和风险推进', 'R&D/QA 负责影响分析', 'SCM 负责库存和供应影响', 'CCB/管理层负责批准'],
    evidenceRequirements: ['ECR/CCB 评审记录', '影响分析矩阵', 'BOM 差异与成本测算', '变更计划和风险清单'],
    exceptionStrategy: ['收益或必要性不足则拒绝 ECO', '影响范围不清则退回补充分析', '高风险变更需管理层批准后进入设计'],
  },
  design: {
    entryCriteria: ['ECO Kickoff 已通过，变更范围和版本基线已冻结', '设计输入、测试影响和认证影响已明确', '新料件/新工艺样品或供应商支持已准备'],
    exitCriteria: ['硬件、结构、软件、工艺或包装变更设计完成', 'ECN 草案/变更设计包、更新 BOM 和验证计划已确认', '变更后的制造、认证和供应风险已有控制措施'],
    requiredDeliverables: ['ECN草案/变更设计包', '更新后的原理图/PCB', '更新后的BOM', '变更设计评审报告'],
    responsibleRoles: ['R&D 负责变更设计', 'QA 负责验证和认证影响', 'ME/工厂负责制造影响', '项目经理/PMO 负责变更计划推进', 'CCB 负责设计冻结批准'],
    evidenceRequirements: ['变更前后设计差异文件', 'ECN 草案与更新 BOM', 'DFM/认证影响确认', '设计评审纪要'],
    exceptionStrategy: ['设计包不完整则不得进入验证', '认证或制造风险未闭环需增加验证项', '成本/交期偏差需回到 CCB 决策'],
  },
  evt: {
    entryCriteria: ['设计变更冻结 Gate 已通过', '变更样机、测试计划和回归范围已准备', '变更版本、旧版本基线和对比口径已确认'],
    exitCriteria: ['变更点专项验证通过', '核心功能回归无新增重大问题', '可靠性关键项达标或获得批准豁免'],
    requiredDeliverables: ['变更验证样机', '变更验证报告', '回归测试报告', '问题清单'],
    responsibleRoles: ['R&D 负责变更实现和问题修正', 'QA 负责验证结论', '项目经理/PMO 负责 Issue 闭环和 Gate 组织', '产品经理负责变更目标影响确认', 'CCB/管理层负责进入试产决策'],
    evidenceRequirements: ['变更样机清单', '专项验证报告', '回归测试报告', '问题关闭记录和风险豁免'],
    exceptionStrategy: ['验证失败则退回设计整改', '新增问题需评估是否扩大回归范围', '高风险未闭环不得进入产线切换'],
  },
  pvt: {
    entryCriteria: ['变更验证 Gate 已通过，试产切换计划已批准', '产线、治具、SOP/WI、物料和人员培训已准备', '旧版本库存和在制品处理方案已明确'],
    exitCriteria: ['变更试产良率和质量达到切换目标', 'ECN 正式发布，文件包和培训完成', '库存/在制品切换风险受控'],
    requiredDeliverables: ['变更试产报告', '更新后的SOP/WI', '产线切换计划', '库存处理方案'],
    responsibleRoles: ['ME/工厂负责试产切换', 'QA 负责质量判定', 'SCM 负责库存与供应', '项目经理/PMO 负责切换计划推进', 'CCB 负责量产切换批准'],
    evidenceRequirements: ['试产良率报告', 'SOP/WI 更新记录', 'ECN 发布记录', '库存盘点和切换计划签核'],
    exceptionStrategy: ['试产或库存方案未达标则延后切换', '必要时执行分批切换或旧版本消耗策略', '重大质量风险需回退旧版本或重新验证'],
  },
  mp: {
    entryCriteria: ['变更量产切换 Gate 已通过，ECN 已生效', '变更后生产、质量和售后监控指标已定义', '旧版本收尾和市场/客户通知已完成或计划明确'],
    exitCriteria: ['变更目标达到预期并完成量化验证', '连续监控期内无新增重大质量或售后风险', 'ECO 文件、经验教训和关闭报告已归档'],
    requiredDeliverables: ['变更后良率报告', '变更效果验证报告', 'ECO关闭报告'],
    responsibleRoles: ['项目经理/PMO 负责 ECO 关闭组织', '产品经理负责变更目标达成确认', 'QA/工厂负责量产监控', 'SCM/售后负责外部影响跟踪', 'CCB/管理层负责关闭批准'],
    evidenceRequirements: ['连续量产监控数据', '变更前后指标对比', '售后/RMA 跟踪记录', 'ECO 关闭报告和复盘记录'],
    exceptionStrategy: ['效果未达预期则延长监控或重新打开 ECO', '质量恶化需启动 CAPA/回滚评估', '文件不完整不得关闭 ECO'],
  },
};

const DERIVATIVE_GATE_STANDARDS: Record<string, SOPGateStandard> = {
  iteration: {
    entryCriteria: [
      '已确认项目属于大改款或中改款，而非极小工程变更或纯外观翻新',
      '已明确基线产品/当前量产版本、目标升级代际（如 1 代→2 代）和升级动因',
      '机芯、电池、外壳/模具、硬件、软件、包装等候选升级范围已形成初步清单',
      '产品经理/项目经理已确认升级具备商业价值、资源窗口和量产切换必要性',
    ],
    exitCriteria: [
      '管理层批准升级范围、目标指标、目标上市窗口和验证策略',
      '基线 BOM/规格/认证/售后数据完成盘点，升级 BOM 差异、成本和供应影响已确认',
      '旧模块已完成复用判定，明确直接复用、复用但需验证、轻量适配和重新开发的模块边界',
      '模块复用策略已在流程策略面板应用，系统按策略自动判定大/中改等级与 Gate 深度，评审时确认即可',
      '模块复用策略已绑定保留任务、可选任务、交付物深度、Gate 深度和不可裁剪边界',
      '升级版本基线、责任分工、风险清单和阶段计划已冻结',
    ],
    requiredDeliverables: ['迭代需求书', '模块复用策略与影响分析', '迭代项目计划'],
    responsibleRoles: ['产品经理负责升级目标、卖点和范围取舍', '项目经理/PMO 负责迭代项目组织、节点和风险推进', 'R&D/QA 负责技术影响和验证策略', 'SCM 负责关键料件、供应商和库存影响', '管理层/Owner 负责立项批准'],
    evidenceRequirements: ['迭代立项评审记录', '迭代需求书（含一代问题复盘）', '模块复用策略与影响分析（含系统大/中改判定快照）', '项目计划和风险清单'],
    exceptionStrategy: ['升级目标或代际边界不清则退回补充定义', '仅换料、降本或供应商替代等极小改转入 ECO', '纯换色、CMF、包装标签或外观翻新转入 IDR', '若为全新平台或核心架构重构则转入 NPD 评审'],
  },
  design: {
    entryCriteria: ['迭代 Kickoff 已通过，基线版本、目标规格和升级范围已冻结', '机芯/电池/结构/硬件/软件/认证影响已明确，验证输入已形成', '新料件、新模具、新工艺样品或供应商支持已准备'],
    exitCriteria: ['电池/机芯/PCBA/软件/结构等受影响模块升级设计完成并通过跨部门评审', 'BOM v2.0、认证/电池安全路径、升级验证计划和 DFMEA/风险清单已确认', '结构设计与投模评审/开模批准已完成，模具开发计划、费用和周期已冻结', '模块复用策略已在设计冻结前复核，制造、认证、电池安全和供应风险已有控制措施'],
    requiredDeliverables: ['电池/电源升级设计包', '机芯/泵体升级设计包', 'PCBA/主控升级设计包', '软件/固件升级设计包', '结构设计包', 'BOM v2.0', '投模评审/开模批准记录', '模具开发计划', '升级验证计划', 'DFMEA/风险清单'],
    responsibleRoles: ['R&D 负责升级方案设计和技术取舍', 'QA 负责验证输入和认证影响', 'ME/工厂负责制造与治具影响', 'SCM 负责新料件与供应商', '项目经理/PMO 负责计划推进', '管理层/Owner 负责设计冻结批准'],
    evidenceRequirements: ['升级前后设计差异文件', 'BOM v2.0 与关键料件批准记录', '结构设计评审记录', '投模评审/开模批准记录', '模具开发计划和费用/周期确认', 'DFM/DFT/认证影响确认', '设计评审纪要', '模块复用策略复核记录'],
    exceptionStrategy: ['升级设计包不完整则不得进入 EVT', '认证、电池安全或制造风险未闭环需增加验证项', '成本/交期偏差需回到管理层取舍'],
  },
  evt: {
    entryCriteria: ['升级设计冻结 Gate 已通过', '升级 EVT 样机、测试计划和新旧版本对比口径已准备', '关键升级模块、回归范围和安全验证项已确认', 'EVT 可选项已按模块复用策略完成保留/选做判定'],
    exitCriteria: ['关键升级模块专项验证通过或有明确的复用依据', '整机功能、性能和兼容回归无新增重大问题', '可靠性和安全关键项达到 DVT 输入要求或获得批准豁免', 'EVT 问题关闭与 DVT 输入冻结已完成，选做/跳过项、风险接受人和 DVT 保留验证项已记录'],
    requiredDeliverables: ['升级EVT样机', '关键模块验证报告', '整机功能与兼容回归报告', '新旧版本对比报告', 'EVT可选项裁剪记录', 'EVT问题关闭清单', 'DVT输入冻结记录'],
    responsibleRoles: ['R&D 负责升级实现和问题修正', 'QA 负责验证结论', '项目经理/PMO 负责 Issue 闭环和 Gate 组织', '产品经理负责升级目标达成判断', '管理层/Owner 负责进入 DVT 决策'],
    evidenceRequirements: ['升级 EVT 样机清单', '关键模块专项验证报告或裁剪依据', '新旧版本性能对比数据', '回归测试报告', 'EVT 可选项裁剪记录', '问题关闭记录和风险豁免'],
    exceptionStrategy: ['验证失败则退回设计整改', '新增问题需评估是否扩大回归范围', '高风险未闭环不得进入 DVT'],
  },
  dvt: {
    entryCriteria: ['升级 EVT Gate 已通过，DVT 样机版本和验证矩阵已冻结', '模具件、可靠性、认证、电池安全、包装和软件测试资源已按模块复用深度排期', 'EVT 遗留问题已关闭或获得进入 DVT 的批准豁免'],
    exitCriteria: ['DVT 样机、T1/T2 试模、模具件装配/尺寸/外观、可靠性、认证、电池安全和软件测试达到对应 Gate 深度', '无未关闭 P0/P1 问题，量产关键风险已有控制计划', 'PVT 保留项、试产条件、文件包和物料齐套计划已确认'],
    requiredDeliverables: ['升级DVT样机', 'T1试模报告', '模具问题清单', 'T2/修模验证报告', '限度样本', '可靠性测试报告', '认证补测/复用确认', '软件完整测试报告', '包装与物流验证报告', 'DVT问题关闭清单'],
    responsibleRoles: ['QA 负责可靠性、认证和软件测试结论', 'R&D 负责设计整改', 'ME/SCM 负责模具、工艺与供应准备', 'battery_safety/cert 负责电池安全与运输认证结论', '管理层/Owner 负责进入 PVT 决策'],
    evidenceRequirements: ['DVT Build Record', '模具 T1/T2 评审记录', '可靠性/认证/软件测试报告', '包装物流验证记录', 'PFMEA/CTQ 控制计划', 'PVT Readiness 清单'],
    exceptionStrategy: ['可靠性或认证失败必须复测并记录根因', '模具/外观不达标则冻结修模计划', '重大问题未关闭不得进入 PVT，除非有书面豁免和风险接受人'],
  },
  pvt: {
    entryCriteria: ['DVT Gate 已通过，PVT 试产和版本切换计划已批准', '产线、治具、EOL 测试、SOP/WI、物料和人员培训已按模块复用深度准备', '旧版本库存、在制品、售后备件和渠道切换方案已明确'],
    exitCriteria: ['升级小批试产良率和质量达到发布目标，关键异常已完成问题关闭与良率改善', '升级版本文件包、SOP/WI、检验标准、治具/EOL 测试程序和培训完成', '认证补测/复用确认、电池安全与运输合规证据已闭环，版本切换风险受控'],
    requiredDeliverables: ['升级试产报告', '试产问题关闭报告', '良率改善报告', 'SOP/WI与检验标准更新', '治具/EOL测试程序验收', 'EOL 100%测试能力验收记录', '版本切换与库存处理方案', '认证补测/复用确认', 'UN38.3运输测试报告或复用确认', 'MSDS', '电芯/电池包安全认证报告或复用确认'],
    responsibleRoles: ['ME/工厂负责试产与产线切换', 'QA 负责质量判定', '测试工程负责 EOL 测试能力', 'SCM 负责库存与供应', 'cert/battery_safety 负责认证和电池安全放行', '项目经理/PMO 负责切换计划推进', '管理层/Owner 负责量产发布批准'],
    evidenceRequirements: ['试产良率报告', 'SOP/WI 与检验标准更新记录', '治具/EOL 测试程序验收记录', 'EOL 100%测试项目与 GR&R/验收记录', '版本文件发布记录', '库存盘点和切换计划签核', 'UN38.3、MSDS 和电池安全证书/报告或复用有效性确认'],
    exceptionStrategy: ['试产或库存方案未达标则延后发布', '必要时执行分批切换或旧版本消耗策略', '缺 UN38.3/MSDS/电池安全证据或复用有效性确认不得发布 MP 或出货', '重大质量/安全/认证风险需暂停发布并重新验证'],
  },
  mp: {
    entryCriteria: ['升级量产发布 Gate 已通过，升级版本已生效', '升级后生产、质量、售后和市场反馈监控指标已定义', '旧版本收尾和客户/渠道通知已完成或计划明确'],
    exitCriteria: ['升级目标达到预期并完成量化验证', '连续监控期内无新增重大质量、安全或售后风险', '升级项目文件、经验教训和关闭报告已归档'],
    requiredDeliverables: ['升级后良率报告', '升级目标达成验证报告', '市场与售后影响跟踪报表', '迭代项目关闭报告'],
    responsibleRoles: ['项目经理/PMO 负责升级关闭组织', '产品经理负责升级目标达成确认', 'QA/工厂负责量产监控', 'SCM/售后/销售负责外部影响跟踪', '管理层/Owner 负责关闭批准'],
    evidenceRequirements: ['连续量产监控数据', '升级前后指标对比', '售后/RMA 和市场反馈记录', '升级关闭报告和复盘记录'],
    exceptionStrategy: ['效果未达预期则延长监控或发起补充升级', '质量恶化需启动 CAPA/回滚评估', '文件不完整不得关闭升级项目'],
  },
};

const IDR_GATE_STANDARDS: Record<string, SOPGateStandard> = {
  design: {
    entryCriteria: [
      '外观翻新 brief、目标市场、目标 SKU 和上市窗口已确认',
      '现有产品基线资料已收齐，包括 ID/MD/EE/BOM/包装/认证/测试报告',
      '产品经理已确认本项目属于现有产品外观改版，而非全新平台开发',
    ],
    exitCriteria: [
      '翻新范围和受影响模块已冻结，明确 ID、结构、硬件接口、包装、物料和认证影响',
      '新物料、供应商、成本、认证路径和验证计划已形成可执行版本',
      '跨部门 RACI、里程碑和 Gate 节奏已确认',
    ],
    requiredDeliverables: ['IDR翻新 brief', '现有设计基线包', '影响分析矩阵', 'BOM差异与新物料清单', '认证路径预判', '项目计划'],
    responsibleRoles: ['产品经理负责翻新目标、范围和上市口径', '项目经理/PMO 负责节奏、资源和风险推进', 'ID/MD/EE 负责技术影响评估', 'SCM 负责新物料与供应', 'QA/认证负责验证和合规路径', '管理层/Owner 负责 Kickoff 批准'],
    evidenceRequirements: ['IDR brief 签核记录', '现有图纸/BOM/认证资料清单', '影响分析矩阵', '新物料供应风险与报价记录', '认证机构初步确认或内部合规判断'],
    exceptionStrategy: ['范围不清则不得进入设计', '新增核心功能、平台级硬件或电芯体系变化需升级为 产品迭代/衍生开发或 NPD 决策', '认证或供应风险无法判断需补充评估后再 Gate'],
  },
  engineering: {
    entryCriteria: [
      'IDR Kickoff Gate 已通过，翻新范围、设计输入和项目计划已冻结',
      'ID、结构、硬件、包装、采购、QA 和认证负责人已明确',
      '关键新物料样品、供应商窗口和工程打样资源已准备',
    ],
    exitCriteria: [
      'ID/CMF、结构、硬件适配、包装标签和 BOM 更新已完成设计输出',
      '新物料规格、供应商打样、成本和交期已确认',
      '设计冻结版本满足验证样机制作和认证送样要求',
    ],
    requiredDeliverables: ['ID/CMF设计包', 'MD结构图纸', '硬件影响确认', '包装/标签设计稿', '更新BOM', '供应商样件'],
    responsibleRoles: ['ID 负责外观与 CMF', '产品经理负责外观方向和产品取舍', 'MD 负责结构和模具影响', 'EE 负责硬件接口与性能影响', 'SCM 负责新料件打样', 'QA/认证负责验证输入', '项目经理/PMO 负责设计冻结节奏', '管理层/Owner 负责设计冻结批准'],
    evidenceRequirements: ['设计评审纪要', '3D/2D 图纸和样件照片', '硬件影响检查记录', '供应商样件/报价/交期确认', 'BOM 和认证资料版本记录'],
    exceptionStrategy: ['设计输出不完整则不得释放验证样机', '新物料未确认需冻结替代方案或调整排期', '硬件/结构风险未闭环需追加专项验证或升级为产品迭代/衍生开发'],
  },
  dvt: {
    entryCriteria: [
      '设计冻结 Gate 已通过，验证样机、测试矩阵和认证送样计划已准备',
      '外观、结构、硬件回归、可靠性、包装和认证影响项已明确',
      '外观检验标准草案和限度样本制作计划已确认',
    ],
    exitCriteria: [
      '外观可靠性、结构装配、功能性能回归和包装验证达到目标',
      '认证更新、Delta 认证或重新认证结论已完成并归档',
      '外观检验标准、限度样本和试产切换输入已完成',
    ],
    requiredDeliverables: ['验证样机', '可靠性/回归测试报告', '认证更新记录', '包装验证报告', '外观检验标准'],
    responsibleRoles: ['QA 负责可靠性与测试结论', 'MD/EE/ME 负责结构、硬件和工艺整改', 'ID/产品经理负责外观判定', '认证负责人负责合规结论', '项目经理/PMO 负责问题闭环和 Gate 组织', '管理层/Owner 负责进入试产批准'],
    evidenceRequirements: ['验证样机 Build Record', '可靠性/装配/功能回归测试报告', '认证机构确认或 Delta/重测记录', '限度样本/检验标准文件', '问题清单和关闭证据'],
    exceptionStrategy: ['可靠性、功能或装配不达标则退回设计整改', '外观判定争议需形成限度样本', '认证影响不清或未通过不得进入试产切换'],
  },
  mp: {
    entryCriteria: [
      '验证与认证 Gate 已通过，量产物料、检验标准、SOP/WI 和试产排程已准备',
      '旧版库存、在制品、渠道切换和市场资料更新计划已确认',
      '产线、供应商和质量团队已完成新版本培训与首件准备',
    ],
    exitCriteria: [
      '小批试产或首批量产质量确认 OK，良率和外观合格率达到目标',
      '新旧版本库存、BOM、图纸、SOP/WI、认证和系统资料完成切换',
      '市场图片、文案、包装、渠道通知和售后识别规则已同步更新',
    ],
    requiredDeliverables: ['试产/首批量产产品', 'PVT或首批质量报告', 'SOP/WI更新记录', '版本切换计划', '市场上市计划'],
    responsibleRoles: ['ME/工厂负责试产与工艺', 'QA 负责首批质量和外观判定', 'SCM 负责物料与库存切换', '项目经理/PMO 负责切换计划推进', '产品经理/市场/销售负责上市资料', '管理层/Owner 负责 MP Release 批准'],
    evidenceRequirements: ['首件确认和试产检验记录', '分工位良率与外观合格率数据', 'SOP/WI 与培训记录', '库存和系统切换记录', '渠道/市场物料更新截图或签核'],
    exceptionStrategy: ['试产质量不稳定则暂停上市并追加改善', '物料或认证文件未切换完成不得 MP Release', '库存处理未闭环则限制渠道切换'],
  },
};

// JDM —— 客户委托设计轨。客户出 ID/规格，工厂做 MD/EE/SW 并量产。
// 关键差异：以「设计输入冻结」替代概念/规划入口，并在每个 Gate 强制客户签核
// （签核以「必交付物」形式落地，经现有 deliverable-review 服务校验）。
const JDM_GATE_STANDARDS: Record<string, SOPGateStandard> = {
  input: {
    entryCriteria: [
      '客户已提供 ID/CMF 与产品规格初稿，委托范围基本清晰',
      '项目经理已确认双方对设计边界、责任分工和商务条款无重大分歧',
      '初步可行性与 NRE/模具方向已有判断',
    ],
    exitCriteria: [
      '设计输入（ID/CMF/规格）冻结并经客户书面确认',
      'RACI、初步 BOM、NRE/模具方案和项目计划已基线',
      '关键技术、供应与认证归属风险已登记责任人',
    ],
    requiredDeliverables: ['ID/CMF 输入包', '规格确认书（客户签字）', 'RACI 责任矩阵', '初步 BOM 与 NRE/模具方案', '项目计划'],
    responsibleRoles: ['项目经理负责输入冻结、商务对齐和计划推进', 'R&D Lead 负责可行性判断', 'SCM 负责 NRE/模具与供应', '客户负责输入确认签字', '管理层/Owner 负责受理决策'],
    evidenceRequirements: ['规格确认书签核记录', 'ID/CMF 输入包版本', '初步 BOM 与 NRE 报价', 'RACI 与风险登记表'],
    exceptionStrategy: ['输入不完整或未签字则不得进入详细设计', '边界争议需升级双方对齐会', '认证/模具归属不清需补充确认后再 Gate'],
  },
  design: {
    entryCriteria: [
      '设计输入冻结 Gate 已通过，输入包和项目计划已基线',
      'MD/EE/SW 设计资源与关键料件窗口已具备',
      '客户外观一致性判定口径已明确',
    ],
    exitCriteria: [
      'MD/EE/SW 设计输出完成并通过跨部门评审',
      'DFM/DFA、BOM v1.0 和关键料件定型已确认',
      '客户对外观一致性完成签核，开放问题均有责任人与关闭计划',
    ],
    requiredDeliverables: ['MD 结构图纸', 'EE 原理图 & PCB Layout', 'SW 架构文档', 'BOM v1.0', '客户外观签核记录'],
    responsibleRoles: ['R&D Lead 负责设计完整性', 'ID/MD 负责外观一致性落地', '项目经理负责范围、节点与客户协调', '客户负责外观签核', '管理层/Owner 负责设计冻结批准'],
    evidenceRequirements: ['设计评审纪要', '图纸/原理图/Layout/架构版本', 'DFM/DFA Checklist', 'BOM v1.0', '客户外观签核记录'],
    exceptionStrategy: ['设计输出不完整则不得释放 EVT', '外观偏离客户输入需回到客户裁决', '成本偏离目标需提交客户/管理层取舍'],
  },
  evt: {
    entryCriteria: [
      '设计冻结 Gate 已通过，EVT Build Plan 已批准',
      'EVT 样机、测试计划和问题跟踪机制已就绪',
      '客户样机确认安排与判定口径已确认',
    ],
    exitCriteria: [
      '主要功能 Pass Rate 达到 95% 以上',
      'P0 问题全部关闭，P1 问题关闭或获得明确豁免',
      '客户完成 EVT 样机确认，DVT 输入版本已冻结',
    ],
    requiredDeliverables: ['EVT 样机', '功能/性能测试报告', '软硬件联调记录', '问题清单', '客户样机确认记录'],
    responsibleRoles: ['EE/SW/ME 负责问题定位修正', 'QA 负责测试结论', '项目经理负责 Issue 闭环与客户确认', '客户负责样机确认', '管理层/Owner 负责进入 DVT 决策'],
    evidenceRequirements: ['EVT 样机清单与版本', '功能/性能测试报告', 'Issue List 与关闭证据', '客户样机确认记录'],
    exceptionStrategy: ['未达准出条件则 Re-EVT', '客户未确认不得进入 DVT', '开放问题需有责任人、期限与影响评估'],
  },
  dvt: {
    entryCriteria: [
      'EVT Gate 已通过，DVT 样机版本和测试矩阵已冻结',
      '认证、可靠性、模具和包装验证资源已排期',
      '客户 DVT 确认计划已明确，认证归属已对齐',
    ],
    exitCriteria: [
      '可靠性、认证、模具尺寸/外观和软件回归达到目标',
      '无未关闭 P0/P1 问题，量产关键风险已有控制计划',
      '客户完成 DVT 确认，PVT 试产条件已确认',
    ],
    requiredDeliverables: ['DVT 样机', '可靠性测试报告', '安规与认证报告', '模具 T1/T2 样品', '包装验证报告', '客户 DVT 确认记录'],
    responsibleRoles: ['QA 负责可靠性与认证结论', 'R&D 负责设计整改', 'ME/SCM 负责工艺与供应准备', '客户负责 DVT 确认', '管理层/Owner 负责进入 PVT 决策'],
    evidenceRequirements: ['DVT 样机 Build Record', '可靠性/认证报告', '模具 T1/T2 评审记录', '客户 DVT 确认记录'],
    exceptionStrategy: ['可靠性或认证失败必须复测并记录根因', '客户未确认不得进入 PVT', '模具/外观不达标则冻结修模计划'],
  },
  pvt: {
    entryCriteria: [
      'DVT Gate 已通过，量产工艺、治具和测试程序已准备',
      '试产物料齐套，SOP/WI 草案和产线排程已确认',
      '客户 golden sample 签样安排已明确',
    ],
    exitCriteria: [
      '试产良率达到目标，关键异常已关闭或有受控计划',
      'SOP/WI、治具、测试程序、EOL 100%检测能力和人员培训全部就绪',
      '电池安全/运输认证证据（UN38.3、MSDS、电芯/电池包安全认证）已闭环',
      '客户完成 golden sample 签样，MP Release 条件已确认',
    ],
    requiredDeliverables: ['试产（50-300台）报告', 'SOP/WI', '治具与测试程序', '良率报告', '客户 golden sample 签样记录', 'EOL 100%测试能力验收记录', 'UN38.3运输测试报告或复用确认', 'MSDS', '电芯/电池包安全认证报告或复用确认'],
    responsibleRoles: ['ME/工厂负责试产执行', 'QA 负责质量判定', '测试工程负责 EOL 100%检测能力', 'SCM 负责物料与供应', 'battery_safety/cert 负责电池安全与运输认证放行', '客户负责 golden sample 签样', '项目经理负责发布准备推进', '管理层负责 MP Release 决策'],
    evidenceRequirements: ['PVT 试产报告', '分工位良率与 FPY 数据', 'SOP/WI 与培训记录', 'EOL 100%测试项目与验收记录', 'UN38.3、MSDS 和电池安全证书/报告或复用有效性确认', '客户 golden sample 签样记录'],
    exceptionStrategy: ['良率未达标则重复 PVT', '客户未签样不得发布 MP', '工艺/治具/EOL 检测能力未就绪不得 MP Release', '缺 UN38.3/MSDS/电池安全证据或复用有效性确认不得发布 MP 或出货'],
  },
  mp: {
    entryCriteria: [
      'PVT Gate 已通过，MP Release 文件包完整且客户量产授权到位',
      '首批订单、产能、供应和售后反馈机制已准备',
      '量产质量目标和异常升级路径已确认',
    ],
    exitCriteria: [
      '量产爬坡达到计划产能和良率目标',
      '关键质量、成本、交付和售后进入常态化管理',
      'ECN/ECR 和持续改善机制运行稳定',
    ],
    requiredDeliverables: ['量产产品', '良率周报', 'ECN/ECR 记录', '售后数据分析'],
    responsibleRoles: ['工厂/ME 负责产能与工艺', 'QA 负责出货质量', 'SCM 负责供应连续性', '项目经理负责客户交付与爬坡跟踪', '管理层负责量产经营目标'],
    evidenceRequirements: ['MP Release 记录', '周良率/产能/出货数据', 'OQC/RMA 分析', 'ECN/ECR 关闭记录'],
    exceptionStrategy: ['重大质量异常启动围堵/停线/召回评估', '良率/交付偏差进入管理层周会跟踪', '持续不达标需启动专项改善'],
  },
};

// OBT —— openBOM 转产导入轨。客户出完整设计 + BOM，工厂纯生产。
// 核心工作 = DFM 反馈 + 料件齐套 + 治具/测试程序；客户签样/放行强制。
const OBT_GATE_STANDARDS: Record<string, SOPGateStandard> = {
  intake: {
    entryCriteria: [
      '客户已提交完整设计与 openBOM，转产意向明确',
      '项目经理已确认资料完整度足以启动可制造性评审',
      '模具/治具归属和商务条款已进入对齐',
    ],
    exitCriteria: [
      'openBOM、图纸/规格完整性核对完成，DFM 反馈已提交客户',
      '料件齐套与替代料策略、模具/治具归属与 NRE 已确认',
      '设计输入冻结并经客户确认，报价和项目计划已基线',
    ],
    requiredDeliverables: ['openBOM 核对清单', '图纸/规格完整性确认', 'DFM/可制造性反馈报告', '料件齐套与替代料策略', '模具/治具归属与 NRE 确认', '报价', '项目计划', '设计输入冻结确认（客户）'],
    responsibleRoles: ['项目经理负责转产受理、客户对齐和计划推进', 'ME/工厂负责 DFM 可制造性', 'SCM 负责料件齐套与归属', '客户负责输入冻结确认', '管理层/Owner 负责受理决策'],
    evidenceRequirements: ['openBOM 核对记录', 'DFM 反馈报告', '模具/治具归属确认', '客户输入冻结确认记录'],
    exceptionStrategy: ['资料不完整则退回客户补充', 'DFM 重大问题需客户决策', '归属/NRE 不清需补充确认后再 Gate'],
  },
  sample: {
    entryCriteria: [
      '转产受理 Gate 已通过，输入冻结和料件策略已基线',
      '首件/样机制作资源和测试程序/治具已准备',
      '客户签样判定口径已明确',
    ],
    exitCriteria: [
      'FAI 首件检验通过，测试程序与治具调试完成',
      '客户完成样品签样，开放问题已关闭或有计划',
      'PVT 试产条件已确认',
    ],
    requiredDeliverables: ['首件样品', 'FAI 首件检验报告', '测试程序与治具', '客户签样记录'],
    responsibleRoles: ['ME/工厂负责首件制作', 'QA 负责 FAI 判定', '测试工程负责治具与程序', '客户负责样品签样', '项目经理负责进入试产决策组织'],
    evidenceRequirements: ['FAI 首件检验报告', '测试程序与治具验收记录', '客户签样记录'],
    exceptionStrategy: ['FAI 不合格则整改复检', '客户未签样不得进入 PVT', '治具/程序未就绪需补齐'],
  },
  pvt: {
    entryCriteria: [
      '首件确认 Gate 已通过，小批试产计划已批准',
      'SOP/WI、物料齐套和产线排程已准备',
      '客户放行判定口径和包装/物流验证安排已明确',
    ],
    exitCriteria: [
      '小批试产良率达到目标，关键异常已关闭或受控',
      'SOP/WI、包装与物流验证完成',
      '锂电产品的 UN38.3/MSDS 运输合规证据（客户提供或复用确认）已归档',
      '客户完成放行，MP Release 条件已确认',
    ],
    requiredDeliverables: ['小批试产报告', '良率分析与改善', 'SOP/WI', '包装与物流验证', '客户放行记录', 'UN38.3运输测试报告或复用确认', 'MSDS'],
    responsibleRoles: ['ME/工厂负责试产执行', 'QA 负责质量判定', 'SCM 负责物料与物流', '客户负责放行并提供设计侧认证/运输合规文件', '项目经理负责发布准备推进', '管理层负责 MP Release 决策'],
    evidenceRequirements: ['PVT 试产报告', '良率与改善记录', 'SOP/WI 记录', 'UN38.3/MSDS 或客户复用确认归档', '客户放行记录'],
    exceptionStrategy: ['良率未达标则重复 PVT', '客户未放行不得发布 MP', '包装/物流未验证不得 MP Release', '缺 UN38.3/MSDS 运输合规证据不得出货（出货主体责任在制造商）'],
  },
  mp: {
    entryCriteria: [
      'PVT Gate 已通过，客户 PO/量产授权到位',
      '量产监控、出货质量和售后机制已准备',
      '认证/模具归属确认已归档',
    ],
    exitCriteria: [
      '量产良率和交付达到目标',
      '出货质量和售后进入常态化管理',
      '变更与归属责任清晰，文件完整',
    ],
    requiredDeliverables: ['量产产品', '良率周报', '售后问题跟踪'],
    responsibleRoles: ['工厂/ME 负责产能与工艺', 'QA 负责出货质量', 'SCM 负责供应连续性', '项目经理负责客户交付与爬坡跟踪', '管理层负责量产经营目标'],
    evidenceRequirements: ['MP Release 记录', '周良率/出货数据', 'OQC/RMA 分析'],
    exceptionStrategy: ['重大质量异常启动围堵/停线评估', '良率/交付偏差进入周会跟踪', '归属争议需回到合同对齐'],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// NPD — New Product Development (Full 7-phase)
// ─────────────────────────────────────────────────────────────────────────────
export const NPD_PHASES: SOPPhase[] = [
  {
    id: 'concept',
    code: 'P1',
    name: '概念阶段',
    nameEn: 'Concept',
    duration: '2-4周',
    desc: '市场洞察与产品立项',
    gate: '立项评审 / Project Charter',
    gateTaskId: 'c6',
    color: '#78716c',
    deliverables: ['市场调研报告', '产品概念书', '商业可行性分析', '立项申请书', '认证路线图初判'],
    gateStandard: NPD_GATE_STANDARDS.concept,
    tasks: [
      { id: 'c1', name: '市场调研与竞品分析', desc: '收集市场数据、竞品拆解、定价分析', owner: '产品经理/BD', visibleRoles: ['pm', 'sales', 'manager', 'owner'], guide: '1) 收集 TOP 5 竞品的硬件参数、定价、销量数据\n2) 拆解 2-3 款关键竞品（成本结构、用户评价）\n3) 输出竞品对比矩阵' },
      { id: 'c2', name: '用户需求收集 (VoC)', desc: 'Voice of Customer，用户访谈/问卷', owner: '产品经理/UX', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 至少完成 15 位目标用户的深度访谈\n2) 发布在线问卷，目标样本 ≥ 200\n3) 提炼 Top 10 用户痛点与期望' },
      { id: 'c3', name: '产品概念定义', desc: '核心卖点、目标用户、关键场景', owner: '产品经理', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 撰写一句话产品定义（Elevator Pitch）\n2) 定义 3 个核心卖点（USP）\n3) 绘制用户旅程地图' },
      { id: 'c4', name: '技术可行性评估', desc: '关键技术验证、专利检索、认证路线初判', owner: 'R&D Lead', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'cert', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 列出关键技术挑战清单\n2) 完成核心技术 POC\n3) 进行专利检索与规避分析\n4) 对目标市场认证路线、电池安全和运输硬卡做初判' },
      { id: 'c5', name: '商业可行性分析', desc: '市场规模、定价、利润模型', owner: '产品经理/Finance', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 建立 3 年销量预测模型\n2) 估算目标 BOM 成本与零售价\n3) 计算毛利率、回收期' },
      { id: 'c6', name: '立项评审 (Gate 1)', desc: '正式立项决策评审', owner: '管理层', visibleRoles: [], guide: '评审材料: 1) 产品概念书 2) 市场分析 3) 商业模型 4) 技术评估 5) 资源需求' },
    ],
  },
  {
    id: 'planning',
    code: 'P2',
    name: '规划阶段',
    nameEn: 'Planning',
    duration: '3-4周',
    desc: '产品规格与项目计划',
    gate: 'Kickoff评审',
    gateTaskId: 'p7',
    color: '#a16207',
    deliverables: ['PRD产品需求文档', 'PSD产品规格书', '项目甘特图', 'BOM v0.1', '认证路线图', '电芯复用/定点与二供策略'],
    gateStandard: NPD_GATE_STANDARDS.planning,
    tasks: [
      { id: 'p1', name: '产品需求文档 (PRD)', desc: '完整的功能/非功能需求', owner: '产品经理', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 功能需求（Feature List + User Story）\n2) 非功能需求（性能/安全/合规）\n3) 验收标准（Acceptance Criteria）' },
      { id: 'p2', name: '产品规格书 (PSD)', desc: '技术规格、性能指标', owner: 'R&D', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 硬件规格（主芯片/内存/接口）\n2) 软件规格（OS/协议栈/算法）\n3) 性能指标（功耗/续航/响应时间）\n4) 对锂电、电机、受压腔体定义安全边界和验收指标' },
      { id: 'p3', name: '项目时程规划', desc: '里程碑、关键路径、资源排期', owner: '项目经理/PMO', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 制定 WBS\n2) 标注关键路径与风险节点\n3) 设置 Gate Review 时间点' },
      { id: 'p4', name: 'BOM初版', desc: '关键料件清单，预估成本', owner: 'EE/采购', visibleRoles: ['rd_hw', 'scm', 'pm', 'manager', 'owner'], guide: '1) 列出所有关键器件\n2) 标注供应商、料号、单价\n3) 计算总 BOM 成本\n4) 识别长交期/单一来源器件' },
      { id: 'p5', name: '关键供应商初选', desc: 'IC、屏幕、电池等核心料件', owner: '采购', visibleRoles: ['scm', 'rd_hw', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 每个关键料件至少 2-3 家供应商\n2) 评估：价格/品质/产能/付款条件\n3) 索取样品与报价\n4) 对安全件标注供应商资质、认证资料和替代来源风险' },
      { id: 'p5a', name: '电芯复用/定点与二供策略', desc: '判定复用成熟电芯/电池包或新增定点，明确主供/二供', owner: 'EE/采购/电池安全', visibleRoles: ['rd_hw', 'scm', 'qa', 'cert', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 按产品类型和电池包形态判定复用等级：既有电芯复用、既有电池包复用+适配验证、新电池包或新电芯\n2) 复用 18650/21700/聚合物等成熟电芯时，确认供应商资质、规格书、既有认证和适用边界\n3) 新增或变更电芯/电池包时，定义主供/二供策略、替代料验证范围和切换条件\n4) 输出裁剪建议：复用确认+兼容验证，或完整电芯厂审核+保护方案评审' },
      { id: 'p6a', name: '认证路线图', desc: '目标市场、证书清单、前置依赖和送样节奏', owner: '认证/QA', visibleRoles: ['qa', 'cert', 'battery_safety', 'rd_hw', 'scm', 'pm', 'manager', 'owner'], guide: '1) 按目标市场列出电芯/电池包、运输、整机、EMC、RoHS/REACH 认证清单\n2) 明确 IEC 62133、GB 31241、UL 2054、UN38.3、MSDS、CCC/CE/FCC/PSE/KC 等适用性\n3) 标注卡设计冻结、开模、认证送样、发货/出口的关键依赖\n4) 输出认证样品版本、资料责任人、预计周期和阻塞风险' },
      { id: 'p6', name: '团队组建与资源分配', desc: 'ID/MD/EE/SW/QA/产品经理/项目经理', owner: '项目经理/PMO/HR', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 确认各模块负责人（RACI）\n2) 评估外包/内部资源比例\n3) 培训需求识别' },
      { id: 'p7', name: 'Kickoff会议', desc: '项目正式启动，目标对齐', owner: '项目经理/产品经理', visibleRoles: [], guide: '议程: 1) 项目背景与目标 2) 规格与需求 Walk-through 3) 时程与里程碑 4) 角色与职责' },
    ],
  },
  {
    id: 'design',
    code: 'P3',
    name: '设计阶段',
    nameEn: 'Design',
    duration: '6-12周',
    desc: 'ID/MD/EE/SW并行设计',
    gate: '设计冻结评审 (Design Freeze)',
    gateTaskId: 'd8',
    color: '#0369a1',
    deliverables: ['ID外观图', 'MD结构图', 'PCB原理图&Layout', 'SW架构文档', 'BOM v1.0', '安全FMEA与危害分析', '电芯厂质量审核或复用资质确认', '保护电路设计评审或复用确认'],
    gateStandard: NPD_GATE_STANDARDS.design,
    tasks: [
      { id: 'd1', name: 'ID 工业设计', desc: '外观造型、材质、CMF配色', owner: 'ID', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 草图发散（≥ 10 个方向）\n2) 3 套候选方案精化\n3) CMF（颜色/材质/工艺）定义\n4) 3D 渲染图与实体模型' },
      { id: 'd2', name: 'MD 结构设计', desc: '内部结构、装配、堆叠', owner: 'MD', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 内部空间堆叠（Layout）\n2) 装配工艺设计\n3) 公差分析（Tolerance Stack-up）' },
      { id: 'd3', name: 'EE 电子原理设计', desc: '电源/MCU/传感器/通信架构', owner: 'EE', visibleRoles: ['rd_hw', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 系统框图设计\n2) 原理图绘制（Schematic）\n3) 电源树设计与功耗分析\n4) 定义过充、过放、过流、过温、短路保护链路和测试点' },
      { id: 'd4', name: 'PCB Layout', desc: 'PCB布线、阻抗、EMC考量', owner: 'EE/PCB', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 板层规划与叠层设计\n2) 关键信号阻抗控制\n3) EMC/EMI 设计\n4) DRC 检查' },
      { id: 'd5', name: 'SW 软件架构', desc: 'Firmware架构、通信协议、APP', owner: 'SW', visibleRoles: ['rd_sw', 'pm', 'manager', 'owner'], guide: '1) 系统架构图（固件 + 云 + APP）\n2) 通信协议定义（BLE/WiFi/UART）\n3) OTA 升级方案' },
      { id: 'd6', name: 'DFM/DFA 评审', desc: '可制造/可装配性评审', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 工厂参与评审，识别制造风险\n2) DFM Checklist\n3) DFA Checklist' },
      { id: 'd6a', name: '安全 FMEA 与危害分析', desc: 'DFMEA、热失控、过压爆破、连续工作过热专项分析', owner: 'QA/电池安全/R&D', visibleRoles: ['qa', 'battery_safety', 'rd_hw', 'rd_mech', 'rd_sw', 'cert', 'pm', 'manager', 'owner'], guide: '1) 输出 DFMEA，覆盖锂电、高电流电机和受压腔体失效模式\n2) 对热失控、过压爆破、连续工作过热、误触发和保护失效做危害分析\n3) 定义设计控制、验证项目、判定标准和残余风险责任人\n4) P0/P1 安全风险未关闭不得进入设计冻结' },
      { id: 'd7', name: '关键料件定型', desc: '主芯片、屏、电池规格冻结', owner: 'EE/采购', visibleRoles: ['rd_hw', 'scm', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 完成关键料件 2nd Source 验证\n2) 签订正式供货协议\n3) 锁定料件规格与供货计划\n4) 对电芯、电池包、保护板等安全件单独记录批准版本和限制条件' },
      { id: 'd7a', name: '电芯厂质量审核/复用资质确认', desc: '电芯供应商体系审核，或成熟电芯/平台电池包复用资质确认', owner: 'SCM/QA/电池安全', visibleRoles: ['scm', 'qa', 'battery_safety', 'cert', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 复用已批准电芯厂时，可用平台/年度审核、来料质量、变更记录和报告适用性替代现场全量审核\n2) 新供应商、新电芯、新化学体系、二供切换或报告范围不覆盖时，执行完整电芯厂质量审核\n3) 核对来料标准、批次一致性、变更通知、追溯规则和二供切换要求\n4) 输出复用资质确认或审核结论、整改项、限制条件和批准供应商清单' },
      { id: 'd7b', name: '保护电路设计评审/复用确认', desc: 'BMS/保护板与整机保护链路评审，或成熟方案复用边界确认', owner: 'EE/电池安全', visibleRoles: ['rd_hw', 'battery_safety', 'qa', 'cert', 'pm', 'manager', 'owner'], guide: '1) 复用成熟电池包/PCM/BMS 时，确认负载电流、充电策略、温升路径、电池仓固定和受压腔体工况未超出原边界\n2) 新保护板、新充电方案、结构热路径变化或连续工作条件变化时，执行完整保护电路设计评审\n3) 对过充、过放、过流、过温、短路保护参数和失效安全策略做链路校核\n4) 记录与认证、可靠性和量产 EOL 测试的前置关系' },
      { id: 'd8', name: '设计冻结评审 (Gate 3)', desc: 'Design Freeze，进入打样', owner: '跨部门', visibleRoles: [], guide: '评审: 1) ID/MD/EE/SW 设计完成度 2) BOM 成本 vs 目标 3) 安全 FMEA、电芯复用/审核、保护电路评审/复用确认 4) EVT 计划' },
    ],
  },
  {
    id: 'evt',
    code: 'P4',
    name: 'EVT 工程验证',
    nameEn: 'EVT',
    duration: '4-6周',
    desc: '工程样机功能验证',
    gate: 'EVT评审',
    gateTaskId: 'e7',
    color: '#7c3aed',
    deliverables: ['EVT样机 ≥10台', '功能测试报告', '问题清单 (Issue List)', 'PCB v2'],
    gateStandard: NPD_GATE_STANDARDS.evt,
    tasks: [
      { id: 'e1', name: '工程样机制作', desc: '手工焊接，≥10台用于验证', owner: 'EE/EMS', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) PCBA 打样（≥15 套，含备份）\n2) 整机组装（10-20 台）\n3) 标注样机版本与序号' },
      { id: 'e2', name: '功能测试 (FT)', desc: '所有功能点逐一验证', owner: 'QA/EE', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 撰写 FT Test Plan\n2) 逐项测试，记录 Pass/Fail\n3) Bug 进入 Issue List' },
      { id: 'e3', name: '性能测试 (PT)', desc: '续航、信号、热设计、跌落初测', owner: 'QA/EE', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 续航测试（典型/重度场景）\n2) 无线性能（RF Conducted/Radiated）\n3) 热成像与温升测试' },
      { id: 'e4', name: '软硬件联调', desc: 'Firmware与硬件配合调试', owner: 'SW/EE', visibleRoles: ['rd_sw', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) Bringup\n2) 驱动调试\n3) 协议联调\n4) 异常处理与稳定性优化' },
      { id: 'e5', name: '设计问题清单', desc: '记录bug、设计缺陷、改善方案', owner: '项目经理/QA', visibleRoles: ['pm', 'qa', 'rd_hw', 'rd_sw', 'rd_mech', 'manager', 'owner'], guide: '每个 Issue 包含:\n- 现象描述\n- 根因分析\n- 改善方案\n- 责任人与改善期限' },
      { id: 'e6', name: 'PCB改板 (v2)', desc: '根据EVT问题做PCB改版', owner: 'EE', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 汇总 PCB 相关问题\n2) ECN（工程变更通知）\n3) PCB v2 重新 Layout' },
      { id: 'e7', name: 'EVT评审 (Gate 4)', desc: '是否达到进入DVT条件', owner: '跨部门', visibleRoles: [], guide: '评审标准:\n- 主要功能 Pass Rate ≥ 95%\n- 无 P0 级未解决问题\n- 性能初测达标' },
    ],
  },
  {
    id: 'dvt',
    code: 'P5',
    name: 'DVT 设计验证',
    nameEn: 'DVT',
    duration: '4-8周',
    desc: '设计成熟度全面验证',
    gate: 'DVT评审',
    gateTaskId: 'v8',
    color: '#0f766e',
    deliverables: ['DVT样机 ≥30台', '可靠性测试报告', '认证报告', '模具T1样品', 'PFMEA/CTQ控制计划'],
    gateStandard: NPD_GATE_STANDARDS.dvt,
    tasks: [
      { id: 'v1', name: 'DVT样机制作', desc: '半 SMT产线，≥30台', owner: 'EMS', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 半正式产线 SMT（≥50 PCBA）\n2) 整机组装（≥30 台）\n3) 模拟量产工艺' },
      { id: 'v2', name: '可靠性测试', desc: '跌落/高低温/湿度/震动/老化', owner: 'QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '标准测试矩阵:\n- 跌落 1.5m × 26 面\n- 高低温 -20℃ ~ 60℃\n- 湿热 40℃/95%RH × 96h\n- 振动测试' },
      { id: 'v3', name: '安规与认证', desc: '电池安全、运输、整机、EMC、材料合规', owner: 'QA/认证', visibleRoles: ['qa', 'cert', 'battery_safety', 'rd_hw', 'pm', 'manager', 'owner'], guide: '认证清单:\n- 电芯/电池包安全: IEC 62133、GB 31241、UL 2054 等适用项\n- 运输: UN38.3 + MSDS\n- 整机: CCC（国内强制范围需确认）、CE、FCC、PSE、KC 等目标市场认证\n- EMC、RoHS/REACH、标签/说明书合规\n- 每项记录样品版本、BOM/软硬件版本、报告编号和前置依赖' },
      { id: 'v4', name: '模具T1/T2试模', desc: '塑胶模具开模与试模', owner: 'MD/模厂', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 模具开模（4-6 周）\n2) T1 试模 - 准备认证样品\n3) T2 试模 - 修模\n4) 准备认证样品' },
      { id: 'v5', name: '软件功能完整测试', desc: '回归测试、压力测试', owner: 'SW/QA', visibleRoles: ['rd_sw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 完整回归测试\n2) 压力测试\n3) OTA 升级测试\n4) 多 APP/多设备并发测试' },
      { id: 'v6', name: '包装设计验证', desc: '包装跌落、运输测试', owner: '包装', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '1) 包装结构设计\n2) 包装跌落测试（ISTA 1A/3A）\n3) 运输振动测试\n4) 堆叠压力测试' },
      { id: 'v7', name: '量产工艺评估', desc: '与工厂确认SMT/组装工艺和 PFMEA/CTQ', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) PFMEA 工艺失效模式分析\n2) 关键工艺参数定义（CTQ）\n3) 治具与测试设备清单\n4) 将电池包 EOL、压力/过压保护、连续工作温升等项目纳入量产测试方案' },
      { id: 'v8', name: 'DVT评审 (Gate 5)', desc: '进入PVT前的关键评审', owner: '跨部门', visibleRoles: [], guide: '通过标准:\n- 可靠性测试全部 Pass\n- 认证测试通过\n- 模具尺寸/外观 OK\n- BOM 成本达标' },
    ],
  },
  {
    id: 'pvt',
    code: 'P6',
    name: 'PVT 试产验证',
    nameEn: 'PVT',
    duration: '3-6周',
    desc: '生产工艺与良率验证',
    gate: 'MP准备就绪评审',
    gateTaskId: 'pv8',
    isReleaseGate: true,
    color: '#b45309',
    deliverables: ['试产50-300台', 'SOP/WI作业指导书', '良率报告', '治具与测试程序', 'EOL 100%测试能力验收记录', 'UN38.3运输测试报告或复用确认', 'MSDS', '电芯/电池包安全认证报告或复用确认'],
    gateStandard: NPD_GATE_STANDARDS.pvt,
    tasks: [
      { id: 'pv1', name: '试产规划', desc: '产线排程、物料齐套、人员培训', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'scm', 'pm', 'manager', 'owner'], guide: '1) 试产数量与排程\n2) 物料齐套（BOM 100% Ready）\n3) 产线工位规划\n4) 作业人员培训' },
      { id: 'pv2', name: 'SOP/WI制定', desc: '生产标准作业流程、作业指导书', owner: 'ME/IE', visibleRoles: ['rd_mech', 'qa', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '每工位需输出:\n- SOP（Standard Operating Procedure）\n- WI（Work Instruction）\n- 品质检验标准' },
      { id: 'pv3', name: '治具与测试程序', desc: 'ATE/FCT/老化治具，EOL 100%测试能力', owner: '测试工程', visibleRoles: ['rd_hw', 'qa', 'pe', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) ICT/FCT 治具、老化柜与自动化测试程序\n2) 电池包逐台检测: Hi-pot、绝缘电阻、保护功能、OCV/IR 老化筛选、容量\n3) 充气泵逐台检测: 气压精度、自动停泵/过压保护、连续工作温升\n4) 输出测试限值、误判/漏判验证、GR&R 或等效验收记录' },
      { id: 'pv4', name: '试产 (50-300台)', desc: '按量产工艺试制', owner: '工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '1) 试产首件确认（FAI）\n2) 全程监控良率与异常\n3) 每小时记录 First Pass Yield' },
      { id: 'pv5', name: '良率分析与改善', desc: 'SMT/组装/测试良率追踪', owner: 'QE/ME', visibleRoles: ['qa', 'rd_hw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '良率目标:\n- SMT: ≥ 99%\n- 组装: ≥ 98%\n- FCT: ≥ 97%\n- 整机直通率: ≥ 95%' },
      { id: 'pv6', name: '包装与物流验证', desc: '完整包装、运输、仓储测试', owner: '包装/物流', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '1) 完整包装方案确认\n2) 装箱单 / 唛头设计\n3) 物流路径与运输测试\n4) 保税仓/海外仓方案' },
      { id: 'pv7', name: '品质标准固化', desc: 'IPQC/OQC标准、AQL等级、关键安全/性能限值', owner: 'QA', visibleRoles: ['qa', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) IPQC 制程巡检标准\n2) OQC 出货检验标准（AQL 0.65/1.0/2.5）\n3) 外观检验标准（限度样本）\n4) 固化电池包、气压、自动停泵/过压保护和连续工作温升判定标准' },
      { id: 'pv8', name: 'PVT评审 (Gate 6)', desc: '量产准备就绪（Ready for MP）', owner: '跨部门', visibleRoles: [], guide: '量产 GO 条件:\n- 试产良率达标\n- SOP/WI 完整\n- 治具/产能/EOL 100%测试能力就绪\n- UN38.3、MSDS、电池安全认证证据齐套\n- 物料供应稳定' },
    ],
  },
  {
    id: 'mp',
    code: 'P7',
    name: '量产稳定与移交',
    nameEn: 'MP Stabilization & Handover',
    duration: '2-8周',
    desc: '量产版本发布后的爬坡、稳定性验证与项目关闭移交',
    gate: '项目关闭移交评审',
    gateTaskId: 'mp6',
    isCloseGate: true,
    color: '#166534',
    deliverables: ['量产产品', '良率周报', 'ECN/ECR记录', '售后数据分析'],
    gateStandard: NPD_GATE_STANDARDS.mp,
    tasks: [
      { id: 'mp1', name: '首批量产 (Ramp-up)', desc: '小批量爬坡，监控良率', owner: '工厂/项目经理', visibleRoles: ['scm', 'qa', 'mfg', 'pe', 'pm', 'manager', 'owner'], guide: '1) 首批 1K-5K 爬坡\n2) 日良率监控与异常响应\n3) 关键工位驻厂支持\n4) 客户样品确认' },
      { id: 'mp2', name: '良率监控与改善', desc: '日/周良率追踪、CAR处理', owner: 'QE/工厂', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 每日 SMT/组装/测试良率报告\n2) Pareto 分析 Top 3 异常\n3) CAR 跟进与关闭' },
      { id: 'mp3', name: '产能爬坡', desc: '产能逐步提升至目标产能', owner: '工厂/项目经理', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '产能爬坡曲线:\n- 第 1 月: 30%\n- 第 2 月: 60%\n- 第 3 月: 100%' },
      { id: 'mp4', name: '工程变更管理', desc: 'ECN/ECR评审与执行', owner: '项目经理/CM', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) ECR（变更申请）评估影响\n2) CCB（变更评审委员会）审批\n3) ECN（变更通知）执行与追踪' },
      { id: 'mp5', name: '售后问题跟踪', desc: 'RMA数据、市场反馈、FA分析', owner: '售后/QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 月度 RMA 数据分析\n2) Top 3 失效模式 FA\n3) 客诉响应与改善\n4) 现场质量问题处理' },
      { id: 'mp6', name: '持续改善 (CIP)', desc: '成本优化、质量提升、周期缩短', owner: '跨部门', visibleRoles: [], guide: '改善方向:\n- VAVE 降本\n- 工艺优化提良率\n- 周期 CT 缩短\n- 自动化升级' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ECO — Engineering Change Order (5-phase)
// Small-scope changes such as material replacement, cost-down, quality fix,
// certification correction, or limited design updates.
// ─────────────────────────────────────────────────────────────────────────────
export const ECO_PHASES: SOPPhase[] = [
  {
    id: 'planning',
    code: 'P1',
    name: '变更规划',
    nameEn: 'Change Planning',
    duration: '2-4周',
    desc: '变更范围定义与影响评估',
    gate: 'ECO Kickoff评审',
    gateTaskId: 'ep7',
    color: '#a16207',
    deliverables: ['ECR变更申请书', '影响分析报告', 'BOM差异对比', '变更时程'],
    gateStandard: ECO_GATE_STANDARDS.planning,
    tasks: [
      { id: 'ep1', name: '变更需求分析 (ECR)', desc: '明确变更原因、范围与目标', owner: '产品经理/EE', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 填写 ECR（Engineering Change Request）\n2) 说明变更原因（成本/质量/功能/合规）\n3) 定义变更范围（硬件/软件/结构/包装）' },
      { id: 'ep2', name: '影响范围评估', desc: '评估变更对现有产品的影响', owner: 'EE/QA', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'qa', 'cert', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 影响分析矩阵（功能/可靠性/认证/电池安全/成本）\n2) 识别需要重新测试的项目\n3) 评估是否需要重新认证\n4) 涉及电芯/电池包/保护方案变更或二供切换时，评估电池安全与运输认证影响' },
      { id: 'ep3', name: 'BOM 差异分析', desc: '新旧 BOM 对比，成本核算', owner: 'EE/采购', visibleRoles: ['rd_hw', 'scm', 'pm', 'manager', 'owner'], guide: '1) 新旧 BOM 逐行对比\n2) 计算成本变化（±ΔCost）\n3) 确认新料件供应商与交期' },
      { id: 'ep4', name: '变更时程规划', desc: '里程碑、验证计划、上线时间', owner: '项目经理/PMO', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 制定变更验证计划\n2) 确认各阶段时程\n3) 识别关键路径与风险' },
      { id: 'ep5', name: '资源与供应商确认', desc: '确认变更所需资源与供应商', owner: '采购/ME', visibleRoles: ['scm', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 新料件样品申请\n2) 供应商 NDA/报价确认\n3) 内部资源排期' },
      { id: 'ep6', name: '变更评审委员会 (CCB)', desc: '跨部门评审变更方案', owner: '管理层/跨部门', visibleRoles: ['pm', 'manager', 'owner'], guide: '评审内容:\n1) 变更必要性与收益\n2) 风险与影响\n3) 资源与时程\n4) 正式批准 ECO' },
      { id: 'ep7', name: 'ECO Kickoff (Gate 1)', desc: '变更正式立项，进入设计', owner: '项目经理', visibleRoles: [], guide: '确认事项:\n- ECO 编号与版本\n- 变更范围冻结\n- 团队分工确认\n- 时程基线确认' },
    ],
  },
  {
    id: 'design',
    code: 'P2',
    name: '变更设计',
    nameEn: 'Change Design',
    duration: '3-6周',
    desc: '针对变更内容的设计与验证',
    gate: '设计变更冻结',
    gateTaskId: 'ed6',
    color: '#0369a1',
    deliverables: ['ECN草案/变更设计包', '更新后的原理图/PCB', '更新后的BOM', '变更设计评审报告'],
    gateStandard: ECO_GATE_STANDARDS.design,
    tasks: [
      { id: 'ed1', name: '硬件设计变更', desc: '原理图/PCB/BOM 更新', owner: 'EE', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 更新原理图（Schematic）\n2) PCB Layout 修改\n3) BOM 更新（新料件替换）\n4) 设计 DRC 检查' },
      { id: 'ed2', name: '结构设计变更', desc: '结构/模具/装配变更（如适用）', owner: 'MD', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 结构图纸更新\n2) 模具修改评估（ECO 模具）\n3) 装配工艺变更' },
      { id: 'ed3', name: '软件变更', desc: 'Firmware/APP 适配更新（如适用）', owner: 'SW', visibleRoles: ['rd_sw', 'pm', 'manager', 'owner'], guide: '1) 驱动适配\n2) 功能调整\n3) OTA 升级包准备' },
      { id: 'ed4', name: 'DFM 变更评审', desc: '确认变更后的可制造性', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '1) 工厂确认新工艺可行性\n2) 治具/测试程序更新评估\n3) 产线影响评估' },
      { id: 'ed5', name: '认证影响评估', desc: '判断是否需要重新认证', owner: 'QA/认证', visibleRoles: ['qa', 'cert', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 与认证机构确认变更影响\n2) 如需重新认证，启动认证流程\n3) 更新认证文件\n4) 涉及电池/运输的变更同步评估 UN38.3/MSDS/电池安全证书是否需重出或复用' },
      { id: 'ed6', name: '设计变更冻结 (Gate 2)', desc: '变更设计完成，进入验证', owner: '跨部门', visibleRoles: [], guide: '评审:\n1) 变更设计完整性\n2) BOM 成本确认\n3) 认证计划\n4) 验证计划' },
    ],
  },
  {
    id: 'evt',
    code: 'P3',
    name: 'EVT 变更验证',
    nameEn: 'Change Verification',
    duration: '3-5周',
    desc: '变更内容的功能与性能验证',
    gate: '变更验证评审',
    gateTaskId: 'ev5',
    color: '#7c3aed',
    deliverables: ['变更验证样机', '变更验证报告', '回归测试报告', '问题清单'],
    gateStandard: ECO_GATE_STANDARDS.evt,
    tasks: [
      { id: 'ev1', name: '变更样机制作', desc: '制作变更后的验证样机', owner: 'EE/EMS', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 新 PCBA 打样\n2) 整机组装（≥5 台）\n3) 标注变更版本号' },
      { id: 'ev2', name: '变更点专项验证', desc: '针对变更内容的专项测试', owner: 'QA/EE', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 变更点功能验证\n2) 性能对比测试（新旧对比）\n3) 记录测试数据' },
      { id: 'ev3', name: '回归测试', desc: '确认变更未影响其他功能', owner: 'QA', visibleRoles: ['qa', 'rd_sw', 'pm', 'manager', 'owner'], guide: '1) 核心功能回归测试\n2) 关键性能指标复测\n3) 与基线版本对比' },
      { id: 'ev4', name: '可靠性验证（关键项）', desc: '针对变更点的可靠性测试', owner: 'QA', visibleRoles: ['qa', 'battery_safety', 'cert', 'pm', 'manager', 'owner'], guide: '根据变更影响范围选择:\n- 跌落测试\n- 温度循环\n- 寿命测试\n- 电池/运输/认证相关关键项\n- 其他相关项' },
      { id: 'ev5', name: '变更验证评审 (Gate 3)', desc: '确认变更验证通过，进入试产', owner: '跨部门', visibleRoles: [], guide: '通过标准:\n- 变更点验证 Pass\n- 回归测试无新增问题\n- 可靠性验证达标' },
    ],
  },
  {
    id: 'pvt',
    code: 'P4',
    name: '变更试产',
    nameEn: 'Change PVT',
    duration: '2-4周',
    desc: '变更后的产线验证与切换',
    gate: '变更量产切换评审',
    gateTaskId: 'epv5',
    isReleaseGate: true,
    color: '#b45309',
    deliverables: ['变更试产报告', '更新后的SOP/WI', '产线切换计划', '库存处理方案'],
    gateStandard: ECO_GATE_STANDARDS.pvt,
    tasks: [
      { id: 'epv1', name: '产线变更准备', desc: '治具/物料/SOP 更新', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '1) 更新 SOP/WI\n2) 治具修改或新制\n3) 测试程序更新\n4) 操作人员培训' },
      { id: 'epv2', name: '变更试产', desc: '小批量试产验证产线', owner: '工厂', visibleRoles: ['qa', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '1) 试产数量（≥20 台）\n2) 首件确认（FAI）\n3) 全程良率监控' },
      { id: 'epv3', name: '库存与在制品处理', desc: '旧版本库存处理方案', owner: '项目经理/供应链', visibleRoles: ['scm', 'sales', 'pm', 'manager', 'owner'], guide: '1) 旧版本库存盘点\n2) 消耗计划或报废处理\n3) 在制品切换时间节点' },
      { id: 'epv4', name: 'ECN 正式发布', desc: '发布工程变更通知', owner: '项目经理/CM', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 发布 ECN（Engineering Change Notice）\n2) 通知所有相关部门\n3) 更新产品文件包（BOM/图纸/SOP）' },
      { id: 'epv5', name: '变更量产切换评审 (Gate 4)', desc: '正式切换至变更后版本', owner: '跨部门', visibleRoles: [], guide: '切换 GO 条件:\n- 试产良率达标\n- 库存处理方案确认\n- SOP/WI 更新完成\n- ECN 正式发布' },
    ],
  },
  {
    id: 'mp',
    code: 'P5',
    name: '变更稳定与关闭',
    nameEn: 'MP Monitoring',
    duration: '2-8周',
    desc: '新版本发布后的量产稳定性监控、效果验证与关闭移交',
    gate: '变更关闭评审',
    gateTaskId: 'em4',
    isCloseGate: true,
    color: '#166534',
    deliverables: ['变更后良率报告', '变更效果验证报告', 'ECO关闭报告'],
    gateStandard: ECO_GATE_STANDARDS.mp,
    tasks: [
      { id: 'em1', name: '变更后量产监控', desc: '监控变更后的良率与质量', owner: 'QE/工厂', visibleRoles: ['qa', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '1) 连续 4 周良率数据收集\n2) 与变更前基线对比\n3) 异常快速响应' },
      { id: 'em2', name: '变更效果验证', desc: '确认变更达到预期目标', owner: '产品经理/QA', visibleRoles: ['pm', 'qa', 'manager', 'owner'], guide: '1) 对比变更前后的核心指标\n2) 成本节约核算\n3) 质量改善数据' },
      { id: 'em3', name: '售后影响跟踪', desc: '监控变更后的售后数据', owner: '售后/QA', visibleRoles: ['qa', 'sales', 'pm', 'manager', 'owner'], guide: '1) 变更后 RMA 数据追踪\n2) 与变更前对比\n3) 客诉处理' },
      { id: 'em4', name: 'ECO 关闭评审 (Gate 5)', desc: '确认变更目标达成，正式关闭 ECO', owner: '跨部门', visibleRoles: [], guide: '关闭条件:\n- 变更效果达到预期\n- 无遗留问题\n- 文件归档完整\n- 经验教训总结' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Derivative — Product Iteration / Derivative Development (6-phase)
// Gen 1 -> Gen 2 style upgrades that affect core modules and need EVT/DVT/PVT.
// ─────────────────────────────────────────────────────────────────────────────
export const DERIVATIVE_PHASES: SOPPhase[] = [
  {
    id: 'iteration',
    code: 'P1',
    name: '迭代立项',
    nameEn: 'Iteration Scoping',
    duration: '2-3周',
    desc: '定义大改款/中改款的二代或衍生产品目标，盘点一代基线、旧模块复用边界、升级范围、Gate 深度、BOM/成本和验证策略',
    gate: '迭代 Kickoff评审',
    gateTaskId: 'di6',
    color: '#a16207',
    deliverables: ['迭代需求书', '模块复用策略与影响分析', '迭代项目计划'],
    gateStandard: DERIVATIVE_GATE_STANDARDS.iteration,
    tasks: [
      { id: 'di1', name: '产品定义与代际目标', desc: '明确大改款/中改款的定位、卖点、目标 SKU、成功指标和一代问题复盘', owner: '产品经理', visibleRoles: ['pm', 'sales', 'manager', 'owner'], guide: '1) 定义升级类型：机芯、电池、平台模块、核心结构、性能、续航、成本或质量\n2) 明确目标市场、目标 SKU、上市窗口和成功指标，复盘一代 TOP 问题并列入必改项\n3) 标出本次不是极小 ECO，也不是纯 IDR 外观翻新，而是大改款/中改款的二代或衍生开发项目' },
      { id: 'di2', name: '模块复用与影响分析', desc: '盘点一代基线，按模块判定复用等级，并完成 BOM/资源/供应影响分析（一份文档）', owner: '项目经理', visibleRoles: ['project_manager', 'pm', 'rd_hw', 'rd_sw', 'rd_mech', 'qa', 'scm', 'cert', 'battery_safety', 'manager', 'owner'], guide: '1) 汇总 BOM、图纸、软件、测试报告、认证资料和售后/RMA 数据，输出一代基线资料包\n2) 在「项目设置 → 流程策略」按电池/机芯/PCBA/软件/结构模具/包装认证判定复用等级：直接复用、复用但需适配验证、轻量修改、重新开发；大/中改等级与 Gate 深度由系统按策略自动判定，无需单独复核，Kickoff 评审确认即可\n3) 对直接复用模块记录版本、认证/测试依据、适用边界和复用风险；涉及电芯/电池包/保护方案时定义电池安全和运输认证边界\n4) 对比新旧 BOM（新增/替换/停用/复用），测算成本、MOQ、长交期、NRE/模具费用，确认供应商资质与资源窗口，盘点旧版本库存/在制品/售后备件处理策略' },
      { id: 'di5', name: '迭代计划与裁剪矩阵', desc: '定义 3-5 个月里程碑、样机数量、Gate 节奏和模块级裁剪策略', owner: '项目经理', visibleRoles: ['project_manager', 'pm', 'manager', 'owner'], guide: '1) 制定 3-5 个月里程碑和关键路径\n2) 定义样机轮次、验证矩阵、长交期项和版本切换窗口\n3) 流程裁剪时间点：P1 输出模块复用策略初版，Gate1 冻结复用等级和 Gate 深度；Gate2 设计冻结前复核验证矩阵；EVT Gate 关闭选做/跳过项；DVT Gate 确认 PVT 保留项，之后变化走 ECO/变更记录\n4) 输出风险清单、RACI、阶段计划\n5) 不可裁剪边界：量产发布 Gate、整机回归、安全/认证边界、风险接受人和 DVT/PVT 保留验证项不得删除' },
      { id: 'di6', name: '迭代 Kickoff (Gate 1)', desc: '冻结迭代范围、基线、资源、模块复用策略和项目计划', owner: '项目经理', visibleRoles: [], guide: '评审:\n1) 产品定义、代际目标与一代问题复盘\n2) 模块复用策略与影响分析（含 BOM/成本/供应/认证/电池安全风险）\n3) 系统自动判定的大/中改等级、Gate 深度与不可裁剪边界确认\n4) 项目计划、RACI、交付物清单和阶段验证深度' },
    ],
  },
  {
    id: 'design',
    code: 'P2',
    name: '设计',
    nameEn: 'Design',
    duration: '4-6周',
    desc: '完成受影响模块的单项升级设计、结构设计、投模评审/开模批准、模具开发准备、认证/电池安全路径、DFM/DFT 和验证计划',
    gate: '迭代设计冻结',
    gateTaskId: 'dd10',
    color: '#0369a1',
    deliverables: ['电池/电源升级设计包', '机芯/泵体升级设计包', 'PCBA/主控升级设计包', '软件/固件升级设计包', '结构设计包', 'DFM/DFT/DFMEA评审记录', '投模评审/开模批准记录', '模具开发计划', '升级验证计划'],
    gateStandard: DERIVATIVE_GATE_STANDARDS.design,
    tasks: [
      { id: 'dd1', name: '电池/电源系统升级设计', desc: '电芯、电池包、保护板、充电策略、热路径和电源余量的升级或复用确认', owner: '硬件研发', visibleRoles: ['rd_hw', 'battery_safety', 'qa', 'cert', 'pm', 'manager', 'owner'], guide: '1) 按模块复用策略确认电芯、电池包、保护板、充电策略和热路径是复用、适配验证、轻改还是重新开发\n2) 校核容量、续航、保护阈值、充放电策略、温升、电源余量和安全边界\n3) 输出电池/电源升级设计包、复用边界、验证项目和认证资料责任人\n4) 电芯、电池包、保护方案或热路径变化时，不得裁剪安全验证和运输合规确认' },
      { id: 'dd2', name: '机芯/马达/泵体升级设计', desc: '机芯、马达、泵体、传动、噪音、温升、寿命和性能指标升级设计', owner: '结构研发', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 明确机芯/马达/泵体的复用等级和性能目标\n2) 校核气压/流量、噪音、温升、寿命、驱动余量、装配接口和供应风险\n3) 输出机芯/泵体升级设计包、新旧版本性能差异和专项验证计划\n4) 性能、噪音、温升或寿命边界变化时，专项 EVT/DVT 验证不能省略' },
      { id: 'dd3', name: 'PCBA/电源/主控升级设计', desc: 'PCBA、主控、驱动、电源、传感器和关键 IC 的设计升级或复用确认', owner: '硬件研发', visibleRoles: ['rd_hw', 'rd_sw', 'qa', 'scm', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 更新或确认原理图、PCB、关键 IC、电源树、驱动余量、传感器和测试点\n2) 输出 PCBA/主控升级设计包、BOM v2.0 硬件差异和关键料件批准记录\n3) 确认生产烧录、测试接口、EOL 覆盖和治具影响\n4) 主控、驱动、电源架构或关键 IC 变化时，EVT 专项、软件回归和 EOL 能力确认不得裁剪' },
      { id: 'dd4', name: '软件/固件升级设计', desc: '固件、控制策略、APP/OTA、错误码、生产烧录和测试接口升级设计', owner: '软件研发', visibleRoles: ['rd_sw', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 确认软件/固件、控制策略、保护阈值、APP/OTA、错误码和生产烧录接口的变化范围\n2) 输出软件/固件升级设计包、版本策略、接口清单和回归范围\n3) 定义 EVT/DVT 软件回归、异常恢复、OTA/APP 和生产测试接口验证\n4) 控制策略、保护阈值、OTA/APP 或 EOL 接口变化时，软件完整测试和版本切换不得裁剪' },
      { id: 'dd5', name: '结构设计与装配方案', desc: '外壳、机芯仓、电池仓、按键/接口、堆叠、公差、材料和装配方案设计', owner: '结构研发', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pe', 'pm', 'manager', 'owner'], guide: '1) 输出结构 3D/2D、堆叠、公差、材料、装配关系和关键尺寸\n2) 明确主承力结构、密封、散热、电池仓、跌落和运输保护风险\n3) 评估新开模、修模、治具、检具、限度样本和试模需求\n4) 结构设计完成后才能进入投模评审，不能把结构设计与模具开发合并为一个任务' },
      { id: 'dd6', name: 'DFM/DFT/DFMEA 与验证计划', desc: '完成制造、测试、风险和 EVT/DVT/PVT 验证矩阵评审', owner: 'QA', visibleRoles: ['qa', 'rd_hw', 'rd_sw', 'rd_mech', 'pe', 'mfg', 'cert', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 汇总受影响模块的 DFMEA/风险清单、DFM/DFT、关键 CTQ 和量产测试覆盖\n2) 将模块复用等级绑定到 EVT/DVT/PVT 保留项、选做项、交付物深度和 Gate 深度\n3) 明确安全/认证、整机回归、DVT/PVT 保留验证项和风险接受人\n4) Gate2 前复核流程裁剪矩阵，后续如需减少安全/认证/整机回归项目必须走变更记录' },
      { id: 'dd7', name: '投模评审/开模批准', desc: '确认结构冻结、模具费用、周期、T1/T2 计划和开模条件', owner: '项目经理', visibleRoles: ['project_manager', 'rd_mech', 'pe', 'mfg', 'scm', 'qa', 'pm', 'manager', 'owner'], guide: '1) 评审结构设计包、关键尺寸、公差、外观面、材料、缩水、进胶、顶出、装配和可靠性风险\n2) 确认模具费用、周期、供应商、T1/T2 计划、认证样品需求和项目关键路径影响\n3) 输出投模评审/开模批准记录；未批准不得启动模具开发\n4) 投模是 DRV 的关键时间点，需在项目排期和 Gate 证据中明确留痕' },
      { id: 'dd8', name: '模具开发与 T0 准备', desc: '执行模具开发、T0/T1 准备、试模计划和检具/治具准备', owner: 'PE', visibleRoles: ['pe', 'rd_mech', 'mfg', 'qa', 'scm', 'pm', 'manager', 'owner'], guide: '1) 根据投模批准启动模具开发，跟踪模具进度、T0/T1 试模准备和关键风险\n2) 准备检具、治具、试模材料、试模验证表、尺寸测量方案和外观判定口径\n3) 输出模具开发计划、T0/T1 准备记录和模具问题预警\n4) 模具开发结果进入 DVT T1/T2 验证，不应与结构设计混在同一任务中关闭' },
      { id: 'dd9', name: '认证/电池安全与验证计划', desc: '确认认证补测或复用路径，冻结安全、运输和目标市场验证矩阵', owner: 'QA', visibleRoles: ['qa', 'cert', 'battery_safety', 'rd_hw', 'rd_sw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 判断 UN38.3、MSDS、电芯/电池包安全认证和目标市场认证是否补测、Delta 或复用确认\n2) 涉及电芯/电池包/保护方案、充电策略、热路径、标签、说明书或目标市场变化时定义专项安全/认证验证\n3) 输出送样版本、资料责任人、预计周期、认证路径和验证计划\n4) 与 DFM/DFT/DFMEA 结果一起冻结 EVT/DVT/PVT 验证矩阵' },
      { id: 'dd10', name: '迭代设计冻结 (Gate 2)', desc: '设计输出、投模状态、验证矩阵和 Gate 深度冻结，批准进入 EVT', owner: '项目经理', visibleRoles: [], guide: '评审:\n1) 电池、机芯、PCBA、软件、结构设计包完整性\n2) BOM v2.0、成本、供应、DFMEA/DFM/DFT 和 EOL 测试覆盖\n3) 投模评审/开模批准、模具开发计划和 T1/T2 关键路径\n4) 认证、电池安全、EVT/DVT/PVT 验证矩阵和 Gate 深度\n5) 模块复用策略复核、可裁剪项依据、不可裁剪边界和风险接受人' },
    ],
  },
  {
    id: 'evt',
    code: 'P3',
    name: 'EVT',
    nameEn: 'EVT',
    duration: '3-5周',
    desc: '按模块复用策略验证关键升级模块、整机功能、兼容回归和安全关键项；未受影响模块可减少对应 EVT 专项',
    gate: 'EVT 评审',
    gateTaskId: 'de6',
    color: '#7c3aed',
    deliverables: ['升级EVT样机', '关键模块验证报告', '整机功能与兼容回归报告', '可靠性与安全预验证报告', 'EVT可选项裁剪记录', 'EVT问题关闭清单', 'DVT输入冻结记录'],
    gateStandard: DERIVATIVE_GATE_STANDARDS.evt,
    tasks: [
      { id: 'de1', name: 'EVT 样机制作', desc: '制作升级版本 EVT 样机并标识软硬件/BOM/结构版本', owner: '硬件研发', visibleRoles: ['rd_hw', 'rd_mech', 'qa', 'pm', 'manager', 'owner'], guide: '1) 新 PCBA、机芯、电池包、结构件或模具件打样\n2) 整机组装（建议 ≥10 台，按风险增加）\n3) 记录 Build Record 和异常' },
      { id: 'de2', name: '关键模块专项验证', desc: '针对机芯、电池、硬件、结构/模具等升级模块做专项测试，未受影响模块可选做或减少专项', owner: 'QA', visibleRoles: ['qa', 'rd_hw', 'rd_mech', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 按模块复用策略决定 EVT 专项：重新开发模块必须验证，轻量修改模块做差异验证，直接复用且边界未变模块可减少专项\n2) 机芯升级：性能、噪音、温升、寿命和驱动余量\n3) 电池升级：容量、续航、充放电、保护功能、温升和安全边界；涉及电芯/保护/热路径变化时不可裁剪安全验证\n4) 结构/模具升级：装配、尺寸、跌落、密封、散热和外观\n5) 记录选做/跳过依据、风险接受人和转入 DVT 的保留验证项' },
      { id: 'de3', name: '整机功能与兼容回归', desc: '确认升级未引入核心功能、软件、接口和生产测试回归问题', owner: 'QA', visibleRoles: ['qa', 'rd_sw', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 核心功能回归测试\n2) 关键性能指标复测和新旧版本对比\n3) 软件、APP/OTA、生产烧录和 EOL 测试接口回归\n4) 即使多个模块直接复用，也需保留整机级回归，不能用单模块复用证据替代整机确认' },
      { id: 'de4', name: '可靠性与安全预验证（按风险选做）', desc: '验证升级涉及的可靠性、电池安全、运输和认证前置风险；低风险复用项可减少预验证', owner: 'QA', visibleRoles: ['qa', 'battery_safety', 'cert', 'pm', 'manager', 'owner'], guide: '1) 按升级影响范围选择跌落、振动、温湿度循环、寿命、电池安全、包装保护和认证前置摸底\n2) 直接复用且应用边界未变的结构、电池包、包装或认证项，可减少对应 EVT 预验证\n3) 发生电芯/电池包/保护方案、热路径、主承力结构、目标市场认证或运输边界变化时，不得裁剪相关安全/认证预验证\n4) 减少项需在 EVT 可选项裁剪记录中说明依据，并在 DVT/PVT 保留必要确认' },
      { id: 'de5', name: 'EVT 问题关闭与 DVT 输入冻结', desc: '关闭 EVT 问题，冻结 DVT 样机版本、测试矩阵、模具件输入和保留验证项', owner: '项目经理', visibleRoles: ['project_manager', 'qa', 'rd_hw', 'rd_sw', 'rd_mech', 'pe', 'pm', 'manager', 'owner'], guide: '1) 关闭 EVT P0/P1 问题，未关闭项需有风险接受人、关闭计划和 DVT 影响评估\n2) 冻结 DVT 样机 BOM、软硬件版本、结构版本、模具件输入和测试矩阵\n3) 明确 DVT 保留验证项、可选项关闭结论、T1/T2 依赖和样品需求\n4) 输出 EVT 问题关闭清单和 DVT 输入冻结记录' },
      { id: 'de6', name: 'EVT 评审 (Gate 3)', desc: '确认 EVT 通过，进入 DVT', owner: '项目经理', visibleRoles: [], guide: '通过标准:\n- 关键升级模块验证 Pass 或已有批准的裁剪依据\n- 整机功能与兼容回归无新增重大问题\n- EVT 可选项裁剪记录、风险接受人和 DVT 保留验证项已确认\n- DVT 样机版本、测试矩阵和模具件输入已冻结' },
    ],
  },
  {
    id: 'dvt',
    code: 'P4',
    name: 'DVT',
    nameEn: 'DVT',
    duration: '4-8周',
    desc: '使用模具件和冻结版本按 Gate 深度完成可靠性、认证、电池安全、软件、包装和 PVT 准备验证',
    gate: 'DVT 评审',
    gateTaskId: 'dv7',
    color: '#0f766e',
    deliverables: ['升级DVT样机', 'T1试模报告', '模具问题清单', 'T2/修模验证报告', '限度样本', '可靠性测试报告', '认证补测/复用确认', '软件完整测试报告', '包装与物流验证报告', 'DVT问题关闭清单'],
    gateStandard: DERIVATIVE_GATE_STANDARDS.dvt,
    tasks: [
      { id: 'dv1', name: 'DVT 样机制作', desc: '按冻结设计、模具件、软硬件版本和 BOM 制作 DVT 样机', owner: 'PE', visibleRoles: ['pe', 'mfg', 'rd_hw', 'rd_mech', 'qa', 'pm', 'manager', 'owner'], guide: '1) 使用冻结版 PCBA、软件、BOM、结构件和模具件组装 DVT 样机\n2) 标注样机版本、供应商批次、Build Record、测试用途和认证/可靠性样品分配\n3) 确认装配工艺、关键尺寸、首件结果和 DVT 测试可用性\n4) DVT 样机制作依赖 EVT 评审通过和 T1 试模输入，不应绕过模具件状态' },
      { id: 'dv2', name: 'T1 试模与模具问题清单', desc: '完成 T1 试模、尺寸/外观/装配检查和模具问题清单', owner: '结构研发', visibleRoles: ['rd_mech', 'pe', 'qa', 'mfg', 'pm', 'manager', 'owner'], guide: '1) 执行 T1 试模，检查尺寸、外观面、披锋、缩水、变形、装配、公差、密封和关键 CTQ\n2) 形成模具问题清单、修模建议、责任人、完成时间和 DVT 样机使用限制\n3) 确认可用于认证/可靠性的样品版本和风险\n4) T1 问题清单是 DVT Gate 必要证据，不能以“结构设计已完成”替代' },
      { id: 'dv3', name: 'T2/修模验证与限度样本', desc: '验证修模结果、冻结关键外观/尺寸限度样本和量产判定口径', owner: '结构研发', visibleRoles: ['rd_mech', 'pe', 'qa', 'mfg', 'pm', 'manager', 'owner'], guide: '1) 跟进 T2 或修模验证，确认 T1 问题关闭、尺寸稳定、外观可接受和装配风险受控\n2) 建立限度样本、关键尺寸检验口径、模具验收状态和遗留问题受控计划\n3) 输出 T2/修模验证报告、限度样本和量产判定口径\n4) 若结构/模具直接复用且边界未变，可用复用证据替代 T2；但有修模或新开模时不得裁剪' },
      { id: 'dv4', name: '可靠性/安全/认证验证', desc: '按复用深度完成环境、机械、寿命、电池安全、运输和认证验证', owner: 'QA', visibleRoles: ['qa', 'cert', 'battery_safety', 'rd_hw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 按升级影响执行跌落、振动、温湿度循环、寿命、耐久、温升、电池安全和关键模块专项可靠性\n2) 提交目标市场认证补测或复用确认资料\n3) 完成 UN38.3、MSDS、电芯/电池包安全认证或复用有效性确认\n4) 记录报告编号、样品版本、上市限制和 Gate 放行条件' },
      { id: 'dv5', name: '软件/包装/物流完整验证', desc: '完成固件/APP/OTA/生产烧录、包装运输和渠道标签验证', owner: '软件研发', visibleRoles: ['rd_sw', 'qa', 'scm', 'sales', 'pm', 'manager', 'owner'], guide: '1) 完成软件完整回归、压力测试、异常恢复、OTA/APP、生产烧录和 EOL 接口验证\n2) 按模块复用深度完成包装跌落、运输振动、堆码和渠道标签验证\n3) 确认包装资料、说明书、标签和区域市场资料一致\n4) 软件或包装直接复用时仍需保留版本一致性与发布资料确认' },
      { id: 'dv6', name: 'DVT 问题关闭与 PVT 准备', desc: '关闭 DVT 问题，确认 PVT 试产条件、物料、文件和保留项', owner: '项目经理', visibleRoles: ['project_manager', 'pm', 'qa', 'rd_hw', 'rd_sw', 'rd_mech', 'pe', 'mfg', 'scm', 'manager', 'owner'], guide: '1) 关闭 DVT P0/P1 问题，未关闭项需有风险接受人和受控计划\n2) 确认 PVT 试产数量、物料齐套、产线窗口、治具/EOL 能力和培训计划\n3) 冻结进入 PVT 的保留验证项、版本文件和发布约束\n4) 输出 DVT 问题关闭清单和 PVT Readiness 清单' },
      { id: 'dv7', name: 'DVT 评审 (Gate 4)', desc: 'DVT 通过并批准进入 PVT', owner: '项目经理', visibleRoles: [], guide: '通过标准:\n- 可靠性、认证、电池安全、T1/T2 或修模验证、软件和包装验证达到对应 Gate 深度\n- 无未关闭 P0/P1 问题，或已有明确风险接受人与受控计划\n- PVT 保留项、试产条件和物料计划确认' },
    ],
  },
  {
    id: 'pvt',
    code: 'P5',
    name: 'PVT',
    nameEn: 'PVT',
    duration: '3-5周',
    desc: '小批试产、生产文件固化、EOL 能力验收和版本切换',
    gate: '迭代量产发布评审',
    gateTaskId: 'dp6',
    isReleaseGate: true,
    color: '#b45309',
    deliverables: ['PVT试产计划', 'SOP/WI与检验标准更新', '治具/EOL测试程序验收', 'EOL 100%测试能力验收记录', '升级试产报告', '试产问题关闭报告', '良率改善报告', '版本切换与库存处理方案', '认证补测/复用确认', 'UN38.3运输测试报告或复用确认', 'MSDS', '电芯/电池包安全认证报告或复用确认'],
    gateStandard: DERIVATIVE_GATE_STANDARDS.pvt,
    tasks: [
      { id: 'dp1', name: 'PVT 试产准备', desc: '试产排程、物料齐套、SOP/WI、检验标准、培训和质量口径', owner: 'PE', visibleRoles: ['pe', 'mfg', 'qa', 'rd_mech', 'rd_hw', 'scm', 'pm', 'manager', 'owner'], guide: '1) 定义试产数量、排程、Build Record、版本标识和首件计划\n2) 更新 SOP/WI、工艺参数、检验标准、限度样本和培训记录\n3) 确认 BOM 齐套、人员培训、关键质量标准和良率统计口径' },
      { id: 'dp2', name: '治具/EOL 与首件验收', desc: '验证治具、检具、烧录、老化、EOL 100% 测试能力和首件条件', owner: 'QA', visibleRoles: ['qa', 'pe', 'rd_hw', 'battery_safety', 'mfg', 'pm', 'manager', 'owner'], guide: '1) 验收 ICT/FCT/老化/烧录/EOL 测试程序\n2) 电池包逐台检测保护功能、OCV/IR、容量或等效项目\n3) 完成首件确认、关键工位参数确认、EOL 100% 测试项目、限值、误判/漏判和 GR&R/验收记录' },
      { id: 'dp3', name: '小批试产', desc: '按量产工艺验证良率、一致性、关键性能和制造稳定性', owner: '工厂', visibleRoles: ['mfg', 'qa', 'pe', 'rd_hw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 试产数量建议 50-300 台，按模块风险调整\n2) 执行首件确认、Build Record、全流程工位记录和异常收集\n3) 监控直通率、测试失败、返修、外观、关键性能一致性和节拍\n4) 输出升级试产报告、分工位良率、FPY 和问题清单' },
      { id: 'dp4', name: '试产问题关闭与良率改善', desc: '关闭试产关键问题，验证改善措施和 MP 放行良率', owner: 'QA', visibleRoles: ['qa', 'mfg', 'pe', 'rd_hw', 'rd_mech', 'project_manager', 'pm', 'manager', 'owner'], guide: '1) 对试产 P0/P1 和 Top 良率问题做根因分析、围堵、改善和复验\n2) 输出 Pareto、改善前后良率、关键异常关闭证据和进入 MP 的开放项受控计划\n3) 对安全、认证、EOL、模具件或软件版本相关异常做专项放行确认\n4) 试产问题未关闭或良率未达目标，不得仅靠 Gate 豁免直接发布' },
      { id: 'dp5', name: '版本切换与文件发布', desc: '发布 Rev B/二代文件包，确认库存、渠道、客户和认证资料切换', owner: '项目经理', visibleRoles: ['project_manager', 'pm', 'qa', 'scm', 'pe', 'mfg', 'sales', 'manager', 'owner'], guide: '1) 发布 BOM、图纸、软件、SOP/WI、检验标准、包装标签和测试程序\n2) 确认旧版本库存、在制品、售后备件、渠道和客户通知方案\n3) 归档认证、UN38.3、MSDS、电池安全、标签、说明书和系统资料同步记录\n4) 明确版本生效日期、回滚条件和售后识别方式' },
      { id: 'dp6', name: '迭代量产发布评审 (Gate 5)', desc: '批准迭代版本进入 MP', owner: '项目经理', visibleRoles: [], guide: '发布 GO 条件:\n- PVT 良率和质量达标，试产问题关闭与良率改善完成\n- SOP/WI、检验标准、治具和 EOL 测试能力就绪\n- 认证、UN38.3、MSDS、电池安全证据齐套或复用确认有效\n- 版本切换和库存处理方案确认' },
    ],
  },
  {
    id: 'mp',
    code: 'P6',
    name: '迭代稳定与关闭',
    nameEn: 'MP Monitoring',
    duration: '2-8周',
    desc: '迭代版本量产爬坡、目标达成验证、售后跟踪和项目关闭',
    gate: '迭代关闭评审',
    gateTaskId: 'dm3',
    isCloseGate: true,
    color: '#166534',
    deliverables: ['升级后良率报告', '升级目标达成验证报告', '市场与售后影响跟踪报表', '迭代项目关闭报告'],
    gateStandard: DERIVATIVE_GATE_STANDARDS.mp,
    tasks: [
      { id: 'dm1', name: '量产监控与目标达成', desc: '监控升级版本良率、质量、安全、交付表现，并确认升级目标达成', owner: 'QA', visibleRoles: ['qa', 'pe', 'mfg', 'pm', 'sales', 'manager', 'owner'], guide: '1) 连续 4 周或首批订单收集良率、OQC、返修、交付和客户反馈数据\n2) 与一代基线版本对比性能、续航、噪音、成本、可靠性、FPY、返修、测试失败和客诉\n3) 复核认证/标签/说明书/市场资料是否与升级版本一致\n4) 对异常执行快速围堵、根因分析和 CAPA，输出未达目标项的补充计划' },
      { id: 'dm2', name: '市场与售后影响跟踪', desc: '监控迭代版本上市后的售后、客户、渠道和版本切换反馈', owner: '销售', visibleRoles: ['sales', 'qa', 'scm', 'pm', 'manager', 'owner'], guide: '1) 迭代后 RMA、客诉、退换货和渠道反馈追踪\n2) 与一代基线版本做同周期对比\n3) 对客户、区域市场、特殊渠道或库存切换问题做闭环' },
      { id: 'dm3', name: '迭代关闭评审 (Gate 6)', desc: '确认升级目标达成并正式关闭项目', owner: '项目经理', visibleRoles: [], guide: '关闭条件:\n- 升级目标达到预期或遗留项已形成受控计划\n- 无新增重大质量、安全、认证或售后风险\n- 版本文件、测试报告、试产和量产数据归档完整' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// IDR — ID Refresh / Appearance-Led Redesign (5-phase, including stabilization/close)
// Appearance refresh for existing products. It may trigger ID, MD, EE, new
// material procurement, packaging, manufacturing, and certification work.
// ─────────────────────────────────────────────────────────────────────────────
export const IDR_PHASES: SOPPhase[] = [
  {
    id: 'design',
    code: 'P1',
    name: '翻新范围评估',
    nameEn: 'Refresh Scoping',
    duration: '2-3周',
    desc: '定义外观翻新范围，评估 ID/结构/硬件/物料/认证影响',
    gate: 'IDR Kickoff评审',
    gateTaskId: 'ir6',
    color: '#0369a1',
    deliverables: ['IDR翻新 brief', '现有设计基线包', '影响分析矩阵', 'BOM差异与新物料清单', '认证路径预判', '项目计划'],
    gateStandard: IDR_GATE_STANDARDS.design,
    tasks: [
      { id: 'ir1', name: '翻新需求与边界定义', desc: '明确目标市场、目标 SKU、上市窗口和翻新边界', owner: '产品经理/ID', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 定义翻新目标（外观升级/渠道定制/成本/合规）\n2) 锁定目标 SKU、目标市场和上市窗口\n3) 说明是否涉及外壳、按键、接口、铭牌、包装或内部堆叠' },
      { id: 'ir2', name: '现有设计基线盘点', desc: '收集旧版 ID/MD/EE/BOM/包装/认证资料', owner: '项目经理/CM', visibleRoles: ['pm', 'rd_mech', 'rd_hw', 'qa', 'scm', 'manager', 'owner'], guide: '1) 汇总当前 ID 图、结构图、BOM、包装、标签和认证资料\n2) 确认当前量产问题、售后问题和客户限制\n3) 标记不可变更项与可优化项' },
      { id: 'ir3', name: '跨专业影响评估', desc: '评估外观翻新对结构、硬件、散热、装配和性能的影响', owner: 'MD/EE/QA', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'cert', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) MD 评估外壳、模具、按键、密封、堆叠和装配影响\n2) EE 评估接口、线束、天线/RF、充电、电池空间、EMC 和测试影响\n3) QA 评估可靠性、安规、包装运输和售后识别风险' },
      { id: 'ir4', name: '新物料与供应策略', desc: '识别新外观件、包装、标签和潜在电子/结构料件', owner: 'SCM/采购', visibleRoles: ['scm', 'rd_mech', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 建立新旧 BOM 差异清单\n2) 确认新料号、供应商、MOQ、交期、报价和备选来源\n3) 对长交期、单一来源和认证相关物料建立风险计划' },
      { id: 'ir5', name: '认证路径预判', desc: '判断是否需要 Delta 认证、补测或重新认证', owner: 'QA/认证', visibleRoles: ['qa', 'cert', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 按目标市场列出已有证书和报告\n2) 判断外壳、标签、电池、充电、RF/EMC、材料和包装变化对认证的影响\n3) 与认证机构或内部合规负责人确认送样、资料和周期' },
      { id: 'ir6', name: 'IDR Kickoff (Gate 1)', desc: '冻结翻新范围，批准进入跨专业设计', owner: '跨部门', visibleRoles: [], guide: '评审:\n1) 翻新范围和排除范围\n2) ID/MD/EE/SCM/QA/认证影响矩阵\n3) 新物料、成本和认证路径\n4) 项目计划、RACI 和 Gate 节奏' },
    ],
  },
  {
    id: 'engineering',
    code: 'P2',
    name: '跨专业设计',
    nameEn: 'Cross-Functional Design',
    duration: '4-8周',
    desc: '完成 ID/CMF、结构、硬件适配、包装标签、BOM 和供应商打样',
    gate: '设计冻结评审',
    gateTaskId: 'id7',
    color: '#7c3aed',
    deliverables: ['ID/CMF设计包', 'MD结构图纸', '硬件影响确认', '包装/标签设计稿', '更新BOM', '供应商样件'],
    gateStandard: IDR_GATE_STANDARDS.engineering,
    tasks: [
      { id: 'id1', name: 'ID/CMF 详细设计', desc: '外观造型、颜色、材质和表面工艺定义', owner: 'ID', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 输出外观方案、3D 渲染和 CMF 规格\n2) 定义颜色标准、材质牌号、纹理、光泽度和表面处理\n3) 准备实体色板、手板或样件用于评审' },
      { id: 'id2', name: '结构与模具设计', desc: '外壳、按键、接口、散热、堆叠和模具影响设计', owner: 'MD', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 更新 3D/2D 图纸、装配关系和公差\n2) 检查电池仓、气泵/马达、风道、接口、螺丝柱、密封和跌落风险\n3) 评估新开模、修模、治具和装配工艺影响' },
      { id: 'id3', name: '硬件适配确认', desc: '确认外观改版对 PCBA、接口、电源和射频性能的影响', owner: 'EE', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 检查 PCBA 固定、连接器、按键/屏幕/灯位、线束和测试点\n2) 评估充电口、电池、保护电路、温升、EMC/RF 和传感器开孔影响\n3) 如需硬件小改，输出原理图/PCB/BOM 更新和验证计划' },
      { id: 'id4', name: '包装/标签/铭牌设计', desc: '更新包装、说明书、机身标签和合规标识', owner: '包装/法规', visibleRoles: ['scm', 'qa', 'pm', 'manager', 'owner'], guide: '1) 更新包装结构、平面、说明书和装箱资料\n2) 确认机身铭牌、警示语、认证标识、批次编码和售后识别规则\n3) 评估电池运输资料、渠道标签和客户定制标签影响' },
      { id: 'id5', name: 'BOM/图纸/ECN 草案', desc: '建立新版本料号、图纸版本和工程变更文件包', owner: '项目经理/CM', visibleRoles: ['pm', 'rd_mech', 'rd_hw', 'scm', 'qa', 'manager', 'owner'], guide: '1) 输出新旧 BOM 差异、料号申请和版本规则\n2) 更新图纸、规格书、包装文件和检验标准草案\n3) 准备 ECN/版本切换草案，明确旧料处理方式' },
      { id: 'id6', name: '供应商打样与FAI', desc: '完成新物料样件、包装样和首件确认', owner: 'SCM/MD/QA', visibleRoles: ['scm', 'rd_mech', 'qa', 'pm', 'manager', 'owner'], guide: '1) 组织外观件、结构件、标签、包装和相关电子料件打样\n2) 做颜色、纹理、尺寸、装配、功能和关键尺寸首件确认\n3) 记录样件问题、整改责任人和下一版样品计划' },
      { id: 'id7', name: '设计冻结评审 (Gate 2)', desc: '设计输出冻结，进入验证与认证', owner: '跨部门', visibleRoles: [], guide: '评审:\n1) ID/结构/硬件/包装设计完整性\n2) BOM 成本、供应商和交期\n3) 验证样机 Build Plan\n4) 认证送样和补测计划' },
    ],
  },
  {
    id: 'dvt',
    code: 'P3',
    name: '验证与认证',
    nameEn: 'DVT & Certification',
    duration: '4-8周',
    desc: '验证外观、结构、硬件回归、包装和认证更新',
    gate: '验证与认证评审',
    gateTaskId: 'iv7',
    color: '#0f766e',
    deliverables: ['验证样机', '可靠性/回归测试报告', '认证更新记录', '包装验证报告', '外观检验标准'],
    gateStandard: IDR_GATE_STANDARDS.dvt,
    tasks: [
      { id: 'iv1', name: '验证样机制作', desc: '按冻结版本制作整机样机和认证样品', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 使用冻结版外观件、结构件、包装和电子料件制作样机\n2) 标注样机版本、BOM 版本、供应商批次和用途\n3) 按测试、认证、客户确认和备份需求分配样机' },
      { id: 'iv2', name: '结构与装配验证', desc: '验证新外观件与内部件、工艺和治具的匹配', owner: 'MD/ME', visibleRoles: ['rd_mech', 'qa', 'pm', 'manager', 'owner'], guide: '1) 检查装配良率、关键尺寸、公差、干涉、密封和跌落风险\n2) 验证按钮、接口、屏幕/灯位、出风/进风/散热开孔和铭牌位置\n3) 记录修模、治具或工艺调整项' },
      { id: 'iv3', name: '功能与性能回归', desc: '确认外观改版未影响核心功能和电气性能', owner: 'QA/EE', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 回归核心功能、充电/放电、按键/显示/传感器和保护功能\n2) 复测温升、续航、噪音、气压/流量、EMC/RF 等受影响项目\n3) 与量产基线版本做关键指标对比' },
      { id: 'iv4', name: '可靠性与外观耐久测试', desc: '验证新材料、涂装、结构和包装可靠性', owner: 'QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '测试项目按影响范围选择:\n- 跌落/振动/高低温/湿热/老化\n- 耐磨、耐汗液、耐化学品、UV 老化、盐雾\n- 包装跌落、运输振动、堆码\n- 新材料环保与相容性检查' },
      { id: 'iv5', name: '认证更新或重新认证', desc: '完成目标市场认证补测、Delta 或重新认证', owner: 'QA/认证', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 向认证机构提交变更说明、差异清单、图纸、BOM、标签和样品\n2) 按结论执行安规、EMC/RF、电池、材料、包装或标签相关补测\n3) 归档证书、报告、豁免说明和上市限制' },
      { id: 'iv6', name: '外观检验标准制定', desc: '制定新版本 AQL、限度样本和 OQC 标准', owner: 'QA/ID', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 定义颜色、纹理、光泽、划伤、色差、脏污、披锋和装配间隙标准\n2) 制作限度样本，明确光源、角度、距离和判定责任人\n3) 更新 IPQC/OQC 检验表和客户验货标准' },
      { id: 'iv7', name: '验证与认证评审 (Gate 3)', desc: '验证和认证通过，进入试产切换', owner: '跨部门', visibleRoles: [], guide: '通过标准:\n- 可靠性、结构装配和功能回归 Pass\n- 认证更新/补测/重新认证结论完成\n- 外观检验标准和限度样本完成\n- 试产物料、SOP/WI 和切换计划准备就绪' },
    ],
  },
  {
    id: 'mp',
    code: 'P4',
    name: '试产与量产切换',
    nameEn: 'MP Launch',
    duration: '3-6周',
    desc: '完成新版本试产、物料切换、文件发布和上市准备',
    gate: 'MP Release评审',
    gateTaskId: 'im6',
    isReleaseGate: true,
    color: '#166534',
    deliverables: ['试产/首批量产产品', 'PVT或首批质量报告', 'SOP/WI更新记录', '版本切换计划', '市场上市计划'],
    gateStandard: IDR_GATE_STANDARDS.mp,
    tasks: [
      { id: 'im1', name: '试产切换准备', desc: '准备新物料、SOP/WI、治具、测试程序和培训', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'scm', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '1) 确认新物料齐套、版本标识和首批采购计划\n2) 更新 SOP/WI、检验标准、治具、测试程序和包装作业指导\n3) 完成产线、IQC/IPQC/OQC 和售后识别培训' },
      { id: 'im2', name: '小批试产/首批确认', desc: '按量产工艺验证良率、外观和功能稳定性', owner: '工厂/QA', visibleRoles: ['qa', 'rd_mech', 'rd_hw', 'mfg', 'pe', 'pm', 'manager', 'owner'], guide: '1) 执行小批试产或首批量产确认\n2) 统计装配良率、外观合格率、测试良率和包装异常\n3) 对关键异常做原因分析、围堵和整改关闭' },
      { id: 'im3', name: '物料与库存切换', desc: '处理旧版库存、在制品、采购订单和系统版本', owner: '项目经理/SCM', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '1) 盘点旧外观件、包装、标签、成品和在制品\n2) 制定消耗、返工、隔离、报废或渠道限制方案\n3) 更新 ERP/PLM/MES 版本、BOM 生效日期和采购切换节点' },
      { id: 'im4', name: '文件与认证资料发布', desc: '发布 ECN、图纸、BOM、检验标准和认证资料', owner: '项目经理/CM/QA', visibleRoles: ['pm', 'qa', 'scm', 'manager', 'owner'], guide: '1) 发布 ECN/版本切换通知\n2) 归档图纸、BOM、包装、标签、SOP/WI、检验标准和认证文件\n3) 通知工厂、供应商、销售、售后和客户相关窗口' },
      { id: 'im5', name: '市场与渠道切换', desc: '同步新版本图片、文案、包装和售后识别规则', owner: '产品经理/市场/销售', visibleRoles: ['pm', 'sales', 'manager', 'owner'], guide: '1) 更新产品图片、详情页、说明书、包装图和渠道资料\n2) 明确新旧版本命名、SKU、条码、销售区域和上市日期\n3) 向销售、客服和售后说明版本差异和识别方式' },
      { id: 'im6', name: 'MP Release评审 (Gate 4)', desc: '批准新版本量产和正式上市', owner: '跨部门', visibleRoles: [], guide: 'Release 条件:\n- 试产或首批质量 OK\n- 良率、外观合格率和关键功能达标\n- 新旧物料和系统切换完成\n- 文件、认证、市场和渠道资料发布完成' },
    ],
  },
  {
    id: 'stabilization',
    code: 'P5',
    name: '上市稳定与关闭',
    nameEn: 'Launch Stabilization & Close',
    duration: '2-8周',
    desc: '新外观版本发布后的首批稳定、渠道反馈与项目移交关闭',
    gate: 'IDR 项目关闭移交评审',
    gateTaskId: 'is4',
    isCloseGate: true,
    color: '#15803d',
    deliverables: ['首批量产稳定性报告', '市场与渠道反馈清单', '版本资料移交清单', 'IDR项目关闭报告'],
    gateStandard: {
      entryCriteria: ['量产版本已正式发布', '首批量产与渠道反馈窗口已启动'],
      exitCriteria: ['连续稳定窗口内无新增重大质量/认证问题', '资料、售后识别与遗留项完成移交'],
      requiredDeliverables: ['首批量产稳定性报告', '市场与渠道反馈清单', '版本资料移交清单', 'IDR项目关闭报告'],
      responsibleRoles: ['QA/工厂负责首批稳定结论', '产品经理/销售负责渠道反馈', 'SCM负责库存与供应切换', '项目经理/管理层负责关闭移交'],
      evidenceRequirements: ['首批良率/客诉数据', '遗留项责任人与截止日期', '产品运营接收确认'],
      exceptionStrategy: ['重大质量、安全或认证风险未关闭不得归档', '稳定窗口不足时延长观察期'],
    },
    tasks: [
      { id: 'is1', name: '首批稳定性监控', desc: '跟踪首批良率、返修、客诉和渠道异常', owner: 'QA/工厂', visibleRoles: ['qa', 'mfg', 'pe', 'pm', 'manager', 'owner'], guide: '1) 连续 2-8 周跟踪良率、返修和客诉\n2) 对异常完成围堵、根因与复验\n3) 输出稳定性结论' },
      { id: 'is2', name: '市场与渠道反馈关闭', desc: '确认版本识别、上市资料和渠道反馈已闭环', owner: '产品经理/销售', visibleRoles: ['pm', 'sales', 'qa', 'manager', 'owner'], guide: '1) 汇总上市与渠道反馈\n2) 核对新旧版本识别和售后话术\n3) 将遗留改进转入受控 ECO' },
      { id: 'is3', name: '产品运营移交', desc: '移交版本、认证、供应、售后和遗留项责任', owner: '项目经理/SCM', visibleRoles: ['project_manager', 'scm', 'qa', 'pm', 'manager', 'owner'], guide: '1) 移交冻结版本与认证资料\n2) 明确供应、售后和证书维护责任\n3) 记录遗留项负责人和截止日期' },
      { id: 'is4', name: 'IDR 项目关闭移交评审 (Gate 5)', desc: '确认稳定目标和移交完成后正式关闭项目', owner: '跨部门', visibleRoles: [], guide: '关闭条件:\n- 稳定窗口达标\n- 无重大开放风险\n- 产品运营完成接收\n- 项目经验与资料归档完整' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// JDM — Joint Design Manufacture / 客户委托设计 (6-phase)
// 客户出 ID/规格；工厂做 MD+EE+SW 并量产。= NPD 砍掉概念/规划，换「设计输入冻结」
// 入口闸，并在 EVT/DVT/PVT 强制客户签核（签核以必交付物落地）。
// ─────────────────────────────────────────────────────────────────────────────
export const JDM_PHASES: SOPPhase[] = [
  {
    id: 'input',
    code: 'P1',
    name: '设计输入冻结',
    nameEn: 'Design Input Freeze',
    duration: '2-3周',
    desc: '接收并冻结客户 ID/CMF/规格输入',
    gate: '输入冻结评审',
    gateTaskId: 'jin5',
    color: '#78716c',
    deliverables: ['ID/CMF 输入包', '规格确认书（客户签字）', 'RACI 责任矩阵', '初步 BOM 与 NRE/模具方案', '项目计划'],
    gateStandard: JDM_GATE_STANDARDS.input,
    tasks: [
      { id: 'jin1', name: '接收客户 ID/CMF/规格输入', desc: '汇总并核对客户提供的外观与规格资料', owner: '项目经理', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 接收 ID/CMF 文件与规格书\n2) 核对完整性与版本\n3) 登记缺口清单' },
      { id: 'jin2', name: '设计边界与 RACI 确认', desc: '明确工厂/客户责任分工与设计边界', owner: '项目经理', visibleRoles: ['pm', 'manager', 'owner'], guide: '1) 划定 MD/EE/SW 设计边界\n2) 输出 RACI 责任矩阵\n3) 与客户对齐确认' },
      { id: 'jin3', name: '可行性与初步 DFM', desc: '评估设计可行性与可制造性', owner: 'R&D Lead', visibleRoles: ['rd_hw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 关键技术可行性判断\n2) 初步 DFM 风险\n3) 输出可行性结论' },
      { id: 'jin4', name: '报价 / NRE / 模具方案确认', desc: '确认 NRE、模具方案与报价', owner: 'SCM/采购', visibleRoles: ['scm', 'sales', 'pm', 'manager', 'owner'], guide: '1) NRE 与模具方案\n2) 初步 BOM 成本\n3) 报价确认' },
      { id: 'jin5', name: '输入冻结评审 (Gate 1, 客户确认)', desc: '冻结设计输入，客户书面确认', owner: '跨部门', visibleRoles: [], guide: '评审:\n1) 输入完整性\n2) 规格确认书签字\n3) RACI 与初步 BOM/NRE\n4) 项目计划' },
    ],
  },
  {
    id: 'design',
    code: 'P2',
    name: '详细设计',
    nameEn: 'Detailed Design',
    duration: '5-9周',
    desc: 'MD/EE/SW 并行设计与外观一致性落地',
    gate: '设计冻结评审 + 客户外观签核',
    gateTaskId: 'jd7',
    color: '#0369a1',
    deliverables: ['MD 结构图纸', 'EE 原理图 & PCB Layout', 'SW 架构文档', 'BOM v1.0', '客户外观签核记录'],
    gateStandard: JDM_GATE_STANDARDS.design,
    tasks: [
      { id: 'jd1', name: 'MD 结构设计', desc: '内部结构、装配与外观件落地', owner: 'MD', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 结构 3D/2D\n2) 装配工艺\n3) 外观件还原客户 ID' },
      { id: 'jd2', name: 'EE 原理设计', desc: '电源/MCU/传感器/通信架构', owner: 'EE', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 系统框图\n2) 原理图\n3) 电源树与功耗' },
      { id: 'jd3', name: 'PCB Layout', desc: 'PCB 布线、阻抗与 EMC', owner: 'EE/PCB', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 叠层规划\n2) 关键信号阻抗\n3) EMC/DRC' },
      { id: 'jd4', name: 'SW 架构设计', desc: 'Firmware 架构与通信协议', owner: 'SW', visibleRoles: ['rd_sw', 'pm', 'manager', 'owner'], guide: '1) 系统架构\n2) 协议定义\n3) OTA 方案' },
      { id: 'jd5', name: 'DFM/DFA 评审', desc: '可制造/可装配性评审', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 工厂参与评审\n2) DFM/DFA Checklist' },
      { id: 'jd6', name: '关键料件定型', desc: '主芯片/屏/电池等规格冻结', owner: 'EE/采购', visibleRoles: ['rd_hw', 'scm', 'pm', 'manager', 'owner'], guide: '1) 2nd Source 验证\n2) 规格与供货锁定' },
      { id: 'jd7', name: '设计冻结评审 (Gate 2, 客户外观签核)', desc: 'Design Freeze + 客户外观一致性签核', owner: '跨部门', visibleRoles: [], guide: '评审:\n1) 设计完整度\n2) BOM v1.0 成本\n3) 客户外观签核\n4) EVT 计划' },
    ],
  },
  {
    id: 'evt',
    code: 'P3',
    name: 'EVT 工程验证',
    nameEn: 'EVT',
    duration: '4-6周',
    desc: '工程样机功能/性能验证',
    gate: 'EVT 评审 + 客户样机确认',
    gateTaskId: 'je6',
    color: '#7c3aed',
    deliverables: ['EVT 样机', '功能/性能测试报告', '软硬件联调记录', '问题清单', '客户样机确认记录'],
    gateStandard: JDM_GATE_STANDARDS.evt,
    tasks: [
      { id: 'je1', name: '工程样机制作', desc: '制作 EVT 样机用于验证', owner: 'EE/EMS', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) PCBA 打样\n2) 整机组装\n3) 标注版本序号' },
      { id: 'je2', name: '功能测试 (FT)', desc: '功能点逐一验证', owner: 'QA/EE', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) FT Test Plan\n2) 逐项 Pass/Fail\n3) Bug 入 Issue List' },
      { id: 'je3', name: '性能测试 (PT)', desc: '续航/信号/热设计初测', owner: 'QA/EE', visibleRoles: ['qa', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 续航\n2) RF 性能\n3) 温升' },
      { id: 'je4', name: '软硬件联调', desc: 'Firmware 与硬件联调', owner: 'SW/EE', visibleRoles: ['rd_sw', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) Bringup\n2) 驱动/协议\n3) 稳定性优化' },
      { id: 'je5', name: '问题清单', desc: '记录 bug、缺陷与改善方案', owner: '项目经理/QA', visibleRoles: ['pm', 'qa', 'rd_hw', 'rd_sw', 'rd_mech', 'manager', 'owner'], guide: '每个 Issue:\n- 现象\n- 根因\n- 改善方案\n- 责任人/期限' },
      { id: 'je6', name: 'EVT 评审 (Gate 3, 客户样机确认)', desc: '是否达到进入 DVT 条件 + 客户样机确认', owner: '跨部门', visibleRoles: [], guide: '标准:\n- 功能 Pass Rate ≥95%\n- 无 P0 未解\n- 客户样机确认' },
    ],
  },
  {
    id: 'dvt',
    code: 'P4',
    name: 'DVT 设计验证',
    nameEn: 'DVT',
    duration: '4-8周',
    desc: '设计成熟度、可靠性与认证验证',
    gate: 'DVT 评审 + 客户 DVT 确认',
    gateTaskId: 'jv6',
    color: '#0f766e',
    deliverables: ['DVT 样机', '可靠性测试报告', '安规与认证报告', '模具 T1/T2 样品', '包装验证报告', '客户 DVT 确认记录'],
    gateStandard: JDM_GATE_STANDARDS.dvt,
    tasks: [
      { id: 'jv1', name: 'DVT 样机制作', desc: '半量产工艺制作 DVT 样机', owner: 'EMS', visibleRoles: ['rd_hw', 'pm', 'manager', 'owner'], guide: '1) 半正式 SMT\n2) 整机组装\n3) 模拟量产工艺' },
      { id: 'jv2', name: '可靠性测试', desc: '跌落/温湿/震动/老化', owner: 'QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '标准测试矩阵:\n- 跌落\n- 高低温\n- 湿热\n- 振动' },
      { id: 'jv3', name: '安规与认证', desc: '电池安全、运输、整机、EMC 等目标市场认证', owner: 'QA/认证', visibleRoles: ['qa', 'cert', 'battery_safety', 'rd_hw', 'pm', 'manager', 'owner'], guide: '认证清单:\n- 电芯/电池包安全: IEC 62133、GB 31241、UL 2054 等适用项（或复用确认）\n- 运输: UN38.3 + MSDS\n- 整机: CCC/CE/FCC/PSE/KC 等目标市场认证\n- 安规/EMC/RF，归档证书\n- 每项记录样品版本与报告编号' },
      { id: 'jv4', name: '模具 T1/T2 试模', desc: '塑胶模具开模与试模', owner: 'MD/模厂', visibleRoles: ['rd_mech', 'pm', 'manager', 'owner'], guide: '1) 开模\n2) T1/T2 试模\n3) 修模与认证样品' },
      { id: 'jv5', name: '包装设计验证', desc: '包装跌落与运输测试', owner: '包装', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '1) 包装结构\n2) ISTA 跌落\n3) 运输振动' },
      { id: 'jv6', name: 'DVT 评审 (Gate 4, 客户 DVT 确认)', desc: '进入 PVT 前关键评审 + 客户 DVT 确认', owner: '跨部门', visibleRoles: [], guide: '标准:\n- 可靠性/认证 Pass\n- 模具尺寸/外观 OK\n- 客户 DVT 确认' },
    ],
  },
  {
    id: 'pvt',
    code: 'P5',
    name: 'PVT 试产验证',
    nameEn: 'PVT',
    duration: '3-6周',
    desc: '生产工艺与良率验证',
    gate: 'MP 准备就绪评审 + 客户 golden sample 签样',
    gateTaskId: 'jp6',
    isReleaseGate: true,
    color: '#b45309',
    deliverables: ['试产（50-300台）报告', 'SOP/WI', '治具与测试程序', '良率报告', '客户 golden sample 签样记录', 'EOL 100%测试能力验收记录', 'UN38.3运输测试报告或复用确认', 'MSDS', '电芯/电池包安全认证报告或复用确认'],
    gateStandard: JDM_GATE_STANDARDS.pvt,
    tasks: [
      { id: 'jp1', name: '试产规划', desc: '产线排程、物料齐套、培训', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'scm', 'pm', 'manager', 'owner'], guide: '1) 试产数量与排程\n2) 物料齐套\n3) 人员培训' },
      { id: 'jp2', name: 'SOP/WI 制定', desc: '标准作业流程与作业指导书', owner: 'ME/IE', visibleRoles: ['rd_mech', 'qa', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '每工位:\n- SOP\n- WI\n- 检验标准' },
      { id: 'jp3', name: '治具与测试程序', desc: 'ICT/FCT/老化治具与测试软件', owner: '测试工程', visibleRoles: ['rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) ICT/FCT 治具\n2) 老化柜\n3) 测试程序与判定' },
      { id: 'jp4', name: '试产 (50-300台)', desc: '按量产工艺试制', owner: '工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '1) FAI\n2) 全程良率监控\n3) FPY 记录' },
      { id: 'jp5', name: '良率分析与改善', desc: 'SMT/组装/测试良率追踪', owner: 'QE/ME', visibleRoles: ['qa', 'rd_hw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '良率目标与 Pareto 改善' },
      { id: 'jp6', name: 'PVT 评审 (Gate 5, 客户 golden sample 签样)', desc: '量产准备就绪 + 客户 golden sample 签样', owner: '跨部门', visibleRoles: [], guide: 'GO 条件:\n- 试产良率达标\n- SOP/WI 完整\n- 治具/产能就绪\n- 客户 golden sample 签样' },
    ],
  },
  {
    id: 'mp',
    code: 'P6',
    name: '量产稳定与客户移交',
    nameEn: 'Mass Production',
    duration: '2-8周',
    desc: '量产发布后的爬坡、客户交付验证与项目关闭移交',
    gate: '项目关闭移交评审',
    gateTaskId: 'jm5',
    isCloseGate: true,
    color: '#166534',
    deliverables: ['量产产品', '良率周报', 'ECN/ECR 记录', '售后数据分析'],
    gateStandard: JDM_GATE_STANDARDS.mp,
    tasks: [
      { id: 'jm1', name: '首批量产 (Ramp-up)', desc: '小批爬坡，监控良率', owner: '工厂/项目经理', visibleRoles: ['scm', 'qa', 'mfg', 'pe', 'pm', 'manager', 'owner'], guide: '1) 首批爬坡\n2) 日良率监控\n3) 客户样品确认' },
      { id: 'jm2', name: '良率监控与改善', desc: '日/周良率追踪与 CAR', owner: 'QE/工厂', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 良率报告\n2) Pareto Top3\n3) CAR 关闭' },
      { id: 'jm3', name: '工程变更管理', desc: 'ECN/ECR 评审与执行', owner: '项目经理/CM', visibleRoles: ['rd_hw', 'rd_sw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) ECR 评估\n2) CCB 审批\n3) ECN 执行' },
      { id: 'jm4', name: '售后问题跟踪', desc: 'RMA 与市场反馈 FA', owner: '售后/QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) RMA 分析\n2) 失效模式 FA\n3) 客诉改善' },
      { id: 'jm5', name: '产品交付/EOL 评审 (Gate 6)', desc: '量产交付与 EOL 决策', owner: '跨部门', visibleRoles: [], guide: '关注:\n- 量产经营目标\n- 持续改善\n- EOL 计划' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// OBT — openBOM Transfer / 转产导入 (4-phase)
// 客户出完整设计 + BOM；工厂纯生产。核心 = DFM 反馈 + 料件齐套 + 治具/测试程序。
// ─────────────────────────────────────────────────────────────────────────────
export const OBT_PHASES: SOPPhase[] = [
  {
    id: 'intake',
    code: 'P1',
    name: '设计接收与可制造性评审',
    nameEn: 'Design Intake & DFM',
    duration: '2-4周',
    desc: '核对设计与 openBOM，输出 DFM 反馈并冻结输入',
    gate: '转产受理 + 设计输入冻结',
    gateTaskId: 'or7',
    color: '#78716c',
    deliverables: ['openBOM 核对清单', '图纸/规格完整性确认', 'DFM/可制造性反馈报告', '料件齐套与替代料策略', '模具/治具归属与 NRE 确认', '报价', '项目计划', '设计输入冻结确认（客户）'],
    gateStandard: OBT_GATE_STANDARDS.intake,
    tasks: [
      { id: 'or1', name: 'openBOM 核对', desc: '料件可得性/替代料/版本核对', owner: 'SCM/采购', visibleRoles: ['scm', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 逐行核对 openBOM\n2) 可得性与版本\n3) 替代料标注' },
      { id: 'or2', name: '图纸 / 规格完整性核对', desc: '核对图纸与规格完整性', owner: 'R&D Lead', visibleRoles: ['rd_hw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 图纸版本核对\n2) 规格完整性\n3) 缺口清单' },
      { id: 'or3', name: 'DFM / 可制造性反馈', desc: '输出 DFM 反馈并提交客户', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) DFM Checklist\n2) 制造风险\n3) 提交客户' },
      { id: 'or4', name: '料件齐套与替代料策略', desc: '建立齐套与替代料计划', owner: 'SCM', visibleRoles: ['scm', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 齐套分析\n2) 长交期/单一来源\n3) 替代料策略' },
      { id: 'or5', name: '模具 / 治具归属与 NRE 确认', desc: '逐项确认模具/治具归属与 NRE', owner: '项目经理/SCM', visibleRoles: ['scm', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 归属逐项钉死\n2) NRE 确认\n3) 记录责任方' },
      { id: 'or6', name: '报价', desc: '完成转产报价', owner: '项目经理/SCM', visibleRoles: ['scm', 'pm', 'manager', 'owner'], guide: '1) 制造成本\n2) NRE 摊销\n3) 报价确认' },
      { id: 'or7', name: '转产受理 + 设计输入冻结评审 (Gate 1, 客户确认)', desc: '受理转产并冻结输入，客户确认', owner: '跨部门', visibleRoles: [], guide: '评审:\n1) 资料完整性\n2) DFM 反馈关闭\n3) 归属/NRE\n4) 客户输入冻结确认' },
    ],
  },
  {
    id: 'sample',
    code: 'P2',
    name: '打样与首件确认',
    nameEn: 'Sample & FAI',
    duration: '3-5周',
    desc: '首件制作、FAI 与客户签样',
    gate: '首件确认 (FAI) + 客户签样',
    gateTaskId: 'os5',
    color: '#7c3aed',
    deliverables: ['首件样品', 'FAI 首件检验报告', '测试程序与治具', '客户签样记录'],
    gateStandard: OBT_GATE_STANDARDS.sample,
    tasks: [
      { id: 'os1', name: '首件 / 样机制作', desc: '按客户设计制作首件样品', owner: 'ME/工厂', visibleRoles: ['rd_mech', 'rd_hw', 'pm', 'manager', 'owner'], guide: '1) 物料备齐\n2) 首件制作\n3) 标注版本' },
      { id: 'os2', name: 'FAI 首件检验', desc: '首件检验与尺寸/功能确认', owner: 'QA', visibleRoles: ['qa', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 尺寸检验\n2) 功能检验\n3) FAI 报告' },
      { id: 'os3', name: '测试程序与治具调试', desc: '调试测试程序与治具', owner: '测试工程', visibleRoles: ['rd_hw', 'qa', 'pm', 'manager', 'owner'], guide: '1) 治具调试\n2) 测试程序\n3) 判定标准' },
      { id: 'os4', name: '客户样品确认', desc: '送样客户并收集确认意见', owner: '项目经理', visibleRoles: ['pm', 'qa', 'sales', 'manager', 'owner'], guide: '1) 送样\n2) 收集意见\n3) 整改闭环' },
      { id: 'os5', name: '首件确认评审 (Gate 2, 客户签样)', desc: 'FAI 通过 + 客户签样', owner: '跨部门', visibleRoles: [], guide: '标准:\n- FAI 合格\n- 治具/程序就绪\n- 客户签样' },
    ],
  },
  {
    id: 'pvt',
    code: 'P3',
    name: '试产验证 PVT',
    nameEn: 'PVT',
    duration: '2-4周',
    desc: '小批试产、良率改善与切换准备',
    gate: 'MP 准备就绪评审 + 客户放行',
    gateTaskId: 'op5',
    isReleaseGate: true,
    color: '#b45309',
    deliverables: ['小批试产报告', '良率分析与改善', 'SOP/WI', '包装与物流验证', '客户放行记录', 'UN38.3运输测试报告或复用确认', 'MSDS'],
    gateStandard: OBT_GATE_STANDARDS.pvt,
    tasks: [
      { id: 'op1', name: '小批试产', desc: '按量产工艺小批试产', owner: '工厂', visibleRoles: ['rd_mech', 'rd_hw', 'qa', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '1) FAI\n2) 全程良率监控\n3) FPY 记录' },
      { id: 'op2', name: '良率分析与改善', desc: '良率追踪与异常改善', owner: 'QE/ME', visibleRoles: ['qa', 'rd_hw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 良率统计\n2) Pareto 改善\n3) 异常关闭' },
      { id: 'op3', name: 'SOP/WI 制定', desc: '标准作业流程与作业指导书', owner: 'ME/IE', visibleRoles: ['rd_mech', 'qa', 'pe', 'mfg', 'pm', 'manager', 'owner'], guide: '每工位 SOP/WI 与检验标准' },
      { id: 'op4', name: '包装与物流验证', desc: '包装、运输与物流验证（含 UN38.3/MSDS 运输合规）', owner: '包装/物流', visibleRoles: ['scm', 'cert', 'battery_safety', 'pm', 'manager', 'owner'], guide: '1) 包装方案\n2) 运输测试\n3) 物流路径\n4) 锂电产品核对 UN38.3/MSDS 运输合规文件（客户提供或复用确认）' },
      { id: 'op5', name: 'MP 准备就绪评审 (Gate 3, 客户放行)', desc: '量产准备就绪 + 客户放行', owner: '跨部门', visibleRoles: [], guide: 'GO 条件:\n- 试产良率达标\n- SOP/WI 完整\n- 包装/物流验证\n- 客户放行' },
    ],
  },
  {
    id: 'mp',
    code: 'P4',
    name: '量产稳定与客户移交',
    nameEn: 'Mass Production',
    duration: '2-8周',
    desc: '量产发布后的稳定性监控、客户交付确认与项目关闭移交',
    gate: '项目关闭移交评审',
    gateTaskId: 'om4',
    isCloseGate: true,
    color: '#166534',
    deliverables: ['量产产品', '良率周报', '售后问题跟踪'],
    gateStandard: OBT_GATE_STANDARDS.mp,
    tasks: [
      { id: 'om1', name: '首批量产', desc: '首批量产与爬坡', owner: '工厂/项目经理', visibleRoles: ['scm', 'qa', 'mfg', 'pe', 'pm', 'manager', 'owner'], guide: '1) 首批量产\n2) 日良率监控\n3) 客户确认' },
      { id: 'om2', name: '良率监控', desc: '量产良率监控', owner: 'QE/工厂', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) 周良率报告\n2) 异常响应\n3) CAR 关闭' },
      { id: 'om3', name: '售后问题跟踪', desc: 'RMA 与客诉跟踪', owner: '售后/QA', visibleRoles: ['qa', 'pm', 'manager', 'owner'], guide: '1) RMA 分析\n2) 客诉处理\n3) 改善反馈' },
      { id: 'om4', name: '产品交付/EOL 评审 (Gate 4)', desc: '量产交付与 EOL 决策', owner: '跨部门', visibleRoles: [], guide: '关注:\n- 量产经营目标\n- 归属责任\n- EOL 计划' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Category Registry
// ─────────────────────────────────────────────────────────────────────────────

const CLOSE_PHASE_COPY: Record<ProjectCategory, { name: string; gate: string; desc: string }> = {
  npd: { name: '量产稳定与移交', gate: '项目关闭移交评审', desc: '量产版本发布后的爬坡、稳定性验证与项目关闭移交' },
  eco: { name: '变更稳定与关闭', gate: 'ECO 关闭评审', desc: '变更版本发布后的效果验证、稳定性确认与项目关闭' },
  derivative: { name: '迭代稳定与关闭', gate: '迭代关闭评审', desc: '迭代版本发布后的爬坡、目标验证与项目关闭' },
  idr: { name: '上市稳定与关闭', gate: 'IDR 项目关闭移交评审', desc: '外观版本发布后的首批稳定、渠道反馈与项目关闭' },
  jdm: { name: '量产稳定与客户移交', gate: '项目关闭移交评审', desc: '量产发布后的爬坡、客户交付验证与项目关闭移交' },
  obt: { name: '量产稳定与客户移交', gate: '项目关闭移交评审', desc: '转产版本发布后的稳定性监控、客户确认与项目关闭移交' },
};

function toCurrentClosePhase(category: ProjectCategory, phase: SOPPhase): SOPPhase {
  const copy = CLOSE_PHASE_COPY[category];
  return {
    ...phase,
    name: copy.name,
    nameEn: 'Post-release Stabilization & Project Close',
    duration: '2-8周',
    desc: copy.desc,
    gate: copy.gate,
    gateTaskId: 'project_close_review',
    isCloseGate: true,
    deliverables: [],
    gateStandard: {
      entryCriteria: ['量产版本已发布，稳定观察窗口已开始'],
      exitCriteria: ['至少两期结构化稳定记录经 QA 确认并累计覆盖不少于 14 个自然日', '项目无未关闭 P0/P1，稳定期遗留项已关闭或转入受控流程'],
      requiredDeliverables: [],
      responsibleRoles: ['QA 负责良率和质量稳定结论', 'NPI/工厂负责产能和爬坡结论', '项目经理负责遗留项关闭与项目收口', '管理层负责 Close 决策'],
      evidenceRequirements: ['结构化稳定期周报', 'P0/P1 关闭记录', 'Close Gate 会签与评审记录'],
      exceptionStrategy: ['稳定窗口不足或指标未达标时延长观察期', '新增重大安全、质量或法规风险时不得关闭'],
    },
    tasks: [
      { id: 'stability_ramp', name: '首批量产与爬坡', desc: '跟踪首批产量、产能与交付爬坡', owner: '工厂/NPI', visibleRoles: ['pe', 'mfg', 'scm', 'qa', 'project_manager', 'pm', 'manager', 'owner'], guide: '1) 记录首批产量和目标产能\n2) 跟踪瓶颈工位与交付风险\n3) 异常进入受控问题或 CAPA/ECO' },
      { id: 'stability_metrics', name: '良率、质量与产能稳定确认', desc: '以结构化周报确认发布后稳定表现', owner: 'QA/NPI', visibleRoles: ['qa', 'pe', 'mfg', 'scm', 'project_manager', 'pm', 'manager', 'owner'], guide: '1) 至少两期周报\n2) 累计覆盖不少于 14 天\n3) QA 确认 FPY、质量事件和产能达成' },
      { id: 'stability_issues', name: '遗留问题关闭与受控转交', desc: '关闭稳定期问题，必要时转入 ECO/CAPA', owner: '项目经理/QA', visibleRoles: ['project_manager', 'qa', 'rd_hw', 'rd_sw', 'rd_mech', 'pm', 'manager', 'owner'], guide: '1) 关闭全部 P0/P1\n2) 不在项目内长期运行工程变更、售后或持续改善\n3) 需继续处理的事项转入受控流程' },
      { id: 'project_close_review', name: '项目关闭评审', desc: '确认稳定证据和遗留问题满足关闭条件', owner: '跨部门', visibleRoles: [], guide: 'Close 条件:\n- 已发布量产版本\n- 两期稳定记录且覆盖至少 14 天\n- QA 已确认\n- 无未关闭 P0/P1\n- 必签完成' },
    ],
  };
}

function buildCurrentPhases(category: ProjectCategory, legacy: SOPPhase[]): SOPPhase[] {
  return legacy.map((phase) => phase.isCloseGate ? toCurrentClosePhase(category, phase) : phase);
}

export const NPD_PHASES_CURRENT = buildCurrentPhases('npd', NPD_PHASES);
export const ECO_PHASES_CURRENT = buildCurrentPhases('eco', ECO_PHASES);
export const DERIVATIVE_PHASES_CURRENT = buildCurrentPhases('derivative', DERIVATIVE_PHASES);
export const IDR_PHASES_CURRENT = buildCurrentPhases('idr', IDR_PHASES);
export const JDM_PHASES_CURRENT = buildCurrentPhases('jdm', JDM_PHASES);
export const OBT_PHASES_CURRENT = buildCurrentPhases('obt', OBT_PHASES);

const LEGACY_PHASES_BY_CATEGORY: Record<ProjectCategory, SOPPhase[]> = {
  npd: NPD_PHASES,
  eco: ECO_PHASES,
  derivative: DERIVATIVE_PHASES,
  idr: IDR_PHASES,
  jdm: JDM_PHASES,
  obt: OBT_PHASES,
};

const CURRENT_PHASES_BY_CATEGORY: Record<ProjectCategory, SOPPhase[]> = {
  npd: NPD_PHASES_CURRENT,
  eco: ECO_PHASES_CURRENT,
  derivative: DERIVATIVE_PHASES_CURRENT,
  idr: IDR_PHASES_CURRENT,
  jdm: JDM_PHASES_CURRENT,
  obt: OBT_PHASES_CURRENT,
};

export const PROJECT_CATEGORIES: ProjectCategoryConfig[] = [
  {
    id: 'npd',
    name: '新产品开发',
    nameEn: 'New Product Development',
    badge: 'NPD',
    color: 'bg-blue-50',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-300',
    icon: '🚀',
    desc: '全新品类产品，从0到1完整开发流程，包含概念立项、规划、设计、EVT/DVT/PVT 验证到量产，共 7 个阶段。',
    phaseCount: 7,
    typicalDuration: '约 5-8 个月',
    phases: NPD_PHASES_CURRENT,
  },
  {
    id: 'eco',
    name: '工程变更',
    nameEn: 'Engineering Change',
    badge: 'ECO',
    color: 'bg-amber-50',
    textColor: 'text-amber-800',
    borderColor: 'border-amber-300',
    icon: '🔧',
    desc: '现有产品的换料、降成本、小范围设计变更、质量/合规整改和受控版本切换，共 5 个阶段。',
    phaseCount: 5,
    typicalDuration: '约 1.5-3 个月',
    phases: ECO_PHASES_CURRENT,
  },
  {
    id: 'derivative',
    name: '产品迭代/衍生开发',
    nameEn: 'Product Iteration / Derivative Development',
    badge: 'DRV',
    color: 'bg-violet-50',
    textColor: 'text-violet-800',
    borderColor: 'border-violet-300',
    icon: '🔄',
    desc: '现有产品的大改款或中改款，从 1 代升级到 2 代或衍生型号开发；按旧模块复用情况判定大/中改与 Gate 深度，覆盖产品定义、一代基线盘点、模块复用策略、设计/模具、EVT/DVT/PVT 验证和量产切换，共 6 个阶段。极小改走 ECO，纯外观/换色走 IDR。',
    phaseCount: 6,
    typicalDuration: '约 3-5 个月',
    phases: DERIVATIVE_PHASES_CURRENT,
  },
  {
    id: 'idr',
    name: '外观翻新',
    nameEn: 'ID Refresh',
    badge: 'IDR',
    color: 'bg-teal-50',
    textColor: 'text-teal-800',
    borderColor: 'border-teal-300',
    icon: '🎨',
    desc: '现有产品的外观翻新/外观改版，覆盖设计、验证、量产发布，以及发布后 2-8 周稳定与关闭移交，共 5 个阶段。',
    phaseCount: 5,
    typicalDuration: '约 2.5-4 个月',
    phases: IDR_PHASES_CURRENT,
  },
  {
    id: 'jdm',
    name: '客户委托设计',
    nameEn: 'Joint Design Manufacture',
    badge: 'JDM',
    color: 'bg-indigo-50',
    textColor: 'text-indigo-800',
    borderColor: 'border-indigo-300',
    icon: '🤝',
    desc: '客户提供 ID/外观与产品规格，委托工厂完成结构、硬件与软件设计并量产；以设计输入冻结为入口，EVT/DVT/PVT 强制客户签核，共 6 个阶段。',
    phaseCount: 6,
    typicalDuration: '约 4-6 个月',
    phases: JDM_PHASES_CURRENT,
  },
  {
    id: 'obt',
    name: '转产导入',
    nameEn: 'openBOM Transfer',
    badge: 'OBT',
    color: 'bg-cyan-50',
    textColor: 'text-cyan-800',
    borderColor: 'border-cyan-300',
    icon: '📦',
    desc: '客户提供完整设计与 openBOM，工厂完成可制造性导入、首件确认、试产与量产；核心为 DFM 反馈与料件齐套，共 4 个阶段。',
    phaseCount: 4,
    typicalDuration: '约 1.5-3 个月',
    phases: OBT_PHASES_CURRENT,
  },
];

export const CATEGORY_MAP: Record<ProjectCategory, ProjectCategoryConfig> = {
  npd: PROJECT_CATEGORIES[0],
  eco: PROJECT_CATEGORIES[1],
  derivative: PROJECT_CATEGORIES[2],
  idr: PROJECT_CATEGORIES[3],
  jdm: PROJECT_CATEGORIES[4],
  obt: PROJECT_CATEGORIES[5],
};

/**
 * Get the SOP phases for a project based on its category.
 * Falls back to NPD phases if category is not set.
 */
export const getPhasesForCategory = (category?: string, templateVersion?: string | null): SOPPhase[] => {
  const resolvedCategory = (category && CATEGORY_MAP[category as ProjectCategory])
    ? category as ProjectCategory
    : 'npd';
  const version = normalizeSopTemplateVersion(templateVersion);
  if (version === SOP_TEMPLATE_VERSION_NPD_V3) {
    return resolvedCategory === 'npd'
      ? NPD_V3_CORE_PHASES
      : CURRENT_PHASES_BY_CATEGORY[resolvedCategory];
  }
  return version === SOP_TEMPLATE_VERSION_LEGACY
    ? LEGACY_PHASES_BY_CATEGORY[resolvedCategory]
    : CURRENT_PHASES_BY_CATEGORY[resolvedCategory];
};

/** 定位某 category 的「MP Release 前置 Gate」所在 phase；未定义返回 null。 */
export const getReleaseGatePhase = (category?: string, templateVersion?: string | null): SOPPhase | null =>
  getPhasesForCategory(category, templateVersion).find((p) => p.isReleaseGate) ?? null;
