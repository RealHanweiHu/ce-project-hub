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
  parseAutomationRuleConfig,
  RecipientRole,
} from "./rules";
import { DIGEST_RULES } from "./digestRules";

type ResolvedRecipients = {
  userIds: number[];
  pushGroup: boolean;
  /** 项目专属钉钉群 id;有则群提醒发到此群,否则回退全局机器人 webhook */
  chatId: string | null;
};

type DispatchChannel = "site" | "dingtalk" | "group" | "webhook";

type DispatchResult = {
  channel: DispatchChannel;
  ok: boolean;
  userId?: number;
  group?: boolean;
  error?: string;
};

type DispatchDeps = {
  createNotification?: typeof defaultCreateNotification;
  pushWebhook?: typeof defaultPushWebhook;
  notifyDingtalk?: (userIds: number[], title: string, markdown: string) => Promise<void>;
  notifyGroup?: (chatId: string, title: string, markdown: string) => Promise<boolean>;
};

let seededDefaults = false;
const activeScheduledRuns = new Set<string>();

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
  const rows = await listAutomationRuleRows();
  const rowByKey = new Map(rows.map((row) => [row.ruleKey, row]));
  const eventTrigger = event.action === "scheduled" ? "scheduled" : "event";

  for (const rule of AUTOMATION_RULES) {
    if (rule.triggerType !== eventTrigger) continue;
    const row = rowByKey.get(rule.key);
    if (!row?.enabled) continue;

    let activeRunKey: string | null = null;
    let activeRunLocked = false;
    try {
      const config = parseAutomationRuleConfig(rule.key, row.config ?? {});
      if (!rule.matches(event, config)) continue;

      const entityId = entityIdForRun(event);
      if (rule.triggerType === "scheduled" && entityId) {
        activeRunKey = automationRunKey(rule.key, event.action, entityId);
        if (activeScheduledRuns.has(activeRunKey)) {
          await writeRun(rule, event, "skipped", [], "dedup already running");
          continue;
        }
        activeScheduledRuns.add(activeRunKey);
        activeRunLocked = true;
        const cadenceHours = getCadenceHours(config);
        const since = new Date(Date.now() - cadenceHours * 60 * 60 * 1000);
        if (await hasRecentAutomationFire({ ruleKey: rule.key, eventType: event.action, entityId, since })) {
          await writeRun(rule, event, "skipped", [], `dedup within ${cadenceHours}h`);
          continue;
        }
      }

      const ctx = await buildMessageContext(event);
      const message = rule.buildMessage(event, config, ctx);
      const recipients = await resolveRecipients(rule, event, config);

      if (recipients.userIds.length === 0 && !recipients.pushGroup) {
        await writeRun(rule, event, "skipped", [], "no recipients");
        continue;
      }

      const dispatchResults = await dispatchMessage(event, message, recipients, deps);
      const failures = dispatchResults.filter((result) => !result.ok);
      await writeRun(
        rule,
        event,
        "fired",
        serializeRecipients(recipients, dispatchResults),
        failures.length > 0 ? `${message.text}\nChannel failures: ${summarizeDispatchFailures(failures)}` : message.text
      );
    } catch (error) {
      await writeRun(rule, event, "error", [], error instanceof Error ? error.message : String(error));
    } finally {
      if (activeRunLocked && activeRunKey) activeScheduledRuns.delete(activeRunKey);
    }
  }
}

