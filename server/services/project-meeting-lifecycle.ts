import {
  getMeetingParticipants,
  setUserDingtalkId,
  updateProjectDingtalkEvent,
  updateProjectDingtalkMeetingSync,
} from "../db";
import { resolveDingtalkUserId } from "../_core/dingtalk";
import { cancelMeeting, upsertWeeklyMeeting } from "../_core/dingtalkCalendar";
import { sendToGroupChat } from "../_core/dingtalkGroup";
import {
  syncProjectMeeting,
  type MeetingSyncResult,
} from "../_core/meetingSync";
import { pushWebhook } from "../_core/notify";
import { withProjectExternalOperation } from "../project-external-operation";

type MeetingConfig = {
  enabled: boolean;
  weekday: number;
  time: string;
  durationMin: number;
  title: string;
};

type ProjectForMeetingLifecycle = {
  id: string;
  name: string;
  startDate: string | null;
  targetDate: string | null;
  pmUserId: number | null;
  dingtalkEventId: string | null;
  dingtalkChatId?: string | null;
  dingtalkMeetingSyncStatus?: string | null;
};

type MeetingParticipant = Awaited<
  ReturnType<typeof getMeetingParticipants>
>[number];

type ProjectMeetingCancellationDeps = {
  loadParticipants?: (
    projectId: string,
    pmUserId: number | null
  ) => Promise<MeetingParticipant[]>;
  resolveOrganizer?: (
    participant: MeetingParticipant
  ) => Promise<string | null>;
  cancelRemote?: (organizerUserId: string, eventId: string) => Promise<boolean>;
  updateSync?: typeof updateProjectDingtalkMeetingSync;
  now?: () => Date;
};

/** Remote cancellation succeeded, so callers must not reactivate the project. */
export class ProjectMeetingCleanupError extends Error {
  readonly irreversibleChanges = true;
  readonly eventId: string;
  readonly checkpointPersisted: boolean;

  constructor(args: {
    eventId: string;
    checkpointPersisted: boolean;
    cause: unknown;
  }) {
    super(
      `钉钉周会已取消，但本地状态保存失败：${
        args.cause instanceof Error ? args.cause.message : String(args.cause)
      }`
    );
    this.name = "ProjectMeetingCleanupError";
    this.eventId = args.eventId;
    this.checkpointPersisted = args.checkpointPersisted;
  }
}

function normalizeError(error: string | undefined): string | null {
  if (!error) return null;
  return error.length > 1000 ? `${error.slice(0, 997)}...` : error;
}

export async function recordProjectMeetingSyncResult(
  projectId: string,
  result: MeetingSyncResult
): Promise<void> {
  const now = new Date();
  if (result.uncertain) {
    await updateProjectDingtalkMeetingSync(projectId, {
      status: "pending",
      lastError: normalizeError(result.error ?? "钉钉周会创建结果未知"),
    });
    return;
  }
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
    dingtalkEventId: result.eventId ?? undefined,
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
  const {
    project,
    config,
    allowGroupFallback = true,
    todayISO = new Date().toISOString().slice(0, 10),
  } = args;
  return withProjectExternalOperation(
    [project.id],
    "project_meeting_sync",
    async () => {
      if (!config?.enabled) {
        const canceled = await cancelAndRecordProjectMeeting(project);
        return {
          mode: canceled.ok ? "skipped" : "failed",
          error: canceled.error ?? undefined,
        };
      }

      await updateProjectDingtalkMeetingSync(project.id, {
        status: "pending",
        lastError: null,
      });
      const members = await getMeetingParticipants(
        project.id,
        project.pmUserId ?? null
      );
      const result = await syncProjectMeeting({
        project,
        config,
        members,
        todayISO,
        deps: {
          resolveUserId: user => resolveDingtalkUserId(user, setUserDingtalkId),
          upsert: upsertWeeklyMeeting,
          saveEventId: updateProjectDingtalkEvent,
          rollbackCreatedEvent: cancelMeeting,
          groupPush: async text => {
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
  );
}

export async function cancelAndRecordProjectMeeting(
  project: ProjectForMeetingLifecycle,
  deps: ProjectMeetingCancellationDeps = {}
): Promise<{ ok: boolean; error: string | null }> {
  const updateSync = deps.updateSync ?? updateProjectDingtalkMeetingSync;
  const now = deps.now ?? (() => new Date());
  if (!project.dingtalkEventId) {
    await updateSync(project.id, {
      dingtalkEventId: null,
      status: "canceled",
      lastError: null,
      lastSyncedAt: now(),
    });
    return { ok: true, error: null };
  }

  // A prior attempt canceled the remote event and persisted the checkpoint,
  // but may have failed while clearing the local handle. Finish locally only.
  if (project.dingtalkMeetingSyncStatus === "canceled") {
    await updateSync(project.id, {
      dingtalkEventId: null,
      lastError: null,
    });
    return { ok: true, error: null };
  }

  const members = await (deps.loadParticipants ?? getMeetingParticipants)(
    project.id,
    project.pmUserId ?? null
  );
  const pm = members.find(member => member.id === project.pmUserId);
  const organizerUserId = pm
    ? await (
        deps.resolveOrganizer ??
        (participant => resolveDingtalkUserId(participant, setUserDingtalkId))
      )(pm)
    : null;
  if (!organizerUserId) {
    const error = "无法解析 PM 的钉钉用户，未能取消原周会日程";
    await updateSync(project.id, {
      status: "failed",
      lastError: error,
    });
    return { ok: false, error };
  }

  const canceled = await (deps.cancelRemote ?? cancelMeeting)(
    organizerUserId,
    project.dingtalkEventId
  );
  if (!canceled) {
    const error = "钉钉周会日程取消失败";
    await updateSync(project.id, {
      status: "failed",
      lastError: error,
    });
    return { ok: false, error };
  }

  let checkpointPersisted = false;
  try {
    // Keep the handle until the durable cancellation checkpoint exists. This
    // makes a retry after the second write safe without another remote DELETE.
    await updateSync(project.id, {
      status: "canceled",
      lastError: null,
      lastSyncedAt: now(),
    });
    checkpointPersisted = true;
    await updateSync(project.id, {
      dingtalkEventId: null,
    });
  } catch (error) {
    throw new ProjectMeetingCleanupError({
      eventId: project.dingtalkEventId,
      checkpointPersisted,
      cause: error,
    });
  }
  return { ok: true, error: null };
}
