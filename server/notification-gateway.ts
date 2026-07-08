import { ENV } from "./_core/env";
import {
  notifyUsersViaDingtalk as defaultNotifyDingtalk,
  type WorkNotificationButton,
  type WorkNotificationOptions,
} from "./_core/dingtalkMessage";
import { tryDeliverActionItemInteractiveCard } from "./dingtalk-interactive-card-service";
import {
  createNotification as defaultCreateNotification,
  getNotificationDeliveryProfiles as defaultGetDeliveryProfiles,
  type NotificationDeliveryProfile,
} from "./db";
import {
  getNotificationPolicy,
  type NotificationEventKey,
} from "../shared/notification-matrix";
import { toAbsoluteAppUrl } from "../shared/action-links";

export type NotifyPersonalDeps = {
  createNotification?: typeof defaultCreateNotification;
  notifyDingtalk?: (userIds: number[], title: string, markdown: string, options?: WorkNotificationOptions) => Promise<void>;
  getDeliveryProfiles?: (userIds: number[]) => Promise<Map<number, NotificationDeliveryProfile>>;
  now?: Date;
};

export type NotifyPersonalInput = {
  eventKey: NotificationEventKey;
  userIds: number[];
  title: string;
  body?: string | null;
  markdown?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionPath?: string | null;
  actionUrl?: string | null;
  actionButtons?: WorkNotificationButton[] | null;
  interactiveActionItem?: {
    actionItemId: number | null;
    recipientUserId: number;
    projectId: string;
    entityType: string;
    entityId: string;
  } | null;
  priority?: "critical" | "high" | "normal" | "low" | string | null;
  bestEffortDingtalk?: boolean;
  suppressDingtalk?: boolean;
};

export async function notifyPersonal(
  input: NotifyPersonalInput,
  deps: NotifyPersonalDeps = {},
): Promise<{ site: number; dingtalk: number }> {
  const policy = getNotificationPolicy(input.eventKey);
  const uniqueUserIds = Array.from(new Set(input.userIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueUserIds.length === 0) return { site: 0, dingtalk: 0 };

  let site = 0;
  if (policy.personalChannels.includes("site")) {
    const createNotification = deps.createNotification ?? defaultCreateNotification;
    for (const userId of uniqueUserIds) {
      await createNotification({
        userId,
        type: policy.requiresAction ? "action" : "automation",
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      });
      site += 1;
    }
  }

  let dingtalk = 0;
  if (!input.suppressDingtalk && policy.personalChannels.includes("dingtalk")) {
    const notifyDingtalk = deps.notifyDingtalk ?? defaultNotifyDingtalk;
    const getDeliveryProfiles = deps.getDeliveryProfiles ?? defaultGetDeliveryProfiles;
    const dingtalkUserIds = await filterDingtalkRecipients({
      userIds: uniqueUserIds,
      eventKey: input.eventKey,
      requiresAction: policy.requiresAction,
      priority: input.priority ?? null,
      profiles: await getDeliveryProfiles(uniqueUserIds),
      now: deps.now ?? new Date(),
    });
    if (dingtalkUserIds.length === 0) return { site, dingtalk: 0 };
    const actionUrl = input.actionUrl ?? (
      input.actionPath ? toAbsoluteAppUrl(input.actionPath, ENV.appBaseUrl) : null
    );
    const markdown = withActionLink(input.markdown ?? input.body ?? input.title, actionUrl);
    const options = input.actionButtons?.length ? { buttons: input.actionButtons } : undefined;
    const deliveredNative = !deps.notifyDingtalk && input.interactiveActionItem && dingtalkUserIds.length === 1
      ? await tryDeliverActionItemInteractiveCard({
          actionItemId: input.interactiveActionItem.actionItemId,
          recipientUserId: input.interactiveActionItem.recipientUserId,
          eventKey: input.eventKey,
          projectId: input.interactiveActionItem.projectId,
          entityType: input.interactiveActionItem.entityType,
          entityId: input.interactiveActionItem.entityId,
          title: input.title,
          body: input.body ?? null,
          actionUrl,
          actionButtons: input.actionButtons ?? null,
        })
      : false;
    if (deliveredNative) {
      dingtalk = dingtalkUserIds.length;
      return { site, dingtalk };
    }
    if (input.bestEffortDingtalk) {
      try {
        await notifyDingtalk(dingtalkUserIds, input.title, markdown, options);
        dingtalk = dingtalkUserIds.length;
      } catch {
        dingtalk = 0;
      }
    } else {
      await notifyDingtalk(dingtalkUserIds, input.title, markdown, options);
      dingtalk = dingtalkUserIds.length;
    }
  }

  return { site, dingtalk };
}

function withActionLink(markdown: string, actionUrl: string | null): string {
  if (!actionUrl) return markdown;
  if (markdown.includes(actionUrl)) return markdown;
  const label = actionUrl === ENV.appBaseUrl || actionUrl === `${ENV.appBaseUrl}/`
    ? "打开 CE Project Hub"
    : "打开处理";
  return `${markdown}\n\n[${label}](${actionUrl})`;
}

function hourInTimezone(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  return Number.isFinite(hour) ? hour % 24 : 0;
}

function isWithinQuietHours(now: Date, startHour: number, endHour: number, timezone: string): boolean {
  const hour = hourInTimezone(now, timezone);
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function isCriticalDelivery(eventKey: NotificationEventKey, priority: string | null): boolean {
  return priority === "critical" || eventKey === "critical_issue";
}

async function filterDingtalkRecipients(input: {
  userIds: number[];
  eventKey: NotificationEventKey;
  requiresAction: boolean;
  priority: string | null;
  profiles: Map<number, NotificationDeliveryProfile>;
  now: Date;
}): Promise<number[]> {
  const critical = isCriticalDelivery(input.eventKey, input.priority);
  const isLowPriority = !critical && input.priority !== "high";
  return input.userIds.filter((userId) => {
    const profile = input.profiles.get(userId);
    const prefs = profile?.prefs.dingtalk ?? {};
    if (prefs.enabled === false) return false;

    const quietHours = prefs.quietHours ?? {};
    const startHour = Number.isInteger(quietHours.startHour) ? quietHours.startHour! : 22;
    const endHour = Number.isInteger(quietHours.endHour) ? quietHours.endHour! : 8;
    const timezone = quietHours.timezone || "Asia/Shanghai";
    if (!critical && isWithinQuietHours(input.now, startHour, endHour, timezone)) {
      return false;
    }

    const maxImmediatePerDay = Number.isInteger(prefs.maxImmediatePerDay) ? prefs.maxImmediatePerDay! : 10;
    if (input.requiresAction && isLowPriority && (profile?.immediateSent24h ?? 0) >= maxImmediatePerDay) {
      return false;
    }
    return true;
  });
}
