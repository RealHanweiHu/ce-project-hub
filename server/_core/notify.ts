// 群机器人通知：钉钉 / 飞书。未配 webhook 则 no-op；失败只 warn，绝不阻断主流程。
import crypto from "crypto";
import { ENV } from "./env";

/** 钉钉「加签」：在 URL 上拼 timestamp + sign（HMAC-SHA256(secret, `${ts}\n${secret}`) → base64 → urlencode） */
function signDingtalkUrl(url: string, secret: string): string {
  const ts = Date.now();
  const sign = crypto.createHmac("sha256", secret).update(`${ts}\n${secret}`).digest("base64");
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
}

/**
 * 推送群机器人消息。
 * @param text     纯文本兜底内容（飞书、以及钉钉未提供 markdown 时使用）
 * @param opts     可选：title + markdown。钉钉在提供 markdown 时发 markdown 卡片（支持 [链接]）。
 */
export async function pushWebhook(
  text: string,
  opts?: { title?: string; markdown?: string }
): Promise<void> {
  const baseUrl = ENV.notifyWebhookUrl;
  if (!baseUrl) return; // 未配置 → 仅站内通知
  try {
    const isFeishu = ENV.notifyWebhookType === "feishu";
    const url = !isFeishu && ENV.notifyWebhookSecret
      ? signDingtalkUrl(baseUrl, ENV.notifyWebhookSecret)
      : baseUrl;
    const body = isFeishu
      ? { msg_type: "text", content: { text } } // 飞书 text（含内联 URL）
      : opts?.markdown
        ? { msgtype: "markdown", markdown: { title: opts.title ?? "通知", text: opts.markdown } }
        : { msgtype: "text", text: { content: text } }; // 默认钉钉
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.warn(`[notify] webhook ${resp.status}`);
    } else {
      // 钉钉成功响应 errcode=0；非 0 也只 warn
      const j = await resp.json().catch(() => ({}));
      if (j && typeof j.errcode === "number" && j.errcode !== 0) {
        console.warn(`[notify] dingtalk errcode=${j.errcode} ${j.errmsg ?? ""}`);
      }
    }
  } catch (err) {
    console.warn("[notify] webhook failed (non-fatal):", err);
  }
}
