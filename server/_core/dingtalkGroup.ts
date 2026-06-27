// 钉钉企业内部群:建群(chat/create) + 群发消息(chat/send)。
// 需要应用具备「企业会话」权限。未配置/失败均安全降级(返回 null / no-op)。
import { getAccessToken, isDingtalkConfigured } from "./dingtalk";

export type CreateGroupResult =
  | { ok: true; chatId: string }
  | { ok: false; error: string };

export type GroupOperationResult =
  | { ok: true }
  | { ok: false; error: string };

function responseError(prefix: string, body: Record<string, unknown>, status?: number): string {
  const code = body.errcode ?? body.code ?? status ?? "unknown";
  const message = body.errmsg ?? body.message ?? "";
  return `${prefix} errcode=${code} ${message}`.trim();
}

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

async function chatIdToOpenConversationId(chatId: string, token: string): Promise<string | null> {
  const resp = await fetch(
    `https://api.dingtalk.com/v1.0/im/chat/${encodeURIComponent(chatId)}/convertToOpenConversationId`,
    {
      method: "POST",
      headers: { "x-acs-dingtalk-access-token": token },
    }
  );
  const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
  if (!resp.ok) {
    console.warn("[group] convert chatId failed:", responseError("钉钉转换群 ID 失败", body, resp.status));
    return null;
  }
  const openConversationId = body.openConversationId;
  return typeof openConversationId === "string" && openConversationId ? openConversationId : null;
}

function isAlreadyGone(body: Record<string, unknown>): boolean {
  const raw = String(body.errcode ?? body.code ?? body.errmsg ?? body.message ?? "").toLowerCase();
  return raw.includes("notfound") || raw.includes("not_found") || raw.includes("not exist") || raw.includes("notexists");
}

function hasErrorCode(body: Record<string, unknown>): boolean {
  const errcode = body.errcode;
  const code = body.code;
  return (errcode !== undefined && errcode !== 0 && errcode !== "0")
    || (code !== undefined && code !== 0 && code !== "0");
}

/** 解散群聊。用于删除项目时同步删除项目钉钉群；失败会返回错误供上层阻断删除。 */
export async function disbandGroupChat(chatId: string): Promise<GroupOperationResult> {
  if (!chatId) return { ok: true };
  if (!isDingtalkConfigured()) return { ok: false, error: "钉钉未配置，无法删除已绑定的项目群" };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "获取钉钉 access_token 失败" };

  try {
    const openConversationId = await chatIdToOpenConversationId(chatId, token);
    if (!openConversationId) {
      return { ok: false, error: "钉钉群 ID 转换失败，无法删除项目群" };
    }

    const resp = await fetch("https://api.dingtalk.com/v1.0/im/chat/scenegroup/disband", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
      body: JSON.stringify({ openConversationId }),
    });
    const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
    if (isAlreadyGone(body)) return { ok: true };
    if (resp.ok && !hasErrorCode(body)) return { ok: true };
    return { ok: false, error: responseError("钉钉删除项目群失败", body, resp.status) };
  } catch (e) {
    return { ok: false, error: `钉钉删除项目群异常: ${(e as Error).message}` };
  }
}
