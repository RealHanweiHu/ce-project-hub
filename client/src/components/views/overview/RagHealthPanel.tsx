import { useMemo } from "react";
import { type RagLevel } from "@shared/health";
import type { PortfolioTableRow } from "./PortfolioTable";
import { PHASE_MAP } from "@/lib/data";
import { Activity, ChevronRight } from "lucide-react";

const LABEL: Record<RagLevel, string> = { green: "绿", amber: "黄", red: "红" };

export function RagHealthPanel({ rows, onSelectProject }: { rows: PortfolioTableRow[]; onSelectProject: (id: string) => void }) {
  const scored = useMemo(
    () =>
      rows.map((r) => ({
        row: r,
        level: r.ragLevel,
      })),
    [rows]
  );
  const counts = { green: 0, amber: 0, red: 0 } as Record<RagLevel, number>;
  for (const s of scored) counts[s.level]++;
  const attention = scored
    .filter((s) => s.level !== "green")
    .sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));

  return (
    <div className="ce-panel p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-serif text-lg text-stone-900">项目健康度</h3>
          <p className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">PROJECT HEALTH · RAG</p>
        </div>
        <Activity size={18} className="text-stone-300" />
      </div>
      <div className="flex gap-2 mb-4">
        <Pill level="green" n={counts.green} />
        <Pill level="amber" n={counts.amber} />
        <Pill level="red" n={counts.red} />
      </div>
      <div className="divide-y divide-stone-100">
        {attention.length === 0 && <div className="text-sm text-stone-400 py-2">全部项目健康（绿）</div>}
        {attention.map(({ row, level }) => (
          <div key={row.id} onClick={() => onSelectProject(row.id)} className="flex items-center gap-3 py-2 cursor-pointer hover:bg-stone-50/60 -mx-2 px-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${level === "red" ? "bg-rose-500" : "bg-amber-500"}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-stone-800 truncate">{row.name}</div>
              <div className="text-[10px] font-mono text-stone-400">{PHASE_MAP[row.currentPhase]?.name ?? row.currentPhase}</div>
            </div>
            <ChevronRight size={13} className="text-stone-300 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Pill({ level, n }: { level: RagLevel; n: number }) {
  const cls = level === "green" ? "bg-emerald-50 text-emerald-700" : level === "amber" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
  return <span className={`flex-1 text-center rounded py-2 text-sm font-medium ${cls}`}>{LABEL[level]} {n}</span>;
}
