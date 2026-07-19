import {
  buildWeeklyEvent,
  DingtalkCalendarCreationUncertainError,
} from "./dingtalkCalendar";

type Cfg = {
  enabled: boolean;
  weekday: number;
  time: string;
  durationMin: number;
  title: string;
};
type Proj = {
  id: string;
  name: string;
  startDate: string | null;
  targetDate: string | null;
  pmUserId: number | null;
  dingtalkEventId: string | null;
};
type Member = {
  id: number;
  dingtalkUserId?: string | null;
  mobile?: string | null;
};

export type MeetingSyncMode = "skipped" | "dingtalk" | "group_push" | "failed";
export type MeetingSyncResult = {
  mode: MeetingSyncMode;
  eventId?: string | null;
  error?: string;
  uncertain?: boolean;
};

export type MeetingSyncDeps = {
  resolveUserId: (u: Member) => Promise<string | null>;
  upsert: (p: {
    organizerUserId: string;
    existingEventId: string | null;
    event: ReturnType<typeof buildWeeklyEvent>;
  }) => Promise<string | null>;
  saveEventId: (projectId: string, eventId: string | null) => Promise<void>;
  rollbackCreatedEvent: (
    organizerUserId: string,
    eventId: string
  ) => Promise<boolean>;
  groupPush: (text: string) => Promise<boolean | void>;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A remote event was created, but its local recovery handle could not be
 * committed. `rollbackSucceeded=false` means callers must durably retain
 * `eventId` so a later cleanup can cancel it.
 */
export class DingtalkEventHandlePersistenceError extends Error {
  readonly eventId: string;
  readonly rollbackSucceeded: boolean;

  constructor(args: {
    eventId: string;
    saveError: unknown;
    rollbackSucceeded: boolean;
    rollbackError?: unknown;
  }) {
    const rollbackDescription = args.rollbackSucceeded
      ? "已回滚新建的钉钉日程"
      : `回滚失败，需保留远端日程 ID ${args.eventId} 继续清理${
          args.rollbackError ? `（${errorText(args.rollbackError)}）` : ""
        }`;
    super(
      `钉钉日程本地句柄保存失败：${errorText(args.saveError)}；${rollbackDescription}`
    );
    this.name = "DingtalkEventHandlePersistenceError";
    this.eventId = args.eventId;
    this.rollbackSucceeded = args.rollbackSucceeded;
  }
}

/** Commit a newly-created remote event handle, compensating on local failure. */
export async function persistCreatedDingtalkEventHandle(args: {
  organizerUserId: string;
  eventId: string;
  saveEventId: () => Promise<void>;
  rollbackCreatedEvent: (
    organizerUserId: string,
    eventId: string
  ) => Promise<boolean>;
}): Promise<void> {
  try {
    await args.saveEventId();
  } catch (saveError) {
    let rollbackSucceeded = false;
    let rollbackError: unknown;
    try {
      rollbackSucceeded = await args.rollbackCreatedEvent(
        args.organizerUserId,
        args.eventId
      );
    } catch (error) {
      rollbackError = error;
    }
    throw new DingtalkEventHandlePersistenceError({
      eventId: args.eventId,
      saveError,
      rollbackSucceeded,
      rollbackError,
    });
  }
}

/**
 * 同步项目周会：钉钉日程优先（在 PM 日历建/更新循环日程），解析不到人/未配/失败则降级群推。
 * 永远不抛错由调用方控制；本函数只决策与编排。
 */
export async function syncProjectMeeting(args: {
  project: Proj;
  config: Cfg | null;
  members: Member[];
  todayISO: string;
  deps: MeetingSyncDeps;
}): Promise<MeetingSyncResult> {
  const { project, config, members, todayISO, deps } = args;
  if (!config?.enabled) return { mode: "skipped" };
  // 周会不强制项目开始日；无开始日则以今天为首次锚点
  const startAnchor = project.startDate || todayISO;
  const fallbackText = `【${project.name}】项目周会：每周${"日一二三四五六"[config.weekday]} ${config.time}（${config.durationMin} 分钟）`;

  const pm = members.find(m => m.id === project.pmUserId);
  let lastError: string | undefined = pm ? undefined : "项目未配置 PM";

  const pushFallback = async (): Promise<MeetingSyncResult> => {
    try {
      const pushed = await deps.groupPush(fallbackText);
      if (pushed === false) {
        return { mode: "failed", error: lastError ?? "未能发送项目周会群提醒" };
      }
      return { mode: "group_push", error: lastError };
    } catch (error) {
      const pushError = error instanceof Error ? error.message : String(error);
      return {
        mode: "failed",
        error: lastError
          ? `${lastError}; 群提醒失败：${pushError}`
          : `群提醒失败：${pushError}`,
      };
    }
  };

  let pmUserId: string | null = null;
  if (pm) {
    try {
      pmUserId = await deps.resolveUserId(pm);
      if (!pmUserId) lastError = "无法解析 PM 的钉钉用户";
    } catch (error) {
      lastError = `解析 PM 钉钉用户失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  if (pmUserId) {
    try {
      const attendees: string[] = [];
      for (const member of members) {
        try {
          const userId = await deps.resolveUserId(member);
          if (userId && !attendees.includes(userId)) attendees.push(userId);
        } catch (error) {
          console.warn("[meeting] resolve attendee failed (non-fatal):", error);
        }
      }
      const event = buildWeeklyEvent({
        title: config.title,
        weekday: config.weekday,
        time: config.time,
        durationMin: config.durationMin,
        startDate: startAnchor,
        targetDate: project.targetDate,
        timeZone: "Asia/Shanghai",
        attendees,
      });
      const eventId = await deps.upsert({
        organizerUserId: pmUserId,
        existingEventId: project.dingtalkEventId,
        event,
      });
      if (eventId) {
        if (project.dingtalkEventId) {
          try {
            await deps.saveEventId(project.id, eventId);
          } catch (error) {
            return {
              mode: "failed",
              eventId: project.dingtalkEventId,
              error: `钉钉周会已更新，但本地句柄保存失败：${errorText(error)}`,
            };
          }
        } else {
          try {
            await persistCreatedDingtalkEventHandle({
              organizerUserId: pmUserId,
              eventId,
              saveEventId: () => deps.saveEventId(project.id, eventId),
              rollbackCreatedEvent: deps.rollbackCreatedEvent,
            });
          } catch (error) {
            if (error instanceof DingtalkEventHandlePersistenceError) {
              return {
                mode: "failed",
                eventId: error.rollbackSucceeded ? undefined : error.eventId,
                error: error.message,
              };
            }
            return {
              mode: "failed",
              eventId,
              error: `钉钉周会本地句柄保存失败：${errorText(error)}`,
            };
          }
        }
        return { mode: "dingtalk", eventId };
      }
      lastError = "钉钉未返回周会日程 ID";
    } catch (error) {
      if (error instanceof DingtalkCalendarCreationUncertainError) {
        return {
          mode: "failed",
          error: error.message,
          uncertain: true,
        };
      }
      lastError = `钉钉周会同步失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // 降级：群推文字提醒
  return pushFallback();
}
