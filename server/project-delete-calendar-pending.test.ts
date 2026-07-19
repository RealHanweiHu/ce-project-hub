import { describe, expect, it, vi } from "vitest";
import { cancelFutureProjectDingtalkEvents } from "./project-delete-calendar-cleanup";

describe("project delete pending calendar reservation", () => {
  it("blocks deletion while a reserved DingTalk event has not stored its remote id", async () => {
    const resolveOrganizer = vi.fn(async () => "ding-7");
    const cancelMeeting = vi.fn(async () => true);

    await expect(
      cancelFutureProjectDingtalkEvents("p1", {
        loadEvents: async () => [
          {
            id: 1,
            title: "正在创建的评审",
            organizerUserId: 7,
            dingtalkEventId: null,
            dingtalkSyncStatus: "pending",
          },
        ],
        resolveOrganizer,
        cancelMeeting,
      })
    ).rejects.toThrow(/仍在同步中/);

    expect(resolveOrganizer).not.toHaveBeenCalled();
    expect(cancelMeeting).not.toHaveBeenCalled();
  });
});
