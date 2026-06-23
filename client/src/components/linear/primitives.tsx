// client/src/components/linear/primitives.tsx
import { cn } from '@/lib/utils';
import { forwardRef, type ReactNode } from 'react';

export const LinearCard = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }
>(function LinearCard({ className, hover, children, ...p }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-[11px] border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]',
        hover && 'transition-[box-shadow,border-color,transform] duration-150 hover:shadow-[0_4px_14px_rgb(0_0_0/0.09)] hover:border-[color:var(--acc-border)]',
        className,
      )}
      {...p}
    >
      {children}
    </div>
  );
});

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground', className)}>{children}</div>;
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.4px]">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusDot({ tone }: { tone: 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? 'var(--success)' : tone === 'amber' ? 'var(--warning)' : 'var(--destructive)';
  return <span className="relative inline-block h-[13px] w-[13px] shrink-0 rounded-full border-2" style={{ borderColor: color }}>
    <span className="absolute inset-[2px] rounded-full" style={{ background: color }} />
  </span>;
}

export function LinearBar({ value, className }: { value: number; className?: string }) {
  return <div className={cn('h-1.5 overflow-hidden rounded bg-[color:var(--secondary)]', className)}>
    <div className="h-full rounded bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>;
}

export function SegToggle<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="flex rounded-[7px] bg-[color:var(--secondary)] p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn('flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium whitespace-nowrap',
            value === o.value ? 'bg-card font-semibold text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]' : 'text-muted-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TypeBadge({ type }: { type: 'NPD' | 'ECO' | 'JDM' | string }) {
  const cls = type === 'NPD'
    ? 'bg-[color:var(--acc-soft)] text-primary border-[color:var(--acc-border)]'
    : type === 'ECO' ? 'bg-secondary text-[color:var(--secondary-foreground)] border-border'
    : 'bg-card text-[color:var(--secondary-foreground)] border-border';
  return <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-[6px] border px-2 text-[11px] font-semibold', cls)}>{type}</span>;
}
