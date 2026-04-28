import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const db = drizzle(process.env.DATABASE_URL);
const [rows] = await db.execute(
  sql`SELECT id, name, email, openId, role, canCreateProject FROM users LIMIT 20`
);
console.log(JSON.stringify(rows, null, 2));
process.exit(0);
