import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const OVERVIEW_PROJECT_COMPONENTS = [
  "PortfolioDashboard.tsx",
  "PortfolioTable.tsx",
  "RagHealthPanel.tsx",
  "PerspectivePanel.tsx",
] as const;

describe("project-bound overview phase labels", () => {
  for (const file of OVERVIEW_PROJECT_COMPONENTS) {
    it(`${file} resolves phases from project template context`, () => {
      const source = readFileSync(
        path.resolve(process.cwd(), "client/src/components/views/overview", file),
        "utf8"
      );

      expect(source).not.toMatch(/\bPHASE_MAP\b/);
      expect(source).toMatch(/\bresolvePhaseName\b/);
    });
  }

  it("PerspectivePanel QA queue reuses the shared validation phase set", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "client/src/components/views/overview/PerspectivePanel.tsx"),
      "utf8"
    );

    expect(source).toMatch(/MANAGEMENT_VALIDATION_PHASES/);
    expect(source).toMatch(/new Set<string>\(MANAGEMENT_VALIDATION_PHASES\)/);
    expect(source).toContain("验证 / EVT / DVT / PVT 测试与报告");
  });
});
