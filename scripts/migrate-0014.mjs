// 幂等应用 0014：project_tasks.deliverables jsonb + 记录到 drizzle.__drizzle_migrations。
// 在 ECS app 容器内执行：node scripts/migrate-0014.mjs（读取容器内 DATABASE_URL）。
import pg from "pg";

const HASH = "85b3d9113219d5f3186a96a3135c8170d419877f1421f2d34a84847078c1de19";
const WHEN = 1781455710552;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(
    `ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "deliverables" jsonb DEFAULT '{}'::jsonb;`
  );
  const existing = await client.query(
    `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1 LIMIT 1;`,
    [HASH]
  );
  if (existing.rowCount === 0) {
    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2);`,
      [HASH, WHEN]
    );
    console.log("migration 0014 recorded");
  } else {
    console.log("migration 0014 already recorded");
  }
  await client.query("COMMIT");
  console.log("OK: project_tasks.deliverables ready");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("FAILED:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
