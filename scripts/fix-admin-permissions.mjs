// 确保所有系统管理员(role='admin')都拥有 canCreateProject=true。
// PostgreSQL 版（此前是 MySQL 时代死代码，导入 drizzle-orm/mysql2 直接崩）。
// 幂等，可反复执行。容器内：node scripts/fix-admin-permissions.mjs
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // PG 列名大小写敏感，必须加引号
  const upd = await client.query(
    `UPDATE users SET "canCreateProject" = true WHERE role = 'admin' AND "canCreateProject" = false`,
  );
  console.log(`已更新 ${upd.rowCount} 个管理员账号的建项目权限。`);

  const { rows } = await client.query(
    `SELECT id, name, role, "canCreateProject" FROM users WHERE role = 'admin' ORDER BY id`,
  );
  console.log("当前管理员：", JSON.stringify(rows, null, 2));
} catch (e) {
  console.error("FAILED:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
