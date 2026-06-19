import { describe, it, expect } from "vitest";
import { buildRevisionChangelogSnapshot, REVISION_CHANGE_STATUSES } from "@shared/changelog-snapshot";

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, status: "implemented", number: "ECN-001", type: "ecn", title: "改电芯",
    reason: "续航", decisionMaker: "张三", createdDate: "2026-06-02",
    costImpact: "+2元", scheduleImpact: "+3天", implementedDate: "2026-06-10",
    ...over,
  } as any;
}

describe("buildRevisionChangelogSnapshot", () => {
  it("只保留 implemented + approved，排除 proposed/rejected/cancelled", () => {
    const out = buildRevisionChangelogSnapshot([
      row({ id: 1, status: "implemented", number: "A" }),
      row({ id: 2, status: "approved", number: "B" }),
      row({ id: 3, status: "proposed", number: "C" }),
      row({ id: 4, status: "rejected", number: "D" }),
      row({ id: 5, status: "cancelled", number: "E" }),
    ]);
    expect(out.map((e) => e.number)).toEqual(["A", "B"]);
  });

  it("排序：createdDate asc(null 末尾) → number asc → id asc", () => {
    const out = buildRevisionChangelogSnapshot([
      row({ id: 10, status: "approved", number: "Z", createdDate: null }),
      row({ id: 11, status: "approved", number: "B", createdDate: "2026-06-05" }),
      row({ id: 12, status: "approved", number: "A", createdDate: "2026-06-05" }),
      row({ id: 13, status: "approved", number: "A", createdDate: "2026-06-01" }),
    ]);
    expect(out.map((e) => e.number)).toEqual(["A", "A", "B", "Z"]);
  });

  it("字段映射正确", () => {
    const [e] = buildRevisionChangelogSnapshot([row()]);
    expect(e).toEqual({
      number: "ECN-001", type: "ecn", title: "改电芯", reason: "续航",
      decisionMaker: "张三", costImpact: "+2元", scheduleImpact: "+3天", implementedDate: "2026-06-10",
    });
  });

  it("空输入 → 空数组", () => {
    expect(buildRevisionChangelogSnapshot([])).toEqual([]);
  });

  it("REVISION_CHANGE_STATUSES = implemented + approved", () => {
    expect([...REVISION_CHANGE_STATUSES].sort()).toEqual(["approved", "implemented"]);
  });
});
