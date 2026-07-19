import { describe, expect, it } from "vitest";
import { shouldOfferCompletionAfterEvidenceUpload } from "./task-evidence-actions";

describe("重证据上传后的完成提示", () => {
  it("只对未终态的非 Gate 重证据任务开放", () => {
    expect(shouldOfferCompletionAfterEvidenceUpload({
      evidenceLevel: "heavy",
      isGateTask: false,
      completed: false,
      status: "todo",
    })).toBe(true);
    expect(shouldOfferCompletionAfterEvidenceUpload({
      evidenceLevel: "heavy",
      isGateTask: false,
      completed: false,
      status: "in_progress",
    })).toBe(true);
  });

  it.each([
    { evidenceLevel: "light" as const, isGateTask: false, completed: false, status: "todo" },
    { evidenceLevel: "heavy" as const, isGateTask: true, completed: false, status: "todo" },
    { evidenceLevel: "heavy" as const, isGateTask: false, completed: true, status: "done" },
    { evidenceLevel: "heavy" as const, isGateTask: false, completed: false, status: "skipped" },
    { evidenceLevel: "heavy" as const, isGateTask: false, completed: false, status: "pending_approval" },
  ])("不开放：$evidenceLevel / gate=$isGateTask / $status", (input) => {
    expect(shouldOfferCompletionAfterEvidenceUpload(input)).toBe(false);
  });
});
