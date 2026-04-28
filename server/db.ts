import { eq, desc, and, or, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users, projects, InsertProject, ProjectRow,
  projectMembers, InsertProjectMember, ProjectMember, ProjectMemberRole,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0];
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result[0];
}

export async function createUserWithPassword(data: {
  username: string;
  passwordHash: string;
  name: string;
  role?: 'user' | 'admin';
  canCreateProject?: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.insert(users).values({
    openId: data.username,
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
    loginMethod: 'password',
    role: data.role ?? 'user',
    canCreateProject: data.canCreateProject ?? false,
    lastSignedIn: new Date(),
  });
}

export async function updateUserPassword(userId: number, passwordHash: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

/** Count total users in the database (used by /api/setup to check if setup is needed) */
export async function countUsers(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.select({ id: users.id }).from(users).limit(1);
  // For setup check we only need to know if any user exists
  return result.length;
}

// ── Project helpers ───────────────────────────────────────────────────────────

/**
 * Get all projects accessible by a user:
 * - projects they created
 * - projects they are a member of
 */
export async function getProjectsByUser(userId: number): Promise<ProjectRow[]> {
  const db = await getDb();
  if (!db) return [];

  // Get project IDs where user is a member
  const memberRows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  const memberProjectIds = memberRows.map((r) => r.projectId);

  // Get projects created by user OR where user is a member
  if (memberProjectIds.length > 0) {
    return db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.archived, false),
          or(
            eq(projects.createdBy, userId),
            inArray(projects.id, memberProjectIds)
          )
        )
      )
      .orderBy(desc(projects.updatedAt));
  }

  return db
    .select()
    .from(projects)
    .where(and(eq(projects.createdBy, userId), eq(projects.archived, false)))
    .orderBy(desc(projects.updatedAt));
}

export async function getProjectById(id: string): Promise<ProjectRow | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return result[0];
}

export async function createProject(project: InsertProject): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(projects).values(project);
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<InsertProject, "id" | "createdBy" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects).set(patch).where(eq(projects.id, id));
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects).set({ archived: true }).where(eq(projects.id, id));
}

/** Get projects where user is an explicit member (not creator) */
export async function getProjectsByMember(userId: number): Promise<ProjectRow[]> {
  const db = await getDb();
  if (!db) return [];
  const memberRows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
  const memberProjectIds = memberRows.map((r) => r.projectId);
  if (memberProjectIds.length === 0) return [];
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.archived, false), inArray(projects.id, memberProjectIds)))
    .orderBy(desc(projects.updatedAt));
}

// ── Project Member helpers ────────────────────────────────────────────────────

/** Get all members of a project, joined with user info */
export async function getProjectMembers(projectId: string): Promise<Array<ProjectMember & {
  userName: string | null;
  userEmail: string | null;
}>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: projectMembers.id,
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
      jobTitle: projectMembers.jobTitle,
      invitedBy: projectMembers.invitedBy,
      createdAt: projectMembers.createdAt,
      updatedAt: projectMembers.updatedAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(projectMembers)
    .leftJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.createdAt);
  return rows as Array<ProjectMember & { userName: string | null; userEmail: string | null }>;
}

/** Get a specific member's role in a project */
export async function getProjectMember(projectId: string, userId: number): Promise<ProjectMember | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return result[0];
}

/** Add a member to a project */
export async function addProjectMember(member: InsertProjectMember): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(projectMembers).values(member);
}

/** Update a member's role or jobTitle */
export async function updateProjectMember(
  projectId: string,
  userId: number,
  patch: { role?: ProjectMemberRole; jobTitle?: string | null }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(projectMembers)
    .set(patch)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

/** Remove a member from a project */
export async function removeProjectMember(projectId: string, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}
