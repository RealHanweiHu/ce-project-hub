// Design: Industrial Precision - stone/amber color system
// ProgressBar: thin horizontal progress indicator

interface ProgressBarProps {
  value: number;
  color?: string;
  height?: string;
  className?: string;
}

export function ProgressBar({ value, color = 'bg-stone-900', height = 'h-1', className = '' }: ProgressBarProps) {
  return (
    <div className={`w-full bg-stone-200 rounded-full overflow-hidden ${height} ${className}`}>
      <div
        className={`${color} ${height} rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
