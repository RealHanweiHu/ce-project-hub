import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getProjectById,
  getMeetingParticipants,
  updateProjectMeetingConfig,
  setUserDingtalkId,
  createProjectCalendarEvent,
  updateProjectCalendarEventSync,
  createActivityLog,
} from "../db";
import { resolveDingtalkUserId } from "../_core/dingtalk";
import {
  buildSingleEvent,
  cancelMeeting,
  upsertSingleMeeting,
} from "../_core/dingtalkCalendar";
import {
  DingtalkEventHandlePersistenceError,
  persistCreatedDingtalkEventHandle,
} from "../_core/meetingSync";
import { sendToGroupChat } from "../_core/dingtalkGroup";
import {
  assertProjectAccess,
  assertProjectPermission,
} from "../project-access";
import { syncAndRecordProjectMeeting } from "../services/project-meeting-lifecycle";
import {
  ProjectExternalOperationBlockedError,
  withProjectExternalOperation,
} from "../project-external-operation";

const cfgSchema = z.object({
  enabled: z.boolean(),
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(15).max(480),
  title: z.string().min(1).max(64),
});

const eventSchema = z.object({
  projectId: z.string(),
  title: z.string().trim().min(1).max(128),
  description: z.string().trim().max(1000).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(15).max(480),
  syncDingtalk: z.boolean().default(true),
});

async function runProjectDingtalkOperation<T>(
  projectId: string,
  kind: string,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await withProjectExternalOperation([projectId], kind, operation);
  } catch (error) {
    if (error instanceof ProjectExternalOperationBlockedError) {
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    }
    throw error;
  }
}

type OneOffEventSyncPatch = {
  dingtalkEventId: string | null;
  dingtalkSyncStatus: "synced" | "failed";
};

type OneOffEventPersistenceDeps = {
  updateSync?: (id: number, patch: OneOffEventSyncPatch) => Promise<void>;
  rollbackCreatedEvent?: (
    organizerUserId: string,
    eventId: string
  ) => Promise<boolean>;
};

/**
 * Commit a one-off event's remote handle. If the local commit fails, cancel the
 * newly-created remote event and move the placeholder row out of `pending`.
 */
export async function persistOneOffDingtalkEventHandle(
  args: {
    localEventId: number;
    organizerUserId: string;
    remoteEventId: string;
  },
  deps: OneOffEventPersistenceDeps = {}
): Promise<void> {
  const updateSync = deps.updateSync ?? updateProjectCalendarEventSync;
  try {
    await persistCreatedDingtalkEventHandle({
      organizerUserId: args.organizerUserId,
      eventId: args.remoteEventId,
      saveEventId: () =>
        updateSync(args.localEventId, {
          dingtalkEventId: args.remoteEventId,
          dingtalkSyncStatus: "synced",
        }),
      rollbackCreatedEvent: deps.rollbackCreatedEvent ?? cancelMeeting,
    });
  } catch (error) {
    if (error instanceof DingtalkEventHandlePersistenceError) {
      try {
        await updateSync(args.localEventId, {
          dingtalkEventId: error.rollbackSucceeded ? null : args.remoteEventId,
          dingtalkSyncStatus: "failed",
        });
      } catch (recoveryError) {
        console.error(
          "[calendar] failed to persist compensated event state:",
          args.remoteEventId,
          recoveryError
        );
      }
    }
    throw error;
  }
}

