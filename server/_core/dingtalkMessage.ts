// 钉钉工作通知：把规则提醒直接推到负责人本人的钉钉（不止站内/群）。
// 需企业内部应用 AgentId + 「发送工作通知」权限；发给通讯录 userid。未配/失败安全静默。
import { ENV } from "./env";
import { getAccessToken, isDingtalkConfigured, resolveDingtalkCorpUserId } from "./dingtalk";
import { getUserById, setUserDingtalkCorpId } from "../db";

export type DispatchResult = {
  channel: "work_notice";
  attempted: number;
  delivered: number;
  failed: number;
  skipped: number;
  error?: string;
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

/** 给一组钉钉通讯录 userid 发工作通知（markdown） */
export async function sendWorkNotification(corpUserIds: string[], title: string, markdown: string): Promise<DispatchResult> {
  const uniqueCorpUserIds = Array.from(new Set(corpUserIds.filter(Boolean)));
  if (uniqueCorpUserIds.length === 0) return dispatchResult({});
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
    const resp = await fetch(`https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: Number(ENV.dingtalkAgentId),
        userid_list: uniqueCorpUserIds.join(","),
        msg: { msgtype: "markdown", markdown: { title, text: markdown } },
      }),
    });
    const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
    if (!resp.ok || hasErrorCode(body)) {
      const error = responseError("钉钉工作通知失败", body, resp.status);
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
export async function notifyUsersViaDingtalk(userIds: number[], title: string, markdown: string): Promise<DispatchResult> {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) return dispatchResult({});
  if (!isDingtalkConfigured() || !ENV.dingtalkAgentId) {
    return dispatchResult({ skipped: uniqueUserIds.length, error: "钉钉工作通知未配置" });
  }
  const resolved = await resolveCorpIdsForUsersWithStats(uniqueUserIds);
  const sent = await sendWorkNotification(resolved.corpIds, title, markdown);
  return {
    ...sent,
    skipped: sent.skipped + resolved.skipped,
    failed: sent.failed + resolved.failed,
    error: sent.error,
  };
}
