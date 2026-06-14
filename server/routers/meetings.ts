import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectById, getProjectMember, getMeetingParticipants,
  updateProjectMeetingConfig, setUserDingtalkId, updateProjectDingtalkEvent,
} from "../db";
import { ROLE_PERMISSIONS } from "./members";
import { resolveDingtalkUserId } from "../_core/dingtalk";
import { upsertWeeklyMeeting } from "../_core/dingtalkCalendar";
import { syncProjectMeeting } from "../_core/meetingSync";
import { pushWebhook } from "../_core/notify";

const cfgSchema = z.object({
  enabled: z.boolean(),
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(15).max(480),
  title: z.string().min(1).max(64),
});

async function effectiveRole(projectId: string, userId: number) {
  const p = await getProjectById(projectId);
  if (!p) return null;
  if (p.createdBy === userId) return "owner" as const;
  return (await getProjectMember(projectId, userId))?.role ?? null;
}

export const meetingsRouter = router({
  getConfig: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const p = await getProjectById(input.projectId);
      return (p as { meetingConfig?: unknown } | undefined)?.meetingConfig ?? null;
    }),

  setConfig: protectedProcedure
    .input(z.object({ projectId: z.string(), config: cfgSchema }))
    .mutation(async ({ ctx, input }) => {
      const role = await effectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) throw new TRPCError({ code: "FORBIDDEN" });
      await updateProjectMeetingConfig(input.projectId, input.config);
      const project = await getProjectById(input.projectId);
      const members = await getMeetingParticipants(input.projectId, project?.pmUserId ?? null);
      await syncProjectMeeting({
        project: project as never,
        config: input.config,
        members,
        todayISO: new Date().toISOString().slice(0, 10),
        deps: {
          resolveUserId: (u) => resolveDingtalkUserId(u, setUserDingtalkId),
          upsert: upsertWeeklyMeeting,
          saveEventId: updateProjectDingtalkEvent,
          groupPush: (t) => pushWebhook(t, { title: "项目周会" }),
        },
      });
      return { success: true } as const;
    }),
});
