import { z } from "zod";

export const AUTOMATION_RULE_KEYS = [
  "overdue_reminder",
  "due_soon_reminder",
  "high_severity_issue",
  "status_change_notify",
  "task_blocked_notify",
  "gate_prereq_incomplete",
  "mp_release_broadcast",
  "delay_impact_notify",
  "exception_escalation",
  "definition_confirmed_notify",
  "gate_decision_notify",
  "phase_advanced_notify",
] as const;

export type AutomationRuleKey = (typeof AUTOMATION_RULE_KEYS)[number];

export type AutomationEntityType = "task" | "issue" | "gate_review" | "mp_release" | "deliverable_review" | "product_definition" | "phase";

export type AutomationEvent = {
  action:
    | "scheduled"
    | "issue.create"
    | "issue.update"
    | "issue.close"
    | "task.update_meta"
    | "task.rescheduled"
    | "gate.create"
    | "gate.update"
    | "mp.release"
    | "product.definition_confirmed"
    | "phase.advanced";
  projectId?: string | null;
  entityType: AutomationEntityType;
  entityId?: string | number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  actorId?: number | null;
  now?: Date | string;
  impact?: import("../../shared/delay-impact").DelayImpact;
};

export type RecipientRole = "assignee" | "reporter" | "pm" | "manager" | "owner" | "group";

export type AutomationMessageContext = {
  projectName?: string | null;
  entityTitle?: string | null;
  productName?: string | null;
  revisionLabel?: string | null;
};

export type AutomationMessage = {
  title: string;
  text: string;
  markdown?: string;
};

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

const dueSoonConfigSchema = z.object({
  dueSoonDays: z.number().int().min(1).default(2),
  cadenceHours: z.number().int().min(1).default(24),
  scope: z.enum(["tasks", "issues", "both"]).default("both"),
  notifyRoles: z.array(z.enum(["assignee", "pm"])).default(["assignee", "pm"]),
  pushGroup: z.boolean().default(false),
});

const taskBlockedConfigSchema = z.object({
  pushGroup: z.boolean().default(false),
});

const gatePrereqConfigSchema = z.object({
  leadDays: z.number().int().min(1).default(3),
  cadenceHours: z.number().int().min(1).default(24),
  pushGroup: z.boolean().default(false),
});

const delayImpactConfigSchema = z.object({
  minDeltaDays: z.number().int().min(0).default(0),
  notifyGateImpacts: z.boolean().default(true),
  notifyTargetBreach: z.boolean().default(true),
  onlyNewTargetBreach: z.boolean().default(false),
  cadenceHours: z.number().int().min(1).default(24),
  pushGroup: z.boolean().default(false),
});

const exceptionEscalationConfigSchema = z.object({
  assigneeAfterDays: z.number().int().min(0).default(2),
  pmAfterDays: z.number().int().min(0).default(5),
  managerAfterDays: z.number().int().min(0).default(10),
  cadenceHours: z.number().int().min(1).default(24),
  include: z.object({
    overdueTasks: z.boolean().default(true),
    blockedTasks: z.boolean().default(true),
    criticalIssues: z.boolean().default(true),
    pendingReviews: z.boolean().default(true),
  }).default({
    overdueTasks: true,
    blockedTasks: true,
    criticalIssues: true,
    pendingReviews: true,
  }),
  pushGroup: z.boolean().default(false),
});

const definitionConfirmedConfigSchema = z.object({
  pushGroup: z.boolean().default(false),
});

const gateDecisionConfigSchema = z.object({
  pushGroup: z.boolean().default(true),
});

const phaseAdvancedConfigSchema = z.object({
  pushGroup: z.boolean().default(true),
});

