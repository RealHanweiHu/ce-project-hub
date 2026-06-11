import type { Express } from "express";
import { storageGetObject } from "../storage";

/**
 * Serve stored objects through the app at /storage/{key}.
 *
 * Streams from the S3-compatible backend instead of redirecting to a
 * presigned URL, so the storage endpoint (compose-internal MinIO or an
 * Aliyun OSS internal endpoint) never needs to be reachable from browsers.
 */
export function registerStorageProxy(app: Express) {
  app.get("/storage/*", async (req, res) => {
    const key = req.path.replace(/^\/storage\//, "");
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    try {
      const obj = await storageGetObject(key);
      if (obj.contentType) res.set("Content-Type", obj.contentType);
      if (obj.contentLength !== undefined) {
        res.set("Content-Length", String(obj.contentLength));
      }
      res.set("Cache-Control", "private, max-age=3600");
      obj.body.pipe(res);
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
        res.status(404).send("Not found");
        return;
      }
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
