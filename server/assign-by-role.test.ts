/**
 * 按角色自动分配任务负责人:依据任务 visibleRoles 首个非管理角色匹配项目成员。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { addProjectMember, upsertProjectTask, assignTasksByRole, getProjectTasks, getDb } from "./db";
import { projectMembers, projectTasks, projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `assign-test-${Date.now()}`;
const PM = 700001, EE = 700002, INV = 700003;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJ, name: "分配测试", projectNumber: PROJ, category: "npd",
    risk: "low", currentPhase: "concept", createdBy: 1,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (db) {
    await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
    await db.delete(projects).where(eq(projects.id, PROJ));
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

  it("显式角色分工(立项向导)优先于成员表:支持创建者本人与一人多角色", async () => {
    const CREATOR = 700004;
    // rd_sw 角色在成员表中无人(创建者兼任,ensureProjectMember 会跳过创建者);
    // qa 角色由 EE 兼任(EE 已是 rd_hw 成员,成员表一人一角色存不下第二个);
    // rd_mech 有成员 INV,但向导里改配给 PM → 显式分工应覆盖成员表推导。
    await addProjectMember({ projectId: PROJ, userId: INV, role: "rd_mech", invitedBy: 1 });
    await upsertProjectTask(PROJ, "design", "d5", { visibleRoles: ["rd_sw", "pm", "manager", "owner"] });
    await upsertProjectTask(PROJ, "evt", "e2", { visibleRoles: ["qa", "pm", "manager", "owner"] });
    await upsertProjectTask(PROJ, "design", "d2", { visibleRoles: ["rd_mech", "pm", "manager", "owner"] });

    const out = await assignTasksByRole(PROJ, 1, { rd_sw: CREATOR, qa: EE, rd_mech: PM });
    const byTask = Object.fromEntries(out.map((a) => [a.taskId, a.userId]));
    expect(byTask["d5"]).toBe(CREATOR); // 成员表无 rd_sw,靠显式分工
    expect(byTask["e2"]).toBe(EE);      // EE 兼任 qa,不受一人一角色限制
    expect(byTask["d2"]).toBe(PM);      // 显式分工覆盖成员表的 INV
  });
});
