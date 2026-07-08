import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { registerFileUploadRoute } from "../routers/files";
import { registerSetupRoute } from "../setup";
import { registerActionCardRoute } from "../action-card-route";
import { registerDingtalkCallbackRoute } from "../dingtalk-callback";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { startActivityLogTailer } from "../automation/activityLogTailer";
import { startAutomationScheduler } from "../automation/scheduler";
import { ensureBucket } from "../storage";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

function validateProductionSecrets() {
  if (process.env.NODE_ENV !== "production") return;
  // 生产启动即校验关键配置，避免「启动绿灯、首次登录/查询/上传才炸」的隐性故障。
  const missing: string[] = [];
  if (!(process.env.JWT_SECRET ?? "")) missing.push("JWT_SECRET（会话签名密钥，openssl rand -base64 32）");
  if (!(process.env.DATABASE_URL ?? "")) missing.push("DATABASE_URL（PostgreSQL 连接串）");
  if (!(process.env.S3_BUCKET ?? "")) missing.push("S3_BUCKET（对象存储桶名）");
  if (!(process.env.S3_ACCESS_KEY_ID ?? "")) missing.push("S3_ACCESS_KEY_ID");
  if (!(process.env.S3_SECRET_ACCESS_KEY ?? "")) missing.push("S3_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    console.error(
      `[FATAL] 生产环境缺少必需配置，拒绝启动：\n  - ${missing.join("\n  - ")}\n` +
      `请在 .env 中补齐后重启（参考 .env.example）。`,
    );
    process.exit(1);
  }
}

async function startServer() {
  validateProductionSecrets();
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerFileUploadRoute(app);
  registerSetupRoute(app);
  registerDingtalkCallbackRoute(app, appRouter);
  registerActionCardRoute(app, appRouter);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files.
  // Vite is a devDependency — import it lazily so the production bundle
  // never tries to load it.
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    startAutomationScheduler();
    startActivityLogTailer();
    // 首次部署自建对象存储桶（MinIO），避免第一个上传报 NoSuchBucket。best-effort，不阻断启动。
    void ensureBucket().catch(() => {});
  });
}

startServer().catch(console.error);
