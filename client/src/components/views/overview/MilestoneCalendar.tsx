import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Calendar, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

const TYPE_CLS: Record<string, string> = {
  phase: "bg-secondary text-[color:var(--secondary-foreground)] border-border",
  gate: "bg-[color:var(--acc-soft)] text-primary border-[color:var(--acc-border)]",
  target: "bg-[color:var(--destructive)]/10 text-[color:var(--destructive)] border-[color:var(--destructive)]/30",
};
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function MilestoneCalendar({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const first = new Date(ym.year, ym.month, 1);
  const daysInMonth = new Date(ym.year, ym.month + 1, 0).getDate();
  const fromDate = ymd(ym.year, ym.month, 1);
  const toDate = ymd(ym.year, ym.month, daysInMonth);

  const { data: rawEvents = [], isLoading } = trpc.projects.calendar.useQuery({ fromDate, toDate });
  const events = useMemo(
    () => rawEvents.filter((event) => event.type === "phase" || event.type === "gate" || event.type === "target"),
    [rawEvents],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, typeof events>();
    for (const e of events) {
      const arr = m.get(e.date) ?? [];
      arr.push(e); m.set(e.date, arr);
    }
    return m;
  }, [events]);

  const leadingBlanks = first.getDay();
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const shift = (delta: number) => setYm(({ year, month }) => {
    const d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  return (
    <div className="rounded-[11px] border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-primary" />
          <h3 className="text-lg text-foreground">里程碑 / Gate 日历</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="text-muted-foreground hover:text-foreground"><ChevronLeft size={16} /></button>
          <span className="text-sm num text-[color:var(--secondary-foreground)]">{ym.year}-{pad(ym.month + 1)}</span>
          <button onClick={() => shift(1)} className="text-muted-foreground hover:text-foreground"><ChevronRight size={16} /></button>
        </div>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center"><Loader2 size={16} className="animate-spin" />加载日历…</div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 mb-1 text-[10px] num text-muted-foreground text-center">
            {["日", "一", "二", "三", "四", "五", "六"].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`b${i}`} />;
              const key = ymd(ym.year, ym.month, day);
              const dayEvents = byDay.get(key) ?? [];
              return (
                <div key={key} className="min-h-[68px] border border-border rounded p-1">
                  <div className="text-[10px] num text-muted-foreground">{day}</div>
                  <div className="space-y-0.5 mt-0.5">
                    {dayEvents.map((e, j) => (
                      <button key={j} onClick={() => onSelectProject(e.projectId)} title={`${e.projectName} · ${e.label}`}
                        className={`block w-full text-left truncate text-[9px] px-1 py-0.5 border rounded ${TYPE_CLS[e.type]}`}>
                        {e.projectName}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
