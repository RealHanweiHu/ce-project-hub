// 钉钉企业内部群:建群(chat/create) + 群发消息(chat/send)。
// 需要应用具备「企业会话」权限。未配置/失败均安全降级(返回 null / no-op)。
import { getAccessToken, isDingtalkConfigured } from "./dingtalk";

export type CreateGroupResult =
  | { ok: true; chatId: string }
  | { ok: false; error: string };

/**
 * 建群。owner/members 均为钉钉「企业 userid」(corp userid)。
 * 钉钉要求群成员 ≥ 2 人(含群主)。
 */
export async function createGroupChat(
  name: string,
  ownerUserId: string,
  memberUserIds: string[]
): Promise<CreateGroupResult> {
  if (!isDingtalkConfigured()) return { ok: false, error: "钉钉未配置" };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "获取钉钉 access_token 失败" };
  const useridlist = Array.from(new Set([ownerUserId, ...memberUserIds])).filter(Boolean);
  if (useridlist.length < 2) {
    return { ok: false, error: "建群至少需要 2 名已配置手机号的成员(含群主)" };
  }
  try {
    const resp = await fetch(`https://oapi.dingtalk.com/chat/create?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.slice(0, 40), owner: ownerUserId, useridlist }),
    });
    const j = await resp.json().catch(() => ({}));
    if (j && j.errcode === 0 && j.chatid) return { ok: true, chatId: j.chatid as string };
    return { ok: false, error: `钉钉建群失败 errcode=${j?.errcode} ${j?.errmsg ?? ""}` };
  } catch (e) {
    return { ok: false, error: `钉钉建群异常: ${(e as Error).message}` };
  }
}

/** 向群发送 markdown 消息。失败仅 warn,绝不阻断。 */
export async function sendToGroupChat(chatId: string, title: string, markdown: string): Promise<boolean> {
  if (!isDingtalkConfigured() || !chatId) return false;
  const token = await getAccessToken();
  if (!token) return false;
  try {
    const resp = await fetch(`https://oapi.dingtalk.com/chat/send?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatid: chatId, msg: { msgtype: "markdown", markdown: { title, text: markdown } } }),
    });
    const j = await resp.json().catch(() => ({}));
    if (j && j.errcode === 0) return true;
    console.warn(`[group] chat/send errcode=${j?.errcode} ${j?.errmsg ?? ""}`);
    return false;
  } catch (e) {
    console.warn("[group] chat/send failed (non-fatal):", e);
    return false;
  }
}
