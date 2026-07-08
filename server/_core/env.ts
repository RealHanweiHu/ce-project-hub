export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  /** 是否开放自助注册。设为 "false" 关闭后，新用户只能由管理员在后台创建 */
  allowRegistration: process.env.ALLOW_REGISTRATION !== "false",
  /** 注册邀请码。非空时注册必须提供匹配的邀请码；留空则注册无需邀请码 */
  registrationInviteCode: (process.env.REGISTRATION_INVITE_CODE ?? "").trim(),
  // S3-compatible object storage (MinIO / Aliyun OSS / AWS S3)
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  // path-style is required for MinIO; Aliyun OSS uses virtual-hosted style
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  // 群机器人通知（配了才推送；未配仅站内通知）
  notifyWebhookUrl: process.env.NOTIFY_WEBHOOK_URL ?? "",
  /** dingtalk | feishu */
  notifyWebhookType: (process.env.NOTIFY_WEBHOOK_TYPE ?? "dingtalk").toLowerCase(),
  /** 钉钉「加签」密钥（SEC 开头）；配了则按加签模式签名请求 */
  notifyWebhookSecret: process.env.NOTIFY_WEBHOOK_SECRET ?? "",
  /** 站点对外地址（用于通知里的跳转链接），如 https://hub.beepump.net；留空则不带链接 */
  appBaseUrl: (process.env.APP_BASE_URL ?? "").replace(/\/+$/, ""),
  /** 自动化逾期扫描间隔（分钟） */
  automationScanIntervalMin: Number(process.env.AUTOMATION_SCAN_INTERVAL_MIN ?? "30") || 30,
  // 钉钉企业内部应用（用于真日程+视频会议；未配则降级群推）
  dingtalkAppKey: process.env.DINGTALK_APP_KEY ?? "",
  dingtalkAppSecret: process.env.DINGTALK_APP_SECRET ?? "",
  dingtalkCorpId: process.env.DINGTALK_CORP_ID ?? "",
  /** 企业内部应用 AgentId（发送工作通知必需） */
  dingtalkAgentId: process.env.DINGTALK_AGENT_ID ?? "",
  /** 钉钉事件回调 token / EncodingAESKey（审批回调解密验签） */
  dingtalkCallbackToken: process.env.DINGTALK_CALLBACK_TOKEN ?? "",
  dingtalkCallbackAesKey: process.env.DINGTALK_CALLBACK_AES_KEY ?? "",
  /** 钉钉原生互动卡片（配置齐全时启用；未配置自动回退工作通知 ActionCard） */
  dingtalkInteractiveCardTemplateId: process.env.DINGTALK_INTERACTIVE_CARD_TEMPLATE_ID ?? "",
  dingtalkInteractiveRobotCode: process.env.DINGTALK_INTERACTIVE_ROBOT_CODE ?? "",
  /** 原生互动卡片按钮回调（Phase B）：模板按钮用回传请求时需要 */
  dingtalkInteractiveCardCallbackRouteKey: process.env.DINGTALK_INTERACTIVE_CARD_CALLBACK_ROUTE_KEY ?? "",
  dingtalkInteractiveCardCallbackSecret: process.env.DINGTALK_INTERACTIVE_CARD_CALLBACK_SECRET ?? "",
  dingtalkInteractiveCardEnabled: process.env.DINGTALK_INTERACTIVE_CARD_ENABLED !== "false",
};
