// 幂等应用 0016:projects 立项基础信息字段 + dingtalkChatId。容器内执行:node scripts/migrate-0016.mjs
import pg from "pg";
const HASH = "0595abe654fd7f9d3e0d6fd069538c0df59a9ccc6706a406df428ff5a4ba4286";
const WHEN = 1781504388746;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`ALTER TABLE "projects"
    ADD COLUMN IF NOT EXISTS "description" text,
    ADD COLUMN IF NOT EXISTS "customer" varchar(256),
    ADD COLUMN IF NOT EXISTS "background" text,
    ADD COLUMN IF NOT EXISTS "value" text,
    ADD COLUMN IF NOT EXISTS "dingtalkChatId" varchar(128);`);
  const ex = await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1 LIMIT 1;`, [HASH]);
  if (ex.rowCount === 0) {
    await client.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1,$2);`, [HASH, WHEN]);
    console.log("migration 0016 recorded");
  } else console.log("migration 0016 already recorded");
  await client.query("COMMIT");
  console.log("OK: projects 立项字段 + dingtalkChatId ready");
} catch (e) { await client.query("ROLLBACK"); console.error("FAILED:", e.message); process.exit(1); }
finally { await client.end(); }
