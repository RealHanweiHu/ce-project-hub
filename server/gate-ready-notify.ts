import {
  createAutomationRun,
  finishAutomationClaim,
  getGateReadiness,
  getProjectById,
  tryClaimAutomation,
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
  if (!project?.pmUserId || project.archived || project.lifecycle !== "active" || !readiness?.ready) return false;

  const entityId = `${input.projectId}:${input.phaseId}:ready`;
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const claimKey = `${RULE_KEY}:${input.projectId}:${entityId}`;
  const claim = await tryClaimAutomation({
    claimKey,
    ruleKey: RULE_KEY,
    projectId: input.projectId,
    entityId,
    since,
  });
  if (!claim) return false;

  try {
    const delivery = await notifyPersonal({
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
    if (delivery.site + delivery.dingtalk === 0) {
      throw new Error(delivery.errors.join("；") || "Gate 就绪通知没有渠道实际送达");
    }

    await finishAutomationClaim({ claimKey, token: claim.token, status: "fired" });
    await createAutomationRun({
      ruleKey: RULE_KEY,
      projectId: input.projectId,
      eventType: "gate.ready",
      entityType: "gate_review",
      entityId,
      status: delivery.errors.length > 0 ? "partial" : "fired",
      recipients: { userId: project.pmUserId, ...delivery },
      detail: input.reason ?? "gate ready",
    });
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await finishAutomationClaim({ claimKey, token: claim.token, status: "error", error: detail });
    await createAutomationRun({
      ruleKey: RULE_KEY,
      projectId: input.projectId,
      eventType: "gate.ready",
      entityType: "gate_review",
      entityId,
      status: "error",
      recipients: [],
      detail,
    });
    return false;
  }
}
