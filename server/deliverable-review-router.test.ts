import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectFile } from "./db";
import { projects, projectFiles, projectDeliverableReviews, projectMembers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { deliverableReviewsRouter } from "./routers/deliverableReviews";

const PROJ = `drr-${Date.now()}`;
const PM = 930001, REVIEWER = 930002, OUTSIDER = 930003;
const makeCtx = (id: number, role: string) => ({ user: { id, role, name: "x", email: "x", canCreateProject: true, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null, passwordHash: null, username: null } });
const caller = (id: number, role: string) => deliverableReviewsRouter.createCaller(makeCtx(id, role) as any);

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({ id: PROJ, name: "审核路由", projectNumber: "DRR-1", category: "npd", risk: "low", currentPhase: "design", createdBy: PM, pmUserId: PM });
  await db!.insert(projectMembers).values({ projectId: PROJ, userId: PM, role: "pm", invitedBy: PM });
  await createProjectFile({ projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: "ID外观图", name: "id.pdf", mimeType: "application/pdf", size: 1, storageKey: "k/id", storageUrl: "/storage/k/id", uploadedBy: PM });
});
afterAll(async () => {
  const db = await getDb();
  await db!.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
  await db!.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db!.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

describe("deliverableReviews 权限", () => {
  it("非成员 list → FORBIDDEN", async () => {
    await expect(caller(OUTSIDER, "user").list({ projectId: PROJ })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("PM list → ok", async () => {
    await expect(caller(PM, "user").list({ projectId: PROJ })).resolves.toBeDefined();
  });
  it("非成员 submit → FORBIDDEN", async () => {
    await expect(caller(OUTSIDER, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", reviewerUserId: REVIEWER })).rejects.toThrow();
  });
  it("PM submit → ok", async () => {
    await expect(caller(PM, "user").submit({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", reviewerUserId: REVIEWER })).resolves.toBeTruthy();
  });
  it("非审核人 review → FORBIDDEN", async () => {
    await expect(caller(OUTSIDER, "user").review({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", note: null })).rejects.toThrow();
  });
  it("审核人 review → ok", async () => {
    await expect(caller(REVIEWER, "user").review({ projectId: PROJ, phaseId: "design", deliverableName: "ID外观图", decision: "approved", note: null })).resolves.toBeTruthy();
  });
});
