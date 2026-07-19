import { beforeEach, describe, expect, it, vi } from "vitest";

const markHandled = vi.hoisted(() => vi.fn());
vi.mock("./dingtalk-interactive-card-service", () => ({
  markActionItemInteractiveCardsHandled: markHandled,
}));

import { settleProjectInteractiveCards } from "./project-delete-push-cleanup";

describe("project delete interactive-card settlement", () => {
  beforeEach(() => {
    markHandled.mockReset();
    markHandled.mockResolvedValue(true);
  });

  it("marks every captured action card as non-actionable before removing tracking rows", async () => {
    await expect(settleProjectInteractiveCards({ notificationIds: [], actionItemIds: [11, 12] }))
      .resolves.toBe(true);

    expect(markHandled).toHaveBeenCalledTimes(2);
    expect(markHandled).toHaveBeenNthCalledWith(1, 11, {
      title: "项目已删除",
      message: "该项目已删除，此行动项不再需要处理。",
    });
    expect(markHandled).toHaveBeenNthCalledWith(2, 12, {
      title: "项目已删除",
      message: "该项目已删除，此行动项不再需要处理。",
    });
  });

  it("keeps settling other cards if one remote update throws", async () => {
    markHandled.mockRejectedValueOnce(new Error("DingTalk unavailable"));

    await expect(settleProjectInteractiveCards({ notificationIds: [], actionItemIds: [11, 12] }))
      .resolves.toBe(false);
    expect(markHandled).toHaveBeenCalledTimes(2);
  });
});
