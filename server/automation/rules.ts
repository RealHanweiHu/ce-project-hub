import { z } from "zod";

export const AUTOMATION_RULE_KEYS = [
  "overdue_reminder",
  "high_severity_issue",
  "status_change_notify",
  "mp_release_broadcast",
] as const;

export type AutomationRuleKey = (typeof AUTOMATION_RULE_KEYS)[number];

export type AutomationEntityType = "task" | "issue" | "gate_review" | "mp_release";

export type AutomationEvent = {
  action:
    | "scheduled"
    | "issue.create"
    | "issue.update"
    | "issue.close"
    | "task.update_meta"
    | "gate.create"
    | "gate.update"
    | "mp.release";
  projectId?: string | null;
  entityType: AutomationEntityType;
  entityId?: string | number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  actorId?: number | null;
  now?: Date | string;
};

export type RecipientRole = "assignee" | "reporter" | "pm" | "manager" | "owner" | "group";

const overdueConfigSchema = z.object({
  graceDays: z.number().int().min(0).default(0),
  cadenceHours: z.number().int().min(1).default(24),
  scope: z.enum(["tasks", "issues", "both"]).default("both"),
  notifyRoles: z.array(z.enum(["assignee", "pm"])).default(["assignee", "pm"]),
  pushGroup: z.boolean().default(false),
});

const highSeverityIssueConfigSchema = z.object({
  severities: z.array(z.enum(["P0", "P1", "P2", "P3"])).default(["P0", "P1"]),
  pushGroup: z.boolean().default(true),
});

const statusChangeConfigSchema = z.object({
  transitions: z
    .object({
      issue: z.array(z.string()).default(["resolved", "closed"]),
      task: z.array(z.string()).default([]),
      gate: z.array(z.string()).default(["approved", "rejected"]),
    })
    .default({ issue: ["resolved", "closed"], task: [], gate: ["approved", "rejected"] }),
  pushGroup: z.boolean().default(false),
});

const mpReleaseConfigSchema = z.object({
  pushGroup: z.boolean().default(true),
});

export type OverdueConfig = z.infer<typeof overdueConfigSchema>;
export type HighSeverityIssueConfig = z.infer<typeof highSeverityIssueConfigSchema>;
export type StatusChangeConfig = z.infer<typeof statusChangeConfigSchema>;
export type MpReleaseConfig = z.infer<typeof mpReleaseConfigSchema>;
export type AutomationRuleConfig =
  | OverdueConfig
  | HighSeverityIssueConfig
  | StatusChangeConfig
  | MpReleaseConfig;

export type BuiltInAutomationRule = {
  key: AutomationRuleKey;
  label: string;
  triggerType: "scheduled" | "event";
  defaultEnabled: boolean;
  defaultConfig: AutomationRuleConfig;
  configSchema: z.ZodTypeAny;
  recipientRoles: RecipientRole[];
  matches: (event: AutomationEvent, config: AutomationRuleConfig) => boolean;
};

export const AUTOMATION_RULES = [
  {
    key: "overdue_reminder",
    label: "逾期催办",
    triggerType: "scheduled",
    defaultEnabled: true,
    defaultConfig: overdueConfigSchema.parse({}),
    configSchema: overdueConfigSchema,
    recipientRoles: ["assignee", "pm"],
    matches: (event, config) => matchesOverdueReminder(event, config as OverdueConfig),
  },
  {
    key: "high_severity_issue",
    label: "P0/P1 缺陷升级",
    triggerType: "event",
    defaultEnabled: true,
    defaultConfig: highSeverityIssueConfigSchema.parse({}),
    configSchema: highSeverityIssueConfigSchema,
    recipientRoles: ["pm", "manager", "assignee", "group"],
    matches: (event, config) => matchesHighSeverityIssue(event, config as HighSeverityIssueConfig),
  },
  {
    key: "status_change_notify",
    label: "状态流转通知",
    triggerType: "event",
    defaultEnabled: false,
    defaultConfig: statusChangeConfigSchema.parse({}),
    configSchema: statusChangeConfigSchema,
    recipientRoles: ["reporter", "assignee", "pm"],
    matches: (event, config) => matchesStatusChange(event, config as StatusChangeConfig),
  },
  {
    key: "mp_release_broadcast",
    label: "量产发布播报",
    triggerType: "event",
    defaultEnabled: true,
    defaultConfig: mpReleaseConfigSchema.parse({}),
    configSchema: mpReleaseConfigSchema,
    recipientRoles: ["pm", "manager", "owner", "group"],
    matches: matchesMpReleaseBroadcast,
  },
] as const satisfies readonly BuiltInAutomationRule[];

