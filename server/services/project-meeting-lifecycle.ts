import {
  getMeetingParticipants,
  setUserDingtalkId,
  updateProjectDingtalkEvent,
  updateProjectDingtalkMeetingSync,
} from "../db";
import { resolveDingtalkUserId } from "../_core/dingtalk";
import { cancelMeeting, upsertWeeklyMeeting } from "../_core/dingtalkCalendar";
import { sendToGroupChat } from "../_core/dingtalkGroup";
import { syncProjectMeeting, type MeetingSyncResult } from "../_core/meetingSync";
import { pushWebhook } from "../_core/notify";

type MeetingConfig = { enabled: boolean; weekday: number; time: string; durationMin: number; title: string };

type ProjectForMeetingLifecycle = {
  id: string;
  name: string;
  startDate: string | null;
  targetDate: string | null;
  pmUserId: number | null;
  dingtalkEventId: string | null;
  dingtalkChatId?: string | null;
};

function normalizeError(error: string | undefined): string | null {
  if (!error) return null;
  return error.length > 1000 ? `${error.slice(0, 997)}...` : error;
}

export async function recordProjectMeetingSyncResult(projectId: string, result: MeetingSyncResult): Promise<void> {
  const now = new Date();
  if (result.mode === "dingtalk") {
    await updateProjectDingtalkMeetingSync(projectId, {
      dingtalkEventId: result.eventId ?? undefined,
      status: "synced",
      lastError: null,
      lastSyncedAt: now,
    });
    return;
  }

  if (result.mode === "group_push") {
    await updateProjectDingtalkMeetingSync(projectId, {
      status: "group_fallback",
      lastError: normalizeError(result.error),
      lastSyncedAt: now,
    });
    return;
  }

  if (result.mode === "skipped") {
    await updateProjectDingtalkMeetingSync(projectId, {
      status: "not_synced",
      lastError: null,
    });
    return;
  }

  await updateProjectDingtalkMeetingSync(projectId, {
    status: "failed",
    lastError: normalizeError(result.error ?? "钉钉周会同步失败"),
  });
}

export async function syncAndRecordProjectMeeting(args: {
  project: ProjectForMeetingLifecycle;
  config: MeetingConfig | null;
  allowGroupFallback?: boolean;
  todayISO?: string;
}): Promise<MeetingSyncResult> {
  const { project, config, allowGroupFallback = true, todayISO = new Date().toISOString().slice(0, 10) } = args;
  if (!config?.enabled) {
    const canceled = await cancelAndRecordProjectMeeting(project);
    return { mode: canceled.ok ? "skipped" : "failed", error: canceled.error ?? undefined };
  }

  await updateProjectDingtalkMeetingSync(project.id, { status: "pending", lastError: null });
  const members = await getMeetingParticipants(project.id, project.pmUserId ?? null);
  const result = await syncProjectMeeting({
    project,
    config,
    members,
    todayISO,
    deps: {
      resolveUserId: (user) => resolveDingtalkUserId(user, setUserDingtalkId),
      upsert: upsertWeeklyMeeting,
      saveEventId: updateProjectDingtalkEvent,
      groupPush: async (text) => {
        if (!allowGroupFallback) return false;
        if (project.dingtalkChatId) {
          return sendToGroupChat(project.dingtalkChatId, "项目周会", text);
        }
        await pushWebhook(text, { title: "项目周会" });
        return true;
      },
    },
  });
  await recordProjectMeetingSyncResult(project.id, result);
  return result;
}

export async function cancelAndRecordProjectMeeting(
  project: ProjectForMeetingLifecycle,
): Promise<{ ok: boolean; error: string | null }> {
  if (!project.dingtalkEventId) {
    await updateProjectDingtalkMeetingSync(project.id, {
      dingtalkEventId: null,
      status: "canceled",
      lastError: null,
      lastSyncedAt: new Date(),
    });
    return { ok: true, error: null };
  }

  const members = await getMeetingParticipants(project.id, project.pmUserId ?? null);
  const pm = members.find((member) => member.id === project.pmUserId);
  const organizerUserId = pm ? await resolveDingtalkUserId(pm, setUserDingtalkId) : null;
  if (!organizerUserId) {
    const error = "无法解析 PM 的钉钉用户，未能取消原周会日程";
    await updateProjectDingtalkMeetingSync(project.id, { status: "failed", lastError: error });
    return { ok: false, error };
  }

  const canceled = await cancelMeeting(organizerUserId, project.dingtalkEventId);
  if (!canceled) {
    const error = "钉钉周会日程取消失败";
    await updateProjectDingtalkMeetingSync(project.id, { status: "failed", lastError: error });
    return { ok: false, error };
  }

  await updateProjectDingtalkMeetingSync(project.id, {
    dingtalkEventId: null,
    status: "canceled",
    lastError: null,
    lastSyncedAt: new Date(),
  });
  return { ok: true, error: null };
}
