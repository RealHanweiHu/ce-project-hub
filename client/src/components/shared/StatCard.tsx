// StatCard: dashboard statistics card (Linear style)

import { ReactNode } from 'react';
import { LinearCard } from '@/components/linear/primitives';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, sub, accent = 'bg-secondary', icon }: StatCardProps) {
  return (
    <LinearCard hover className="p-4 sm:p-5 group">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">{icon}</span>}
      </div>
      <div className="flex items-end gap-2">
        <span className="num text-3xl font-semibold text-foreground leading-none">{value}</span>
      </div>
      {sub && (
        <div className={`mt-3 inline-flex items-center rounded px-2 py-0.5 ${accent}`}>
          <span className="num text-[10px] uppercase tracking-wider text-muted-foreground">{sub}</span>
        </div>
      )}
    </LinearCard>
  );
}
