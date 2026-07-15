// IPD 消费电子(锂电充气泵/车载吸尘器等)自动排期依赖图。
// 格式：taskId -> [工期(工厂工作日), ...前置任务id]。无前置=阶段入口（依赖上一阶段 gate 由下方手动接上）。
// 工期为首版经验值，可随时调（纯数据，不改逻辑）。
import { contractSchedTasks, generateSchedule, type SchedTask, type Schedule, type CalendarExceptions } from "./scheduling";
import { getPhasesForCategory } from "./sop-templates";
import { getEffectivePhasesForProjectLike, type ProjectTemplateLike } from "./npd-v3";

type G = Record<string, [number, ...string[]]>;

// 压缩版（目标:整机开发约 3-4 个月）。关键提速:
//  1) 认证(v3)与开模(v4)在「设计冻结 d8」即启动,与 EVT/DVT 并行(长交期项早开工);
//  2) 设计多轨并行(ID/MD/EE/SW);测试项并行;工期按快速消费电子收紧。
// 仍是纯数据,可按实际产品微调。工厂日历按周一至周六工作、周日休息计算。
export const SCHEDULE_GRAPH: G = {
  // ── NPD ───────────────────────────────────────────────
  // 概念 P1
  c1: [5], c2: [5], c3: [4, "c1", "c2"], c4: [5, "c3"], c5: [4, "c3"], c6: [1, "c4", "c5"],
  // 规划 P2（入口依赖 c6）
  p1: [5, "c6"], p2: [5, "p1"], p3: [4, "p1"], p4: [5, "p2"], p5: [5, "p4"], p5a: [6, "p5"], p6: [4, "c6"], p6a: [5, "p2"], p7: [1, "p2", "p3", "p5", "p5a", "p6", "p6a"],
  // 设计 P3（入口依赖 p7，多轨并行）
  d1: [8, "p7"], d2: [9, "d1"], d3: [8, "p7"], d4: [6, "d3"], d5: [9, "p7"], d6: [3, "d2", "d4"], d6a: [4, "d2", "d3"], d7: [4, "d4"], d7a: [7, "p5a"], d7b: [4, "d3", "d7"], d8: [1, "d5", "d6", "d6a", "d7", "d7a", "d7b"],
  // EVT P4（入口依赖 d8）
  e1: [7, "d8"], e2: [5, "e1"], e3: [5, "e1"], e4: [5, "e1"], e5: [3, "e2", "e3", "e4"], e6: [4, "e5"], e7: [1, "e6"],
  // DVT P5（v1 样机依赖 e7；认证 v3、开模 v4 在设计冻结 d8 即启动，与 EVT/DVT 并行）
  v1: [7, "e7"], v2: [8, "v1"], v3: [14, "d8"], v4: [14, "d8"], v5: [7, "v1"], v6: [5, "v1"], v7: [7, "v4"], v8: [1, "v2", "v3", "v4", "v5", "v6", "v7"],
  // PVT P6（入口依赖 v8）
  pv1: [4, "v8"], pv2: [5, "pv1"], pv3: [5, "pv1"], pv4: [5, "pv2", "pv3"], pv5: [4, "pv4"], pv6: [4, "pv4"], pv7: [4, "pv5"], pv8: [1, "pv5", "pv6", "pv7"],
  // MP P7（入口依赖 pv8，量产爬坡）
  mp1: [8, "pv8"], mp2: [8, "mp1"], mp3: [8, "mp1"], mp4: [6, "mp1"], mp5: [10, "mp1"], mp6: [3, "mp2", "mp3"],

  // ── ECO（工程变更）────────────────────────────────────
  ep1: [2], ep2: [3, "ep1"], ep3: [2, "ep2"], ep4: [2, "ep2"], ep5: [3, "ep3"], ep6: [1, "ep4", "ep5"], ep7: [1, "ep6"],
  ed1: [8, "ep7"], ed2: [8, "ep7"], ed3: [8, "ep7"], ed4: [4, "ed1", "ed2"], ed5: [4, "ed1", "ed2"], ed6: [1, "ed3", "ed4", "ed5"],
  ev1: [8, "ed6"], ev2: [7, "ev1"], ev3: [7, "ev1"], ev4: [12, "ed6"], ev5: [1, "ev2", "ev3", "ev4"],
  epv1: [5, "ev5"], epv2: [7, "epv1"], epv3: [4, "epv1"], epv4: [2, "epv2"], epv5: [1, "epv2", "epv3", "epv4"],
  em1: [8, "epv5"], em2: [8, "em1"], em3: [10, "em1"], em4: [1, "em2", "em3"],

  // ── DRV project-track-v1：公共任务 + 六模块任务包 ─────────────
  drv_common_product_baseline: [2],
  drv_common_project_plan: [2, "drv_common_product_baseline"],
  drv_common_risk_scope: [2, "drv_common_product_baseline"],
  drv_common_kickoff_gate: [1, "drv_common_product_baseline", "drv_common_project_plan", "drv_common_risk_scope"],
  drv_common_dfm_validation_plan: [4, "drv_common_kickoff_gate"],
  drv_battery_design: [6, "drv_common_kickoff_gate"],
  drv_core_function_design: [6, "drv_common_kickoff_gate"],
  drv_electronics_design: [7, "drv_common_kickoff_gate"],
  drv_software_requirements_design: [5, "drv_common_kickoff_gate"],
  drv_structure_design: [7, "drv_common_kickoff_gate"],
  drv_structure_mold_review: [2, "drv_structure_design"],
  drv_structure_mold_development: [12, "drv_structure_mold_review"],
  drv_id_cmf_design: [6, "drv_common_kickoff_gate"],
  drv_common_accessory_definition: [2, "drv_common_kickoff_gate"],
  drv_common_design_gate: [1, "drv_common_dfm_validation_plan", "drv_battery_design", "drv_core_function_design", "drv_electronics_design", "drv_software_requirements_design", "drv_structure_mold_development", "drv_id_cmf_design", "drv_common_accessory_definition"],
  drv_common_evt_build: [5, "drv_common_design_gate"],
  drv_battery_sample_integration: [4, "drv_common_evt_build"],
  drv_battery_special_validation: [6, "drv_battery_sample_integration"],
  drv_core_function_sample: [4, "drv_common_evt_build"],
  drv_core_function_special_validation: [6, "drv_core_function_sample"],
  drv_electronics_sample_integration: [5, "drv_common_evt_build"],
  drv_electronics_special_validation: [5, "drv_electronics_sample_integration"],
  drv_software_development_integration: [6, "drv_common_evt_build"],
  drv_software_special_validation: [5, "drv_software_development_integration"],
  drv_structure_t1_t2_validation: [8, "drv_common_evt_build", "drv_structure_mold_development"],
  drv_id_cmf_sample: [4, "drv_common_evt_build"],
  drv_id_cmf_standard_confirmation: [3, "drv_id_cmf_sample"],
  drv_common_system_function_regression: [5, "drv_common_evt_build", "drv_battery_special_validation", "drv_core_function_special_validation", "drv_electronics_special_validation", "drv_software_special_validation", "drv_structure_t1_t2_validation", "drv_id_cmf_standard_confirmation"],
  drv_common_software_function_validation: [5, "drv_common_evt_build"],
  drv_common_evt_issue_close: [3, "drv_common_system_function_regression", "drv_common_software_function_validation"],
  drv_common_evt_gate: [1, "drv_common_evt_issue_close"],
  drv_common_dvt_build: [5, "drv_common_evt_gate"],
  drv_common_reliability_validation: [8, "drv_common_dvt_build"],
  drv_common_safety_certification_validation: [8, "drv_common_dvt_build"],
  drv_common_accessory_confirmation: [3, "drv_common_dvt_build"],
  drv_common_packaging_validation: [4, "drv_common_dvt_build"],
  drv_common_logistics_validation: [4, "drv_common_dvt_build"],
  drv_common_dvt_issue_close: [3, "drv_common_reliability_validation", "drv_common_safety_certification_validation", "drv_common_accessory_confirmation", "drv_common_packaging_validation", "drv_common_logistics_validation"],
  drv_common_dvt_gate: [1, "drv_common_dvt_issue_close"],
  drv_common_fixture_confirmation: [4, "drv_common_dvt_gate"],
  drv_common_eol_test_program_confirmation: [4, "drv_common_dvt_gate"],
  drv_common_pvt_trial: [6, "drv_common_fixture_confirmation", "drv_common_eol_test_program_confirmation"],
  drv_common_pvt_quality_close: [4, "drv_common_pvt_trial"],
  drv_common_release_files: [3, "drv_common_pvt_quality_close"],
  drv_common_pvt_release_gate: [1, "drv_common_fixture_confirmation", "drv_common_eol_test_program_confirmation", "drv_common_pvt_trial", "drv_common_pvt_quality_close", "drv_common_release_files"],

  // ── IDR（外观翻新）────────────────────────────────────
  ir1: [2], ir2: [2], ir3: [3, "ir1", "ir2"], ir4: [4, "ir3"], ir5: [3, "ir3"], ir6: [1, "ir4", "ir5"],
  id1: [8, "ir6"], id2: [10, "id1"], id3: [6, "ir6"], id4: [5, "id1"], id5: [5, "id2", "id3"], id6: [8, "id2"], id7: [1, "id4", "id5", "id6"],
  // 认证 iv5 / 工装 iv4 在设计冻结 id7 即启动，与验证并行
  iv1: [8, "id7"], iv2: [7, "iv1"], iv3: [7, "iv1"], iv4: [12, "id7"], iv5: [15, "id7"], iv6: [5, "iv2"], iv7: [1, "iv3", "iv4", "iv5", "iv6"],
  im1: [6, "iv7"], im2: [8, "im1"], im3: [6, "im1"], im4: [4, "im2"], im5: [6, "im2"], im6: [1, "im3", "im4", "im5"],
  // 发布后稳定与关闭（2-8 周窗口）
  is1: [10, "im6"], is2: [10, "im6"], is3: [4, "is1", "is2"], is4: [1, "is3"],

  // ── JDM（客供 ID/规格，工厂全自研 MD/EE/SW）──────────
  // 输入冻结 P1
  jin1: [3], jin2: [3, "jin1"], jin3: [4, "jin1"], jin4: [4, "jin3"], jin5: [1, "jin2", "jin3", "jin4"],
  // 详细设计 P2（MD/EE/SW 多轨并行）
  jd1: [10, "jin5"], jd2: [9, "jin5"], jd3: [8, "jd2"], jd4: [8, "jin5"], jd5: [3, "jd1", "jd3"], jd6: [4, "jd2"], jd7: [1, "jd1", "jd3", "jd4", "jd5", "jd6"],
  // EVT P3
  je1: [7, "jd7"], je2: [5, "je1"], je3: [5, "je1"], je4: [6, "je1"], je5: [3, "je2", "je3", "je4"], je6: [1, "je5"],
  // DVT P4（认证 jv3、开模 jv4 在设计冻结 jd7 即启动，与 EVT/DVT 并行——同 NPD v3/v4）
  jv1: [7, "je6"], jv2: [10, "jv1"], jv3: [14, "jd7"], jv4: [14, "jd7"], jv5: [5, "jv1"], jv6: [1, "jv2", "jv3", "jv4", "jv5"],
  // PVT P5（发布门）
  jp1: [4, "jv6"], jp2: [5, "jp1"], jp3: [5, "jp1"], jp4: [5, "jp2", "jp3"], jp5: [4, "jp4"], jp6: [1, "jp4", "jp5"],
  // MP P6
  jm1: [8, "jp6"], jm2: [8, "jm1"], jm3: [8, "jm1"], jm4: [10, "jm1"], jm5: [3, "jm2", "jm3"],

  // ── OBT（客供完整设计+openBOM，工厂纯转产）──────────
  // 设计接收 P1
  or1: [4], or2: [3], or3: [4, "or1", "or2"], or4: [4, "or1"], or5: [3, "or3"], or6: [3, "or4", "or5"], or7: [1, "or3", "or4", "or5", "or6"],
  // 打样与首件 P2（治具 os3 与首件并行）
  os1: [6, "or7"], os2: [4, "os1"], os3: [5, "or7"], os4: [5, "os2"], os5: [1, "os2", "os3", "os4"],
  // PVT P3（发布门；SOP/WI、包装与试产并行）
  op1: [5, "os5"], op2: [4, "op1"], op3: [4, "os5"], op4: [5, "os5"], op5: [1, "op2", "op3", "op4"],
  // MP P4
  om1: [6, "op5"], om2: [8, "om1"], om3: [8, "om1"], om4: [3, "om2", "om3"],

  // ── SOP v2 通用发布后稳定阶段（入口依赖由 buildSchedTasks 按上一阶段 Gate 注入）
  stability_ramp: [5],
  stability_metrics: [7, "stability_ramp"],
  stability_issues: [2, "stability_metrics"],
  project_close_review: [1, "stability_issues"],
};

