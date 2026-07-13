import { useMemo } from "react";
import { type RagLevel } from "@shared/health";
import type { PortfolioTableRow } from "./PortfolioTable";
import { resolvePhaseName } from "@shared/sop-template-resolution";
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
    <div className="rounded-[11px] border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg text-foreground">项目健康度</h3>
          <p className="text-[10px] num uppercase tracking-widest text-muted-foreground mt-0.5">PROJECT HEALTH · RAG</p>
        </div>
        <Activity size={18} className="text-muted-foreground" />
      </div>
      <div className="flex gap-2 mb-4">
        <Pill level="green" n={counts.green} />
        <Pill level="amber" n={counts.amber} />
        <Pill level="red" n={counts.red} />
      </div>
      <div className="divide-y divide-border">
        {attention.length === 0 && <div className="text-sm text-muted-foreground py-2">全部项目健康（绿）</div>}
        {attention.map(({ row, level }) => (
          <div key={row.id} onClick={() => onSelectProject(row.id)} className="flex items-center gap-3 py-2 cursor-pointer hover:bg-secondary -mx-2 px-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${level === "red" ? "bg-[color:var(--destructive)]" : "bg-[color:var(--warning)]"}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground truncate">{row.name}</div>
              <div className="text-[10px] num text-muted-foreground">{resolvePhaseName(row, row.currentPhase)}</div>
            </div>
            <ChevronRight size={13} className="text-muted-foreground shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Pill({ level, n }: { level: RagLevel; n: number }) {
  const cls = level === "green" ? "bg-[color:var(--success)]/12 text-[color:var(--success)]" : level === "amber" ? "bg-[color:var(--warning)]/12 text-[color:var(--warning)]" : "bg-[color:var(--destructive)]/12 text-[color:var(--destructive)]";
  return <span className={`flex-1 text-center rounded py-2 text-sm font-medium ${cls}`}>{LABEL[level]} {n}</span>;
}
