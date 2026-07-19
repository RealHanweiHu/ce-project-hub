// 钉钉工作通知：把规则提醒直接推到负责人本人的钉钉（不止站内/群）。
// 需企业内部应用 AgentId + 「发送工作通知」权限；发给通讯录 userid。未配/失败安全静默。
import { ENV } from "./env";
import { getAccessToken, isDingtalkConfigured, resolveDingtalkCorpUserId } from "./dingtalk";
import { getUserById, setUserDingtalkCorpId } from "../db";
import { fetchWithTimeout } from "./fetchWithTimeout";
import {
  ProjectRemoteOutcomeUncertainError,
  quarantineCurrentProjectExternalOperation,
} from "../project-external-operation";
import {
  DINGTALK_DELIVERY_DISABLED_MESSAGE,
  isDingtalkDeliveryEnabled,
} from "./dingtalk-delivery-policy";

export type DispatchResult = {
  channel: "work_notice";
  attempted: number;
  delivered: number;
  failed: number;
  skipped: number;
  error?: string;
};

export type WorkNotificationButton = {
  title: string;
  actionUrl: string;
};

export type WorkNotificationOptions = {
  buttons?: WorkNotificationButton[];
  buttonLayout?: "horizontal" | "vertical";
};

type DingtalkWorkMessage =
  | { msgtype: "markdown"; markdown: { title: string; text: string } }
  | {
      msgtype: "action_card";
      action_card: {
        title: string;
        markdown: string;
        btn_orientation: "0" | "1";
        btn_json_list: Array<{ title: string; action_url: string }>;
      };
    };

function dispatchResult(patch: Partial<DispatchResult>): DispatchResult {
  return {
    channel: "work_notice",
    attempted: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
    ...patch,
  };
}

function responseError(prefix: string, body: Record<string, unknown>, status?: number): string {
  const code = body.errcode ?? body.code ?? status ?? "unknown";
  const message = body.errmsg ?? body.message ?? "";
  return `${prefix} errcode=${code} ${message}`.trim();
}

function hasErrorCode(body: Record<string, unknown>): boolean {
  const errcode = body.errcode;
  const code = body.code;
  return (errcode !== undefined && errcode !== 0 && errcode !== "0")
    || (code !== undefined && code !== 0 && code !== "0");
}

function normalizedButtons(options?: WorkNotificationOptions): WorkNotificationButton[] {
  return (options?.buttons ?? [])
    .map((button) => ({
      title: button.title.trim().slice(0, 20),
      actionUrl: button.actionUrl.trim(),
    }))
    .filter((button) => button.title && button.actionUrl);
}

function withMarkdownButtons(markdown: string, buttons: WorkNotificationButton[]): string {
  if (buttons.length === 0) return markdown;
  const lines = buttons.map((button) => `[${button.title}](${button.actionUrl})`).join("  ");
  return `${markdown}\n\n${lines}`;
}

function markdownMessage(title: string, markdown: string): DingtalkWorkMessage {
  return { msgtype: "markdown", markdown: { title, text: markdown } };
}

function buildWorkMessage(title: string, markdown: string, options?: WorkNotificationOptions): DingtalkWorkMessage {
  const buttons = normalizedButtons(options);
  if (buttons.length === 0) return markdownMessage(title, markdown);
  return {
    msgtype: "action_card",
    action_card: {
      title,
      markdown,
      btn_orientation: options?.buttonLayout === "vertical" ? "0" : "1",
      btn_json_list: buttons.map((button) => ({
        title: button.title,
        action_url: button.actionUrl,
      })),
    },
  };
}

