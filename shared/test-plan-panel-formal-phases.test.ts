import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  path.resolve(process.cwd(), "client/src/components/views/TestPlanPanel.tsx"),
  "utf8"
);

describe("TestPlanPanel formal test phases", () => {
  it("reuses the shared validation phases, including lite verification", () => {
    expect(panelSource).toMatch(/MANAGEMENT_VALIDATION_PHASES/);
    expect(panelSource).toMatch(/new Set<string>\(MANAGEMENT_VALIDATION_PHASES\)/);
  });
});
