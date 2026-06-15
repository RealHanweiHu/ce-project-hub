// 幂等应用 0015:project_requirements.projectId 改可空 + convertedType/convertedId 列。
// 容器内执行:node scripts/migrate-0015.mjs(读取容器内 DATABASE_URL)。
import pg from "pg";

const HASH = "e6c7485e08630dd8f3a1cef3e61f5891c402f0c4b3aa9db5ee7717e99bc552b6";
const WHEN = 1781495411566;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`ALTER TABLE "project_requirements" ALTER COLUMN "projectId" DROP NOT NULL;`);
  await client.query(`ALTER TABLE "project_requirements" ADD COLUMN IF NOT EXISTS "convertedType" varchar(16);`);
  await client.query(`ALTER TABLE "project_requirements" ADD COLUMN IF NOT EXISTS "convertedId" varchar(64);`);
  const existing = await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1 LIMIT 1;`, [HASH]);
  if (existing.rowCount === 0) {
    await client.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2);`, [HASH, WHEN]);
    console.log("migration 0015 recorded");
  } else {
    console.log("migration 0015 already recorded");
  }
  await client.query("COMMIT");
  console.log("OK: project_requirements unified schema ready");
} catch (e) {
  await client.query("ROLLBACK");
  console.error("FAILED:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
