export const NOTIFICATION_EVENT_KEYS = [
  "task_approval",
  "task_ready",
  "task_rework",
  "deliverable_review",
  "deliverable_rework",
  "issue_validation",
  "critical_issue",
  "task_assignment",
  "mention",
  "overdue_reminder",
  "due_soon_reminder",
  "high_severity_issue",
  "status_change_notify",
  "task_blocked_notify",
  "gate_prereq_incomplete",
  "gate_ready_notify",
  "mp_release_broadcast",
  "mp_release_confirm",
  "condition_followup",
  "certificate_renewal",
  "handoff_acceptance",
  "delay_impact_notify",
  "exception_escalation",
  "definition_confirmed_notify",
  "gate_decision_notify",
  "phase_advanced_notify",
  "health_digest",
  "personal_daily_digest",
  "group_weekly_digest",
  "weekly_meeting_reminder",
  "task_ready_notify",
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];
export type NotificationChannel = "site" | "dingtalk";
export type NotificationTier =
  | "immediate_action"
  | "daily_digest"
  | "weekly_digest"
  | "inbox_only"
  | "broadcast";

export type NotificationPolicy = {
  tier: NotificationTier;
  personalChannels: readonly NotificationChannel[];
  requiresAction: boolean;
  label: string;
};

export const NOTIFICATION_MATRIX = {
  task_ready: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "任务可以开始",
  },
  task_approval: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "任务审批",
  },
  task_rework: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "任务返工",
  },
  deliverable_review: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "交付物审核",
  },
  deliverable_rework: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "交付物返工",
  },
  issue_validation: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "问题验证",
  },
  critical_issue: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "关键问题",
  },
  task_assignment: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "任务分配",
  },
  mention: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "评论提及",
  },
  high_severity_issue: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "P0/P1 问题",
  },
  task_blocked_notify: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "任务阻塞",
  },
  exception_escalation: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "异常升级",
  },
  delay_impact_notify: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "延期影响确认",
  },
  mp_release_confirm: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "MP Release 发布确认",
  },
  condition_followup: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "条件项跟进",
  },
  certificate_renewal: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: false,
    label: "证书续期",
  },
  handoff_acceptance: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "量产移交接收",
  },
  overdue_reminder: {
    tier: "daily_digest",
    personalChannels: ["site"],
    requiresAction: false,
    label: "逾期提醒",
  },
  due_soon_reminder: {
    tier: "daily_digest",
    personalChannels: ["site"],
    requiresAction: false,
    label: "临期提醒",
  },
  gate_prereq_incomplete: {
    tier: "daily_digest",
    personalChannels: ["site"],
    requiresAction: false,
    label: "Gate 前置未完成",
  },
  gate_ready_notify: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "Gate 就绪",
  },
  health_digest: {
    tier: "daily_digest",
    personalChannels: ["site", "dingtalk"],
    requiresAction: false,
    label: "健康摘要",
  },
  personal_daily_digest: {
    tier: "daily_digest",
    personalChannels: ["site", "dingtalk"],
    requiresAction: false,
    label: "个人每日摘要",
  },
  group_weekly_digest: {
    tier: "weekly_digest",
    personalChannels: [],
    requiresAction: false,
    label: "项目群周摘要",
  },
  weekly_meeting_reminder: {
    tier: "weekly_digest",
    personalChannels: [],
    requiresAction: false,
    label: "项目周会提醒",
  },
  task_ready_notify: {
    tier: "immediate_action",
    personalChannels: ["site", "dingtalk"],
    requiresAction: true,
    label: "任务可以开始规则",
  },
  status_change_notify: {
    tier: "inbox_only",
    personalChannels: ["site"],
    requiresAction: false,
    label: "状态流转",
  },
  definition_confirmed_notify: {
    tier: "inbox_only",
    personalChannels: ["site"],
    requiresAction: false,
    label: "定义确认",
  },
  gate_decision_notify: {
    tier: "inbox_only",
    personalChannels: ["site"],
    requiresAction: false,
    label: "Gate 决策",
  },
  phase_advanced_notify: {
    tier: "inbox_only",
    personalChannels: ["site"],
    requiresAction: false,
    label: "阶段推进",
  },
  mp_release_broadcast: {
    tier: "broadcast",
    personalChannels: ["site"],
    requiresAction: false,
    label: "量产发布播报",
  },
} satisfies Record<NotificationEventKey, NotificationPolicy>;

export function getNotificationPolicy(eventKey: NotificationEventKey): NotificationPolicy {
  return NOTIFICATION_MATRIX[eventKey];
}
