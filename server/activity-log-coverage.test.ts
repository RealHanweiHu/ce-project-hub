import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

type CoverageCase = {
  file: string;
  name: string;
  kind: "routerProcedure" | "function";
  markers: string[];
};

const HIGH_RISK_MUTATIONS: CoverageCase[] = [
  {
    file: "server/routers/bom.ts",
    name: "add",
    kind: "routerProcedure",
    markers: ["createActivityLog", 'action: "bom.add"'],
  },
  {
    file: "server/routers/bom.ts",
    name: "update",
    kind: "routerProcedure",
    markers: ["createActivityLog", 'action: "bom.update"'],
  },
  {
    file: "server/routers/bom.ts",
    name: "delete",
    kind: "routerProcedure",
    markers: ["createActivityLog", 'action: "bom.delete"'],
  },
  {
    file: "server/routers/meetings.ts",
    name: "setConfig",
    kind: "routerProcedure",
    markers: ["createActivityLog", 'action: "meeting.update_config"'],
  },
  {
    file: "server/routers/products.ts",
    name: "setProject",
    kind: "routerProcedure",
    markers: ["createActivityLog", 'action: "project.update"'],
  },
  {
    file: "server/deliverable-review-service.ts",
    name: "submitDeliverableReview",
    kind: "function",
    markers: ["createActivityLog", 'action: "deliverable_review.submit"'],
  },
  {
    file: "server/deliverable-review-service.ts",
    name: "reviewDeliverable",
    kind: "function",
    markers: ["createActivityLog", 'deliverable_review.approve', 'deliverable_review.reject'],
  },
  {
    file: "server/deliverable-review-service.ts",
    name: "resetReviewOnReupload",
    kind: "function",
    markers: ["createActivityLog", 'action: "deliverable_review.reset"'],
  },
];

describe("activity log coverage guard", () => {
  it.each(HIGH_RISK_MUTATIONS)("$file $name keeps an activity log", (item) => {
    const source = readFileSync(join(root, item.file), "utf8");
    const body = item.kind === "routerProcedure"
      ? extractRouterProcedure(source, item.name)
      : extractFunction(source, item.name);
    for (const marker of item.markers) {
      expect(body, `${item.file} ${item.name} should contain ${marker}`).toContain(marker);
    }
  });
});

function extractRouterProcedure(source: string, name: string): string {
  const start = source.indexOf(`\n  ${name}:`);
  if (start < 0) throw new Error(`Router procedure not found: ${name}`);
  const rest = source.slice(start + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z_][A-Za-z0-9_]*:/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const signatureEnd = source.indexOf("): Promise", start);
  const braceStart = source.indexOf("{", signatureEnd > 0 ? signatureEnd : start);
  if (braceStart < 0) throw new Error(`Function body not found: ${name}`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unclosed function body: ${name}`);
}
