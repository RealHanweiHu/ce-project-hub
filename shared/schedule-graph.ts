// IPD 消费电子(锂电充气泵/车载吸尘器等)自动排期依赖图。
// 格式：taskId -> [工期(日历日), ...前置任务id]。无前置=阶段入口（依赖上一阶段 gate 由下方手动接上）。
// 工期为首版经验值，可随时调（纯数据，不改逻辑）。
import { generateSchedule, type SchedTask, type Schedule } from "./scheduling";
import { getPhasesForCategory } from "./sop-templates";

type G = Record<string, [number, ...string[]]>;

export const SCHEDULE_GRAPH: G = {
  // ── NPD ───────────────────────────────────────────────
  // 概念 P1
  c1: [7], c2: [7], c3: [5, "c1", "c2"], c4: [7, "c3"], c5: [5, "c3"], c6: [1, "c4", "c5"],
  // 规划 P2（入口依赖 c6）
  p1: [10, "c6"], p2: [10, "p1"], p3: [5, "p1"], p4: [7, "p2"], p5: [14, "p4"], p6: [5, "c6"], p7: [1, "p2", "p3", "p5", "p6"],
  // 设计 P3（入口依赖 p7）
  d1: [15, "p7"], d2: [20, "d1"], d3: [15, "p7"], d4: [12, "d3"], d5: [15, "p7"], d6: [7, "d2", "d4"], d7: [10, "d4"], d8: [2, "d5", "d6", "d7"],
  // EVT P4（入口依赖 d8）
  e1: [15, "d8"], e2: [10, "e1"], e3: [10, "e1"], e4: [12, "e1"], e5: [5, "e2", "e3", "e4"], e6: [12, "e5"], e7: [2, "e6"],
  // DVT P5（入口依赖 e7）
  v1: [18, "e7"], v2: [25, "v1"], v3: [30, "v1"], v4: [30, "e7"], v5: [18, "v1"], v6: [12, "v1"], v7: [12, "v4"], v8: [2, "v2", "v3", "v4", "v5", "v6", "v7"],
  // PVT P6（入口依赖 v8）
  pv1: [7, "v8"], pv2: [10, "pv1"], pv3: [14, "pv1"], pv4: [10, "pv2", "pv3"], pv5: [12, "pv4"], pv6: [7, "pv4"], pv7: [7, "pv5"], pv8: [2, "pv5", "pv6", "pv7"],
  // MP P7（入口依赖 pv8）
  mp1: [15, "pv8"], mp2: [20, "mp1"], mp3: [20, "mp1"], mp4: [10, "mp1"], mp5: [20, "mp1"], mp6: [5, "mp2", "mp3"],

  // ── ECO（迭代升级）────────────────────────────────────
  ep1: [3], ep2: [5, "ep1"], ep3: [3, "ep2"], ep4: [3, "ep2"], ep5: [5, "ep3"], ep6: [2, "ep4", "ep5"], ep7: [1, "ep6"],
  ed1: [12, "ep7"], ed2: [12, "ep7"], ed3: [12, "ep7"], ed4: [5, "ed1", "ed2"], ed5: [5, "ed1", "ed2"], ed6: [2, "ed3", "ed4", "ed5"],
  ev1: [12, "ed6"], ev2: [10, "ev1"], ev3: [10, "ev1"], ev4: [18, "ev1"], ev5: [2, "ev2", "ev3", "ev4"],
  epv1: [7, "ev5"], epv2: [10, "epv1"], epv3: [5, "epv1"], epv4: [3, "epv2"], epv5: [2, "epv2", "epv3", "epv4"],
  em1: [15, "epv5"], em2: [12, "em1"], em3: [15, "em1"], em4: [2, "em2", "em3"],

  // ── IDR（外观翻新）────────────────────────────────────
  ir1: [3], ir2: [3], ir3: [5, "ir1", "ir2"], ir4: [7, "ir3"], ir5: [5, "ir3"], ir6: [1, "ir4", "ir5"],
  id1: [15, "ir6"], id2: [20, "id1"], id3: [10, "ir6"], id4: [8, "id1"], id5: [7, "id2", "id3"], id6: [15, "id2"], id7: [2, "id4", "id5", "id6"],
  iv1: [15, "id7"], iv2: [10, "iv1"], iv3: [10, "iv1"], iv4: [20, "iv1"], iv5: [25, "iv1"], iv6: [7, "iv2"], iv7: [2, "iv3", "iv4", "iv5", "iv6"],
  im1: [7, "iv7"], im2: [10, "im1"], im3: [7, "im1"], im4: [5, "im2"], im5: [7, "im2"], im6: [2, "im3", "im4", "im5"],
};

/** 把某 category 的阶段（按顺序）转成排期任务；工期/依赖取自 SCHEDULE_GRAPH，缺省 1 天、无依赖。 */
export function buildSchedTasks(phases: Array<{ bufferDays?: number; tasks: Array<{ id: string }> }>): SchedTask[] {
  const out: SchedTask[] = [];
  for (const phase of phases) {
    const phaseIds = new Set(phase.tasks.map((t) => t.id));
    for (const t of phase.tasks) {
      const g = SCHEDULE_GRAPH[t.id];
      const durationDays = g ? g[0] : 1;
      const dependsOn = g ? (g.slice(1) as string[]) : [];
      const isEntry = dependsOn.length === 0 || dependsOn.every((d) => !phaseIds.has(d));
      out.push({ id: t.id, durationDays, dependsOn, lagDays: isEntry ? phase.bufferDays ?? 0 : 0 });
    }
  }
  return out;
}

/** 按 category + 开始日生成整套任务起止日（taskId -> {start, due}） */
export function scheduleForCategory(category: string | undefined, startDate: string): Schedule {
  return generateSchedule(buildSchedTasks(getPhasesForCategory(category)), startDate);
}
