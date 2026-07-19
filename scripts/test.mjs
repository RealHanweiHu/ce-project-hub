#!/usr/bin/env node

import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Client, Pool } = pg;
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultDatabaseUrl = "postgres://postgres:cehub@127.0.0.1:55432/cehub";

const databaseUrl = normalizeDatabaseUrl(
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || defaultDatabaseUrl
);

process.env.DATABASE_URL = databaseUrl;
// Never let the test runner inherit live DingTalk delivery credentials from
// the developer shell or root .env. Transport unit tests explicitly opt into
// mocked delivery inside their own process.
process.env.DINGTALK_DELIVERY_MODE = "disabled";

function localBin(name) {
  const binName = process.platform === "win32" ? `${name}.cmd` : name;
  return path.join(projectRoot, "node_modules", ".bin", binName);
}

function normalizeDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname === "db") {
      url.hostname = "127.0.0.1";
      url.port = process.env.POSTGRES_PORT || "55432";
      return url.toString();
    }
  } catch {
    // Let pg/drizzle report malformed URLs with their native errors.
  }
  return value;
}

function isLocalDatabase(value) {
  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
      ...options,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command} ${args.join(" ")} failed with ${suffix}`));
    });
  });
}

async function canConnect() {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 1000,
  });

  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore close errors from failed connection attempts.
    }
  }
}

async function waitForDatabase() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (await canConnect()) return;
    await delay(500);
  }

  throw new Error("Timed out waiting for the local Postgres test database.");
}

async function prepareDatabase() {
  if (await canConnect()) return;

  if (!isLocalDatabase(databaseUrl)) {
    throw new Error(
      "DATABASE_URL is not reachable, and it does not point to a local database that can be started automatically."
    );
  }

  console.log("Starting local Postgres for tests...");
  await run("docker", ["compose", "up", "-d", "db"]);
  await waitForDatabase();
}

async function applyMigrations() {
  // Use Drizzle's own migrator so the test DB tracks migrations the same way
  // `db:push` (drizzle-kit migrate) does. It applies only the entries newer than
  // what `drizzle.__drizzle_migrations` records, so a fresh DB gets the full schema
  // and an already-migrated DB is a no-op. Adding a new table only requires
  // `drizzle-kit generate` — no manual SQL and no hand-maintained table list.
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: path.join(projectRoot, "drizzle") });
  } finally {
    await pool.end();
  }
}

try {
  await prepareDatabase();

  console.log("Applying database migrations...");
  await applyMigrations();

  await run(localBin("vitest"), ["run", ...process.argv.slice(2)]);
} catch (error) {
  console.error("");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
