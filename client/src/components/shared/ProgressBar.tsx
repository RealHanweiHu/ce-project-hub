// ProgressBar: thin horizontal progress indicator (Linear style)

interface ProgressBarProps {
  value: number;
  color?: string;
  height?: string;
  className?: string;
}

export function ProgressBar({ value, color = 'bg-primary', height = 'h-1', className = '' }: ProgressBarProps) {
  return (
    <div className={`w-full bg-secondary rounded-full overflow-hidden ${height} ${className}`}>
      <div
        className={`${color} ${height} rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
