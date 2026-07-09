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
  {
    file: "server/routers/issues.ts",
    name: "create",
    kind: "routerProcedure",
    markers: ["createActivityLog", 'action: "issue.create"', "emitAutomationEvent"],
  },
  {
    file: "server/routers/issues.ts",
    name: "update",
    kind: "routerProcedure",
    markers: ["createActivityLog", "issue.close", "issue.update", "emitAutomationEvent", "notifyIssueValidation"],
  },
  {
    file: "server/routers/issues.ts",
    name: "delete",
    kind: "routerProcedure",
    markers: ["closeIssueValidationActionItem", "createActivityLog", 'action: "issue.delete"'],
  },
  {
    file: "server/db.ts",
    name: "setTaskCompletion",
    kind: "function",
    markers: ["createActivityLog", "task.submit_approval", "task.complete", "task.uncomplete"],
  },
  {
    file: "server/db.ts",
    name: "decideTaskApproval",
    kind: "function",
    markers: ["createActivityLog", "task.approve", "task.reject"],
  },
  {
    file: "server/routers/tasks.ts",
    name: "setMeta",
    kind: "routerProcedure",
    markers: ["createActivityLog", 'action: "task.update_meta"', "emitAutomationEvent"],
  },
  {
    file: "server/services/schedule-service.ts",
    name: "rescheduleProjectFromTask",
    kind: "function",
    markers: ["createActivityLog", 'action: "task.rescheduled"', "emitAutomationEvent"],
  },
  {
    file: "server/services/action-approval-submit.ts",
    name: "maybeSubmitActionExternalApproval",
    kind: "function",
    markers: ["createActivityLog", 'action: "approval.submit"', "dingtalkApproverUserIds"],
  },
  {
    file: "server/services/action-approval-apply.ts",
    name: "applyIssueValidation",
    kind: "function",
    markers: ["createActivityLog", "dingtalk_approval", "emitAutomationEvent"],
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
  const paramsStart = source.indexOf("(", start);
  if (paramsStart < 0) throw new Error(`Function params not found: ${name}`);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (parenDepth === 0) {
      paramsEnd = i;
      break;
    }
  }
  if (paramsEnd < 0) throw new Error(`Function params not closed: ${name}`);
  let angleDepth = 0;
  let braceStart = -1;
  for (let i = paramsEnd + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === "<") angleDepth += 1;
    if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    if (char === "{" && angleDepth === 0 && source[i + 1] === "\n") {
      braceStart = i;
      break;
    }
  }
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
