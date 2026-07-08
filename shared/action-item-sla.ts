import type { ActionItemKind } from "../drizzle/schema";

export type ActionItemSlaPolicy = {
  label: string;
  remindOwnerAfterHours: number;
  escalatePmAfterHours: number;
  escalateManagerAfterHours: number;
};

export const ACTION_ITEM_SLA_POLICIES = {
  task_approval: {
    label: "任务审批",
    remindOwnerAfterHours: 24,
    escalatePmAfterHours: 24,
    escalateManagerAfterHours: 48,
  },
  task_rework: {
    label: "任务返工",
    remindOwnerAfterHours: 24,
    escalatePmAfterHours: 24,
    escalateManagerAfterHours: 48,
  },
  deliverable_review: {
    label: "交付物审核",
    remindOwnerAfterHours: 48,
    escalatePmAfterHours: 24,
    escalateManagerAfterHours: 48,
  },
  deliverable_rework: {
    label: "交付物返工",
    remindOwnerAfterHours: 48,
    escalatePmAfterHours: 24,
    escalateManagerAfterHours: 48,
  },
  issue_validation: {
    label: "问题验证",
    remindOwnerAfterHours: 24,
    escalatePmAfterHours: 24,
    escalateManagerAfterHours: 48,
  },
  critical_issue: {
    label: "关键问题",
    remindOwnerAfterHours: 2,
    escalatePmAfterHours: 2,
    escalateManagerAfterHours: 8,
  },
  delay_impact_notify: {
    label: "延期影响确认",
    remindOwnerAfterHours: 24,
    escalatePmAfterHours: 24,
    escalateManagerAfterHours: 48,
  },
  mp_release_confirm: {
    label: "MP Release 发布确认",
    remindOwnerAfterHours: 24,
    escalatePmAfterHours: 24,
    escalateManagerAfterHours: 48,
  },
} satisfies Record<ActionItemKind, ActionItemSlaPolicy>;

export type ActionItemSlaStage = "owner_reminded" | "pm_escalated" | "manager_escalated";

export type ActionItemSlaMetadata = {
  slaStage?: ActionItemSlaStage;
  ownerRemindedAt?: string;
  pmEscalatedAt?: string;
  managerEscalatedAt?: string;
  pmEscalationSkipped?: string;
  managerEscalationSkipped?: string;
};

export function getActionItemSlaPolicy(kind: ActionItemKind): ActionItemSlaPolicy {
  return ACTION_ITEM_SLA_POLICIES[kind];
}

export function hoursElapsedSince(now: Date, value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return (now.getTime() - date.getTime()) / 3_600_000;
}
