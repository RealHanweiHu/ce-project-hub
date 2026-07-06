import type { ProjectMemberRole } from "../drizzle/schema";

/**
 * Authorization for the /storage/{key} streaming proxy.
 *
 * The proxy streams S3 objects to the browser; without this check any object
 * could be downloaded by anyone who knows (or guesses) its key. Access is tied
 * to the actual file record's project membership, not a string parse of the key.
 */
export type StorageAuthResult = "ok" | "unauthorized" | "notfound" | "forbidden";

export type StorageAuthDeps = {
  /** Project id that owns the object with this storage key, or null if unknown. */
  getFileProjectId?: (key: string) => Promise<string | null>;
  /** Project id + visibility for the object with this storage key, or null if unknown. */
  getFileAccess?: (key: string) => Promise<{ projectId: string; visibility: string } | null>;
  /** Caller's effective role in the project, or null if they have no access. */
  getRole: (projectId: string, userId: number) => Promise<ProjectMemberRole | null>;
  /** Optional role/visibility policy for customer/supplier-facing files. */
  canRoleViewFile?: (role: ProjectMemberRole, visibility: string) => boolean;
};

export async function resolveStorageAuthorization(
  key: string,
  userId: number | null | undefined,
  deps: StorageAuthDeps,
): Promise<StorageAuthResult> {
  if (!userId) return "unauthorized";
  const fileAccess = deps.getFileAccess
    ? await deps.getFileAccess(key)
    : deps.getFileProjectId
      ? await deps.getFileProjectId(key).then((projectId) => projectId ? { projectId, visibility: "internal" } : null)
      : null;
  if (!fileAccess) return "notfound";
  const { projectId, visibility } = fileAccess;
  const role = await deps.getRole(projectId, userId);
  if (!role) return "forbidden";
  if (deps.canRoleViewFile && !deps.canRoleViewFile(role, visibility)) return "forbidden";
  return "ok";
}
