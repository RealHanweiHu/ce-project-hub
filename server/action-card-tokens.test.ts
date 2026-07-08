import { afterEach, describe, expect, it } from "vitest";
import { ENV } from "./_core/env";
import { createActionCardToken, verifyActionCardToken } from "./action-card-tokens";

const originalSecret = ENV.cookieSecret;

afterEach(() => {
  ENV.cookieSecret = originalSecret;
});

describe("action card tokens", () => {
  it("round-trips a signed action payload", async () => {
    ENV.cookieSecret = "test-secret-for-action-card";

    const token = await createActionCardToken({
      kind: "task_approval",
      userId: 7,
      projectId: "p1",
      phaseId: "design",
      taskId: "d1",
      decision: "approved",
    });

    await expect(verifyActionCardToken(token)).resolves.toMatchObject({
      kind: "task_approval",
      userId: 7,
      projectId: "p1",
      phaseId: "design",
      taskId: "d1",
      decision: "approved",
    });
  });

  it("rejects expired tokens", async () => {
    ENV.cookieSecret = "test-secret-for-action-card";
    const token = await createActionCardToken({
      kind: "task_complete",
      userId: 7,
      projectId: "p1",
      phaseId: "evt",
      taskId: "e1",
    }, { expiresInSeconds: -1 });

    await expect(verifyActionCardToken(token)).rejects.toThrow();
  });

  it("round-trips a snooze payload", async () => {
    ENV.cookieSecret = "test-secret-for-action-card";

    const token = await createActionCardToken({
      kind: "action_item_snooze",
      userId: 7,
      actionItemId: 42,
      until: "tomorrow_morning",
    });

    await expect(verifyActionCardToken(token)).resolves.toMatchObject({
      kind: "action_item_snooze",
      userId: 7,
      actionItemId: 42,
      until: "tomorrow_morning",
    });
  });

  it("round-trips long-tail confirmation payloads", async () => {
    ENV.cookieSecret = "test-secret-for-action-card";

    const delayToken = await createActionCardToken({
      kind: "delay_impact_confirm",
      userId: 7,
      actionItemId: 42,
      projectId: "p1",
      taskId: "c1",
      startDate: "2026-07-08",
      dueDate: "2026-07-20",
    });
    await expect(verifyActionCardToken(delayToken)).resolves.toMatchObject({
      kind: "delay_impact_confirm",
      actionItemId: 42,
      projectId: "p1",
      taskId: "c1",
      startDate: "2026-07-08",
      dueDate: "2026-07-20",
    });

    const releaseToken = await createActionCardToken({
      kind: "mp_release_confirm",
      userId: 7,
      actionItemId: 43,
      projectId: "p1",
      approvalInstanceId: 99,
    });
    await expect(verifyActionCardToken(releaseToken)).resolves.toMatchObject({
      kind: "mp_release_confirm",
      actionItemId: 43,
      projectId: "p1",
      approvalInstanceId: 99,
    });
  });
});
