import { describe, expect, it } from "vitest";
import { computeManagementKpis, parseCostValue } from "./management-kpis";

describe("computeManagementKpis", () => {
  it("computes factory management KPIs for delay, gate, aging, closure, cost and customer risk", () => {
    const result = computeManagementKpis({
      todayISO: "2026-07-05",
      portfolio: [
        {
          id: "p1",
          name: "Pocket E-Pump R1",
          projectNumber: "NPD-001",
          category: "npd",
          customer: "Decathlon",
          currentPhase: "pvt",
          targetDate: "2026-07-01",
          projectedEnd: "2026-07-12",
          ragLevel: "red",
          ragReasons: ["预计晚11天", "P0/P1×1"],
          pmName: "PM",
          overdueTasks: 2,
          blockedTasks: 1,
          criticalIssues: 1,
          openIssues: 3,
          highRisks: 1,
          mediumRisks: 0,
          gateBlockers: 2,
          deliverableGap: 1,
        },
        {
          id: "p2",
          name: "Platform Pump",
          projectNumber: "NPD-002",
          category: "npd",
          sopTemplateVersion: "2026-07-v3",
          customFields: { npdTemplate: { tier: "lite", packs: [] } },
          customer: "Internal",
          currentPhase: "verification",
          targetDate: "2026-08-01",
          projectedEnd: "2026-07-20",
          ragLevel: "green",
          ragReasons: [],
          pmName: null,
          overdueTasks: 0,
          blockedTasks: 0,
          criticalIssues: 0,
          openIssues: 0,
          highRisks: 0,
          mediumRisks: 0,
          gateBlockers: 0,
          deliverableGap: 0,
        },
      ],
      gateReviews: [
        { projectId: "p1", phaseId: "evt", decision: "approved", roundNumber: 1 },
        { projectId: "p1", phaseId: "dvt", decision: "rejected", roundNumber: 1 },
        { projectId: "p1", phaseId: "dvt", decision: "approved", roundNumber: 2 },
      ],
      issues: [
        { projectId: "p1", projectName: "Pocket E-Pump R1", phaseId: "pvt", title: "Battery thermal runaway", severity: "P0", status: "open", foundDate: "2026-06-20" },
        { projectId: "p1", projectName: "Pocket E-Pump R1", phaseId: "evt", title: "Cosmetic gap", severity: "P2", status: "open", foundDate: "2026-07-01" },
      ],
      validationItems: [
        { projectId: "p1", phaseId: "evt", status: "passed" },
        { projectId: "p1", phaseId: "dvt", status: "failed", relatedIssueStatus: "closed" },
        { projectId: "p2", phaseId: "verification", status: "passed" },
        { projectId: "p1", phaseId: "pvt", status: "blocked", relatedIssueStatus: "open" },
      ],
      bomCosts: [
        { projectId: "p1", projectName: "Pocket E-Pump R1", customer: "Decathlon", targetCost: 20, workingBomCost: 23.5, lineCount: 3 },
      ],
    });

    expect(result.delayPrediction.delayedCount).toBe(1);
    expect(result.delayPrediction.maxSlipDays).toBe(11);
    expect(result.gateFirstPass.ratePct).toBe(50);
    expect(result.p0p1Aging.openCount).toBe(1);
    expect(result.p0p1Aging.over14Days).toBe(1);
    expect(result.validationClosure.byPhase.find((row) => row.phaseId === "dvt")?.closureRatePct).toBe(100);
    expect(result.validationClosure.byPhase.find((row) => row.phaseId === "verification"))
      .toMatchObject({ total: 1, closed: 1, closureRatePct: 100 });
    expect(result.validationClosure.byPhase.find((row) => row.phaseId === "pvt")?.closureRatePct).toBe(0);
    expect(result.bomCostDelta.rows[0].delta).toBe(3.5);
    expect(result.bomCostDelta.rows[0].deltaPct).toBe(18);
    expect(result.customerRiskRanking.rows[0].projectId).toBe("p1");
    expect(result.customerRiskRanking.rows.find((row) => row.projectId === "p2")?.phaseName)
      .toBe("样机验证");
  });

  it("parses common cost strings", () => {
    expect(parseCostValue("USD 22.50 BOM")).toBe(22.5);
    expect(parseCostValue("1,234.56")).toBe(1234.56);
    expect(parseCostValue("n/a")).toBeNull();
  });
});
