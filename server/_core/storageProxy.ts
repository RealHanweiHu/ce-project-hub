import type { Express } from "express";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { storageGetObject } from "../storage";
import { getProjectFileAccessByStorageKey } from "../db";
import { getEffectiveProjectRoleById, getEffectiveProjectRolesById } from "../project-access";
import { resolveStorageAuthorization } from "../storage-access";
import { canRoleViewFileVisibility } from "../file-visibility";
import { createContext } from "./context";

/**
 * Serve stored objects through the app at /storage/{key}.
 *
 * Streams from the S3-compatible backend instead of redirecting to a
 * presigned URL, so the storage endpoint (compose-internal MinIO or an
 * Aliyun OSS internal endpoint) never needs to be reachable from browsers.
 *
 * Access is authorized against the owning project's membership: the caller
 * must be logged in and be a member of the project that owns the object.
 * Without this any file could be downloaded by anyone who knows its key.
 */
export function registerStorageProxy(app: Express) {
  app.get("/storage/*", async (req, res) => {
    // req.path 仍是百分号编码的；S3 对象 key 是原始（可能含中文）字节，需先解码才能匹配
    let key: string;
    try {
      key = decodeURIComponent(req.path.replace(/^\/storage\//, ""));
    } catch {
      key = req.path.replace(/^\/storage\//, "");
    }
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    // Authorize: reuse the tRPC context factory to resolve the session user.
    const ctx = await createContext(
      { req, res } as CreateExpressContextOptions
    );
    const auth = await resolveStorageAuthorization(key, ctx.user?.id, {
      getFileAccess: getProjectFileAccessByStorageKey,
      getRole: getEffectiveProjectRoleById,
      getRoles: getEffectiveProjectRolesById,
      canRoleViewFile: canRoleViewFileVisibility,
    });
    if (auth === "unauthorized") {
      res.status(401).send("Unauthorized");
      return;
    }
    // Collapse notfound/forbidden to 404 so authorized-elsewhere users can't
    // probe which storage keys exist in projects they can't access.
    if (auth !== "ok") {
      res.status(404).send("Not found");
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
