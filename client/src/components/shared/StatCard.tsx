// Design: Industrial Precision - stone/amber color system
// StatCard: dashboard statistics card

import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, sub, accent = 'bg-stone-100', icon }: StatCardProps) {
  return (
    <div className="bg-white border border-stone-200 p-5 group hover:border-stone-300 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">{label}</span>
        {icon && <span className="text-stone-300">{icon}</span>}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-serif font-semibold text-stone-900 leading-none">{value}</span>
      </div>
      {sub && (
        <div className={`mt-3 inline-flex items-center px-2 py-0.5 ${accent}`}>
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">{sub}</span>
        </div>
      )}
    </div>
  );
}
