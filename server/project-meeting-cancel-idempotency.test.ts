import { describe, expect, it, vi } from "vitest";
import {
  cancelAndRecordProjectMeeting,
  ProjectMeetingCleanupError,
} from "./services/project-meeting-lifecycle";

const project = {
  id: "p1",
  name: "测试项目",
  startDate: null,
  targetDate: null,
  pmUserId: 7,
  dingtalkEventId: "evt-weekly",
  dingtalkMeetingSyncStatus: "synced",
};

describe("project meeting cancellation checkpoint", () => {
  it("finishes locally on retry after remote cancellation was checkpointed", async () => {
    const cancelRemote = vi.fn(async () => true);
    const firstUpdate = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("clear handle failed"));

    const error = await cancelAndRecordProjectMeeting(project, {
      loadParticipants: async () => [{ id: 7, dingtalkUserId: "ding-pm" }],
      resolveOrganizer: async () => "ding-pm",
      cancelRemote,
      updateSync: firstUpdate,
      now: () => new Date("2026-07-18T00:00:00Z"),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProjectMeetingCleanupError);
    expect(error).toMatchObject({
      irreversibleChanges: true,
      checkpointPersisted: true,
      eventId: "evt-weekly",
    });
    expect(cancelRemote).toHaveBeenCalledOnce();

    const retryUpdate = vi.fn(async () => undefined);
    const retry = await cancelAndRecordProjectMeeting(
      { ...project, dingtalkMeetingSyncStatus: "canceled" },
      {
        cancelRemote,
        updateSync: retryUpdate,
      }
    );

    expect(retry.ok).toBe(true);
    expect(cancelRemote).toHaveBeenCalledOnce();
    expect(retryUpdate).toHaveBeenCalledWith("p1", {
      dingtalkEventId: null,
      lastError: null,
    });
  });
});