async function dispatchMessage(
  event: AutomationEvent,
  message: ReturnType<BuiltInAutomationRule["buildMessage"]>,
  recipients: ResolvedRecipients,
  deps: DispatchDeps
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  const createNotification = deps.createNotification ?? defaultCreateNotification;
  const siteResults = await Promise.allSettled(
    recipients.userIds.map((userId) =>
      createNotification({
        userId,
        type: "automation",
        title: message.title,
        body: message.text,
        entityType: event.entityType,
        entityId: event.entityId == null ? null : String(event.entityId),
      })
    )
  );
  siteResults.forEach((result, index) => {
    const userId = recipients.userIds[index];
    results.push(result.status === "fulfilled"
      ? { channel: "site", userId, ok: true }
      : { channel: "site", userId, ok: false, error: errorMessage(result.reason) });
  });

  if (recipients.userIds.length > 0) {
    const notifyDingtalk = deps.notifyDingtalk ?? defaultNotifyDingtalk;
    try {
      await notifyDingtalk(recipients.userIds, message.title, message.markdown ?? message.text);
      results.push({ channel: "dingtalk", ok: true });
    } catch (error) {
      results.push({ channel: "dingtalk", ok: false, error: errorMessage(error) });
    }
  }

  if (recipients.pushGroup) {
    const link = ENV.appBaseUrl ? `\n\n[打开 CE Project Hub](${ENV.appBaseUrl}/)` : "";
    const md = `${message.markdown ?? message.text}${link}`;
    if (recipients.chatId) {
      const notifyGroup = deps.notifyGroup ?? defaultNotifyGroup;
      try {
        const ok = await notifyGroup(recipients.chatId, message.title, md);
        results.push(ok
          ? { channel: "group", group: true, ok: true }
          : { channel: "group", group: true, ok: false, error: "group notification returned false" });
      } catch (error) {
        results.push({ channel: "group", group: true, ok: false, error: errorMessage(error) });
      }
    } else {
      const pushWebhook = deps.pushWebhook ?? defaultPushWebhook;
      try {
        await pushWebhook(message.text, { title: message.title, markdown: md });
        results.push({ channel: "webhook", group: true, ok: true });
      } catch (error) {
        results.push({ channel: "webhook", group: true, ok: false, error: errorMessage(error) });
      }
    }
  }

  return results;
}

async function resolveRecipients(
  rule: BuiltInAutomationRule,
  event: AutomationEvent,
  config: AutomationRuleConfig
): Promise<ResolvedRecipients> {
  const projectId = event.projectId ?? stringField(event.after, "projectId") ?? stringField(event.before, "projectId");
  const project = projectId ? await getProjectById(projectId) : undefined;
  const members = projectId ? await getProjectMembers(projectId) : [];
  const userIds = new Set<number>();
  // 优先用规则 config 里的 notifyRoles（如逾期催办可配通知对象）；没配则回退到规则静态 recipientRoles
  const configuredRoles = (config as { notifyRoles?: RecipientRole[] }).notifyRoles;
  const effectiveRoles = Array.isArray(configuredRoles) && configuredRoles.length > 0
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
    const assigneeId = numberField(event.after, "assigneeUserId") ?? numberField(event.before, "assigneeUserId");
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
  const projectId = event.projectId ?? stringField(event.after, "projectId") ?? stringField(event.before, "projectId");
  const project = projectId ? await getProjectById(projectId) : undefined;
  return {
    projectName: project?.name ?? null,
    entityTitle:
      stringField(event.after, "title") ??
      stringField(event.after, "name") ??
      stringField(event.after, "gateName") ??
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
  detail: string
): Promise<void> {
  try {
    await createAutomationRun({
      ruleKey: rule.key,
      projectId: event.projectId ?? null,
      eventType: event.action,
      entityType: event.entityType,
      entityId: entityIdForRun(event),
      status,
      recipients,
      detail: detail.slice(0, 1000),
    });
  } catch (error) {
    console.warn("[automation] failed to write run (non-fatal):", error);
  }
}

function serializeRecipients(recipients: ResolvedRecipients, dispatchResults: DispatchResult[] = []) {
  if (dispatchResults.length > 0) return dispatchResults;
  return [
    ...recipients.userIds.map((userId) => ({ userId, channel: "site" })),
    ...(recipients.pushGroup ? [{ group: true, channel: "webhook" }] : []),
  ];
}

function summarizeDispatchFailures(failures: DispatchResult[]): string {
  return failures
    .map((failure) => `${failure.channel}${failure.userId ? `:${failure.userId}` : ""}=${failure.error ?? "failed"}`)
    .join("; ")
    .slice(0, 500);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function entityIdForRun(event: AutomationEvent): string | null {
  return event.entityId == null ? null : String(event.entityId);
}

function automationRunKey(ruleKey: string, eventType: string, entityId: string): string {
  return `${ruleKey}\u001f${eventType}\u001f${entityId}`;
}

function getCadenceHours(config: AutomationRuleConfig): number {
  const value = (config as { cadenceHours?: unknown }).cadenceHours;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 24;
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
