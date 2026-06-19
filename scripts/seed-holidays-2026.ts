import "dotenv/config";
import pg from "pg";

// 2026 中国法定节假日 + 调休上班日（首版经验值，可改）。
const HOLIDAYS: Array<[string, string]> = [
  ["2026-01-01", "元旦"],
  ["2026-02-16", "春节"], ["2026-02-17", "春节"], ["2026-02-18", "春节"],
  ["2026-02-19", "春节"], ["2026-02-20", "春节"], ["2026-02-21", "春节"], ["2026-02-22", "春节"],
  ["2026-04-05", "清明"], ["2026-05-01", "劳动节"], ["2026-06-19", "端午"],
  ["2026-09-25", "中秋"], ["2026-10-01", "国庆"], ["2026-10-02", "国庆"], ["2026-10-03", "国庆"],
  ["2026-10-04", "国庆"], ["2026-10-05", "国庆"], ["2026-10-06", "国庆"], ["2026-10-07", "国庆"],
];
const MAKEUP_WORKDAYS: Array<[string, string]> = [
  ["2026-02-15", "春节调休"], ["2026-09-27", "国庆调休"], ["2026-10-10", "国庆调休"],
];

async function main() {
  const { Client } = pg;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const [date, name] of HOLIDAYS) {
      await client.query(
        `INSERT INTO calendar_exceptions(date, type, name) VALUES($1,'holiday',$2)
         ON CONFLICT (date) DO UPDATE SET type='holiday', name=$2`, [date, name]);
    }
    for (const [date, name] of MAKEUP_WORKDAYS) {
      await client.query(
        `INSERT INTO calendar_exceptions(date, type, name) VALUES($1,'makeup_workday',$2)
         ON CONFLICT (date) DO UPDATE SET type='makeup_workday', name=$2`, [date, name]);
    }
    console.log(`seeded ${HOLIDAYS.length} holidays + ${MAKEUP_WORKDAYS.length} makeup workdays`);
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
