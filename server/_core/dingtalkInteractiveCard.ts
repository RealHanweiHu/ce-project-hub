import { ENV } from "./env";
import { getAccessToken, isDingtalkConfigured } from "./dingtalk";
import type { WorkNotificationButton } from "./dingtalkMessage";

const INTERACTIVE_CARD_BASE = "https://api.dingtalk.com/v1.0/im/interactiveCards";
const PRIVATE_CHAT_INTERACTIVE_CARD_BASE = "https://api.dingtalk.com/v1.0/im/privateChat/interactiveCards";

export type InteractiveCardResult =
  | { ok: true; raw: unknown }
  | { ok: false; error: string; raw?: unknown };

export type InteractiveCardParams = Record<string, string>;

function hasApiError(body: Record<string, unknown>): boolean {
  const errcode = body.errcode;
  const code = body.code;
  const success = body.success;
  return (errcode !== undefined && errcode !== 0 && errcode !== "0")
    || (code !== undefined && code !== 0 && code !== "0" && code !== "OK")
    || success === false;
}

function responseError(prefix: string, body: Record<string, unknown>, status?: number): string {
  const code = body.errcode ?? body.code ?? status ?? "unknown";
  const message = body.errmsg ?? body.message ?? body.errorMessage ?? "";
  return `${prefix} code=${code} ${message}`.trim();
}

function toCardValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function normalizeCardParams(params: Record<string, unknown>): InteractiveCardParams {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, toCardValue(value)]),
  );
}

function tokenFromActionUrl(actionUrl: string | null | undefined): string {
  if (!actionUrl) return "";
  try {
    const url = new URL(actionUrl, "https://cehub.local");
    return url.searchParams.get("token") ?? "";
  } catch {
    return "";
  }
}

export function isDingtalkInteractiveCardConfigured(): boolean {
  return ENV.dingtalkInteractiveCardEnabled
    && isDingtalkConfigured()
    && !!ENV.dingtalkInteractiveCardTemplateId.trim()
    && !!ENV.dingtalkInteractiveRobotCode.trim();
}

export function buildPendingActionCardParams(input: {
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  buttons?: WorkNotificationButton[] | null;
}): InteractiveCardParams {
  const buttons = (input.buttons ?? []).filter((button) => button.title.trim() && button.actionUrl.trim());
  const primary = buttons[0];
  const secondary = buttons[1];
  return normalizeCardParams({
    title: input.title,
    body: input.body ?? "",
    status: "pending",
    statusText: "待处理",
    handledText: "",
    primaryActionText: primary?.title ?? (input.actionUrl ? "打开处理" : ""),
    primaryActionUrl: primary?.actionUrl ?? input.actionUrl ?? "",
    primaryActionToken: tokenFromActionUrl(primary?.actionUrl ?? input.actionUrl),
    secondaryActionText: secondary?.title ?? "",
    secondaryActionUrl: secondary?.actionUrl ?? "",
    secondaryActionToken: tokenFromActionUrl(secondary?.actionUrl),
  });
}

export function buildHandledActionCardParams(input: {
  title?: string | null;
  message?: string | null;
  actionUrl?: string | null;
}): InteractiveCardParams {
  return normalizeCardParams({
    title: input.title || "已处理",
    body: input.message ?? "",
    status: "handled",
    statusText: "已处理",
    handledText: input.message ?? "该行动项已闭环",
    primaryActionText: input.actionUrl ? "打开详情" : "",
    primaryActionUrl: input.actionUrl ?? "",
    primaryActionToken: "",
    secondaryActionText: "",
    secondaryActionUrl: "",
    secondaryActionToken: "",
  });
}

export async function createAndDeliverInteractiveCard(input: {
  corpUserId: string;
  outTrackId: string;
  cardParamMap: InteractiveCardParams;
}): Promise<InteractiveCardResult> {
  if (!isDingtalkInteractiveCardConfigured()) {
    return { ok: false, error: "钉钉互动卡片未配置" };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "获取钉钉 access_token 失败" };

  const requestBody = {
    cardTemplateId: ENV.dingtalkInteractiveCardTemplateId.trim(),
    receiverUserIdList: [input.corpUserId],
    outTrackId: input.outTrackId,
    robotCode: ENV.dingtalkInteractiveRobotCode.trim(),
    userIdType: 1,
    cardData: { cardParamMap: input.cardParamMap },
    cardOptions: { supportForward: false },
  };

  try {
    const resp = await fetch(`${PRIVATE_CHAT_INTERACTIVE_CARD_BASE}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
      body: JSON.stringify(requestBody),
    });
    const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
    if (!resp.ok || hasApiError(body)) {
      return { ok: false, error: responseError("钉钉互动卡片投放失败", body, resp.status), raw: body };
    }
    return { ok: true, raw: body };
  } catch (error) {
    return { ok: false, error: `钉钉互动卡片投放异常: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function updateInteractiveCard(input: {
  outTrackId: string;
  cardParamMap: InteractiveCardParams;
}): Promise<InteractiveCardResult> {
  if (!isDingtalkInteractiveCardConfigured()) {
    return { ok: false, error: "钉钉互动卡片未配置" };
  }
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "获取钉钉 access_token 失败" };

  try {
    const resp = await fetch(INTERACTIVE_CARD_BASE, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
      body: JSON.stringify({
        outTrackId: input.outTrackId,
        cardData: { cardParamMap: input.cardParamMap },
        userIdType: 1,
        cardOptions: { updateCardDataByKey: true },
      }),
    });
    const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
    if (!resp.ok || hasApiError(body)) {
      return { ok: false, error: responseError("钉钉互动卡片更新失败", body, resp.status), raw: body };
    }
    return { ok: true, raw: body };
  } catch (error) {
    return { ok: false, error: `钉钉互动卡片更新异常: ${error instanceof Error ? error.message : String(error)}` };
  }
}
