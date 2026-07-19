import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("B2 project overview de-duplication", () => {
  it("keeps next Gate information in only the dashboard focus card", () => {
    const dashboard = source(
      "../client/src/components/views/project-overview/ProjectDashboard.tsx",
    );

    expect(dashboard.match(/statusSummary\?\.nextGate/g) ?? []).toHaveLength(1);
    expect(dashboard).not.toContain("下一 GATE");
    expect(dashboard).toContain("Gate 评审入口");
    expect(dashboard.indexOf("进度</Kicker>"))
      .toBeLessThan(dashboard.indexOf("Gate 评审入口"));
  });

  it("hides the global focus band while the overview dashboard is visible", () => {
    const detail = source(
      "../client/src/components/views/ProjectDetailView.tsx",
    );

    expect(detail).toMatch(
      /\{mainTab !== ['"]overview['"] && \(\s*<ProjectFocusBand/,
    );
  });
});
