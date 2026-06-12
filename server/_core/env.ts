export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  /** 是否开放自助注册。设为 "false" 关闭后，新用户只能由管理员在后台创建 */
  allowRegistration: process.env.ALLOW_REGISTRATION !== "false",
  // S3-compatible object storage (MinIO / Aliyun OSS / AWS S3)
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  // path-style is required for MinIO; Aliyun OSS uses virtual-hosted style
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
};
