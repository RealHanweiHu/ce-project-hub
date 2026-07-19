import { ENV } from "../_core/env";
import { pushWebhook as defaultPushWebhook } from "../_core/notify";
import { sendToGroupChat as defaultNotifyGroup } from "../_core/dingtalkGroup";
import {
  createAutomationRun,
  finishAutomationClaim,
  getProjectById,
  getProjectMembers,
  listAutomationRuleRows,
  seedAutomationRuleDefaults,
  syncAutomationRuleDefaultChanges,
  tryClaimAutomation,
} from "../db";
import {
  AUTOMATION_NOTIFICATION_LAYERING_DEFAULT_CHANGES,
  AUTOMATION_RULES,
  AutomationEvent,
  AutomationMessageContext,
  AutomationRuleConfig,
  BuiltInAutomationRule,
  exceptionEscalationLevel,
  exceptionEscalationRoles,
  parseAutomationRuleConfig,
  RecipientRole,
} from "./rules";
import { DIGEST_RULES } from "./digestRules";
import { isAutomationSuppressedProject } from "./project-filter";
import {
  notifyPersonal,
  type NotifyPersonalDeps,
} from "../notification-gateway";
import { actionDedupeKey, notifyActionItem } from "../action-item-notify";
import {
  notifyTaskReadyActionItems,
  type TaskReadyDeps,
  type TaskReadyResult,
} from "./taskReady";
import {
  buildDeliverableReviewActionPath,
  buildIssueValidationActionPath,
  buildProjectActionPath,
  buildTaskAssignmentActionPath,
  buildTaskCompletionActionPath,
} from "../../shared/action-links";
import {
  ProjectExternalOperationBlockedError,
  withProjectExternalOperation,
} from "../project-external-operation";
import { isDingtalkDeliveryEnabled as defaultIsDingtalkDeliveryEnabled } from "../_core/dingtalk-delivery-policy";

type ResolvedRecipients = {
  userIds: number[];
  pushGroup: boolean;
  /** 项目专属钉钉群 id;有则群提醒发到此群,否则回退全局机器人 webhook */
  chatId: string | null;
};

type DispatchDeps = TaskReadyDeps & {
  pushWebhook?: (
    text: string,
    opts?: { title?: string; markdown?: string }
  ) => Promise<boolean | void>;
  notifyGroup?: (
    chatId: string,
    title: string,
    markdown: string
  ) => Promise<boolean>;
  loadProjectMembers?: typeof getProjectMembers;
  notifyTaskReady?: (
    event: AutomationEvent,
    project: Parameters<typeof notifyTaskReadyActionItems>[1],
    deps?: TaskReadyDeps
  ) => Promise<TaskReadyResult>;
  allowAutomationTestProjects?: boolean;
  runProjectOperation?: typeof withProjectExternalOperation;
};

let seededDefaults = false;

export type AutomationRunSummary = {
  matched: number;
  fired: number;
  partial: number;
  skipped: number;
  errors: number;
};

export async function ensureAutomationRuleDefaults(): Promise<void> {
  if (seededDefaults) return;
  await seedAutomationRuleDefaults([
    ...AUTOMATION_RULES.map(rule => ({
      ruleKey: rule.key,
      enabled: rule.defaultEnabled,
      config: toConfigRecord(rule.defaultConfig),
    })),
    ...DIGEST_RULES.map(rule => ({
      ruleKey: rule.key,
      enabled: rule.defaultEnabled,
      config: { ...rule.defaultConfig } as Record<string, unknown>,
    })),
  ]);
  await syncAutomationRuleDefaultChanges(
    AUTOMATION_NOTIFICATION_LAYERING_DEFAULT_CHANGES
  );
  seededDefaults = true;
}

