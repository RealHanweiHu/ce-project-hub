import { describe, it, expect } from "vitest";
import { resolveStorageAuthorization, type StorageAuthDeps } from "./storage-access";
import { canRoleViewFileVisibility } from "./file-visibility";

// Deps stub: a single file `k/secret` belonging to project P, whose only member is user 1 (role pm).
const deps: StorageAuthDeps = {
  getFileProjectId: async (key) => (key === "k/secret" ? "P" : null),
  getRole: async (projectId, userId) =>
    projectId === "P" && userId === 1 ? "pm" : null,
};

describe("resolveStorageAuthorization", () => {
  it("unauthenticated request → unauthorized (before any lookup)", async () => {
    expect(await resolveStorageAuthorization("k/secret", null, deps)).toBe("unauthorized");
    expect(await resolveStorageAuthorization("k/secret", undefined, deps)).toBe("unauthorized");
    expect(await resolveStorageAuthorization("k/secret", 0, deps)).toBe("unauthorized");
  });

  it("unknown storage key → notfound", async () => {
    expect(await resolveStorageAuthorization("k/does-not-exist", 1, deps)).toBe("notfound");
  });

  it("authenticated non-member → forbidden (must not stream another project's file)", async () => {
    expect(await resolveStorageAuthorization("k/secret", 2, deps)).toBe("forbidden");
  });

  it("authenticated project member → ok", async () => {
    expect(await resolveStorageAuthorization("k/secret", 1, deps)).toBe("ok");
  });

  it("blocks members whose role cannot view the file visibility", async () => {
    const visibilityDeps: StorageAuthDeps = {
      getFileAccess: async (key) => key === "k/internal" ? { projectId: "P", visibility: "internal" } : null,
      getRole: async (projectId, userId) =>
        projectId === "P" && userId === 3 ? "external_customer" : null,
      canRoleViewFile: canRoleViewFileVisibility,
    };

    expect(await resolveStorageAuthorization("k/internal", 3, visibilityDeps)).toBe("forbidden");
  });
});