export type OverdueConfig = z.infer<typeof overdueConfigSchema>;
export type HighSeverityIssueConfig = z.infer<typeof highSeverityIssueConfigSchema>;
export type StatusChangeConfig = z.infer<typeof statusChangeConfigSchema>;
export type MpReleaseConfig = z.infer<typeof mpReleaseConfigSchema>;
export type DueSoonConfig = z.infer<typeof dueSoonConfigSchema>;
export type TaskBlockedConfig = z.infer<typeof taskBlockedConfigSchema>;
export type GatePrereqConfig = z.infer<typeof gatePrereqConfigSchema>;
export type DelayImpactConfig = z.infer<typeof delayImpactConfigSchema>;
export type ExceptionEscalationConfig = z.infer<typeof exceptionEscalationConfigSchema>;
export type DefinitionConfirmedConfig = z.infer<typeof definitionConfirmedConfigSchema>;
export type GateDecisionConfig = z.infer<typeof gateDecisionConfigSchema>;
export type PhaseAdvancedConfig = z.infer<typeof phaseAdvancedConfigSchema>;
export type AutomationRuleConfig =
  | OverdueConfig
  | HighSeverityIssueConfig
  | StatusChangeConfig
  | MpReleaseConfig
  | DueSoonConfig
  | TaskBlockedConfig
  | GatePrereqConfig
  | DelayImpactConfig
  | ExceptionEscalationConfig
  | DefinitionConfirmedConfig
  | GateDecisionConfig
  | PhaseAdvancedConfig;

