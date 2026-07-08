import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";

const envFile = process.env.ENV_FILE || (existsSync(".env.production") ? ".env.production" : ".env");
loadEnv({ path: envFile });

const [{ ENV }, { registerInteractiveCardCallback }] = await Promise.all([
  import("../server/_core/env"),
  import("../server/_core/dingtalkInteractiveCard"),
]);

const callbackUrl = process.env.DINGTALK_INTERACTIVE_CARD_CALLBACK_URL
  || (ENV.appBaseUrl ? `${ENV.appBaseUrl}/api/dingtalk/callback` : "");

const result = await registerInteractiveCardCallback({
  callbackUrl,
  forceUpdate: true,
});

if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

console.log("DingTalk interactive card callback registered.");
