import { ENV } from "./_core/env";
import {
  notifyUsersViaDingtalk as defaultNotifyDingtalk,
  type DispatchResult,
  type WorkNotificationButton,
  type WorkNotificationOptions,
} from "./_core/dingtalkMessage";
import { tryDeliverActionItemInteractiveCard } from "./dingtalk-interactive-card-service";
import {
  createNotification as defaultCreateNotification,
  getNotificationDeliveryProfiles as defaultGetDeliveryProfiles,
  getProjectById as defaultGetProjectById,
  type NotificationDeliveryProfile,
} from "./db";
import {
  getNotificationPolicy,
  type NotificationEventKey,
} from "../shared/notification-matrix";
import { toAbsoluteAppUrl } from "../shared/action-links";
import {
  ProjectExternalOperationBlockedError,
  releaseProjectExternalOperation,
  reserveProjectExternalOperation,
  runWithProjectExternalOperationReservation,
  startProjectExternalOperationHeartbeat,
  type ProjectExternalOperationHeartbeat,
  type ProjectExternalOperationReservation,
} from "./project-external-operation";
import { isDingtalkDeliveryEnabled as defaultIsDingtalkDeliveryEnabled } from "./_core/dingtalk-delivery-policy";

export type NotifyPersonalDeps = {
  createNotification?: typeof defaultCreateNotification;
  notifyDingtalk?: (
    userIds: number[],
    title: string,
    markdown: string,
    options?: WorkNotificationOptions
  ) => Promise<DispatchResult | void>;
  getDeliveryProfiles?: (
    userIds: number[]
  ) => Promise<Map<number, NotificationDeliveryProfile>>;
  isProjectActive?: (projectId: string) => Promise<boolean>;
  reserveProjectOperation?: typeof reserveProjectExternalOperation;
  releaseProjectOperation?: typeof releaseProjectExternalOperation;
  deliverInteractiveCard?: typeof tryDeliverActionItemInteractiveCard;
  isDingtalkDeliveryEnabled?: () => boolean;
  now?: Date;
};

export type PersonalDispatchResult = {
  site: number;
  dingtalk: number;
  failed: number;
  skipped: number;
  errors: string[];
};

