import { buildWeeklyEvent } from "./dingtalkCalendar";

type Cfg = { enabled: boolean; weekday: number; time: string; durationMin: number; title: string };
type Proj = { id: string; name: string; startDate: string | null; targetDate: string | null; pmUserId: number | null; dingtalkEventId: string | null };
type Member = { id: number; dingtalkUserId?: string | null; mobile?: string | null };

export type MeetingSyncDeps = {
  resolveUserId: (u: Member) => Promise<string | null>;
  upsert: (p: { organizerUserId: string; existingEventId: string | null; event: ReturnType<typeof buildWeeklyEvent> }) => Promise<string | null>;
  saveEventId: (projectId: string, eventId: string | null) => Promise<void>;
  groupPush: (text: string) => Promise<void>;
};

/**
 * 同步项目周会：钉钉日程优先（在 PM 日历建/更新循环日程），解析不到人/未配/失败则降级群推。
 * 永远不抛错由调用方控制；本函数只决策与编排。
 */
export async function syncProjectMeeting(args: {
  project: Proj; config: Cfg | null; members: Member[]; deps: MeetingSyncDeps;
}): Promise<{ mode: "skipped" | "dingtalk" | "group_push" }> {
  const { project, config, members, deps } = args;
  if (!config?.enabled || !project.startDate) return { mode: "skipped" };

  const pm = members.find((m) => m.id === project.pmUserId);
  const pmUserId = pm ? await deps.resolveUserId(pm) : null;

  if (pmUserId) {
    const attendees = (await Promise.all(members.map((m) => deps.resolveUserId(m)))).filter((x): x is string => !!x);
    const event = buildWeeklyEvent({
      title: config.title, weekday: config.weekday, time: config.time, durationMin: config.durationMin,
      startDate: project.startDate, targetDate: project.targetDate, timeZone: "Asia/Shanghai", attendees,
    });
    const eventId = await deps.upsert({ organizerUserId: pmUserId, existingEventId: project.dingtalkEventId, event });
    if (eventId) { await deps.saveEventId(project.id, eventId); return { mode: "dingtalk" }; }
  }

  // 降级：群推文字提醒
  await deps.groupPush(`【${project.name}】项目周会：每周${"日一二三四五六"[config.weekday]} ${config.time}（${config.durationMin} 分钟）`);
  return { mode: "group_push" };
}