export function getAutomationRule(key: string) {
  return AUTOMATION_RULES.find((rule) => rule.key === key);
}

export function parseAutomationRuleConfig(
  key: AutomationRuleKey,
  config: unknown
): AutomationRuleConfig {
  const rule = getAutomationRule(key);
  if (!rule) throw new Error(`Unknown automation rule: ${key}`);
  return rule.configSchema.parse({ ...rule.defaultConfig, ...(isRecord(config) ? config : {}) });
}

export function isAutomationRuleMatch(
  key: AutomationRuleKey,
  event: AutomationEvent,
  config?: unknown
): boolean {
  const rule = getAutomationRule(key);
  if (!rule) return false;
  const parsed = parseAutomationRuleConfig(key, config ?? {});
  return rule.matches(event, parsed);
}

function matchesOverdueReminder(event: AutomationEvent, config: OverdueConfig): boolean {
  if (event.action !== "scheduled") return false;
  if (event.entityType !== "task" && event.entityType !== "issue") return false;
  if (config.scope === "tasks" && event.entityType !== "task") return false;
  if (config.scope === "issues" && event.entityType !== "issue") return false;

  const dueDate = asDate(event.after?.dueDate ?? event.after?.targetDate);
  if (!dueDate) return false;
  if (isClosedStatus(event.entityType, String(event.after?.status ?? ""))) return false;

  const now = asDate(event.now ?? new Date());
  if (!now) return false;
  const daysOverdue = Math.floor((startOfDay(now).getTime() - startOfDay(dueDate).getTime()) / DAY_MS);
  return daysOverdue > config.graceDays;
}

// 严重度排序：序号越小越严重（P0 最严重）
const SEVERITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function matchesHighSeverityIssue(event: AutomationEvent, config: HighSeverityIssueConfig): boolean {
  if (event.entityType !== "issue") return false;
  if (event.action !== "issue.create" && event.action !== "issue.update") return false;
  const afterSeverity = String(event.after?.severity ?? "");
  // 必须落在观察集合内
  if (!config.severities.includes(afterSeverity as "P0" | "P1" | "P2" | "P3")) return false;
  if (event.action === "issue.create") return true;
  // 更新：仅当“变得更严重”（rank 变小）才触发，含集合内升级 P1→P0；降级/不变不发
  const beforeSeverity = String(event.before?.severity ?? "");
  const beforeRank = SEVERITY_RANK[beforeSeverity] ?? Infinity;
  const afterRank = SEVERITY_RANK[afterSeverity] ?? Infinity;
  return afterRank < beforeRank;
}

function matchesStatusChange(event: AutomationEvent, config: StatusChangeConfig): boolean {
  if (event.entityType === "issue") {
    // 关闭(issue.close)与普通更新(issue.update)都按 status 变化判定
    if (event.action !== "issue.update" && event.action !== "issue.close") return false;
    return changedInto(event.before, event.after, "status", config.transitions.issue);
  }
  if (event.entityType === "task") {
    if (event.action !== "task.update_meta") return false;
    return changedInto(event.before, event.after, "status", config.transitions.task);
  }
  if (event.entityType === "gate_review") {
    // 创建即终态(gate.create)与更新(gate.update)都按 decision 落入目标集判定
    if (event.action !== "gate.update" && event.action !== "gate.create") return false;
    return changedInto(event.before, event.after, "decision", config.transitions.gate);
  }
  return false;
}

function matchesMpReleaseBroadcast(event: AutomationEvent): boolean {
  return event.action === "mp.release" && event.entityType === "mp_release";
}

function changedInto(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  field: string,
  allowedTargets: string[]
): boolean {
  const beforeValue = before?.[field];
  const afterValue = after?.[field];
  return beforeValue !== afterValue && allowedTargets.includes(String(afterValue ?? ""));
}

function isClosedStatus(entityType: AutomationEntityType, status: string): boolean {
  if (entityType === "task") return status === "done" || status === "skipped";
  if (entityType === "issue") return status === "resolved" || status === "closed" || status === "wont_fix";
  return false;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