export type NotifyPersonalInput = {
  eventKey: NotificationEventKey;
  projectId?: string | null;
  projectIds?: string[] | null;
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
  deps: NotifyPersonalDeps = {}
): Promise<PersonalDispatchResult> {
  const policy = getNotificationPolicy(input.eventKey);
  const uniqueUserIds = Array.from(
    new Set(input.userIds.filter(id => Number.isInteger(id) && id > 0))
  );
  if (uniqueUserIds.length === 0)
    return { site: 0, dingtalk: 0, failed: 0, skipped: 0, errors: [] };
  const isProjectActive =
    deps.isProjectActive ??
    (async (projectId: string) => {
      const project = await defaultGetProjectById(projectId);
      return Boolean(
        project && !project.archived && project.lifecycle === "active"
      );
    });
  const scopedProjectIds = Array.from(
    new Set([
      ...(input.projectIds ?? []),
      ...(input.projectId ? [input.projectId] : []),
      ...(input.interactiveActionItem?.projectId
        ? [input.interactiveActionItem.projectId]
        : []),
    ])
  );
  const areProjectsActive = async () =>
    (
      await Promise.all(
        scopedProjectIds.map(projectId => isProjectActive(projectId))
      )
    ).every(Boolean);
  if (!(await areProjectsActive())) {
    return {
      site: 0,
      dingtalk: 0,
      failed: 0,
      skipped: uniqueUserIds.length,
      errors: [],
    };
  }

  let site = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];
  if (policy.personalChannels.includes("site")) {
    const createNotification =
      deps.createNotification ?? defaultCreateNotification;
    for (const userId of uniqueUserIds) {
      await createNotification({
        projectId:
          input.projectId ??
          (scopedProjectIds.length === 1 ? scopedProjectIds[0] : null),
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
    const isDingtalkDeliveryEnabled =
      deps.isDingtalkDeliveryEnabled ??
      (deps.notifyDingtalk
        ? () => true
        : defaultIsDingtalkDeliveryEnabled);
    if (!isDingtalkDeliveryEnabled()) {
      return {
        site,
        dingtalk: 0,
        failed,
        skipped: skipped + uniqueUserIds.length,
        errors,
      };
    }
    if (!(await areProjectsActive())) {
      return {
        site,
        dingtalk: 0,
        failed,
        skipped: skipped + uniqueUserIds.length,
        errors,
      };
    }
    const notifyDingtalk = deps.notifyDingtalk ?? defaultNotifyDingtalk;
    const getDeliveryProfiles =
      deps.getDeliveryProfiles ?? defaultGetDeliveryProfiles;
    const dingtalkUserIds = await filterDingtalkRecipients({
      userIds: uniqueUserIds,
      eventKey: input.eventKey,
      requiresAction: policy.requiresAction,
      priority: input.priority ?? null,
      profiles: await getDeliveryProfiles(uniqueUserIds),
      now: deps.now ?? new Date(),
    });
    skipped += uniqueUserIds.length - dingtalkUserIds.length;
    if (dingtalkUserIds.length === 0)
      return { site, dingtalk: 0, failed, skipped, errors };
    const actionUrl =
      input.actionUrl ??
      (input.actionPath
        ? toAbsoluteAppUrl(input.actionPath, ENV.appBaseUrl)
        : null);
    const markdown = withActionLink(
      input.markdown ?? input.body ?? input.title,
      actionUrl
    );
    const options = input.actionButtons?.length
      ? { buttons: input.actionButtons }
      : undefined;
    if (!(await areProjectsActive())) {
      return {
        site,
        dingtalk: 0,
        failed,
        skipped: skipped + dingtalkUserIds.length,
        errors,
      };
    }
    let reservation: ProjectExternalOperationReservation | null = null;
    let reservationHeartbeat: ProjectExternalOperationHeartbeat | null = null;
    try {
      const reserveProjectOperation =
        deps.reserveProjectOperation ??
        (deps.notifyDingtalk
          ? async (projectIds: readonly string[]) => ({
              token: "injected-notifier",
              projectIds: [...projectIds],
            })
          : reserveProjectExternalOperation);
      reservation = await reserveProjectOperation(
        scopedProjectIds,
        `notification:${input.eventKey}`
      );
      reservationHeartbeat = startProjectExternalOperationHeartbeat(
        reservation
      );
      if (!(await areProjectsActive())) {
        return {
          site,
          dingtalk: 0,
          failed,
          skipped: skipped + dingtalkUserIds.length,
          errors,
        };
      }
      const dispatch = async () => {
        const deliverInteractiveCard =
          deps.deliverInteractiveCard ??
          (!deps.notifyDingtalk
            ? tryDeliverActionItemInteractiveCard
            : null);
        const nativeDelivery =
          deliverInteractiveCard &&
          input.interactiveActionItem &&
          dingtalkUserIds.length === 1
            ? await deliverInteractiveCard({
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
            : "fallback";
        if (nativeDelivery === "delivered") {
          dingtalk = dingtalkUserIds.length;
          return;
        }
        if (nativeDelivery === "uncertain") {
          failed += dingtalkUserIds.length;
          errors.push(
            "钉钉互动卡片投放结果未知，已进入隔离期且不会自动补发"
          );
          return;
        }
        if (input.bestEffortDingtalk) {
          try {
            const result = await notifyDingtalk(
              dingtalkUserIds,
              input.title,
              markdown,
              options
            );
            dingtalk = result?.delivered ?? dingtalkUserIds.length;
            failed += result?.failed ?? 0;
            skipped += result?.skipped ?? 0;
            if (result?.error) errors.push(result.error);
          } catch (error) {
            failed += dingtalkUserIds.length;
            errors.push(error instanceof Error ? error.message : String(error));
          }
        } else {
          const result = await notifyDingtalk(
            dingtalkUserIds,
            input.title,
            markdown,
            options
          );
          dingtalk = result?.delivered ?? dingtalkUserIds.length;
          failed += result?.failed ?? 0;
          skipped += result?.skipped ?? 0;
          if (result?.error) errors.push(result.error);
        }
      };
      if (deps.notifyDingtalk) {
        await dispatch();
      } else {
        await runWithProjectExternalOperationReservation(
          reservation,
          reservationHeartbeat,
          dispatch
        );
      }
    } catch (error) {
      if (error instanceof ProjectExternalOperationBlockedError) {
        return {
          site,
          dingtalk: 0,
          failed,
          skipped: skipped + dingtalkUserIds.length,
          errors,
        };
      }
      throw error;
    } finally {
      let heartbeatError: unknown;
      if (reservationHeartbeat) {
        await reservationHeartbeat.stop();
        try {
          reservationHeartbeat.assertHealthy();
        } catch (error) {
          heartbeatError = error;
        }
      }
      if (reservation) {
        const releaseProjectOperation =
          deps.releaseProjectOperation ??
          (deps.notifyDingtalk
            ? async () => {}
            : releaseProjectExternalOperation);
        await releaseProjectOperation(reservation.token).catch(error => {
          console.warn(
            "[notification] failed to release external-operation reservation:",
            error
          );
        });
      }
      if (heartbeatError) throw heartbeatError;
    }
  }

  return { site, dingtalk, failed, skipped, errors };
}

function withActionLink(markdown: string, actionUrl: string | null): string {
  if (!actionUrl) return markdown;
  if (markdown.includes(actionUrl)) return markdown;
  const label =
    actionUrl === ENV.appBaseUrl || actionUrl === `${ENV.appBaseUrl}/`
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
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  return Number.isFinite(hour) ? hour % 24 : 0;
}

function isWithinQuietHours(
  now: Date,
  startHour: number,
  endHour: number,
  timezone: string
): boolean {
  const hour = hourInTimezone(now, timezone);
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function isCriticalDelivery(
  eventKey: NotificationEventKey,
  priority: string | null
): boolean {
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
  return input.userIds.filter(userId => {
    const profile = input.profiles.get(userId);
    const prefs = profile?.prefs.dingtalk ?? {};
    if (prefs.enabled === false) return false;

    const quietHours = prefs.quietHours ?? {};
    const startHour = Number.isInteger(quietHours.startHour)
      ? quietHours.startHour!
      : 22;
    const endHour = Number.isInteger(quietHours.endHour)
      ? quietHours.endHour!
      : 8;
    const timezone = quietHours.timezone || "Asia/Shanghai";
    if (
      !critical &&
      isWithinQuietHours(input.now, startHour, endHour, timezone)
    ) {
      return false;
    }

    const maxImmediatePerDay = Number.isInteger(prefs.maxImmediatePerDay)
      ? prefs.maxImmediatePerDay!
      : 10;
    if (
      input.requiresAction &&
      isLowPriority &&
      (profile?.immediateSent24h ?? 0) >= maxImmediatePerDay
    ) {
      return false;
    }
    return true;
  });
}
