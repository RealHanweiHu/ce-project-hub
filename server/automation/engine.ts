import { ENV } from "../_core/env";
import { pushWebhook as defaultPushWebhook } from "../_core/notify";
import { notifyUsersViaDingtalk as defaultNotifyDingtalk } from "../_core/dingtalkMessage";
import { sendToGroupChat as defaultNotifyGroup } from "../_core/dingtalkGroup";
import {
  createAutomationRun,
  createNotification as defaultCreateNotification,
  getProjectById,
  getProjectMembers,
  hasRecentAutomationFire,
  listAutomationRuleRows,
  seedAutomationRuleDefaults,
} from "../db";
import {
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

type ResolvedRecipients = {
  userIds: number[];
  pushGroup: boolean;
  /** 项目专属钉钉群 id;有则群提醒发到此群,否则回退全局机器人 webhook */
  chatId: string | null;
};

type DispatchDeps = {
  createNotification?: typeof defaultCreateNotification;
  pushWebhook?: typeof defaultPushWebhook;
  notifyDingtalk?: (userIds: number[], title: string, markdown: string) => Promise<void>;
  notifyGroup?: (chatId: string, title: string, markdown: string) => Promise<boolean>;
  allowAutomationTestProjects?: boolean;
};

let seededDefaults = false;

export async function ensureAutomationRuleDefaults(): Promise<void> {
  if (seededDefaults) return;
  await seedAutomationRuleDefaults([
    ...AUTOMATION_RULES.map((rule) => ({
      ruleKey: rule.key,
      enabled: rule.defaultEnabled,
      config: toConfigRecord(rule.defaultConfig),
    })),
    ...DIGEST_RULES.map((rule) => ({
      ruleKey: rule.key,
      enabled: rule.defaultEnabled,
      config: { ...rule.defaultConfig } as Record<string, unknown>,
    })),
  ]);
  seededDefaults = true;
}

export async function runAutomation(event: AutomationEvent, deps: DispatchDeps = {}): Promise<void> {
  await ensureAutomationRuleDefaults();
  const projectId = projectIdForEvent(event);
  if (projectId) {
    const project = await getProjectById(projectId);
    if (event.action !== "mp.release" && (!project || project.archived)) return;
    if (!deps.allowAutomationTestProjects && isAutomationSuppressedProject(project)) return;
  }

  const rows = await listAutomationRuleRows();
  const rowByKey = new Map(rows.map((row) => [row.ruleKey, row]));
  const eventTrigger = event.action === "scheduled" ? "scheduled" : "event";

  for (const rule of AUTOMATION_RULES) {
    if (rule.triggerType !== eventTrigger) continue;
    const row = rowByKey.get(rule.key);
    if (!row?.enabled) continue;

    let entityId: string | null | undefined;
    try {
      const config = parseAutomationRuleConfig(rule.key, row.config ?? {});
      if (!rule.matches(event, config)) continue;

      entityId = entityIdForRuleRun(rule, event, config);
      const cadenceHours = rule.triggerType === "scheduled"
        ? getCadenceHours(config)
        : getEventCadenceHours(config);
      if (cadenceHours !== null && entityId) {
        const since = new Date(Date.now() - cadenceHours * 60 * 60 * 1000);
        if (await hasRecentAutomationFire({ ruleKey: rule.key, entityId, since })) {
          await writeRun(rule, event, "skipped", [], `dedup within ${cadenceHours}h`, entityId);
          continue;
        }
      }

      const ctx = await buildMessageContext(event);
      const message = rule.buildMessage(event, config, ctx);
      const recipients = await resolveRecipients(rule, event, config);

      if (recipients.userIds.length === 0 && !recipients.pushGroup) {
        await writeRun(rule, event, "skipped", [], "no recipients", entityId);
        continue;
      }

      const createNotification = deps.createNotification ?? defaultCreateNotification;
      for (const userId of recipients.userIds) {
        await createNotification({
          userId,
          type: "automation",
          title: message.title,
          body: message.text,
          entityType: event.entityType,
          entityId: event.entityId == null ? null : String(event.entityId),
        });
      }

      // 钉钉工作通知：把提醒直接推到负责人本人的钉钉（解析不到/未配则静默跳过）
      if (recipients.userIds.length > 0) {
        const notifyDingtalk = deps.notifyDingtalk ?? defaultNotifyDingtalk;
        await notifyDingtalk(recipients.userIds, message.title, message.markdown ?? message.text);
      }

      if (recipients.pushGroup) {
        const link = ENV.appBaseUrl ? `\n\n[打开 CE Project Hub](${ENV.appBaseUrl}/)` : "";
        const md = `${message.markdown ?? message.text}${link}`;
        if (recipients.chatId) {
          // 有项目专属钉钉群 → 提醒发到本项目群
          const notifyGroup = deps.notifyGroup ?? defaultNotifyGroup;
          await notifyGroup(recipients.chatId, message.title, md);
        } else {
          // 否则回退到全局群机器人 webhook
          const pushWebhook = deps.pushWebhook ?? defaultPushWebhook;
          await pushWebhook(message.text, { title: message.title, markdown: md });
        }
      }

      await writeRun(rule, event, "fired", serializeRecipients(recipients), message.text, entityId);
    } catch (error) {
      await writeRun(rule, event, "error", [], error instanceof Error ? error.message : String(error), entityId);
    }
  }
}

async function resolveRecipients(
  rule: BuiltInAutomationRule,
  event: AutomationEvent,
  config: AutomationRuleConfig
): Promise<ResolvedRecipients> {
  const projectId = projectIdForEvent(event);
  const project = projectId ? await getProjectById(projectId) : undefined;
  const members = projectId ? await getProjectMembers(projectId) : [];
  const userIds = new Set<number>();
  // 优先用规则 config 里的 notifyRoles（如逾期催办可配通知对象）；没配则回退到规则静态 recipientRoles
  const configuredRoles = (config as { notifyRoles?: RecipientRole[] }).notifyRoles;
  const effectiveRoles = rule.key === "exception_escalation"
    ? exceptionEscalationRoles(event, config as Parameters<typeof exceptionEscalationRoles>[1])
    : Array.isArray(configuredRoles) && configuredRoles.length > 0
      ? configuredRoles
      : rule.recipientRoles;
  const roles = effectiveRoles.filter((role) => role !== "group");

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
  if (role === "manager") return members.filter((m) => m.role === "manager").map((m) => m.userId);
  if (role === "assignee") {
    const assigneeId =
      numberField(event.after, "assigneeUserId") ??
      numberField(event.before, "assigneeUserId") ??
      numberField(event.after, "reviewerUserId") ??
      numberField(event.before, "reviewerUserId");
    if (assigneeId) return [assigneeId];
    return resolveMemberByName(members, stringField(event.after, "owner") ?? stringField(event.before, "owner"));
  }
  if (role === "reporter") {
    const creatorId = numberField(event.after, "creatorId") ?? numberField(event.before, "creatorId");
    if (creatorId) return [creatorId];
    return resolveMemberByName(members, stringField(event.after, "reporter") ?? stringField(event.before, "reporter"));
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
    .filter((member) =>
      member.userName?.trim().toLowerCase() === normalized ||
      member.userEmail?.trim().toLowerCase() === normalized
    )
    .map((member) => member.userId);
}

async function buildMessageContext(event: AutomationEvent): Promise<AutomationMessageContext> {
  const projectId = projectIdForEvent(event);
  const project = projectId ? await getProjectById(projectId) : undefined;
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
  status: "fired" | "skipped" | "error",
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
    ...recipients.userIds.map((userId) => ({ userId, channel: "site" })),
    ...(recipients.pushGroup ? [{ group: true, channel: "webhook" }] : []),
  ];
}

function entityIdForRun(event: AutomationEvent): string | null {
  return event.entityId == null ? null : String(event.entityId);
}

function entityIdForRuleRun(
  rule: BuiltInAutomationRule,
  event: AutomationEvent,
  config: AutomationRuleConfig,
): string | null {
  const base = entityIdForRun(event);
  if (!base || rule.key !== "exception_escalation") return base;
  const level = exceptionEscalationLevel(event, config as Parameters<typeof exceptionEscalationLevel>[1]);
  return level ? `${base}:${level}` : base;
}

function projectIdForEvent(event: AutomationEvent): string | null {
  return event.projectId ?? stringField(event.after, "projectId") ?? stringField(event.before, "projectId");
}

function getCadenceHours(config: AutomationRuleConfig): number {
  const value = (config as { cadenceHours?: unknown }).cadenceHours;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 24;
}

function getEventCadenceHours(config: AutomationRuleConfig): number | null {
  if (!Object.prototype.hasOwnProperty.call(config as Record<string, unknown>, "cadenceHours")) return null;
  const value = (config as { cadenceHours?: unknown }).cadenceHours;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function numberField(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function toConfigRecord(config: AutomationRuleConfig): Record<string, unknown> {
  return { ...(config as Record<string, unknown>) };
}
