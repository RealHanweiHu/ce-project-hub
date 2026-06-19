export const REVISION_CHANGE_STATUSES = ["implemented", "approved"] as const;

export type RevisionChangeEntry = {
  number: string;
  type: string;
  title: string;
  reason: string | null;
  decisionMaker: string | null;
  costImpact: string | null;
  scheduleImpact: string | null;
  implementedDate: string | null;
};

export type ChangelogRowForSnapshot = {
  id: number;
  status: string;
  number: string;
  type: string;
  title: string;
  reason: string | null;
  decisionMaker: string | null;
  createdDate: string | null;
  costImpact: string | null;
  scheduleImpact: string | null;
  implementedDate: string | null;
};

const REVISION_STATUS_SET = new Set<string>(REVISION_CHANGE_STATUSES);

/**
 * 过滤进入版本的变更(implemented+approved) → 排序 → 映射成快照条目。
 * 排序：createdDate asc(null 末尾) → number asc → id asc。
 * 过滤对已过滤输入幂等(发布路径喂入 UPDATE…RETURNING 的行)。
 */
export function buildRevisionChangelogSnapshot(records: ChangelogRowForSnapshot[]): RevisionChangeEntry[] {
  return records
    .filter((r) => REVISION_STATUS_SET.has(r.status))
    .sort((a, b) => {
      const ad = a.createdDate ?? "￿";
      const bd = b.createdDate ?? "￿";
      if (ad !== bd) return ad < bd ? -1 : 1;
      if (a.number !== b.number) return a.number < b.number ? -1 : 1;
      return a.id - b.id;
    })
    .map((r) => ({
      number: r.number,
      type: r.type,
      title: r.title,
      reason: r.reason,
      decisionMaker: r.decisionMaker,
      costImpact: r.costImpact,
      scheduleImpact: r.scheduleImpact,
      implementedDate: r.implementedDate,
    }));
}
