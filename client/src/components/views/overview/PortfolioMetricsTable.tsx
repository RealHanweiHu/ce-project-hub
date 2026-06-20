import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

type SortKey = "overdueRatePct" | "leadTimeDaysMedian" | "recentThroughput" | "gateFirstPassRatePct";

const RAG_DOT: Record<string, string> = {
  red: "bg-red-500", amber: "bg-amber-500", green: "bg-emerald-500",
};

function fmt(value: number | null, suffix = ""): string {
  return value === null || value === undefined ? "—" : `${value}${suffix}`;
}

export function PortfolioMetricsTable() {
  const { data, isLoading } = trpc.analytics.portfolioMetrics.useQuery();
  const [sortKey, setSortKey] = useState<SortKey>("overdueRatePct");

  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
  }, [data, sortKey]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-stone-400 py-6 justify-center">
        <Loader2 size={16} className="animate-spin" />加载项目度量对比…
      </div>
    );
  }

  const agg = data?.aggregates;
  if (!agg || rows.length === 0) {
    return <div className="py-6 text-center text-sm text-stone-400">暂无项目</div>;
  }

  const cols: { key: SortKey; label: string; suffix?: string }[] = [
    { key: "leadTimeDaysMedian", label: "Lead Time 中位", suffix: "d" },
    { key: "overdueRatePct", label: "逾期率", suffix: "%" },
    { key: "recentThroughput", label: "近4周吞吐" },
    { key: "gateFirstPassRatePct", label: "Gate 通过率", suffix: "%" },
  ];

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-stone-100 px-4 py-3 text-xs text-stone-500">
        <span className="font-mono uppercase tracking-widest text-stone-400">项目度量对比</span>
        <span>项目数 <b className="text-stone-800">{agg.projectCount}</b></span>
        <span>
          <span className="text-red-600">红 {agg.ragCounts.red}</span> ·
          <span className="text-amber-600"> 黄 {agg.ragCounts.amber}</span> ·
          <span className="text-emerald-600"> 绿 {agg.ragCounts.green}</span>
        </span>
        <span>总近4周吞吐 <b className="text-stone-800">{agg.totalRecentThroughput}</b></span>
        <span>池化逾期率 <b className="text-stone-800">{fmt(agg.pooledOverdueRatePct, "%")}</b></span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-mono uppercase tracking-wider text-stone-400">
            <th className="px-4 py-2">项目</th>
            {cols.map((c) => (
              <th key={c.key} className="px-4 py-2">
                <button
                  type="button"
                  onClick={() => setSortKey(c.key)}
                  className={`hover:text-stone-700 ${sortKey === c.key ? "text-stone-800" : ""}`}
                >
                  {c.label}{sortKey === c.key ? " ↓" : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.projectId} className={`border-t border-stone-100 ${r.ragLevel === "red" ? "bg-red-50/40" : ""}`}>
              <td className="px-4 py-2">
                <span className="inline-flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${RAG_DOT[r.ragLevel] ?? "bg-stone-300"}`} />
                  {r.name}
                </span>
              </td>
              <td className="px-4 py-2">{fmt(r.leadTimeDaysMedian, "d")}</td>
              <td className="px-4 py-2">{fmt(r.overdueRatePct, "%")}</td>
              <td className="px-4 py-2">{r.recentThroughput}</td>
              <td className="px-4 py-2">{fmt(r.gateFirstPassRatePct, "%")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
