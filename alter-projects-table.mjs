/**
 * Migrate the existing `projects` table from old schema to new schema.
 * - Rename `pm` → `pmName`
 * - Add `pmUserId` column
 * - Add `orgId` column
 * - Drop `data` column (data is now in separate tables)
 * Run once with: node alter-projects-table.mjs
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const steps = [
  // 1. Add pmUserId column (nullable int)
  {
    name: 'Add pmUserId column',
    sql: `ALTER TABLE projects ADD COLUMN pmUserId INT NULL AFTER category`,
  },
  // 2. Rename pm → pmName
  {
    name: 'Rename pm to pmName',
    sql: `ALTER TABLE projects CHANGE pm pmName VARCHAR(128) NULL`,
  },
  // 3. Add orgId column (nullable int, for future workspace/org support)
  {
    name: 'Add orgId column',
    sql: `ALTER TABLE projects ADD COLUMN orgId INT NULL AFTER archived`,
  },
  // 4. Drop data column (data is now in separate tables)
  {
    name: 'Drop data column',
    sql: `ALTER TABLE projects DROP COLUMN data`,
  },
];

for (const step of steps) {
  try {
    await conn.execute(step.sql);
    console.log(`✓ ${step.name}`);
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
      console.log(`⚠ Skipped (already exists): ${step.name}`);
    } else if (err.code === 'ER_CANT_DROP_FIELD_OR_KEY' || err.message.includes("Can't DROP")) {
      console.log(`⚠ Skipped (column not found): ${step.name}`);
    } else {
      console.error(`✗ Failed: ${step.name}`, err.message);
    }
  }
}

// Verify final schema
const [rows] = await conn.execute('DESCRIBE projects');
console.log('\nFinal projects schema:');
console.log(rows.map(r => `  ${r.Field} ${r.Type}`).join('\n'));

await conn.end();
console.log('\nDone.');