async function postWorkMessage(token: string, corpUserIds: string[], message: DingtalkWorkMessage): Promise<{
  ok: boolean;
  body: Record<string, unknown>;
  status: number;
  uncertain: boolean;
}> {
  let resp: Response;
  try {
    resp = await fetchWithTimeout(`https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: Number(ENV.dingtalkAgentId),
        userid_list: corpUserIds.join(","),
        msg: message,
      }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await quarantineCurrentProjectExternalOperation(detail);
    throw new ProjectRemoteOutcomeUncertainError(
      `钉钉工作通知响应丢失，远端结果未知：${detail}`
    );
  }
  const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
  const ambiguousStatus = resp.status === 408 || resp.status === 429 || resp.status >= 500;
  const apiAccepted = resp.ok && !hasErrorCode(body);
  const taskId = body.task_id ?? body.taskId;
  const missingTaskId = apiAccepted && taskId == null;
  const uncertain = ambiguousStatus || missingTaskId;
  if (uncertain) {
    await quarantineCurrentProjectExternalOperation(
      missingTaskId
        ? "钉钉工作通知响应未返回 task_id"
        : `钉钉工作通知返回 HTTP ${resp.status}`
    );
  }
  return {
    ok: apiAccepted && !missingTaskId,
    body,
    status: resp.status,
    uncertain,
  };
}

/** 给一组钉钉通讯录 userid 发工作通知（有按钮时优先 ActionCard,失败降级 markdown） */
export async function sendWorkNotification(
  corpUserIds: string[],
  title: string,
  markdown: string,
  options?: WorkNotificationOptions,
): Promise<DispatchResult> {
  const uniqueCorpUserIds = Array.from(new Set(corpUserIds.filter(Boolean)));
  if (uniqueCorpUserIds.length === 0) return dispatchResult({});
  if (!isDingtalkDeliveryEnabled()) {
    return dispatchResult({
      skipped: uniqueCorpUserIds.length,
      error: DINGTALK_DELIVERY_DISABLED_MESSAGE,
    });
  }
  if (!isDingtalkConfigured() || !ENV.dingtalkAgentId) {
    return dispatchResult({ skipped: uniqueCorpUserIds.length, error: "钉钉工作通知未配置" });
  }
  try {
    const token = await getAccessToken();
    if (!token) {
      return dispatchResult({
        attempted: uniqueCorpUserIds.length,
        failed: uniqueCorpUserIds.length,
        error: "获取钉钉 access_token 失败",
      });
    }
    const primaryMessage = buildWorkMessage(title, markdown, options);
    let result = await postWorkMessage(token, uniqueCorpUserIds, primaryMessage);

    if (!result.ok && !result.uncertain && primaryMessage.msgtype === "action_card") {
      const fallbackMarkdown = withMarkdownButtons(markdown, normalizedButtons(options));
      result = await postWorkMessage(token, uniqueCorpUserIds, markdownMessage(title, fallbackMarkdown));
    }

    if (!result.ok) {
      const error = result.uncertain
        ? "钉钉工作通知结果未知，已进入隔离期且不会自动补发"
        : responseError("钉钉工作通知失败", result.body, result.status);
      console.warn("[dingtalk] work notification failed (non-fatal):", error);
      return dispatchResult({ attempted: uniqueCorpUserIds.length, failed: uniqueCorpUserIds.length, error });
    }
    return dispatchResult({ attempted: uniqueCorpUserIds.length, delivered: uniqueCorpUserIds.length });
  } catch (e) {
    console.warn("[dingtalk] work notification failed (non-fatal):", e);
    return dispatchResult({
      attempted: uniqueCorpUserIds.length,
      failed: uniqueCorpUserIds.length,
      error: (e as Error).message,
    });
  }
}

async function resolveCorpIdsForUsersWithStats(userIds: number[]): Promise<{ corpIds: string[]; skipped: number; failed: number }> {
  const corpIds: string[] = [];
  let skipped = 0;
  let failed = 0;
  for (const uid of Array.from(new Set(userIds))) {
    try {
      const u = await getUserById(uid);
      if (!u) { skipped += 1; continue; }
      const cid = await resolveDingtalkCorpUserId(u, setUserDingtalkCorpId);
      if (cid) corpIds.push(cid);
      else skipped += 1;
    } catch (e) {
      failed += 1;
      console.warn("[dingtalk] resolve corp userid failed (non-fatal):", e);
    }
  }
  return { corpIds, skipped, failed };
}

/** 把内部 userId 列表解析成钉钉企业 userid(corp userid),解析不到的跳过。建群/群发用。 */
export async function resolveCorpIdsForUsers(userIds: number[]): Promise<string[]> {
  return (await resolveCorpIdsForUsersWithStats(userIds)).corpIds;
}

/** 把内部 userId 列表解析成钉钉 userid 并发工作通知（解析不到的跳过）。引擎默认派发用。 */
export async function notifyUsersViaDingtalk(
  userIds: number[],
  title: string,
  markdown: string,
  options?: WorkNotificationOptions,
): Promise<DispatchResult> {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) return dispatchResult({});
  if (!isDingtalkConfigured() || !ENV.dingtalkAgentId) {
    return dispatchResult({ skipped: uniqueUserIds.length, error: "钉钉工作通知未配置" });
  }
  const resolved = await resolveCorpIdsForUsersWithStats(uniqueUserIds);
  const sent = await sendWorkNotification(resolved.corpIds, title, markdown, options);
  return {
    ...sent,
    skipped: sent.skipped + resolved.skipped,
    failed: sent.failed + resolved.failed,
    error: sent.error,
  };
}