export const meetingsRouter = router({
  getConfig: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { project } = await assertProjectAccess(input.projectId, ctx.user);
      return {
        config: (project as { meetingConfig?: unknown }).meetingConfig ?? null,
        syncStatus:
          (project as { dingtalkMeetingSyncStatus?: string | null })
            .dingtalkMeetingSyncStatus ?? "not_synced",
        lastError:
          (project as { dingtalkMeetingLastError?: string | null })
            .dingtalkMeetingLastError ?? null,
        lastSyncedAt:
          (project as { dingtalkMeetingLastSyncedAt?: Date | null })
            .dingtalkMeetingLastSyncedAt ?? null,
        eventId:
          (project as { dingtalkEventId?: string | null }).dingtalkEventId ??
          null,
      };
    }),

  setConfig: protectedProcedure
    .input(z.object({ projectId: z.string(), config: cfgSchema }))
    .mutation(async ({ ctx, input }) => {
      const { project: beforeProject } = await assertProjectPermission(
        input.projectId,
        ctx.user,
        "canEditProjectInfo",
        "没有编辑周会配置的权限"
      );
      const beforeConfig =
        (beforeProject as { meetingConfig?: unknown }).meetingConfig ?? null;
      return runProjectDingtalkOperation(
        input.projectId,
        "meeting_config_sync",
        async () => {
          await updateProjectMeetingConfig(input.projectId, input.config);
          const project = await getProjectById(input.projectId);
          if (!project) return { success: true, syncStatus: "failed" } as const;
          const syncResult = await syncAndRecordProjectMeeting({
            project,
            config: input.config,
          });
          await createActivityLog({
            projectId: input.projectId,
            userId: ctx.user.id,
            action: "meeting.update_config",
            entityType: "meeting_config",
            entityId: input.projectId,
            meta: {
              before: beforeConfig,
              after: input.config,
              syncStatus: syncResult.mode,
              error: syncResult.error ?? null,
            },
          });
          return {
            success: true,
            syncStatus: syncResult.mode,
            error: syncResult.error ?? null,
          } as const;
        }
      );
    }),

  createEvent: protectedProcedure
    .input(eventSchema)
    .mutation(async ({ ctx, input }) => {
      const { project } = await assertProjectPermission(
        input.projectId,
        ctx.user,
        "canEditProjectInfo",
        "只有管理层/PM/Owner 可以创建项目日程"
      );

      return runProjectDingtalkOperation(
        input.projectId,
        "calendar_event_sync",
        async () => {
          const created = await createProjectCalendarEvent({
            projectId: input.projectId,
            title: input.title,
            description: input.description?.trim() || null,
            eventDate: input.date,
            startTime: input.time,
            durationMin: input.durationMin,
            organizerUserId: ctx.user.id,
            createdBy: ctx.user.id,
            dingtalkSyncStatus: input.syncDingtalk ? "pending" : "not_synced",
          });

          let syncStatus = input.syncDingtalk ? "failed" : "not_synced";
          let dingtalkEventId: string | null = null;
          let syncStatePersisted = false;
          if (input.syncDingtalk) {
            const organizerUserId = await resolveDingtalkUserId(
              ctx.user,
              setUserDingtalkId
            );
            if (organizerUserId) {
              const members = await getMeetingParticipants(
                input.projectId,
                project.pmUserId ?? null
              );
              const attendeeIds = new Set(
                (
                  await Promise.all(
                    members.map(member =>
                      resolveDingtalkUserId(member, setUserDingtalkId)
                    )
                  )
                ).filter((id): id is string => !!id)
              );
              const event = buildSingleEvent({
                title: `【${project.name}】${input.title}`,
                date: input.date,
                time: input.time,
                durationMin: input.durationMin,
                timeZone: "Asia/Shanghai",
                attendees: Array.from(attendeeIds),
              });
              dingtalkEventId = await upsertSingleMeeting({
                organizerUserId,
                existingEventId: null,
                event,
              });
              if (dingtalkEventId) {
                try {
                  await persistOneOffDingtalkEventHandle({
                    localEventId: created.id,
                    organizerUserId,
                    remoteEventId: dingtalkEventId,
                  });
                } catch (error) {
                  if (error instanceof DingtalkEventHandlePersistenceError) {
                    throw new TRPCError({
                      code: "INTERNAL_SERVER_ERROR",
                      message: error.message,
                    });
                  }
                  throw error;
                }
                syncStatus = "synced";
                syncStatePersisted = true;
              }
            }

            if (syncStatus === "failed" && project.dingtalkChatId) {
              try {
                const sentToGroup = await sendToGroupChat(
                  project.dingtalkChatId,
                  "项目日程",
                  `### 【${project.name}】${input.title}\n时间：${input.date} ${input.time}（${input.durationMin} 分钟）${input.description ? `\n\n${input.description}` : ""}`
                );
                if (sentToGroup) syncStatus = "group_push";
              } catch {
                // keep failed status
              }
            }
          }

          if (!syncStatePersisted) {
            await updateProjectCalendarEventSync(created.id, {
              dingtalkEventId,
              dingtalkSyncStatus: syncStatus,
            });
          }
          await createActivityLog({
            projectId: input.projectId,
            userId: ctx.user.id,
            action: "calendar.create_event",
            entityType: "calendar",
            entityId: String(created.id),
            meta: {
              title: input.title,
              date: input.date,
              time: input.time,
              syncStatus,
            },
          });

          return {
            success: true,
            id: created.id,
            dingtalkEventId,
            syncStatus,
          } as const;
        }
      );
    }),
});