export type BuiltInAutomationRule = {
  key: AutomationRuleKey;
  label: string;
  triggerType: "scheduled" | "event";
  defaultEnabled: boolean;
  defaultConfig: AutomationRuleConfig;
  configSchema: z.ZodTypeAny;
  recipientRoles: RecipientRole[];
  matches: (event: AutomationEvent, config: AutomationRuleConfig) => boolean;
  buildMessage: (event: AutomationEvent, config: AutomationRuleConfig, ctx: AutomationMessageContext) => AutomationMessage;
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
    buildMessage: (event, config, ctx) => buildOverdueMessage(event, config as OverdueConfig, ctx),
  },
  {
    key: "due_soon_reminder",
    label: "截止前提醒",
    triggerType: "scheduled",
    defaultEnabled: true,
    defaultConfig: dueSoonConfigSchema.parse({}),
    configSchema: dueSoonConfigSchema,
    recipientRoles: ["assignee", "pm"],
    matches: (event, config) => matchesDueSoon(event, config as DueSoonConfig),
    buildMessage: (event, config, ctx) => buildDueSoonMessage(event, config as DueSoonConfig, ctx),
  },
  {
    key: "task_blocked_notify",
    label: "任务阻塞通知",
    triggerType: "event",
    defaultEnabled: true,
    defaultConfig: taskBlockedConfigSchema.parse({}),
    configSchema: taskBlockedConfigSchema,
    recipientRoles: ["pm", "assignee"],
    matches: (event, _config) => matchesTaskBlocked(event),
    buildMessage: (event, _config, ctx) => buildTaskBlockedMessage(event, ctx),
  },
  {
    key: "gate_prereq_incomplete",
    label: "Gate 就绪度提醒",
    triggerType: "scheduled",
    defaultEnabled: true,
    defaultConfig: gatePrereqConfigSchema.parse({}),
    configSchema: gatePrereqConfigSchema,
    recipientRoles: ["pm", "manager"],
    matches: (event, config) => matchesGatePrereq(event, config as GatePrereqConfig),
    buildMessage: (event, _config, ctx) => buildGatePrereqMessage(event, ctx),
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
    buildMessage: (event, _config, ctx) => buildHighSeverityIssueMessage(event, ctx),
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
    buildMessage: (event, _config, ctx) => buildStatusChangeMessage(event, ctx),
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
    buildMessage: (event, _config, ctx) => buildMpReleaseMessage(event, ctx),
  },
  {
    key: "delay_impact_notify",
    label: "延期影响通知",
    triggerType: "event",
    defaultEnabled: true,
    defaultConfig: delayImpactConfigSchema.parse({}),
    configSchema: delayImpactConfigSchema,
    recipientRoles: ["pm"],
    matches: (event, config) => matchesDelayImpact(event, config as DelayImpactConfig),
    buildMessage: (event, _cfg, ctx) => buildDelayImpactMessage(event, ctx),
  },
  {
    key: "exception_escalation",
    label: "异常升级",
    triggerType: "scheduled",
    defaultEnabled: true,
    defaultConfig: exceptionEscalationConfigSchema.parse({}),
    configSchema: exceptionEscalationConfigSchema,
    recipientRoles: ["assignee", "pm", "manager"],
    matches: (event, config) => matchesExceptionEscalation(event, config as ExceptionEscalationConfig),
    buildMessage: (event, config, ctx) => buildExceptionEscalationMessage(event, config as ExceptionEscalationConfig, ctx),
  },
  {
    key: "definition_confirmed_notify",
    label: "产品定义确认通知",
    triggerType: "event",
    defaultEnabled: true,
    defaultConfig: definitionConfirmedConfigSchema.parse({}),
    configSchema: definitionConfirmedConfigSchema,
    recipientRoles: ["pm"],
    matches: (event, _config) => event.action === "product.definition_confirmed" && event.entityType === "product_definition",
    buildMessage: (event, _config, ctx) => buildDefinitionConfirmedMessage(event, ctx),
  },
  {
    key: "gate_decision_notify",
    label: "Gate 决策通知",
    triggerType: "event",
    defaultEnabled: true,
    defaultConfig: gateDecisionConfigSchema.parse({}),
    configSchema: gateDecisionConfigSchema,
    recipientRoles: ["pm", "manager", "group"],
    matches: (event, _config) => matchesGateDecision(event),
    buildMessage: (event, _config, ctx) => buildGateDecisionMessage(event, ctx),
  },
  {
    key: "phase_advanced_notify",
    label: "阶段推进通知",
    triggerType: "event",
    defaultEnabled: true,
    defaultConfig: phaseAdvancedConfigSchema.parse({}),
    configSchema: phaseAdvancedConfigSchema,
    recipientRoles: ["pm", "group"],
    matches: (event, _config) => event.action === "phase.advanced" && event.entityType === "phase",
    buildMessage: (event, _config, ctx) => buildPhaseAdvancedMessage(event, ctx),
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
  if (event.after?.isGate === true) return false; // gate 专项事件交给 gate_prereq 规则
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

/** 距截止还有几天（负数=已逾期）；无法解析返回 null */
function daysUntilDue(event: AutomationEvent): number | null {
  const due = asDate(event.after?.dueDate ?? event.after?.targetDate);
  const now = asDate(event.now ?? new Date());
  if (!due || !now) return null;
  return Math.floor((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

function matchesDueSoon(event: AutomationEvent, config: DueSoonConfig): boolean {
  if (event.action !== "scheduled") return false;
  if (event.after?.isGate === true) return false; // gate 专项事件交给 gate_prereq 规则
  if (event.entityType !== "task" && event.entityType !== "issue") return false;
  if (config.scope === "tasks" && event.entityType !== "task") return false;
  if (config.scope === "issues" && event.entityType !== "issue") return false;
  if (isClosedStatus(event.entityType, String(event.after?.status ?? ""))) return false;
  const d = daysUntilDue(event);
  if (d === null) return false;
  return d >= 0 && d <= config.dueSoonDays; // 今天~N天内到期(未逾期)
}

function matchesTaskBlocked(event: AutomationEvent): boolean {
  if (event.action !== "task.update_meta" || event.entityType !== "task") return false;
  return String(event.after?.status ?? "") === "blocked" && String(event.before?.status ?? "") !== "blocked";
}

function matchesGatePrereq(event: AutomationEvent, config: GatePrereqConfig): boolean {
  if (event.action !== "scheduled" || event.entityType !== "task") return false;
  if (event.after?.isGate !== true) return false;
  if (isClosedStatus("task", String(event.after?.status ?? ""))) return false;
  if (event.after?.notReady !== true) return false;
  const d = daysUntilDue(event);
  return d !== null && d >= 0 && d <= config.leadDays;
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

function matchesDelayImpact(event: AutomationEvent, config: DelayImpactConfig): boolean {
  if (event.action !== "task.rescheduled" || !event.impact?.hasImpact) return false;
  const impact = event.impact;
  const magnitude = Math.max(impact.maxDeltaDays, impact.targetBreach?.slipDays ?? 0);
  if (magnitude < config.minDeltaDays) return false;
  const gateHit = config.notifyGateImpacts && impact.gateImpacts.length > 0;
  const targetHit = config.notifyTargetBreach &&
    !!impact.targetBreach &&
    (!config.onlyNewTargetBreach || impact.targetBreach.newlyBreaches);
  return gateHit || targetHit;
}

export type ExceptionEscalationLevel = "assignee" | "pm" | "manager";

export function exceptionEscalationLevel(
  event: AutomationEvent,
  config: ExceptionEscalationConfig,
): ExceptionEscalationLevel | null {
  const age = numberValue(event.after?.exceptionAgeDays);
  if (age === null) return null;
  if (age >= config.managerAfterDays) return "manager";
  if (age >= config.pmAfterDays) return "pm";
  if (age >= config.assigneeAfterDays) return "assignee";
  return null;
}

export function exceptionEscalationRoles(
  event: AutomationEvent,
  config: ExceptionEscalationConfig,
): RecipientRole[] {
  const level = exceptionEscalationLevel(event, config);
  if (level === "manager") return ["assignee", "pm", "manager"];
  if (level === "pm") return ["assignee", "pm"];
  if (level === "assignee") return ["assignee"];
  return [];
}

function matchesExceptionEscalation(event: AutomationEvent, config: ExceptionEscalationConfig): boolean {
  if (event.action !== "scheduled") return false;
  const type = String(event.after?.exceptionType ?? "");
  if (type === "overdue_task" && !config.include.overdueTasks) return false;
  if (type === "blocked_task" && !config.include.blockedTasks) return false;
  if (type === "critical_issue" && !config.include.criticalIssues) return false;
  if (type === "pending_review" && !config.include.pendingReviews) return false;
  if (!["overdue_task", "blocked_task", "critical_issue", "pending_review"].includes(type)) return false;
  if (event.entityType === "task" && isClosedStatus("task", String(event.after?.status ?? ""))) return false;
  if (event.entityType === "issue" && isClosedStatus("issue", String(event.after?.status ?? ""))) return false;
  if (event.entityType === "deliverable_review" && String(event.after?.status ?? "") !== "pending") return false;
  return exceptionEscalationLevel(event, config) !== null;
}

function buildOverdueMessage(
  event: AutomationEvent,
  _config: OverdueConfig,
  ctx: AutomationMessageContext
): AutomationMessage {
  const label = entityLabel(event.entityType);
  const title = ctx.entityTitle || String(event.after?.title ?? event.after?.taskId ?? event.entityId ?? label);
  const days = daysOverdueFromEvent(event);
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const dueDate = String(event.after?.dueDate ?? event.after?.targetDate ?? "未设置");
  const dayText = days === null ? "" : `，已逾期 ${days} 天`;
  const messageTitle = `${label}逾期提醒`;
  const text = `${project}${label}「${title}」已超过计划日期 ${dueDate}${dayText}。`;
  return {
    title: messageTitle,
    text,
    markdown: `#### ${messageTitle}\n${text}`,
  };
}

function buildHighSeverityIssueMessage(
  event: AutomationEvent,
  ctx: AutomationMessageContext
): AutomationMessage {
  const title = ctx.entityTitle || String(event.after?.title ?? event.entityId ?? "问题");
  const severity = String(event.after?.severity ?? "");
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const isCreate = event.action === "issue.create";
  const messageTitle = isCreate ? `新增 ${severity} 缺陷` : `${severity} 缺陷升级`;
  const text = isCreate
    ? `${project}新增 ${severity} 级问题「${title}」，请及时跟进。`
    : `${project}问题「${title}」严重度已升级为 ${severity}，请及时跟进。`;
  return {
    title: messageTitle,
    text,
    markdown: `#### ${messageTitle}\n${text}`,
  };
}

function buildStatusChangeMessage(
  event: AutomationEvent,
  ctx: AutomationMessageContext
): AutomationMessage {
  const label = entityLabel(event.entityType);
  const title = ctx.entityTitle || String(event.after?.title ?? event.after?.taskId ?? event.entityId ?? label);
  const field = event.entityType === "gate_review" ? "decision" : "status";
  const fromValue = String(event.before?.[field] ?? "未设置");
  const toValue = String(event.after?.[field] ?? "未设置");
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const messageTitle = `${label}状态流转`;
  const text = `${project}${label}「${title}」由 ${fromValue} 变更为 ${toValue}。`;
  return {
    title: messageTitle,
    text,
    markdown: `#### ${messageTitle}\n${text}`,
  };
}

function buildMpReleaseMessage(
  event: AutomationEvent,
  ctx: AutomationMessageContext
): AutomationMessage {
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const product = ctx.productName || String(event.after?.productName ?? "产品");
  const revision = ctx.revisionLabel || String(event.after?.revisionLabel ?? event.after?.revisionId ?? "新版本");
  const messageTitle = "量产发布完成";
  const text = `${project}已完成量产发布：${product} ${revision}。`;
  return {
    title: messageTitle,
    text,
    markdown: `#### ${messageTitle}\n${text}`,
  };
}

function buildDueSoonMessage(event: AutomationEvent, _config: DueSoonConfig, ctx: AutomationMessageContext): AutomationMessage {
  const label = entityLabel(event.entityType);
  const title = ctx.entityTitle || String(event.after?.title ?? event.after?.taskId ?? event.entityId ?? label);
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const due = String(event.after?.dueDate ?? event.after?.targetDate ?? "");
  const d = daysUntilDue(event);
  const when = d === 0 ? "今天截止" : `还有 ${d} 天截止`;
  const messageTitle = `${label}即将到期`;
  const text = `${project}${label}「${title}」${when}（${due}），请及时处理。`;
  return { title: messageTitle, text, markdown: `#### ${messageTitle}\n${text}` };
}

function buildTaskBlockedMessage(event: AutomationEvent, ctx: AutomationMessageContext): AutomationMessage {
  const title = ctx.entityTitle || String(event.after?.title ?? event.after?.taskId ?? event.entityId ?? "任务");
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const messageTitle = "任务被阻塞";
  const text = `${project}任务「${title}」已被标记为阻塞，请协调处理。`;
  return { title: messageTitle, text, markdown: `#### ${messageTitle}\n${text}` };
}

function buildDelayImpactMessage(event: AutomationEvent, ctx: AutomationMessageContext): AutomationMessage {
  const impact = event.impact;
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const title = ctx.entityTitle || String(event.after?.title ?? event.after?.taskId ?? event.entityId ?? "任务");
  const gateLine = (impact?.gateImpacts ?? []).map((g) => `${g.gateName ?? g.taskId} 滑 ${g.deltaDays} 天`).join("；");
  const tb = impact?.targetBreach;
  const targetLine = tb
    ? `目标日 ${tb.targetDate} 预计${tb.newlyBreaches ? "突破" : "再恶化"}至 ${tb.newProjectedEnd}（晚 ${tb.slipDays} 天）`
    : "";
  const parts = [gateLine, targetLine].filter(Boolean).join("；");
  const messageTitle = "延期影响提醒";
  const text = `${project}任务「${title}」改期 → ${parts || `顺延 ${impact?.shifted.length ?? 0} 个下游`}。`;
  return { title: messageTitle, text, markdown: `#### ${messageTitle}\n${text}` };
}

function buildGatePrereqMessage(event: AutomationEvent, ctx: AutomationMessageContext): AutomationMessage {
  const title = ctx.entityTitle || String(event.after?.gateName ?? event.after?.taskId ?? "Gate");
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const d = daysUntilDue(event);
  const summaries = Array.isArray(event.after?.blockerSummaries) ? (event.after?.blockerSummaries as string[]) : [];
  const lines = summaries.length ? summaries.map((s) => `- ${s}`).join("\n") : "- 仍有未就绪项";
  const messageTitle = "Gate 就绪度提醒";
  const when = d === 0 ? "今天" : `还有 ${d} 天`;
  const text = `${project}评审「${title}」${when}到期，尚未就绪：${summaries.join("；") || "仍有未就绪项"}。`;
  return { title: messageTitle, text, markdown: `#### ${messageTitle}\n${project}评审「${title}」${when}到期，还差以下项不能过会：\n${lines}` };
}

function buildExceptionEscalationMessage(
  event: AutomationEvent,
  config: ExceptionEscalationConfig,
  ctx: AutomationMessageContext,
): AutomationMessage {
  const title = ctx.entityTitle || String(event.after?.title ?? event.after?.taskId ?? event.after?.deliverableName ?? event.entityId ?? "异常");
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const age = numberValue(event.after?.exceptionAgeDays) ?? 0;
  const level = exceptionEscalationLevel(event, config);
  const type = exceptionTypeLabel(String(event.after?.exceptionType ?? ""));
  const levelText = level === "manager" ? "升级至管理层" : level === "pm" ? "升级至 PM" : "提醒负责人";
  const messageTitle = `异常${levelText}`;
  const text = `${project}${type}「${title}」已滞留 ${age} 天，${levelText}处理。`;
  return { title: messageTitle, text, markdown: `#### ${messageTitle}\n${text}` };
}

function exceptionTypeLabel(type: string): string {
  if (type === "overdue_task") return "逾期任务";
  if (type === "blocked_task") return "阻塞任务";
  if (type === "critical_issue") return "重大问题";
  if (type === "pending_review") return "待审交付物";
  return "异常";
}

function matchesGateDecision(event: AutomationEvent): boolean {
  if (event.entityType !== "gate_review") return false;
  const decision = String(event.after?.decision ?? "");
  if (!["approved", "conditional", "rejected"].includes(decision)) return false;
  // create 即终态；update 仅在 decision 实际变化时通知（改参会人/纪要不扰动）
  if (event.action === "gate.create") return true;
  if (event.action === "gate.update") return String(event.before?.decision ?? "") !== decision;
  return false;
}

function buildDefinitionConfirmedMessage(event: AutomationEvent, ctx: AutomationMessageContext): AutomationMessage {
  const product = ctx.productName || String(event.after?.productName ?? "产品");
  const version = event.after?.versionNumber != null ? `（基线 v${event.after.versionNumber}）` : "";
  const project = ctx.projectName ? `「${ctx.projectName}」` : "关联项目";
  const messageTitle = "产品定义已确认";
  const text = `产品「${product}」定义已确认冻结${version}，${project}请查收交接任务；后续规格变更将走定义变更流程。`;
  return { title: messageTitle, text, markdown: `#### ${messageTitle}\n${text}` };
}

function buildGateDecisionMessage(event: AutomationEvent, ctx: AutomationMessageContext): AutomationMessage {
  const gate = ctx.entityTitle || String(event.after?.gateName ?? event.after?.phaseId ?? "Gate");
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const decision = String(event.after?.decision ?? "");
  const conditions = String(event.after?.conditions ?? "").trim();
  const decisionText = decision === "approved" ? "已通过" : decision === "conditional" ? "有条件通过" : "未通过";
  const messageTitle = `Gate ${decisionText}`;
  const suffix = decision === "conditional" && conditions
    ? `，通过条件：${conditions}`
    : decision === "rejected"
      ? "，整改后请重新评审"
      : "";
  const text = `${project}评审「${gate}」${decisionText}${suffix}。`;
  return { title: messageTitle, text, markdown: `#### ${messageTitle}\n${text}` };
}

function buildPhaseAdvancedMessage(event: AutomationEvent, ctx: AutomationMessageContext): AutomationMessage {
  const project = ctx.projectName ? `「${ctx.projectName}」` : "项目";
  const from = String(event.after?.fromPhaseName ?? event.after?.fromPhaseId ?? "上一阶段");
  const to = String(event.after?.phaseName ?? event.after?.phaseId ?? "新阶段");
  const messageTitle = "项目阶段推进";
  const text = `${project}${from} Gate 已通过，项目进入 ${to} 阶段，请相关角色启动本阶段任务与交付物。`;
  return { title: messageTitle, text, markdown: `#### ${messageTitle}\n${text}` };
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

function daysOverdueFromEvent(event: AutomationEvent): number | null {
  const dueDate = asDate(event.after?.dueDate ?? event.after?.targetDate);
  const now = asDate(event.now ?? new Date());
  if (!dueDate || !now) return null;
  return Math.max(0, Math.floor((startOfDay(now).getTime() - startOfDay(dueDate).getTime()) / DAY_MS));
}

function entityLabel(entityType: AutomationEntityType): string {
  if (entityType === "task") return "任务";
  if (entityType === "issue") return "问题";
  if (entityType === "gate_review") return "Gate 评审";
  if (entityType === "mp_release") return "量产发布";
  if (entityType === "deliverable_review") return "交付物审核";
  return entityType;
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

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
