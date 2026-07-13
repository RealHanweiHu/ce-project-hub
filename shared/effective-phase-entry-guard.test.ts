import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

type Allowance = { pattern: RegExp; max: number };

/**
 * Category-only lookups are allowed only where no concrete project exists, or
 * inside the template/accessor implementation itself. Project-bound callers
 * must use getEffectivePhasesForProjectLike so tier/add-on customFields survive.
 */
const ALLOWED: Record<string, Allowance[]> = {
  "client/src/components/GlobalSearch.tsx": [{ pattern: /getPhasesForCategory\(\)/, max: 1 }],
  "client/src/components/views/ProjectListView.tsx": [{ pattern: /getPhasesForCategory\(selectedCategory\)/, max: 1 }],
  "client/src/components/views/SOPLibraryView.tsx": [{ pattern: /getPhasesForCategory\(activeCategory\)/, max: 1 }],
  "client/src/lib/sop-templates.ts": [{ pattern: /getPhasesForCategory\(category\)/, max: 1 }],
  "server/db.ts": [
    { pattern: /getPhasesForCategory\(category, templateVersion\)/, max: 1 },
    { pattern: /getPhasesForCategory\("derivative", project\.sopTemplateVersion\)/, max: 1 },
  ],
  "server/routers/handoffs.ts": [{ pattern: /getPhasesForCategory\("eco", SOP_TEMPLATE_VERSION_CURRENT\)/, max: 1 }],
  "server/services/sop-blindspot-service.ts": [{ pattern: /getPhasesForCategory\(input\.toCategory, SOP_TEMPLATE_VERSION_CURRENT\)/, max: 1 }],
  "shared/effective-process.ts": [
    { pattern: /getPhasesForCategory\(category, templateVersion\)/, max: 1 },
    { pattern: /getPhasesForCategory\(category\)/, max: 1 },
  ],
  "shared/npd-v3.ts": [{ pattern: /getPhasesForCategory\(project\.category \?\? undefined, project\.sopTemplateVersion\)/, max: 1 }],
  "shared/schedule-graph.ts": [
    { pattern: /getPhasesForCategory\(category\)/, max: 2 },
    // Canonical derivative graph only: retained so contractSchedTasks can traverse removed dependencies.
    { pattern: /getPhasesForCategory\(projectLike\.category, projectLike\.sopTemplateVersion\)/, max: 1 },
  ],
  "shared/sop-templates.ts": [
    { pattern: /getPhasesForCategory\('derivative', templateVersion\)/, max: 2 },
    { pattern: /getPhasesForCategory\(category, templateVersion\)/, max: 1 },
  ],
};

function productionFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...productionFiles(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

describe("project-bound template resolution guard", () => {
  it("has no category-only phase lookup outside the explicit no-project whitelist", () => {
    const root = process.cwd();
    const usage = new Map<string, number>();
    const unexpected: string[] = [];

    for (const scope of ["shared", "server", "client"]) {
      for (const file of productionFiles(join(root, scope))) {
        const rel = relative(root, file);
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        lines.forEach((line, index) => {
          if (!/\bgetPhasesForCategory\s*\(/.test(line)) return;
          const rules = ALLOWED[rel] ?? [];
          const ruleIndex = rules.findIndex((rule) => rule.pattern.test(line));
          if (ruleIndex < 0) {
            unexpected.push(`${rel}:${index + 1}: ${line.trim()}`);
            return;
          }
          const key = `${rel}:${ruleIndex}`;
          const count = (usage.get(key) ?? 0) + 1;
          usage.set(key, count);
          if (count > rules[ruleIndex].max) {
            unexpected.push(`${rel}:${index + 1}: whitelist count exceeded: ${line.trim()}`);
          }
        });
      }
    }

    expect(unexpected).toEqual([]);
  });

  it("has no production call through the category-only release Gate alias", () => {
    const root = process.cwd();
    const unexpected: string[] = [];
    for (const scope of ["shared", "server", "client"]) {
      for (const file of productionFiles(join(root, scope))) {
        const rel = relative(root, file);
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        lines.forEach((line, index) => {
          if (!/\bgetReleaseGatePhase\s*\(/.test(line)) return;
          if (rel === "shared/sop-templates.ts" && /export function getReleaseGatePhase/.test(line)) return;
          unexpected.push(`${rel}:${index + 1}: ${line.trim()}`);
        });
      }
    }
    expect(unexpected).toEqual([]);
  });
});