/** 把阶段按顺序转成排期任务；模板内联工期/依赖优先，旧模板回退 SCHEDULE_GRAPH。 */
export function buildSchedTasks(phases: Array<{
  gateTaskId?: string;
  bufferDays?: number;
  tasks: Array<{ id: string; durationDays?: number; dependsOn?: string[] }>;
}>): SchedTask[] {
  const out: SchedTask[] = [];
  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
    const phase = phases[phaseIndex];
    const phaseIds = new Set(phase.tasks.map((t) => t.id));
    for (const t of phase.tasks) {
      const g = SCHEDULE_GRAPH[t.id];
      const durationDays = t.durationDays ?? g?.[0] ?? 1;
      let dependsOn = t.dependsOn ?? (g ? (g.slice(1) as string[]) : []);
      if (t.id === "stability_ramp" && dependsOn.length === 0) {
        const previousGate = phases[phaseIndex - 1]?.gateTaskId;
        if (previousGate) dependsOn = [previousGate];
      }
      const isEntry = dependsOn.length === 0 || dependsOn.every((d) => !phaseIds.has(d));
      out.push({ id: t.id, durationDays, dependsOn, lagDays: isEntry ? phase.bufferDays ?? 0 : 0 });
    }
  }
  return out;
}

/** 按 category + 开始日生成整套任务起止日（taskId -> {start, due}） */
export function scheduleForCategory(category: string | undefined, startDate: string, cal?: CalendarExceptions): Schedule {
  return generateSchedule(buildSchedTasks(getPhasesForCategory(category)), startDate, cal);
}

