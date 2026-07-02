// S3-compatible object storage (MinIO / Aliyun OSS / AWS S3).
// Uploads go directly through the SDK; downloads are served by the
// authenticated streaming proxy at /storage/{key} (see storageProxy.ts +
// storage-access.ts) — not a presigned redirect (endpoint may be internal-only).

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

let _client: S3Client | null = null;

function getS3Config() {
  if (!ENV.s3Bucket || !ENV.s3AccessKeyId || !ENV.s3SecretAccessKey) {
    throw new Error(
      "Storage config missing: set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY",
    );
  }
  if (!_client) {
    _client = new S3Client({
      region: ENV.s3Region,
      ...(ENV.s3Endpoint ? { endpoint: ENV.s3Endpoint } : {}),
      forcePathStyle: ENV.s3ForcePathStyle,
      credentials: {
        accessKeyId: ENV.s3AccessKeyId,
        secretAccessKey: ENV.s3SecretAccessKey,
      },
    });
  }
  return { client: _client, bucket: ENV.s3Bucket };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

let _bucketEnsured = false;

/**
 * 确保目标 bucket 存在。自托管 MinIO 首次部署没人建桶时，首个上传会报 NoSuchBucket；
 * 这里在启动/首次上传前自动建桶。托管 OSS（应用凭据通常无 CreateBucket 权限）会失败——
 * 此时仅告警不阻断（桶应由运维预先建好）。
 */
export async function ensureBucket(): Promise<void> {
  if (_bucketEnsured) return;
  const { client, bucket } = getS3Config();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    _bucketEnsured = true;
    return;
  } catch {
    // 不存在或无权 Head —— 尝试创建
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    _bucketEnsured = true;
    console.log(`[storage] created bucket "${bucket}"`);
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    // 已存在（并发/权限差异）视为成功
    if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") {
      _bucketEnsured = true;
      return;
    }
    console.warn(
      `[storage] 无法自动创建 bucket "${bucket}"（${name || e}）。` +
      `若用托管 OSS 请预先建桶；若用 MinIO 请检查凭据/权限。`,
    );
  }
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  await ensureBucket();
  const { client, bucket } = getS3Config();
  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data) : data;
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return { key, url: `/storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/storage/${key}` };
}

export async function storageGetObject(relKey: string): Promise<{
  body: NodeJS.ReadableStream;
  contentType?: string;
  contentLength?: number;
}> {
  const { client, bucket } = getS3Config();
  const key = normalizeKey(relKey);
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return {
    body: resp.Body as NodeJS.ReadableStream,
    contentType: resp.ContentType,
    contentLength: resp.ContentLength,
  };
}

export async function storageGetSignedUrl(
  relKey: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const { client, bucket } = getS3Config();
  const key = normalizeKey(relKey);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

export async function storageDelete(relKey: string): Promise<void> {
  const { client, bucket } = getS3Config();
  const key = normalizeKey(relKey);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
