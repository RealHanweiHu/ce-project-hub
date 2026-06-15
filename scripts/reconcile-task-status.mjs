// 幂等数据修复:把历史上「卡片勾选(completed=true)但 status 未推进」的任务提升为 done,
// 并将 completed 列重置为 status 的派生镜像(completed = status==='done')。
// status 自此为唯一主状态。本机/RDS 各跑一次即可,可重复执行。
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const promoted = await client.query(
    `UPDATE "project_tasks"
       SET "status" = 'done', "completedAt" = COALESCE("completedAt", now())
     WHERE "completed" = true AND "status" NOT IN ('done','skipped');`
  );
  const resynced = await client.query(
    `UPDATE "project_tasks" SET "completed" = ("status" = 'done')
     WHERE "completed" <> ("status" = 'done');`
  );
  await client.query("COMMIT");
  console.log(`OK: promoted ${promoted.rowCount} legacy-checked → done; resynced ${resynced.rowCount} completed mirrors`);
} catch (e) {
  await client.query("ROLLBACK");
  console.error("FAILED:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
