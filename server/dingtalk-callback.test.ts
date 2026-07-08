import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { classifyCallbackEvent, verifyDingtalkCardCallbackSignature } from "./dingtalk-callback";

describe("classifyCallbackEvent", () => {
  it("treats the check_url verification event as a handshake, not a missing-id error", () => {
    expect(classifyCallbackEvent({ EventType: "check_url" })).toEqual({ kind: "verify" });
  });

  it("extracts processInstanceId from an approval-change event", () => {
    expect(
      classifyCallbackEvent({ EventType: "bpms_instance_change", processInstanceId: "pi-1" }),
    ).toEqual({ kind: "sync", processInstanceId: "pi-1" });
  });

  it("extracts native interactive card callbacks when the card returns an action token", () => {
    expect(
      classifyCallbackEvent({
        eventType: "card_callback",
        outTrackId: "cehub_ai_1_7",
        cardCallbackData: {
          cardPrivateData: {
            params: { actionToken: "signed-token" },
          },
        },
      }),
    ).toEqual({ kind: "card", token: "signed-token", outTrackId: "cehub_ai_1_7" });
  });

  it("extracts action tokens from DingTalk actionCallback content strings", () => {
    expect(
      classifyCallbackEvent({
        type: "actionCallback",
        outTrackId: "cehub_ai_1_8",
        content: JSON.stringify({
          cardPrivateData: {
            actionIds: ["primary"],
            params: { actionToken: "signed-token-from-content" },
          },
        }),
      }),
    ).toEqual({ kind: "card", token: "signed-token-from-content", outTrackId: "cehub_ai_1_8" });
  });

  it("verifies DingTalk interactive card callback signatures", () => {
    const timestamp = "1783512000000";
    const secret = "card-secret";
    const signature = crypto
      .createHmac("sha256", secret)
      .update(timestamp)
      .digest("base64");

    expect(verifyDingtalkCardCallbackSignature({ timestamp, signature, secret })).toBe(true);
    expect(verifyDingtalkCardCallbackSignature({ timestamp, signature: "bad", secret })).toBe(false);
  });

  it("ignores other events without a processInstanceId instead of erroring", () => {
    expect(classifyCallbackEvent({ EventType: "bpms_task_change" })).toEqual({ kind: "ignore" });
  });
});
