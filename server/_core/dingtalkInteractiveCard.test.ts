import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setDingtalkConfigForTest, _resetTokenCacheForTest } from "./dingtalk";
import { ENV } from "./env";
import {
  buildHandledActionCardParams,
  buildPendingActionCardParams,
  createAndDeliverInteractiveCard,
  registerInteractiveCardCallback,
  updateInteractiveCard,
} from "./dingtalkInteractiveCard";

const originalAppBaseUrl = ENV.appBaseUrl;
const originalTemplateId = ENV.dingtalkInteractiveCardTemplateId;
const originalRobotCode = ENV.dingtalkInteractiveRobotCode;
const originalCallbackRouteKey = ENV.dingtalkInteractiveCardCallbackRouteKey;
const originalCallbackSecret = ENV.dingtalkInteractiveCardCallbackSecret;
const originalEnabled = ENV.dingtalkInteractiveCardEnabled;

beforeEach(() => {
  vi.restoreAllMocks();
  _resetTokenCacheForTest();
  __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
  ENV.appBaseUrl = "https://hub.test";
  ENV.dingtalkInteractiveCardTemplateId = "tmpl-1";
  ENV.dingtalkInteractiveRobotCode = "robot-1";
  ENV.dingtalkInteractiveCardCallbackRouteKey = "cehub_action_card_v1";
  ENV.dingtalkInteractiveCardCallbackSecret = "card-secret";
  ENV.dingtalkInteractiveCardEnabled = true;
});

afterEach(() => {
  ENV.appBaseUrl = originalAppBaseUrl;
  ENV.dingtalkInteractiveCardTemplateId = originalTemplateId;
  ENV.dingtalkInteractiveRobotCode = originalRobotCode;
  ENV.dingtalkInteractiveCardCallbackRouteKey = originalCallbackRouteKey;
  ENV.dingtalkInteractiveCardCallbackSecret = originalCallbackSecret;
  ENV.dingtalkInteractiveCardEnabled = originalEnabled;
});

describe("dingtalk interactive cards", () => {
  it("builds pending and handled card params as string-only maps", () => {
    expect(buildPendingActionCardParams({
      title: "任务审批",
      body: "请处理",
      buttons: [{ title: "通过", actionUrl: "https://hub.test/api/action-card/execute?token=signed-token" }],
    })).toMatchObject({
      title: "任务审批",
      body: "请处理",
      status: "pending",
      statusText: "待处理",
      primaryActionText: "通过",
      primaryActionUrl: "https://hub.test/api/action-card/execute?token=signed-token",
      primaryActionToken: "signed-token",
      secondaryActionText: "",
    });

    expect(buildHandledActionCardParams({
      title: "已通过",
      message: "审批已闭环",
      actionUrl: "https://hub.test/detail",
    })).toMatchObject({
      title: "已通过",
      status: "handled",
      statusText: "已处理",
      handledText: "审批已闭环",
      primaryActionText: "打开详情",
    });
  });

  it("creates and delivers a native card using DingTalk card instance payload", async () => {
    const payloads: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      }
      payloads.push({
        url: u,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: new Headers(init?.headers),
      });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const result = await createAndDeliverInteractiveCard({
      corpUserId: "user-1",
      outTrackId: "cehub_ai_1_7",
      cardParamMap: buildPendingActionCardParams({ title: "任务审批", body: "请处理" }),
    });

    expect(result.ok).toBe(true);
    expect(payloads[0]?.url).toContain("/v1.0/card/instances/createAndDeliver");
    expect(payloads[0]?.headers.get("x-acs-dingtalk-access-token")).toBe("tok");
    expect(payloads[0]?.body).toMatchObject({
      cardTemplateId: "tmpl-1",
      outTrackId: "cehub_ai_1_7",
      callbackRouteKey: "cehub_action_card_v1",
      userIdType: 1,
      userId: "user-1",
      openSpaceId: "dtv1.card//IM_ROBOT.user-1",
      imRobotOpenSpaceModel: { supportForward: false },
      imRobotOpenDeliverModel: { spaceType: "IM_ROBOT" },
    });
  });

  it("registers the card callback route with DingTalk", async () => {
    const payloads: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      }
      payloads.push({
        url: u,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: new Headers(init?.headers),
      });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const result = await registerInteractiveCardCallback();

    expect(result.ok).toBe(true);
    expect(payloads[0]?.url).toBe("https://api.dingtalk.com/v1.0/card/callbacks/register");
    expect(payloads[0]?.headers.get("x-acs-dingtalk-access-token")).toBe("tok");
    expect(payloads[0]?.body).toMatchObject({
      callbackRouteKey: "cehub_action_card_v1",
      callbackUrl: "https://hub.test/api/dingtalk/callback",
      apiSecret: "card-secret",
      forceUpdate: true,
    });
  });

  it("updates a native card by outTrackId", async () => {
    const payloads: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      }
      payloads.push({
        url: u,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: new Headers(init?.headers),
      });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const result = await updateInteractiveCard({
      outTrackId: "cehub_ai_1_7",
      cardParamMap: buildHandledActionCardParams({ title: "已处理", message: "审批已闭环" }),
    });

    expect(result.ok).toBe(true);
    expect(payloads[0]?.url).toContain("/v1.0/card/instances");
    expect(payloads[0]?.headers.get("x-acs-dingtalk-access-token")).toBe("tok");
    expect(payloads[0]?.body).toMatchObject({
      outTrackId: "cehub_ai_1_7",
      userIdType: 1,
      cardUpdateOptions: { updateCardDataByKey: true },
    });
  });
});
