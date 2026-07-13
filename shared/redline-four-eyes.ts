import type { ProjectTemplateLike } from "./npd-v3";
import { getEffectivePhasesForProjectLike, getNpdV3RedlinePolicy } from "./npd-v3";
import { SOP_TEMPLATE_VERSION_NPD_V3 } from "./sop-templates";
import { TASK_DELIVERABLES } from "./task-deliverables";
import type { GateSignoffSlot } from "./gate-signoffs";

export type RedlineKind = "safety_certification" | "production_release" | "customer_release";

const LEGACY_SAFETY = new Set(["p5a", "d6a", "d7a", "d7b", "p6a", "v3", "pv3"]);
const V3_SAFETY = new Set(["pb1", "pb2", "pc1", "pc2", "npv2"]);
const LEGACY_PRODUCTION = new Set(["pv8"]);
const V3_PRODUCTION = new Set(["npv5"]);
const LEGACY_CUSTOMER = new Set(["mp1"]);
const V3_CUSTOMER = new Set(["nm1"]);

export function redlineKindForTask(project: ProjectTemplateLike, taskId: string): RedlineKind | null {
  if (project.category !== "npd") return null;
  if (project.sopTemplateVersion === SOP_TEMPLATE_VERSION_NPD_V3) {
    if (!getNpdV3RedlinePolicy(project).taskIds.has(taskId)) return null;
    if (V3_PRODUCTION.has(taskId)) return "production_release";
    if (V3_CUSTOMER.has(taskId)) return "customer_release";
    if (V3_SAFETY.has(taskId)) return "safety_certification";
    // Active redline add-on tasks are safety/certification by definition.
    return "safety_certification";
  }
  if (LEGACY_SAFETY.has(taskId)) return "safety_certification";
  if (LEGACY_PRODUCTION.has(taskId)) return "production_release";
  if (LEGACY_CUSTOMER.has(taskId)) return "customer_release";
  return null;
}

export function redlineKindForDeliverable(
  project: ProjectTemplateLike,
  phaseId: string,
  deliverableName: string,
): RedlineKind | null {
  const phase = getEffectivePhasesForProjectLike(project).find((item) => item.id === phaseId);
  for (const task of phase?.tasks ?? []) {
    if (!(TASK_DELIVERABLES[task.id] ?? []).includes(deliverableName)) continue;
    const kind = redlineKindForTask(project, task.id);
    if (kind) return kind;
  }
  return null;
}

export function redlineKindForGateSlot(
  project: ProjectTemplateLike,
  phaseId: string,
  slot: GateSignoffSlot,
): RedlineKind | null {
  const phase = getEffectivePhasesForProjectLike(project).find((item) => item.id === phaseId);
  if (phase?.isReleaseGate) return "production_release";
  if (slot === "certification") return "safety_certification";
  if (slot === "customer") return "customer_release";
  return null;
}

export function assertFourEyes(submitterUserId: number | null | undefined, reviewerUserId: number): void {
  if (submitterUserId != null && submitterUserId === reviewerUserId) {
    throw new Error("红线对象必须由另一位自然人复核；请由管理层代签、指定生效代理人或配置兜底审核人");
  }
}
