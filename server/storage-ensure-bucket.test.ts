import { describe, it, expect, beforeAll, vi } from "vitest";

// 用假 S3Client 拦截 send，验证 ensureBucket 的控制流，无需真 MinIO。
const sends: unknown[] = [];
let headBehavior: () => void = () => {};
let createBehavior: () => void = () => {};

vi.mock("@aws-sdk/client-s3", () => {
  class HeadBucketCommand { constructor(public input: unknown) {} }
  class CreateBucketCommand { constructor(public input: unknown) {} }
  class PutObjectCommand { constructor(public input: unknown) {} }
  class GetObjectCommand { constructor(public input: unknown) {} }
  class DeleteObjectCommand { constructor(public input: unknown) {} }
  class S3Client {
    async send(cmd: { constructor: { name: string } }) {
      sends.push(cmd.constructor.name);
      if (cmd instanceof HeadBucketCommand) headBehavior();
      if (cmd instanceof CreateBucketCommand) createBehavior();
      return {};
    }
  }
  return { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

let ensureBucket: () => Promise<void>;

beforeAll(async () => {
  process.env.S3_BUCKET = "ensure-test";
  process.env.S3_ACCESS_KEY_ID = "k";
  process.env.S3_SECRET_ACCESS_KEY = "s";
  process.env.S3_ENDPOINT = "http://minio:9000";
  process.env.S3_FORCE_PATH_STYLE = "true";
  ({ ensureBucket } = await import("./storage"));
});

describe("ensureBucket", () => {
  it("桶不存在(HeadBucket 抛错)时创建桶", async () => {
    sends.length = 0;
    headBehavior = () => { throw Object.assign(new Error("not found"), { name: "NotFound" }); };
    createBehavior = () => {};
    await ensureBucket();
    expect(sends).toContain("HeadBucketCommand");
    expect(sends).toContain("CreateBucketCommand");
  });

  it("已确保后不再重复探测（幂等短路）", async () => {
    // 上一个用例已成功 → _bucketEnsured=true，本次不应再发命令
    sends.length = 0;
    await ensureBucket();
    expect(sends.length).toBe(0);
  });
});

describe("ensureBucket 并发/权限差异", () => {
  it("CreateBucket 报 BucketAlreadyOwnedByYou 视为成功（不抛）", async () => {
    // 重新加载模块以重置 _bucketEnsured
    vi.resetModules();
    const mod = await import("./storage");
    sends.length = 0;
    headBehavior = () => { throw Object.assign(new Error("nf"), { name: "NotFound" }); };
    createBehavior = () => { throw Object.assign(new Error("owned"), { name: "BucketAlreadyOwnedByYou" }); };
    await expect(mod.ensureBucket()).resolves.toBeUndefined();
  });
});
