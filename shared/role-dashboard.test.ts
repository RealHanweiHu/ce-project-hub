import { describe, expect, it } from "vitest";
import { resolveRoleDashboardLens } from "./role-dashboard";

describe("resolveRoleDashboardLens", () => {
  it("keeps management and owners on the executive view", () => {
    expect(resolveRoleDashboardLens({ systemRole: "admin", roles: [] })).toBe("exec");
    expect(resolveRoleDashboardLens({ roles: [{ role: "manager" }] })).toBe("exec");
    expect(resolveRoleDashboardLens({ roles: [{ role: "owner" }] })).toBe("exec");
  });

  it("separates Project Manager from Product Manager", () => {
    expect(resolveRoleDashboardLens({ roles: [{ role: "project_manager" }] })).toBe("project_manager");
    expect(resolveRoleDashboardLens({ roles: [{ role: "pm" }] })).toBe("product_manager");
    expect(resolveRoleDashboardLens({
      userId: 7,
      portfolio: [{ pmUserId: 7, myRole: "viewer" }],
    })).toBe("project_manager");
  });

  it("routes factory execution roles to domain dashboards", () => {
    expect(resolveRoleDashboardLens({ roles: [{ role: "qa" }] })).toBe("quality");
    expect(resolveRoleDashboardLens({ roles: [{ role: "pe" }] })).toBe("npi");
    expect(resolveRoleDashboardLens({ roles: [{ role: "mfg" }] })).toBe("npi");
    expect(resolveRoleDashboardLens({ roles: [{ role: "rd_mech" }] })).toBe("engineering");
    expect(resolveRoleDashboardLens({ roles: [{ role: "sales" }] })).toBe("sales");
  });

  it("routes external collaborators to the external view and empty users to null", () => {
    expect(resolveRoleDashboardLens({ roles: [{ role: "external_customer" }] })).toBe("external");
    expect(resolveRoleDashboardLens({ roles: [{ role: "supplier" }] })).toBe("external");
    expect(resolveRoleDashboardLens({ roles: [] })).toBeNull();
  });
});
