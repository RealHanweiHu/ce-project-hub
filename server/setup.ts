/**
 * /api/setup - One-time admin initialization endpoint
 *
 * Security rules:
 * 1. Only works when the users table is EMPTY (no existing users)
 * 2. Once any user exists, this endpoint returns 403 immediately
 * 3. Creates the first admin user with username + password
 */
import { Router } from "express";
import { hashPassword } from "./_core/password";
import { countUsers, createUserWithPassword, getUserByUsername } from "./db";

export function registerSetupRoute(app: Router) {
  // GET /api/setup/status - check if setup is needed
  app.get("/api/setup/status", async (_req, res) => {
    try {
      const count = await countUsers();
      res.json({ needsSetup: count === 0 });
    } catch (err) {
      console.error("[Setup] Status check failed:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // POST /api/setup - create the first admin account
  app.post("/api/setup", async (req, res) => {
    try {
      // Safety check: only allow when no users exist
      const count = await countUsers();
      if (count > 0) {
        res.status(403).json({ error: "系统已初始化，此接口已关闭" });
        return;
      }

      const { username, password, name } = req.body as {
        username?: string;
        password?: string;
        name?: string;
      };

      // Validate input
      if (!username || typeof username !== "string" || username.length < 2) {
        res.status(400).json({ error: "用户名至少2位" });
        return;
      }
      if (!/^[a-zA-Z0-9_.\-]+$/.test(username)) {
        res.status(400).json({ error: "用户名只能包含字母、数字、下划线、点和横线" });
        return;
      }
      if (!password || typeof password !== "string" || password.length < 6) {
        res.status(400).json({ error: "密码至少6位" });
        return;
      }
      if (!name || typeof name !== "string" || name.trim().length < 1) {
        res.status(400).json({ error: "请填写显示名称" });
        return;
      }

      // Check username uniqueness (race condition guard)
      const existing = await getUserByUsername(username);
      if (existing) {
        res.status(409).json({ error: "用户名已存在" });
        return;
      }

      const passwordHash = await hashPassword(password);
      await createUserWithPassword({
        username,
        passwordHash,
        name: name.trim(),
        role: "admin",
        canCreateProject: true,
      });

      console.log(`[Setup] First admin account created: ${username}`);
      res.json({ success: true, message: "管理员账号创建成功，请前往登录页面登录" });
    } catch (err) {
      console.error("[Setup] Failed to create admin:", err);
      res.status(500).json({ error: "创建失败，请重试" });
    }
  });
}
