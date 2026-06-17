// IPD 消费电子(锂电充气泵/车载吸尘器等)自动排期依赖图。
// 格式：taskId -> [工期(工作日), ...前置任务id]。无前置=阶段入口（依赖上一阶段 gate 由下方手动接上）。
// 工期为首版经验值；buildSchedTasks/scheduleForCategory 支持传入运行时图覆盖。
import {
  generateSchedule,
  resolveScheduleOrder,
  type SchedTask,
  type Schedule,
  type ScheduleOptions,
} from "./scheduling";
import { getPhasesForCategory } from "./sop-templates";

export type ScheduleGraph = Record<string, [number, ...string[]]>;

// 压缩版（目标:整机开发约 3-4 个月）。关键提速:
//  1) 认证(v3)与开模(v4)在「设计冻结 d8」即启动,与 EVT/DVT 并行(长交期项早开工);
//  2) 设计多轨并行(ID/MD/EE/SW);测试项并行;工期按快速消费电子收紧。
// 仍是纯数据,可按实际产品微调。当前关键路径:NPD ≈ DVT 3.1 月 / 试产 3.9 月,ECO ≈ 2.5 月,IDR ≈ 2.6 月。
export const SCHEDULE_GRAPH: ScheduleGraph = {
  // ── NPD ───────────────────────────────────────────────
  // 概念 P1
  c1: [5], c2: [5], c3: [4, "c1", "c2"], c4: [5, "c3"], c5: [4, "c3"], c6: [1, "c4", "c5"],
  // 规划 P2（入口依赖 c6）
  p1: [5, "c6"], p2: [5, "p1"], p3: [4, "p1"], p4: [5, "p2"], p5: [5, "p4"], p6: [4, "c6"], p7: [1, "p2", "p3", "p5", "p6"],
  // 设计 P3（入口依赖 p7，多轨并行）
  d1: [8, "p7"], d2: [9, "d1"], d3: [8, "p7"], d4: [6, "d3"], d5: [9, "p7"], d6: [3, "d2", "d4"], d7: [4, "d4"], d8: [1, "d5", "d6", "d7"],
  // EVT P4（入口依赖 d8）
  e1: [7, "d8"], e2: [5, "e1"], e3: [5, "e1"], e4: [5, "e1"], e5: [3, "e2", "e3", "e4"], e6: [4, "e5"], e7: [1, "e6"],
  // DVT P5（v1 样机依赖 e7；认证 v3、开模 v4 在设计冻结 d8 即启动，与 EVT/DVT 并行）
  v1: [7, "e7"], v2: [8, "v1"], v3: [14, "d8"], v4: [14, "d8"], v5: [7, "v1"], v6: [5, "v1"], v7: [7, "v4"], v8: [1, "v2", "v3", "v4", "v5", "v6", "v7"],
  // PVT P6（入口依赖 v8）
  pv1: [4, "v8"], pv2: [5, "pv1"], pv3: [5, "pv1"], pv4: [5, "pv2", "pv3"], pv5: [4, "pv4"], pv6: [4, "pv4"], pv7: [4, "pv5"], pv8: [1, "pv5", "pv6", "pv7"],
  // MP P7（入口依赖 pv8，量产爬坡）
  mp1: [8, "pv8"], mp2: [8, "mp1"], mp3: [8, "mp1"], mp4: [6, "mp1"], mp5: [10, "mp1"], mp6: [3, "mp2", "mp3"],

  // ── ECO（迭代升级）────────────────────────────────────
  ep1: [2], ep2: [3, "ep1"], ep3: [2, "ep2"], ep4: [2, "ep2"], ep5: [3, "ep3"], ep6: [1, "ep4", "ep5"], ep7: [1, "ep6"],
  ed1: [8, "ep7"], ed2: [8, "ep7"], ed3: [8, "ep7"], ed4: [4, "ed1", "ed2"], ed5: [4, "ed1", "ed2"], ed6: [1, "ed3", "ed4", "ed5"],
  ev1: [8, "ed6"], ev2: [7, "ev1"], ev3: [7, "ev1"], ev4: [12, "ed6"], ev5: [1, "ev2", "ev3", "ev4"],
  epv1: [5, "ev5"], epv2: [7, "epv1"], epv3: [4, "epv1"], epv4: [2, "epv2"], epv5: [1, "epv2", "epv3", "epv4"],
  em1: [8, "epv5"], em2: [8, "em1"], em3: [10, "em1"], em4: [1, "em2", "em3"],

  // ── IDR（外观翻新）────────────────────────────────────
  ir1: [2], ir2: [2], ir3: [3, "ir1", "ir2"], ir4: [4, "ir3"], ir5: [3, "ir3"], ir6: [1, "ir4", "ir5"],
  id1: [8, "ir6"], id2: [10, "id1"], id3: [6, "ir6"], id4: [5, "id1"], id5: [5, "id2", "id3"], id6: [8, "id2"], id7: [1, "id4", "id5", "id6"],
  // 认证 iv5 / 工装 iv4 在设计冻结 id7 即启动，与验证并行
  iv1: [8, "id7"], iv2: [7, "iv1"], iv3: [7, "iv1"], iv4: [12, "id7"], iv5: [15, "id7"], iv6: [5, "iv2"], iv7: [1, "iv3", "iv4", "iv5", "iv6"],
  im1: [6, "iv7"], im2: [8, "im1"], im3: [6, "im1"], im4: [4, "im2"], im5: [6, "im2"], im6: [1, "im3", "im4", "im5"],
};

