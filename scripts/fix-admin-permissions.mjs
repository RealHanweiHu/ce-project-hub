import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const db = drizzle(process.env.DATABASE_URL);

// All admin users should automatically have canCreateProject = true
const result = await db.execute(
  sql`UPDATE users SET canCreateProject = true WHERE role = 'admin'`
);
console.log("Updated admin users:", result[0]);

// Verify
const [rows] = await db.execute(
  sql`SELECT id, name, role, canCreateProject FROM users`
);
console.log("Current users:", JSON.stringify(rows, null, 2));
process.exit(0);