export async function runAutomation(
  event: AutomationEvent,
  deps: DispatchDeps = {}
): Promise<AutomationRunSummary> {
  const isDingtalkDeliveryEnabled =
    deps.isDingtalkDeliveryEnabled ??
    (deps.notifyDingtalk || deps.notifyGroup || deps.pushWebhook
      ? () => true
      : defaultIsDingtalkDeliveryEnabled);
  const dingtalkDeliveryEnabled = isDingtalkDeliveryEnabled();
  const summary: AutomationRunSummary = {
    matched: 0,
    fired: 0,
    partial: 0,
    skipped: 0,
    errors: 0,
  };
  await ensureAutomationRuleDefaults();
  const projectId = projectIdForEvent(event);
  const project = projectId ? await getProjectById(projectId) : undefined;
  if (projectId) {
    if (!project || project.archived || project.lifecycle !== "active")
      return summary;
    if (
      !deps.allowAutomationTestProjects &&
      isAutomationSuppressedProject(project)
    )
      return summary;
  }
  const isProjectActive =
    deps.isProjectActive ??
    (async (id: string) => {
      const current = await getProjectById(id);
      return Boolean(
        current && !current.archived && current.lifecycle === "active"
      );
    });
  const runProjectOperation =
    deps.runProjectOperation ??
    (deps.notifyGroup || deps.pushWebhook
      ? async <T>(
          _projectIds: readonly string[],
          _kind: string,
          operation: () => Promise<T>
        ) => operation()
      : withProjectExternalOperation);
  let membersPromise: ReturnType<typeof getProjectMembers> | null = null;
  const loadMembers = () => {
    if (!projectId) return Promise.resolve([]);
    membersPromise ??= (deps.loadProjectMembers ?? getProjectMembers)(
      projectId
    );
    return membersPromise;
  };

  const rows = await listAutomationRuleRows();
  const rowByKey = new Map(rows.map(row => [row.ruleKey, row]));
  const eventTrigger = event.action === "scheduled" ? "scheduled" : "event";

  for (const rule of AUTOMATION_RULES) {
    if (rule.triggerType !== eventTrigger) continue;
    const row = rowByKey.get(rule.key);
    if (!row?.enabled) continue;

    let entityId: string | null | undefined;
    let claim: { claimKey: string; token: string } | null = null;
    try {
      const config = parseAutomationRuleConfig(rule.key, row.config ?? {});
      if (!rule.matches(event, config)) continue;
      summary.matched += 1;

      entityId = entityIdForRuleRun(rule, event, config);
      const cadenceHours =
        rule.triggerType === "scheduled"
          ? getCadenceHours(config)
          : getEventCadenceHours(config);
      if (
        entityId &&
        (cadenceHours !== null || event.sourceActivityLogId != null)
      ) {
        const since =
          cadenceHours === null
            ? undefined
            : new Date(Date.now() - cadenceHours * 60 * 60 * 1000);
        // Cadence rules intentionally share one stable key across source logs;
        // otherwise each tailer row would bypass the rolling suppression.
        const claimKey = automationClaimKey(
          rule.key,
          projectId,
          entityId,
          cadenceHours === null ? event.sourceActivityLogId : null
        );
        const acquired = await tryClaimAutomation({
          claimKey,
          ruleKey: rule.key,
          projectId,
          entityId,
          sourceActivityLogId: event.sourceActivityLogId ?? null,
          ...(since ? { since } : {}),
        });
        if (!acquired) {
          const reason =
            cadenceHours === null
              ? `dedup activity ${event.sourceActivityLogId}`
              : `dedup within ${cadenceHours}h`;
          await writeRun(rule, event, "skipped", [], reason, entityId);
          summary.skipped += 1;
          continue;
        }
        claim = { claimKey, token: acquired.token };
      }

      if (rule.key === "task_ready_notify") {
        const result = project
          ? await (deps.notifyTaskReady ?? notifyTaskReadyActionItems)(
              event,
              project,
              deps
            )
          : { eligible: 0, dispatched: 0 };
        const fired = result.dispatched > 0;
        if (claim) {
          await finishAutomationClaim({
            ...claim,
            status: fired ? "fired" : "skipped",
          });
        }
        await writeRun(
          rule,
          event,
          fired ? "fired" : "skipped",
          fired ? [{ channel: "action_item", count: result.dispatched }] : [],
          `eligible ${result.eligible}; dispatched ${result.dispatched}`,
          entityId
        );
        if (fired) summary.fired += 1;
        else summary.skipped += 1;
        continue;
      }

      const ctx = buildMessageContext(event, project);
      const message = rule.buildMessage(event, config, ctx);
      // Only matching, successfully claimed rules need recipient expansion.
      // Multiple matching rules share one lazy query per automation event.
      const members = await loadMembers();
      const recipients = resolveRecipients(
        rule,
        event,
        config,
        project,
        members
      );
      const delivered: unknown[] = [];
      const deliveryErrors: string[] = [];

      if (
        recipients.userIds.length === 0 &&
        (!recipients.pushGroup || !dingtalkDeliveryEnabled)
      ) {
        if (claim) await finishAutomationClaim({ ...claim, status: "skipped" });
        await writeRun(
          rule,
          event,
          "skipped",
          [],
          recipients.pushGroup
            ? "DingTalk delivery disabled for this environment"
            : "no recipients",
          entityId
        );
        summary.skipped += 1;
        continue;
      }

      if (recipients.userIds.length > 0) {
        if (rule.key === "delay_impact_notify" && projectId) {
          const count = await notifyDelayImpactActionItems(
            event,
            recipients.userIds,
            message,
            projectId,
            entityId,
            deps
          );
          delivered.push(
            ...Array.from({ length: count }, (_, index) => ({
              channel: "action_item",
              index,
            }))
          );
        } else {
          const personal = await notifyPersonal(
            {
              eventKey: rule.key,
              projectId,
              userIds: recipients.userIds,
              title: message.title,
              body: message.text,
              markdown: message.markdown ?? message.text,
              entityType: event.entityType,
              entityId: entityId ?? entityIdForRun(event),
              actionPath: actionPathForAutomationEvent(event, projectId),
              priority: deliveryPriority(event),
            },
            deps
          );
          delivered.push(
            ...recipients.userIds
              .slice(0, personal.site)
              .map(userId => ({ userId, channel: "site" })),
            ...recipients.userIds
              .slice(0, personal.dingtalk)
              .map(userId => ({ userId, channel: "dingtalk" }))
          );
          deliveryErrors.push(...personal.errors);
        }
      }

      if (
        recipients.pushGroup &&
        dingtalkDeliveryEnabled &&
        (!projectId || (await isProjectActive(projectId)))
      ) {
        try {
          await runProjectOperation(
            projectId ? [projectId] : [],
            `automation:${rule.key}:group`,
            async () => {
              if (projectId && !(await isProjectActive(projectId))) {
                throw new ProjectExternalOperationBlockedError();
              }
              const link = ENV.appBaseUrl
                ? `\n\n[打开 CE Project Hub](${ENV.appBaseUrl}/)`
                : "";
              const md = `${message.markdown ?? message.text}${link}`;
              if (recipients.chatId) {
                const notifyGroup = deps.notifyGroup ?? defaultNotifyGroup;
                const groupDelivered = await notifyGroup(
                  recipients.chatId,
                  message.title,
                  md
                );
                if (groupDelivered)
                  delivered.push({ group: true, channel: "project_group" });
                else deliveryErrors.push("项目群发送失败");
              }
              if (
                !recipients.chatId ||
                !delivered.some(
                  item =>
                    (item as { channel?: string }).channel === "project_group"
                )
              ) {
                const pushWebhook = deps.pushWebhook ?? defaultPushWebhook;
                const webhookResult = await pushWebhook(message.text, {
                  title: message.title,
                  markdown: md,
                });
                if (webhookResult === false)
                  deliveryErrors.push("群机器人 webhook 发送失败或未配置");
                else delivered.push({ group: true, channel: "webhook" });
              }
            }
          );
        } catch (error) {
          if (!(error instanceof ProjectExternalOperationBlockedError))
            throw error;
        }
      }

      if (
        delivered.length === 0 &&
        projectId &&
        !(await isProjectActive(projectId))
      ) {
        if (claim) await finishAutomationClaim({ ...claim, status: "skipped" });
        await writeRun(
          rule,
          event,
          "skipped",
          [],
          "project became inactive before delivery",
          entityId
        );
        summary.skipped += 1;
        continue;
      }

      if (delivered.length === 0) {
        throw new Error(deliveryErrors.join("；") || "没有渠道实际送达");
      }
      if (claim) await finishAutomationClaim({ ...claim, status: "fired" });
      await writeRun(
        rule,
        event,
        deliveryErrors.length > 0 ? "partial" : "fired",
        delivered,
        deliveryErrors.length > 0
          ? `${message.text}；${deliveryErrors.join("；")}`
          : message.text,
        entityId
      );
      if (deliveryErrors.length > 0) summary.partial += 1;
      else summary.fired += 1;
    } catch (error) {
      if (claim) {
        await finishAutomationClaim({
          ...claim,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await writeRun(
        rule,
        event,
        "error",
        [],
        error instanceof Error ? error.message : String(error),
        entityId
      );
      summary.errors += 1;
    }
  }
  return summary;
}

async function notifyDelayImpactActionItems(
  event: AutomationEvent,
  userIds: number[],
  message: { title: string; text: string; markdown?: string },
  projectId: string,
  entityId: string | null | undefined,
  deps: NotifyPersonalDeps
): Promise<number> {
  const taskId = String(event.after?.taskId ?? event.entityId ?? "");
  const actionEntityId = entityId ?? entityIdForRun(event) ?? taskId;
  if (!actionEntityId) return 0;
  let dispatched = 0;
  for (const userId of userIds) {
    const result = await notifyActionItem(
      {
        kind: "delay_impact_notify",
        projectId,
        entityType: "task",
        entityId: String(actionEntityId),
        dedupeKey: actionDedupeKey({
          kind: "delay_impact_notify",
          projectId,
          entityId: String(actionEntityId),
          recipientUserId: userId,
        }),
        recipientUserId: userId,
        title: message.title,
        body: message.text,
        actionPath:
          actionPathForAutomationEvent(event, projectId) ??
          buildProjectActionPath({ projectId, tab: "tasks" }),
        priority: "high",
        metadata: {
          taskId: taskId || String(actionEntityId),
          startDate:
            typeof event.after?.startDate === "string"
              ? event.after.startDate
              : null,
          dueDate:
            typeof event.after?.dueDate === "string"
              ? event.after.dueDate
              : null,
          impact: event.impact ?? null,
        },
      },
      deps
    );
    if (result.dispatched) dispatched += 1;
  }
  return dispatched;
}

function resolveRecipients(
  rule: BuiltInAutomationRule,
  event: AutomationEvent,
  config: AutomationRuleConfig,
  project: Awaited<ReturnType<typeof getProjectById>>,
  members: Awaited<ReturnType<typeof getProjectMembers>>
): ResolvedRecipients {
  const userIds = new Set<number>();
  // 优先用规则 config 里的 notifyRoles（如逾期催办可配通知对象）；没配则回退到规则静态 recipientRoles
  const configuredRoles = (config as { notifyRoles?: RecipientRole[] })
    .notifyRoles;
  const effectiveRoles =
    rule.key === "exception_escalation"
      ? exceptionEscalationRoles(
          event,
          config as Parameters<typeof exceptionEscalationRoles>[1]
        )
      : Array.isArray(configuredRoles) && configuredRoles.length > 0
        ? configuredRoles
        : rule.recipientRoles;
  const roles = effectiveRoles.filter(role => role !== "group");

  for (const role of roles) {
    for (const userId of resolveRole(role, event, project, members)) {
      userIds.add(userId);
    }
  }

  return {
    userIds: Array.from(userIds),
    pushGroup: Boolean((config as { pushGroup?: boolean }).pushGroup),
    chatId: project?.dingtalkChatId ?? null,
  };
}

function resolveRole(
  role: Exclude<RecipientRole, "group">,
  event: AutomationEvent,
  project: Awaited<ReturnType<typeof getProjectById>>,
  members: Awaited<ReturnType<typeof getProjectMembers>>
): number[] {
  if (role === "pm") return project?.pmUserId ? [project.pmUserId] : [];
  if (role === "owner") return project?.createdBy ? [project.createdBy] : [];
  if (role === "manager")
    return members.filter(m => m.role === "manager").map(m => m.userId);
  if (role === "assignee") {
    const assigneeId =
      numberField(event.after, "assigneeUserId") ??
      numberField(event.before, "assigneeUserId") ??
      numberField(event.after, "reviewerUserId") ??
      numberField(event.before, "reviewerUserId");
    if (assigneeId) {
      const allowed = new Set([
        ...members.map(member => member.userId),
        ...(project?.createdBy ? [project.createdBy] : []),
        ...(project?.pmUserId ? [project.pmUserId] : []),
      ]);
      return allowed.has(assigneeId) ? [assigneeId] : [];
    }
    return resolveMemberByName(
      members,
      stringField(event.after, "owner") ?? stringField(event.before, "owner")
    );
  }
  if (role === "reporter") {
    const creatorId =
      numberField(event.after, "creatorId") ??
      numberField(event.before, "creatorId");
    if (creatorId) return [creatorId];
    return resolveMemberByName(
      members,
      stringField(event.after, "reporter") ??
        stringField(event.before, "reporter")
    );
  }
  return [];
}

function resolveMemberByName(
  members: Awaited<ReturnType<typeof getProjectMembers>>,
  name: string | null
): number[] {
  if (!name) return [];
  const normalized = name.trim().toLowerCase();
  if (!normalized) return [];
  return members
    .filter(
      member =>
        member.userName?.trim().toLowerCase() === normalized ||
        member.userEmail?.trim().toLowerCase() === normalized
    )
    .map(member => member.userId);
}

function buildMessageContext(
  event: AutomationEvent,
  project: Awaited<ReturnType<typeof getProjectById>>
): AutomationMessageContext {
  return {
    projectName: project?.name ?? null,
    entityTitle:
      stringField(event.after, "title") ??
      stringField(event.after, "name") ??
      stringField(event.after, "gateName") ??
      stringField(event.after, "deliverableName") ??
      stringField(event.after, "taskId") ??
      null,
    productName: stringField(event.after, "productName"),
    revisionLabel: stringField(event.after, "revisionLabel"),
  };
}

async function writeRun(
  rule: BuiltInAutomationRule,
  event: AutomationEvent,
  status: "fired" | "partial" | "skipped" | "error",
  recipients: unknown,
  detail: string,
  entityIdOverride?: string | null
): Promise<void> {
  try {
    await createAutomationRun({
      ruleKey: rule.key,
      projectId: event.projectId ?? null,
      eventType: event.action,
      entityType: event.entityType,
      entityId: entityIdOverride ?? entityIdForRun(event),
      status,
      recipients,
      detail: detail.slice(0, 1000),
    });
  } catch (error) {
    console.warn("[automation] failed to write run (non-fatal):", error);
  }
}

function serializeRecipients(recipients: ResolvedRecipients) {
  return [
    ...recipients.userIds.map(userId => ({ userId, channel: "site" })),
    ...(recipients.pushGroup ? [{ group: true, channel: "webhook" }] : []),
  ];
}

function entityIdForRun(event: AutomationEvent): string | null {
  return event.entityId == null ? null : String(event.entityId);
}

function entityIdForRuleRun(
  rule: BuiltInAutomationRule,
  event: AutomationEvent,
  config: AutomationRuleConfig
): string | null {
  const base = entityIdForRun(event);
  if (!base) return base;
  const projectId = projectIdForEvent(event);
  const phaseId =
    stringField(event.after, "phaseId") ?? stringField(event.before, "phaseId");
  const scoped =
    !projectId || base.startsWith(`${projectId}:`)
      ? base
      : event.entityType === "task" && phaseId
        ? `${projectId}:${phaseId}:${base}`
        : `${projectId}:${base}`;
  if (rule.key !== "exception_escalation") return scoped;
  const level = exceptionEscalationLevel(
    event,
    config as Parameters<typeof exceptionEscalationLevel>[1]
  );
  return level ? `${scoped}:${level}` : scoped;
}

function automationClaimKey(
  ruleKey: string,
  projectId: string | null,
  entityId: string,
  sourceActivityLogId?: number | null
): string {
  const source =
    sourceActivityLogId == null ? "cadence" : `activity:${sourceActivityLogId}`;
  return `${ruleKey}:${projectId ?? "global"}:${entityId}:${source}`;
}

function projectIdForEvent(event: AutomationEvent): string | null {
  return (
    event.projectId ??
    stringField(event.after, "projectId") ??
    stringField(event.before, "projectId")
  );
}

function actionPathForAutomationEvent(
  event: AutomationEvent,
  projectId: string | null
): string | null {
  if (!projectId) return ENV.appBaseUrl ? "/" : null;
  if (event.entityType === "task") {
    const parsed = parseTaskTarget(event, projectId);
    if (
      event.after?.assignmentAction === true &&
      parsed.phaseId &&
      parsed.taskId
    ) {
      return buildTaskAssignmentActionPath({
        projectId,
        phaseId: parsed.phaseId,
        taskId: parsed.taskId,
      });
    }
    if (parsed.phaseId && parsed.taskId) {
      return buildTaskCompletionActionPath({
        projectId,
        phaseId: parsed.phaseId,
        taskId: parsed.taskId,
      });
    }
    return buildProjectActionPath({
      projectId,
      tab: "tasks",
      phaseId: parsed.phaseId,
      taskId: parsed.taskId,
    });
  }
  if (event.entityType === "issue") {
    const phaseId =
      stringField(event.after, "phaseId") ??
      stringField(event.before, "phaseId");
    const issueId = event.entityId == null ? null : String(event.entityId);
    const status =
      stringField(event.after, "status") ?? stringField(event.before, "status");
    if (phaseId && issueId && status === "resolved") {
      return buildIssueValidationActionPath({ projectId, phaseId, issueId });
    }
    return buildProjectActionPath({
      projectId,
      tab: "issues",
      phaseId,
    });
  }
  if (event.entityType === "deliverable_review") {
    const phaseId =
      stringField(event.after, "phaseId") ??
      stringField(event.before, "phaseId");
    const deliverableName =
      stringField(event.after, "deliverableName") ??
      stringField(event.before, "deliverableName");
    if (phaseId && deliverableName) {
      return buildDeliverableReviewActionPath({
        projectId,
        phaseId,
        deliverableName,
      });
    }
    return buildProjectActionPath({
      projectId,
      tab: "reviews",
      phaseId,
    });
  }
  if (event.entityType === "gate_review") {
    return buildProjectActionPath({
      projectId,
      tab: "reviews",
      phaseId:
        stringField(event.after, "phaseId") ??
        stringField(event.before, "phaseId"),
    });
  }
  return buildProjectActionPath({ projectId, tab: "overview" });
}

function parseTaskTarget(
  event: AutomationEvent,
  projectId: string
): { phaseId?: string; taskId?: string } {
  const phaseId =
    stringField(event.after, "phaseId") ?? stringField(event.before, "phaseId");
  const taskId =
    stringField(event.after, "taskId") ?? stringField(event.before, "taskId");
  if (phaseId || taskId)
    return { phaseId: phaseId ?? undefined, taskId: taskId ?? undefined };
  const raw = event.entityId == null ? "" : String(event.entityId);
  const parts = raw.split(":");
  if (parts[0] === projectId && parts.length >= 3) {
    return { phaseId: parts[1], taskId: parts[2] };
  }
  if (parts[0] === "gate" && parts[1] === projectId && parts[2]) {
    return { taskId: parts[2] };
  }
  return {};
}

function getCadenceHours(config: AutomationRuleConfig): number {
  const value = (config as { cadenceHours?: unknown }).cadenceHours;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 24;
}

function getEventCadenceHours(config: AutomationRuleConfig): number | null {
  if (
    !Object.prototype.hasOwnProperty.call(
      config as Record<string, unknown>,
      "cadenceHours"
    )
  )
    return null;
  const value = (config as { cadenceHours?: unknown }).cadenceHours;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function numberField(
  record: Record<string, unknown> | null | undefined,
  key: string
): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(
  record: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function deliveryPriority(
  event: AutomationEvent
): "critical" | "high" | undefined {
  const severity =
    stringField(event.after, "severity") ??
    stringField(event.before, "severity");
  if (severity === "P0") return "critical";
  if (severity === "P1") return "high";
  const priority =
    stringField(event.after, "priority") ??
    stringField(event.before, "priority");
  if (priority === "critical") return "critical";
  if (priority === "high") return "high";
  return undefined;
}

function toConfigRecord(config: AutomationRuleConfig): Record<string, unknown> {
  return { ...(config as Record<string, unknown>) };
}
