import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, getGateReadiness, createProjectFile } from "./db";
import { projects, projectFiles, projectDeliverableReviews } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { submitDeliverableReview, reviewDeliverable } from "./deliverable-review-service";
import { getPhasesForCategory } from "../shared/sop-templates";

const PROJ = `drg-${Date.now()}`;
const U = 940001;
const deps = { notifyDingtalk: async () => {} };
const design = getPhasesForCategory("npd").find((p) => p.id === "design")!;
const DELIV = design.gateStandard.requiredDeliverables[0];

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({ id: PROJ, name: "就绪审核", projectNumber: "DRG-1", category: "npd", risk: "low", currentPhase: "design", createdBy: U, pmUserId: U });
  await createProjectFile({ projectId: PROJ, phaseId: "design", taskId: design.gateTaskId, deliverableName: DELIV, name: "f.pdf", mimeType: "application/pdf", size: 1, storageKey: "k/f", storageUrl: "/storage/k/f", uploadedBy: U });
});
afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
  await db!.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

describe("getGateReadiness 审核口径", () => {
  it("有文件但待审 → 该交付物不计入已满足(仍是 blocker)", async () => {
    await submitDeliverableReview({ projectId: PROJ, phaseId: "design", deliverableName: DELIV, reviewerUserId: U, submittedBy: U }, deps);
    const r = await getGateReadiness(PROJ, "design");
    const deliv = r!.dimensions.find((d) => d.dimension === "deliverables")!;
    expect(deliv.blockers.some((b) => b.includes(DELIV))).toBe(true);
  });
  it("审核通过 → 计入已满足(不再是 blocker)", async () => {
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: DELIV, decision: "approved", reviewedBy: U, note: null }, deps);
    const r = await getGateReadiness(PROJ, "design");
    const deliv = r!.dimensions.find((d) => d.dimension === "deliverables")!;
    expect(deliv.blockers.some((b) => b.includes(DELIV))).toBe(false);
  });
});
