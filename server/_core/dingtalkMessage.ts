// 钉钉工作通知：把规则提醒直接推到负责人本人的钉钉（不止站内/群）。
// 需企业内部应用 AgentId + 「发送工作通知」权限；发给通讯录 userid。未配/失败安全静默。
import { ENV } from "./env";
import { getAccessToken, isDingtalkConfigured, resolveDingtalkCorpUserId } from "./dingtalk";
import { getUserById, setUserDingtalkCorpId } from "../db";

/** 给一组钉钉通讯录 userid 发工作通知（markdown） */
export async function sendWorkNotification(corpUserIds: string[], title: string, markdown: string): Promise<void> {
  if (!isDingtalkConfigured() || !ENV.dingtalkAgentId || corpUserIds.length === 0) return;
  try {
    const token = await getAccessToken();
    if (!token) return;
    await fetch(`https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: Number(ENV.dingtalkAgentId),
        userid_list: corpUserIds.join(","),
        msg: { msgtype: "markdown", markdown: { title, text: markdown } },
      }),
    });
  } catch (e) {
    console.warn("[dingtalk] work notification failed (non-fatal):", e);
  }
}

/** 把内部 userId 列表解析成钉钉企业 userid(corp userid),解析不到的跳过。建群/群发用。 */
export async function resolveCorpIdsForUsers(userIds: number[]): Promise<string[]> {
  const corpIds: string[] = [];
  for (const uid of userIds) {
    const u = await getUserById(uid);
    if (!u) continue;
    const cid = await resolveDingtalkCorpUserId(u, setUserDingtalkCorpId);
    if (cid) corpIds.push(cid);
  }
  return corpIds;
}

/** 把内部 userId 列表解析成钉钉 userid 并发工作通知（解析不到的跳过）。引擎默认派发用。 */
export async function notifyUsersViaDingtalk(userIds: number[], title: string, markdown: string): Promise<void> {
  if (!isDingtalkConfigured() || !ENV.dingtalkAgentId || userIds.length === 0) return;
  const corpIds = await resolveCorpIdsForUsers(userIds);
  await sendWorkNotification(corpIds, title, markdown);
}
