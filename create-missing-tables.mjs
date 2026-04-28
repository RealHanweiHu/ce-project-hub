/**
 * Manual migration: drop and recreate the 5 new business tables with correct
 * camelCase column names matching the Drizzle schema.
 * Run once with: node create-missing-tables.mjs
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Drop old snake_case tables if they exist
const drops = [
  'DROP TABLE IF EXISTS project_changelog',
  'DROP TABLE IF EXISTS project_gate_reviews',
  'DROP TABLE IF EXISTS project_issues',
  'DROP TABLE IF EXISTS project_tasks',
  'DROP TABLE IF EXISTS project_phases',
];

for (const sql of drops) {
  const tableName = sql.match(/DROP TABLE IF EXISTS (\w+)/)?.[1];
  try {
    await conn.execute(sql);
    console.log(`✓ Dropped: ${tableName}`);
  } catch (err) {
    console.error(`✗ Failed to drop ${tableName}:`, err.message);
  }
}

const statements = [
  // ── project_phases ────────────────────────────────────────────────────────
  `CREATE TABLE project_phases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    projectId VARCHAR(32) NOT NULL,
    phaseId VARCHAR(32) NOT NULL,
    startDate VARCHAR(32) NULL,
    endDate VARCHAR(32) NULL,
    notes TEXT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_project_phase (projectId, phaseId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── project_tasks ─────────────────────────────────────────────────────────
  `CREATE TABLE project_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    projectId VARCHAR(32) NOT NULL,
    phaseId VARCHAR(32) NOT NULL,
    taskId VARCHAR(32) NOT NULL,
    completed TINYINT(1) NOT NULL DEFAULT 0,
    instructions TEXT NULL,
    visibleRoles JSON NULL,
    updatedBy INT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_project_task (projectId, phaseId, taskId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── project_issues ────────────────────────────────────────────────────────
  `CREATE TABLE project_issues (
    id INT AUTO_INCREMENT PRIMARY KEY,
    projectId VARCHAR(32) NOT NULL,
    phaseId VARCHAR(32) NOT NULL,
    title VARCHAR(512) NOT NULL,
    description TEXT NULL,
    severity ENUM('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
    status ENUM('open','in_progress','resolved','closed','wont_fix') NOT NULL DEFAULT 'open',
    category ENUM('hardware','software','mechanical','thermal','reliability','safety','performance','other') NOT NULL DEFAULT 'other',
    owner VARCHAR(256) NULL,
    reporter VARCHAR(256) NULL,
    foundDate VARCHAR(32) NULL,
    targetDate VARCHAR(32) NULL,
    closedDate VARCHAR(32) NULL,
    rootCause TEXT NULL,
    solution TEXT NULL,
    relatedTaskId VARCHAR(64) NULL,
    creatorId INT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── project_gate_reviews ──────────────────────────────────────────────────
  `CREATE TABLE project_gate_reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    projectId VARCHAR(32) NOT NULL,
    phaseId VARCHAR(32) NOT NULL,
    phaseName VARCHAR(256) NOT NULL DEFAULT '',
    gateName VARCHAR(256) NOT NULL DEFAULT '',
    reviewDate VARCHAR(32) NOT NULL,
    participants TEXT NULL,
    decision ENUM('approved','conditional','rejected') NOT NULL DEFAULT 'conditional',
    conditions TEXT NULL,
    notes TEXT NULL,
    roundNumber INT NOT NULL DEFAULT 1,
    createdBy INT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── project_changelog ─────────────────────────────────────────────────────
  `CREATE TABLE project_changelog (
    id INT AUTO_INCREMENT PRIMARY KEY,
    projectId VARCHAR(32) NOT NULL,
    number VARCHAR(64) NOT NULL DEFAULT '',
    type ENUM('decision','tradeoff','eco','ecn','spec','risk','milestone','other') NOT NULL DEFAULT 'other',
    title VARCHAR(512) NOT NULL,
    description TEXT NULL,
    reason TEXT NULL,
    decisionMaker VARCHAR(256) NULL,
    affectedPhases JSON NULL,
    status ENUM('proposed','approved','rejected','implemented','cancelled') NOT NULL DEFAULT 'proposed',
    costImpact VARCHAR(256) NULL,
    scheduleImpact VARCHAR(256) NULL,
    notes TEXT NULL,
    createdDate VARCHAR(32) NULL,
    implementedDate VARCHAR(32) NULL,
    creatorId INT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

for (const sql of statements) {
  const tableName = sql.match(/CREATE TABLE (\w+)/)?.[1];
  try {
    await conn.execute(sql);
    console.log(`✓ Created table: ${tableName}`);
  } catch (err) {
    console.error(`✗ Failed to create ${tableName}:`, err.message);
  }
}

await conn.end();
console.log('Done.');
