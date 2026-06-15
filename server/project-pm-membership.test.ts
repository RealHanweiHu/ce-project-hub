/**
 * 立项后 PM 自动获得项目访问权:ensureProjectMember 幂等加入。
 */
import { describe, it, expect, afterAll } from "vitest";
import { ensureProjectMember, getProjectMember, getDb } from "./db";
import { projectMembers } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const PROJ = `pm-test-${Date.now()}`;
const PM_USER = 987654;

afterAll(async () => {
  const db = await getDb();
  if (db) await db.delete(projectMembers).where(and(eq(projectMembers.projectId, PROJ), eq(projectMembers.userId, PM_USER)));
});

describe("ensureProjectMember", () => {
  it("首次调用加入 PM 成员并赋 pm 角色,返回 true", async () => {
    const added = await ensureProjectMember(PROJ, PM_USER, "pm", 1);
    expect(added).toBe(true);
    const m = await getProjectMember(PROJ, PM_USER);
    expect(m?.role).toBe("pm");
  });

  it("重复调用幂等,返回 false 且不覆盖既有角色", async () => {
    const again = await ensureProjectMember(PROJ, PM_USER, "manager", 1);
    expect(again).toBe(false);
    const m = await getProjectMember(PROJ, PM_USER);
    expect(m?.role).toBe("pm"); // 不被覆盖为 manager
  });
});
