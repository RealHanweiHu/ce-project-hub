import { buildWeeklyEvent } from "./dingtalkCalendar";

type Cfg = { enabled: boolean; weekday: number; time: string; durationMin: number; title: string };
type Proj = { id: string; name: string; startDate: string | null; targetDate: string | null; pmUserId: number | null; dingtalkEventId: string | null };
type Member = { id: number; dingtalkUserId?: string | null; mobile?: string | null };

export type MeetingSyncMode = "skipped" | "dingtalk" | "group_push" | "failed";
export type MeetingSyncResult = { mode: MeetingSyncMode; eventId?: string | null; error?: string };

export type MeetingSyncDeps = {
  resolveUserId: (u: Member) => Promise<string | null>;
  upsert: (p: { organizerUserId: string; existingEventId: string | null; event: ReturnType<typeof buildWeeklyEvent> }) => Promise<string | null>;
  saveEventId: (projectId: string, eventId: string | null) => Promise<void>;
  groupPush: (text: string) => Promise<boolean | void>;
};

/**
 * 同步项目周会：钉钉日程优先（在 PM 日历建/更新循环日程），解析不到人/未配/失败则降级群推。
 * 永远不抛错由调用方控制；本函数只决策与编排。
 */
export async function syncProjectMeeting(args: {
  project: Proj; config: Cfg | null; members: Member[]; todayISO: string; deps: MeetingSyncDeps;
}): Promise<MeetingSyncResult> {
  const { project, config, members, todayISO, deps } = args;
  if (!config?.enabled) return { mode: "skipped" };
  // 周会不强制项目开始日；无开始日则以今天为首次锚点
  const startAnchor = project.startDate || todayISO;
  const fallbackText = `【${project.name}】项目周会：每周${"日一二三四五六"[config.weekday]} ${config.time}（${config.durationMin} 分钟）`;

  const pm = members.find((m) => m.id === project.pmUserId);
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
      return { mode: "failed", error: lastError ? `${lastError}; 群提醒失败：${pushError}` : `群提醒失败：${pushError}` };
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
        title: config.title, weekday: config.weekday, time: config.time, durationMin: config.durationMin,
        startDate: startAnchor, targetDate: project.targetDate, timeZone: "Asia/Shanghai", attendees,
      });
      const eventId = await deps.upsert({ organizerUserId: pmUserId, existingEventId: project.dingtalkEventId, event });
      if (eventId) {
        await deps.saveEventId(project.id, eventId);
        return { mode: "dingtalk", eventId };
      }
      lastError = "钉钉未返回周会日程 ID";
    } catch (error) {
      lastError = `钉钉周会同步失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // 降级：群推文字提醒
  return pushFallback();
}
