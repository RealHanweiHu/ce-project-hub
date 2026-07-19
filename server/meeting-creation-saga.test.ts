import { describe, expect, it, vi } from "vitest";
import { DingtalkEventHandlePersistenceError } from "./_core/meetingSync";
import { persistOneOffDingtalkEventHandle } from "./routers/meetings";

describe("one-off DingTalk event creation saga", () => {
  it("cancels the new remote event and resolves the pending local row when handle persistence fails", async () => {
    const updateSync = vi
      .fn<
        (
          id: number,
          patch: { dingtalkEventId: string | null; dingtalkSyncStatus: string }
        ) => Promise<void>
      >()
      .mockRejectedValueOnce(new Error("first write failed"))
      .mockResolvedValueOnce(undefined);
    const rollbackCreatedEvent = vi.fn(async () => true);

    const error = await persistOneOffDingtalkEventHandle(
      {
        localEventId: 42,
        organizerUserId: "ding-owner",
        remoteEventId: "evt-new",
      },
      { updateSync, rollbackCreatedEvent }
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DingtalkEventHandlePersistenceError);
    expect(error).toMatchObject({ rollbackSucceeded: true });
    expect(rollbackCreatedEvent).toHaveBeenCalledWith("ding-owner", "evt-new");
    expect(updateSync).toHaveBeenNthCalledWith(2, 42, {
      dingtalkEventId: null,
      dingtalkSyncStatus: "failed",
    });
  });

  it("persists the remote id as failed recovery state when rollback cannot cancel it", async () => {
    const updateSync = vi
      .fn<
        (
          id: number,
          patch: { dingtalkEventId: string | null; dingtalkSyncStatus: string }
        ) => Promise<void>
      >()
      .mockRejectedValueOnce(new Error("first write failed"))
      .mockResolvedValueOnce(undefined);

    const error = await persistOneOffDingtalkEventHandle(
      {
        localEventId: 43,
        organizerUserId: "ding-owner",
        remoteEventId: "evt-needs-cleanup",
      },
      { updateSync, rollbackCreatedEvent: async () => false }
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      rollbackSucceeded: false,
      eventId: "evt-needs-cleanup",
    });
    expect(updateSync).toHaveBeenNthCalledWith(2, 43, {
      dingtalkEventId: "evt-needs-cleanup",
      dingtalkSyncStatus: "failed",
    });
  });
});
