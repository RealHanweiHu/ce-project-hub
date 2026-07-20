import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../client/src/components/views/ProjectDetailView.tsx", import.meta.url),
  "utf8",
);

describe("project detail task modal layering", () => {
  it("portals the task modal outside the sticky project-axis stacking context", () => {
    expect(source).toContain("import { createPortal } from 'react-dom';");
    expect(source).toMatch(/selectedTask\s*&&\s*\(typeof document[^]*?createPortal\([^]*?document\.body/);
  });

  it("exposes accessible dialog semantics", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('aria-labelledby="task-detail-dialog-title"');
    expect(source).toContain('aria-label="关闭任务详情"');
  });
});
