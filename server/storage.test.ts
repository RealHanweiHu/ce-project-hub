import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_ACCESS_KEY_ID = "test-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_FORCE_PATH_STYLE = "true";
});

describe("storage (S3-compatible)", () => {
  it("storageGetSignedUrl produces a presigned URL for the right object", async () => {
    const { storageGetSignedUrl } = await import("./storage");
    const url = await storageGetSignedUrl("projects/p1/files/a.pdf");
    expect(url).toContain("test-bucket");
    expect(url).toContain("projects/p1/files/a.pdf");
    expect(url).toContain("X-Amz-Signature=");
  });

  it("storageGet returns an app-served /storage/ path", async () => {
    const { storageGet } = await import("./storage");
    const { url, key } = await storageGet("/projects/p1/files/a.pdf");
    expect(key).toBe("projects/p1/files/a.pdf");
    expect(url).toBe("/storage/projects/p1/files/a.pdf");
  });
});
