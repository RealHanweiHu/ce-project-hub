// 群机器人通知：钉钉 / 飞书。未配 webhook 则 no-op；失败只 warn，绝不阻断主流程。
import { ENV } from "./env";

export async function pushWebhook(text: string): Promise<void> {
  const url = ENV.notifyWebhookUrl;
  if (!url) return; // 未配置 → 仅站内通知
  try {
    const body =
      ENV.notifyWebhookType === "feishu"
        ? { msg_type: "text", content: { text } }
        : { msgtype: "text", text: { content: text } }; // 默认钉钉
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.warn(`[notify] webhook ${resp.status}`);
    }
  } catch (err) {
    console.warn("[notify] webhook failed (non-fatal):", err);
  }
}
