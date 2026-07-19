import { and, eq, gte } from "drizzle-orm";
import { projectCalendarEvents } from "../drizzle/schema";
import { cancelMeeting as defaultCancelMeeting } from "./_core/dingtalkCalendar";
import { resolveDingtalkUserId } from "./_core/dingtalk";
import {
  getDb,
  getUserById,
  setUserDingtalkId,
  updateProjectCalendarEventSync,
} from "./db";
import { todayShanghai } from "../shared/shanghai-date";

type ProjectCalendarCleanupEvent = {
  id: number;
  title: string;
  organizerUserId: number;
  dingtalkEventId: string | null;
  dingtalkSyncStatus?: string;
};

export type ProjectCalendarCleanupDeps = {
  now?: Date;
  loadEvents?: (
    projectId: string,
    todayISO: string
  ) => Promise<ProjectCalendarCleanupEvent[]>;
  resolveOrganizer?: (userId: number) => Promise<string | null>;
  cancelMeeting?: (
    organizerUserId: string,
    eventId: string
  ) => Promise<boolean>;
  markCanceled?: (eventId: number) => Promise<void>;
};

/**
 * Signals whether deletion cleanup has already changed remote state. A caller
 * must not restore an active lifecycle after `irreversibleChanges=true`.
 */
export class ProjectCalendarCleanupError extends Error {
  readonly canceledCount: number;
  readonly irreversibleChanges: boolean;

  constructor(message: string, canceledCount: number, cause?: unknown) {
    super(message);
    this.name = "ProjectCalendarCleanupError";
    this.canceledCount = canceledCount;
    this.irreversibleChanges = canceledCount > 0;
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: cause,
        configurable: true,
      });
    }
  }
}

async function defaultLoadEvents(
  projectId: string,
  todayISO: string
): Promise<ProjectCalendarCleanupEvent[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({
      id: projectCalendarEvents.id,
      title: projectCalendarEvents.title,
      organizerUserId: projectCalendarEvents.organizerUserId,
      dingtalkEventId: projectCalendarEvents.dingtalkEventId,
      dingtalkSyncStatus: projectCalendarEvents.dingtalkSyncStatus,
    })
    .from(projectCalendarEvents)
    .where(
      and(
        eq(projectCalendarEvents.projectId, projectId),
        gte(projectCalendarEvents.eventDate, todayISO)
      )
    );
  return rows;
}

async function defaultResolveOrganizer(userId: number): Promise<string | null> {
  const user = await getUserById(userId);
  return user ? resolveDingtalkUserId(user, setUserDingtalkId) : null;
}

/** Cancel future one-off DingTalk events before their local handles are deleted. */
export async function cancelFutureProjectDingtalkEvents(
  projectId: string,
  deps: ProjectCalendarCleanupDeps = {}
): Promise<number> {
  const todayISO = todayShanghai(deps.now ?? new Date());
  const events = await (deps.loadEvents ?? defaultLoadEvents)(
    projectId,
    todayISO
  );
  const resolveOrganizer = deps.resolveOrganizer ?? defaultResolveOrganizer;
  const cancelMeeting = deps.cancelMeeting ?? defaultCancelMeeting;
  const markCanceled =
    deps.markCanceled ??
    (async (eventId: number) => {
      await updateProjectCalendarEventSync(eventId, {
        dingtalkEventId: null,
        dingtalkSyncStatus: "canceled",
      });
    });

  let canceled = 0;
  for (const event of events) {
    if (!event.dingtalkEventId) {
      if (event.dingtalkSyncStatus === "pending") {
        throw new ProjectCalendarCleanupError(
          `钉钉日程「${event.title}」仍在同步中`,
          canceled
        );
      }
      continue;
    }
    let organizerUserId: string | null;
    try {
      organizerUserId = await resolveOrganizer(event.organizerUserId);
    } catch (error) {
      throw new ProjectCalendarCleanupError(
        `无法解析日程「${event.title}」的钉钉组织者`,
        canceled,
        error
      );
    }
    if (!organizerUserId) {
      throw new ProjectCalendarCleanupError(
        `无法解析日程「${event.title}」的钉钉组织者`,
        canceled
      );
    }
    let remoteCanceled: boolean;
    try {
      remoteCanceled = await cancelMeeting(
        organizerUserId,
        event.dingtalkEventId
      );
    } catch (error) {
      throw new ProjectCalendarCleanupError(
        `钉钉日程「${event.title}」取消失败`,
        canceled,
        error
      );
    }
    if (!remoteCanceled) {
      throw new ProjectCalendarCleanupError(
        `钉钉日程「${event.title}」取消失败`,
        canceled
      );
    }
    canceled += 1;
    try {
      await markCanceled(event.id);
    } catch (error) {
      throw new ProjectCalendarCleanupError(
        `钉钉日程「${event.title}」已取消，但本地状态保存失败`,
        canceled,
        error
      );
    }
  }
  return canceled;
}
