import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readMigration = (name: string) =>
  readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8");

describe("action item enum migration bootstrap", () => {
  it("defines condition_followup before the backfill migration uses it", () => {
    const enumBootstrap = readMigration("0045_action_items_heartbeat.sql");
    const backfill = readMigration("0057_backfill_controlled_conditions.sql");

    expect(enumBootstrap).toContain("'condition_followup'");
    expect(backfill).toContain("'condition_followup'::action_item_kind");
  });
});