/** 把某 category 的阶段（按顺序）转成排期任务；工期/依赖取自 graph，缺省 1 天、无依赖。 */
export function buildSchedTasks(
  phases: Array<{ bufferDays?: number; tasks: Array<{ id: string }> }>,
  graph: ScheduleGraph = SCHEDULE_GRAPH
): SchedTask[] {
  const out: SchedTask[] = [];
  for (const phase of phases) {
    const phaseIds = new Set(phase.tasks.map((t) => t.id));
    for (const t of phase.tasks) {
      const g = graph[t.id];
      const durationDays = g ? g[0] : 1;
      const dependsOn = g ? (g.slice(1) as string[]) : [];
      const isEntry = dependsOn.length === 0 || dependsOn.every((d) => !phaseIds.has(d));
      out.push({ id: t.id, durationDays, dependsOn, lagDays: isEntry ? phase.bufferDays ?? 0 : 0 });
    }
  }
  return out;
}

type ScheduleForCategoryOptions = ScheduleOptions & { graph?: ScheduleGraph };

/** 按 category + 开始日生成整套任务起止日（taskId -> {start, due}） */
export function scheduleForCategory(
  category: string | undefined,
  startDate: string,
  options: ScheduleForCategoryOptions = {}
): Schedule {
  return generateSchedule(buildSchedTasks(getPhasesForCategory(category), options.graph), startDate, options);
}

const criticalPathCache = new Map<string, Set<string>>();

export function clearCriticalPathCache(): void {
  criticalPathCache.clear();
}

/**
 * 计算某 category 的关键路径任务集合（决定整体工期的最长链)。
 * 用于 Gantt 高亮关键路径。
 */
export function criticalPathTasks(
  category: string | undefined,
  graph: ScheduleGraph = SCHEDULE_GRAPH
): Set<string> {
  const cacheKey = graph === SCHEDULE_GRAPH ? category ?? "__default" : null;
  const cached = cacheKey ? criticalPathCache.get(cacheKey) : undefined;
  if (cached) return new Set(cached);

  const phases = getPhasesForCategory(category);
  const tasks = buildSchedTasks(phases, graph);
  const order = resolveScheduleOrder(tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const finish: Record<string, number> = {};
  const pick: Record<string, string | null> = {};

  for (const id of order) {
    const task = byId.get(id)!;
    let best = 0;
    let bp: string | null = null;
    for (const dep of task.dependsOn ?? []) {
      const f = finish[dep];
      if (f > best) {
        best = f;
        bp = dep;
      }
    }
    pick[id] = bp;
    finish[id] = best + (task.lagDays ?? 0) + (task.durationDays ?? 1);
  }

  let endId: string | null = null, endF = -1;
  for (const id of order) {
    const f = finish[id];
    if (f > endF) {
      endF = f;
      endId = id;
    }
  }
  const path = new Set<string>();
  let cur: string | null = endId;
  while (cur) { path.add(cur); cur = pick[cur]; }
  if (cacheKey) criticalPathCache.set(cacheKey, new Set(path));
  return path;
}
