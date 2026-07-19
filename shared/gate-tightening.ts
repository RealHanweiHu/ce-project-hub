// 2026-07-02 Gate 收紧清单：本次给各赛道 Gate 新增的「必备交付物」。
// 用途：给存量在途项目做 grandfather——已过会的 Gate 不因新增项而被追溯打回 blocked。
// 每条 = 某 category 的某阶段(phase.id) 新增的交付物名称（与 phase.deliverables /
// gateStandard.requiredDeliverables 完全同名，二者本次是同步新增的）。
//
// 维护约定：以后每次收紧 Gate 都追加一个带日期的 manifest（不要改历史条目），
// 并配套一支幂等迁移，对存量已过会项目写入豁免（remove override + reason）。

export interface GateTighteningEntry {
  category: string;
  phaseId: string;
  deliverableName: string;
}

/** 2026-07-02 收紧新增（对照上一次部署 main 的模板差异整理） */
export const GATE_TIGHTENING_2026_07_02: GateTighteningEntry[] = [
  // ── NPD ──
  { category: "npd", phaseId: "concept", deliverableName: "认证路线图初判" },
  { category: "npd", phaseId: "planning", deliverableName: "认证路线图" },
  { category: "npd", phaseId: "planning", deliverableName: "电芯复用/定点与二供策略" },
  { category: "npd", phaseId: "design", deliverableName: "安全FMEA与危害分析" },
  { category: "npd", phaseId: "design", deliverableName: "电芯厂质量审核或复用资质确认" },
  { category: "npd", phaseId: "design", deliverableName: "保护电路设计评审或复用确认" },
  { category: "npd", phaseId: "dvt", deliverableName: "PFMEA/CTQ控制计划" },
  { category: "npd", phaseId: "pvt", deliverableName: "EOL 100%测试能力验收记录" },
  { category: "npd", phaseId: "pvt", deliverableName: "UN38.3运输测试报告或复用确认" },
  { category: "npd", phaseId: "pvt", deliverableName: "MSDS" },
  { category: "npd", phaseId: "pvt", deliverableName: "电芯/电池包安全认证报告或复用确认" },
  // ── JDM ──
  { category: "jdm", phaseId: "pvt", deliverableName: "EOL 100%测试能力验收记录" },
  { category: "jdm", phaseId: "dvt", deliverableName: "UN38.3运输测试报告或复用确认" },
  { category: "jdm", phaseId: "dvt", deliverableName: "MSDS" },
  { category: "jdm", phaseId: "dvt", deliverableName: "电芯/电池包安全认证报告或复用确认" },
  // ── OBT ──
  { category: "obt", phaseId: "pvt", deliverableName: "UN38.3运输测试报告或复用确认" },
  { category: "obt", phaseId: "pvt", deliverableName: "MSDS" },
];

export interface GrandfatherProjectState {
  projectId: string;
  category: string;
  /** 已「过会」的阶段 id 集合（currentPhase 之前的阶段 ∪ 有通过/有条件通过评审的阶段） */
  passedPhaseIds: Iterable<string>;
}

export interface GrandfatherExemption {
  projectId: string;
  nodePhaseId: string;
  deliverableName: string;
}

/**
 * 计算某项目应得的 grandfather 豁免：
 * 只豁免「新增项 且 该阶段 Gate 已过会」的组合——即真正的追溯伤害。
 * 未过会（当前/未来）的 Gate 不豁免：新项目/在途项目按新严格标准往前走。
 */
export function computeGrandfatherExemptions(
  project: GrandfatherProjectState,
  manifest: GateTighteningEntry[] = GATE_TIGHTENING_2026_07_02,
): GrandfatherExemption[] {
  const passed = new Set(Array.from(project.passedPhaseIds));
  const out: GrandfatherExemption[] = [];
  for (const entry of manifest) {
    if (entry.category !== project.category) continue;
    if (!passed.has(entry.phaseId)) continue;
    out.push({
      projectId: project.projectId,
      nodePhaseId: entry.phaseId,
      deliverableName: entry.deliverableName,
    });
  }
  return out;
}

/**
 * 由 category 顺序 + currentPhase 推出「已过会阶段集合」（currentPhase 之前的所有阶段）。
 * gateReviewedPhaseIds 传入有「通过/有条件通过」评审的阶段，作为并集补充
 * （覆盖 currentPhase 尚未推进、但已评审通过的边界情形）。
 */
export function passedPhaseIds(
  orderedPhaseIds: string[],
  currentPhaseId: string,
  gateReviewedPhaseIds: Iterable<string> = [],
): string[] {
  const idx = orderedPhaseIds.indexOf(currentPhaseId);
  const before = idx > 0 ? orderedPhaseIds.slice(0, idx) : [];
  return Array.from(new Set([...before, ...Array.from(gateReviewedPhaseIds)]));
}
