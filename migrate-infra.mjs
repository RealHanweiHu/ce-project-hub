/**
 * Infrastructure migration script.
 * Idempotent: uses IF NOT EXISTS / IF EXISTS guards throughout.
 *
 * Changes:
 *  1. projects: DROP COLUMN pmName (replaced by pmUserId FK + JOIN)
 *  2. project_members: ADD UNIQUE INDEX uniq_project_member(projectId, userId)
 *                      ADD INDEX idx_project_members_project(projectId)
 *  3. CREATE TABLE project_files
 *  4. CREATE TABLE activity_logs
 */

import { createConnection } from '/home/ubuntu/ce-project-hub/node_modules/mysql2/promise.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load DATABASE_URL from process.env (injected by the sandbox)
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set');
  process.exit(1);
}

const conn = await createConnection(DATABASE_URL);

async function run(label, sql) {
  try {
    await conn.execute(sql);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    if (
      err.code === 'ER_DUP_KEYNAME' ||
      err.code === 'ER_TABLE_EXISTS_ERROR' ||
      err.code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
      (err.message && err.message.includes('Duplicate key name')) ||
      (err.message && err.message.includes("Can't DROP"))
    ) {
      console.log(`  ~ ${label} (already applied, skipping)`);
    } else {
      console.error(`  ✗ ${label}: ${err.message}`);
      throw err;
    }
  }
}

console.log('\n=== CE Project Hub Infrastructure Migration ===\n');

// ── 1. projects: drop pmName column ──────────────────────────────────────────
// Check if column exists first to avoid errors
const [pmNameCols] = await conn.execute(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'pmName'`
);
if (pmNameCols.length > 0) {
  await run('projects: DROP COLUMN pmName', `ALTER TABLE projects DROP COLUMN pmName`);
} else {
  console.log('  ~ projects: pmName already removed, skipping');
}

// ── 2. project_members: unique index ─────────────────────────────────────────
await run(
  'project_members: ADD UNIQUE INDEX uniq_project_member(projectId, userId)',
  `ALTER TABLE project_members
   ADD UNIQUE INDEX uniq_project_member (projectId, userId)`
);

await run(
  'project_members: ADD INDEX idx_project_members_project(projectId)',
  `ALTER TABLE project_members
   ADD INDEX idx_project_members_project (projectId)`
);

// ── 3. CREATE TABLE project_files ────────────────────────────────────────────
await run(
  'CREATE TABLE project_files',
  `CREATE TABLE IF NOT EXISTS project_files (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    projectId   VARCHAR(32)  NOT NULL,
    phaseId     VARCHAR(32)  NULL,
    name        VARCHAR(256) NOT NULL,
    mimeType    VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
    size        BIGINT       NOT NULL DEFAULT 0,
    storageKey  VARCHAR(512) NOT NULL,
    storageUrl  VARCHAR(512) NOT NULL,
    uploadedBy  INT          NOT NULL,
    createdAt   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_project_files_project (projectId),
    INDEX idx_project_files_project_phase (projectId, phaseId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
);

// ── 4. CREATE TABLE activity_logs ────────────────────────────────────────────
await run(
  'CREATE TABLE activity_logs',
  `CREATE TABLE IF NOT EXISTS activity_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    projectId   VARCHAR(32)  NOT NULL,
    userId      INT          NOT NULL,
    action      VARCHAR(64)  NOT NULL,
    entityType  VARCHAR(32)  NULL,
    entityId    VARCHAR(64)  NULL,
    meta        JSON         NULL,
    createdAt   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_activity_logs_project (projectId),
    INDEX idx_activity_logs_user (userId),
    INDEX idx_activity_logs_project_time (projectId, createdAt)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
);

// ── Verify ────────────────────────────────────────────────────────────────────
console.log('\n=== Verification ===\n');

const [tables] = await conn.execute(
  `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = DATABASE()
   ORDER BY TABLE_NAME`
);
console.log('Tables:', tables.map(r => r.TABLE_NAME).join(', '));

const [pmMemberIdx] = await conn.execute(
  `SELECT INDEX_NAME, NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_members'
   GROUP BY INDEX_NAME, NON_UNIQUE`
);
console.log('\nproject_members indexes:');
pmMemberIdx.forEach(r => console.log(`  ${r.INDEX_NAME} (unique=${r.NON_UNIQUE === 0})`));

const [projectCols] = await conn.execute(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'
   ORDER BY ORDINAL_POSITION`
);
console.log('\nprojects columns:', projectCols.map(r => r.COLUMN_NAME).join(', '));

await conn.end();
console.log('\n=== Migration complete ===\n');
