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
  getFileProjectId: (key: string) => Promise<string | null>;
  /** Caller's effective role in the project, or null if they have no access. */
  getRole: (projectId: string, userId: number) => Promise<ProjectMemberRole | null>;
};

export async function resolveStorageAuthorization(
  key: string,
  userId: number | null | undefined,
  deps: StorageAuthDeps,
): Promise<StorageAuthResult> {
  if (!userId) return "unauthorized";
  const projectId = await deps.getFileProjectId(key);
  if (!projectId) return "notfound";
  const role = await deps.getRole(projectId, userId);
  if (!role) return "forbidden";
  return "ok";
}
