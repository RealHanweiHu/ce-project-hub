/**
 * 按角色自动分配任务负责人:依据任务 visibleRoles 首个非管理角色匹配项目成员。
 */
import { describe, it, expect, afterAll } from "vitest";
import { addProjectMember, upsertProjectTask, assignTasksByRole, getProjectTasks, getDb } from "./db";
import { projectMembers, projectTasks } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `assign-test-${Date.now()}`;
const PM = 700001, EE = 700002, INV = 700003;

afterAll(async () => {
  const db = await getDb();
  if (db) {
    await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  }
});

describe("assignTasksByRole", () => {
  it("按 visibleRoles 把任务分给对应角色成员,不覆盖已分配", async () => {
    await addProjectMember({ projectId: PROJ, userId: PM, role: "pm", invitedBy: 1 });
    await addProjectMember({ projectId: PROJ, userId: EE, role: "rd_hw", invitedBy: 1 });
    // pm 任务
    await upsertProjectTask(PROJ, "concept", "c1", { visibleRoles: ["pm", "manager", "owner"] });
    // ee 任务
    await upsertProjectTask(PROJ, "design", "d3", { visibleRoles: ["rd_hw", "pm", "manager", "owner"] });
    // 已分配的任务(给 INV),不应被覆盖
    await upsertProjectTask(PROJ, "design", "d4", { visibleRoles: ["rd_hw"], assigneeUserId: INV });
    // gate 任务(visibleRoles 空)→ 落到 pm
    await upsertProjectTask(PROJ, "concept", "c6", { visibleRoles: [] });

    const out = await assignTasksByRole(PROJ, 1);
    const byTask = Object.fromEntries(out.map((a) => [a.taskId, a.userId]));
    expect(byTask["c1"]).toBe(PM);
    expect(byTask["d3"]).toBe(EE);
    expect(byTask["c6"]).toBe(PM);      // gate 落到 pm
    expect(byTask["d4"]).toBeUndefined(); // 已分配,跳过

    const tasks = await getProjectTasks(PROJ);
    expect(tasks.find((t) => t.taskId === "d4")?.assigneeUserId).toBe(INV); // 未被覆盖
    expect(tasks.find((t) => t.taskId === "d3")?.assigneeUserId).toBe(EE);
  });
});
