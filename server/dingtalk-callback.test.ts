import { describe, it, expect } from "vitest";
import { classifyCallbackEvent } from "./dingtalk-callback";

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

  it("ignores other events without a processInstanceId instead of erroring", () => {
    expect(classifyCallbackEvent({ EventType: "bpms_task_change" })).toEqual({ kind: "ignore" });
  });
});
