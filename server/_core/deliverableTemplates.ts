import path from "node:path";
import fs from "node:fs";
import type { Express } from "express";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { getDeliverableTemplatePath } from "../../shared/deliverable-templates";
import { createContext } from "./context";

/**
 * 交付物参照模板下载：GET /api/deliverable-template?name=<交付物名称>
 *
 * 名称必须命中 shared/deliverable-templates.ts 常量表（生成器产出的白名单），
 * 再拼到 docs/templates/deliverables/ 下取文件——不存在任意路径拼接面。
 * 模板是空白表单不含项目数据，鉴权只要求登录（无需项目成员校验）。
 * 生产镜像需包含 docs/templates（Dockerfile COPY）。
 */
const TEMPLATE_ROOT = path.resolve(process.cwd(), "docs", "templates", "deliverables");

export function registerDeliverableTemplateRoute(app: Express) {
  app.get("/api/deliverable-template", async (req, res) => {
    const ctx = await createContext({ req, res } as CreateExpressContextOptions);
    if (!ctx.user) {
      res.status(401).send("Unauthorized");
      return;
    }
    const name = typeof req.query.name === "string" ? req.query.name : "";
    const rel = name ? getDeliverableTemplatePath(name) : null;
    if (!rel) {
      res.status(404).send("Unknown deliverable template");
      return;
    }
    const file = path.join(TEMPLATE_ROOT, rel);
    if (!fs.existsSync(file)) {
      console.warn(`[deliverable-template] mapped file missing on disk: ${rel}`);
      res.status(404).send("Template file missing");
      return;
    }
    res.download(file, path.basename(rel));
  });
}