/** Project scheduling starts from the project's already-composed effective phases. */
export function buildProjectSchedTasks(projectLike: ProjectTemplateLike): SchedTask[] {
  return buildSchedTasks(getEffectivePhasesForProjectLike(projectLike));
}

function effectiveProjectTaskIds(projectLike: ProjectTemplateLike): Set<string> {
  return new Set(
    getEffectivePhasesForProjectLike(projectLike)
      .flatMap((phase) => phase.tasks.map((task) => task.id))
  );
}

/**
 * Project-bound dependency graph after effective-phase composition and approved tailoring.
 * Consumers outside scheduling (completion guards, task-ready automation) must
 * use this instead of reading raw template dependsOn edges independently.
 */
export function buildEffectiveProjectSchedTasks(projectLike: ProjectTemplateLike): SchedTask[] {
  return contractSchedTasks(buildProjectSchedTasks(projectLike), effectiveProjectTaskIds(projectLike));
}

export type OperationalTaskGraphRow = {
  taskId: string;
  status?: string | null;
};

/**
 * Runtime project graph: template version/tier/add-ons first, then approved
 * project-level tailoring represented by skipped task rows. Contracting instead
 * of filtering preserves A → B → C as A → C when B is waived.
 */
export function buildOperationalProjectSchedTasks(
  projectLike: ProjectTemplateLike,
  rows: OperationalTaskGraphRow[],
): SchedTask[] {
  const templateGraph = buildEffectiveProjectSchedTasks(projectLike);
  if (rows.length === 0) return templateGraph;
  // Only an explicit skipped row proves approved tailoring. A missing row is a
  // seed/data anomaly and must remain in the graph so execution guards fail
  // closed instead of silently treating it as waived.
  const skippedTaskIds = new Set(
    rows.filter((row) => row.status === "skipped").map((row) => row.taskId),
  );
  const activeTaskIds = new Set(
    templateGraph.filter((task) => !skippedTaskIds.has(task.id)).map((task) => task.id),
  );
  return contractSchedTasks(templateGraph, activeTaskIds);
}

