import {
  createAutomationRun,
  getGateReadiness,
  getProjectById,
  hasRecentAutomationFire,
} from "./db";
import { notifyPersonal } from "./notification-gateway";
import { buildProjectActionPath } from "../shared/action-links";

const RULE_KEY = "gate_ready_notify";
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function notifyGateReadyIfReady(input: {
  projectId: string;
  phaseId: string;
  actorId?: number | null;
  reason?: string;
}): Promise<boolean> {
  const [project, readiness] = await Promise.all([
    getProjectById(input.projectId),
    getGateReadiness(input.projectId, input.phaseId),
  ]);
  if (!project?.pmUserId || !readiness?.ready) return false;

  const entityId = `${input.projectId}:${input.phaseId}:ready`;
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  if (await hasRecentAutomationFire({ ruleKey: RULE_KEY, entityId, since })) return false;

  await notifyPersonal({
    eventKey: RULE_KEY,
    userIds: [project.pmUserId],
    title: "Gate 已就绪",
    body: `${project.name} · ${input.phaseId} 已满足 Gate 前置条件，可发起评审。`,
    entityType: "gate_review",
    entityId,
    actionUrl: buildProjectActionPath({
      projectId: input.projectId,
      tab: "reviews",
      phaseId: input.phaseId,
    }),
    priority: "high",
    bestEffortDingtalk: true,
  });

  await createAutomationRun({
    ruleKey: RULE_KEY,
    projectId: input.projectId,
    eventType: "gate.ready",
    entityType: "gate_review",
    entityId,
    status: "fired",
    recipients: [project.pmUserId],
    detail: input.reason ?? "gate ready",
  });
  return true;
}
