import { describe, expect, it, vi } from "vitest";
import {
  cancelFutureProjectDingtalkEvents,
  ProjectCalendarCleanupError,
} from "./project-delete-calendar-cleanup";

describe("project delete one-off calendar cleanup", () => {
  it("cancels and marks every future DingTalk event", async () => {
    const cancelMeeting = vi.fn(async () => true);
    const markCanceled = vi.fn(async () => undefined);

    const count = await cancelFutureProjectDingtalkEvents("p1", {
      now: new Date("2026-07-18T02:00:00Z"),
      loadEvents: async (_projectId, todayISO) => {
        expect(todayISO).toBe("2026-07-18");
        return [
          {
            id: 1,
            title: "设计评审",
            organizerUserId: 7,
            dingtalkEventId: "evt-1",
          },
          {
            id: 2,
            title: "试产协调",
            organizerUserId: 8,
            dingtalkEventId: "evt-2",
          },
        ];
      },
      resolveOrganizer: async userId => `ding-${userId}`,
      cancelMeeting,
      markCanceled,
    });

    expect(count).toBe(2);
    expect(cancelMeeting).toHaveBeenNthCalledWith(1, "ding-7", "evt-1");
    expect(cancelMeeting).toHaveBeenNthCalledWith(2, "ding-8", "evt-2");
    expect(markCanceled.mock.calls).toEqual([[1], [2]]);
  });

  it("fails before deleting local handles when a remote event cannot be canceled", async () => {
    const markCanceled = vi.fn(async () => undefined);

    await expect(
      cancelFutureProjectDingtalkEvents("p1", {
        loadEvents: async () => [
          {
            id: 1,
            title: "设计评审",
            organizerUserId: 7,
            dingtalkEventId: "evt-1",
          },
        ],
        resolveOrganizer: async () => "ding-7",
        cancelMeeting: async () => false,
        markCanceled,
      })
    ).rejects.toThrow("设计评审");

    expect(markCanceled).not.toHaveBeenCalled();
  });

  it("reports partial remote cleanup so deletion can keep the project paused", async () => {
    const markCanceled = vi.fn(async () => undefined);
    const cancelMeeting = vi
      .fn<(organizerUserId: string, eventId: string) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const error = await cancelFutureProjectDingtalkEvents("p1", {
      loadEvents: async () => [
        {
          id: 1,
          title: "设计评审",
          organizerUserId: 7,
          dingtalkEventId: "evt-1",
        },
        {
          id: 2,
          title: "试产协调",
          organizerUserId: 8,
          dingtalkEventId: "evt-2",
        },
      ],
      resolveOrganizer: async userId => `ding-${userId}`,
      cancelMeeting,
      markCanceled,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProjectCalendarCleanupError);
    expect(error).toMatchObject({
      irreversibleChanges: true,
      canceledCount: 1,
    });
    expect(markCanceled).toHaveBeenCalledOnce();
  });

  it("is retry-safe after successfully canceled events have been marked", async () => {
    const cancelMeeting = vi.fn(async () => true);

    const count = await cancelFutureProjectDingtalkEvents("p1", {
      loadEvents: async () => [
        {
          id: 1,
          title: "已取消评审",
          organizerUserId: 7,
          dingtalkEventId: null,
          dingtalkSyncStatus: "canceled",
        },
        {
          id: 2,
          title: "待取消协调",
          organizerUserId: 8,
          dingtalkEventId: "evt-2",
        },
      ],
      resolveOrganizer: async userId => `ding-${userId}`,
      cancelMeeting,
      markCanceled: async () => undefined,
    });

    expect(count).toBe(1);
    expect(cancelMeeting).toHaveBeenCalledOnce();
    expect(cancelMeeting).toHaveBeenCalledWith("ding-8", "evt-2");
  });
});