/** Project-bound equivalent; honors template version, tier and add-on packs. */
export function scheduleForProject(
  projectLike: ProjectTemplateLike,
  startDate: string,
  cal?: CalendarExceptions,
): Schedule {
  return generateSchedule(
    buildEffectiveProjectSchedTasks(projectLike),
    startDate,
    cal,
  );
}

/**
 * 计算某 category 的关键路径任务集合（决定整体工期的最长链)。
 * 用于 Gantt 高亮关键路径。
 */
export function criticalPathTasks(category: string | undefined): Set<string> {
  return criticalPathForSchedTasks(buildSchedTasks(getPhasesForCategory(category)));
}

/** Project-bound critical path; honors template version, tier and add-on packs. */
export function criticalPathTasksForProject(projectLike: ProjectTemplateLike): Set<string> {
  return criticalPathForSchedTasks(
    buildEffectiveProjectSchedTasks(projectLike)
  );
}

/**
 * 运行态关键路径：在模板级图之上再收缩"已批准裁剪（skipped 行）"。
 * 甘特高亮必须与服务端排期（buildOperationalProjectSchedTasks）同图源，
 * 否则被裁剪长任务仍被标为关键链，真实驱动链反而不亮。
 */
export function criticalPathTasksForProjectRows(
  projectLike: ProjectTemplateLike,
  rows: OperationalTaskGraphRow[],
): Set<string> {
  return criticalPathForSchedTasks(buildOperationalProjectSchedTasks(projectLike, rows));
}

function criticalPathForSchedTasks(schedTasks: SchedTask[]): Set<string> {
  const idList = schedTasks.map((t) => t.id);
  const ids = new Set<string>(idList);
  const byId = new Map(schedTasks.map((t) => [t.id, t]));
  const finish: Record<string, number> = {};
  const pick: Record<string, string | null> = {};
  const calc = (id: string): number => {
    if (finish[id] != null) return finish[id];
    const task = byId.get(id);
    if (!task) return 0;
    let best = 0, bp: string | null = null;
    for (const dep of (task.dependsOn ?? []).filter((d) => ids.has(d))) {
      const f = calc(dep);
      if (f > best) { best = f; bp = dep; }
    }
    pick[id] = bp;
    return (finish[id] = best + (task.lagDays ?? 0) + Math.max(0, task.durationDays ?? 1));
  };
  let endId: string | null = null, endF = -1;
  for (const id of idList) { const f = calc(id); if (f > endF) { endF = f; endId = id; } }
  const path = new Set<string>();
  let cur: string | null = endId;
  while (cur) { path.add(cur); cur = pick[cur]; }
  return path;
}
