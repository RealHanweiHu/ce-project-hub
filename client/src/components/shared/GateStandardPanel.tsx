import {
  CheckCircle2,
  FileText,
  LogIn,
  LogOut,
  Paperclip,
  RotateCcw,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { SOPGateStandard } from '@/lib/sop-templates';

interface GateStandardPanelProps {
  standard?: SOPGateStandard;
  compact?: boolean;
  evidenceHint?: boolean;
  className?: string;
}

const sections: Array<{
  key: keyof SOPGateStandard;
  label: string;
  icon: ReactNode;
}> = [
  { key: 'entryCriteria', label: '准入条件', icon: <LogIn size={12} /> },
  { key: 'exitCriteria', label: '准出条件', icon: <LogOut size={12} /> },
  { key: 'requiredDeliverables', label: '必须交付物', icon: <FileText size={12} /> },
  { key: 'responsibleRoles', label: '责任角色', icon: <Users size={12} /> },
  { key: 'evidenceRequirements', label: '证据附件要求', icon: <Paperclip size={12} /> },
  { key: 'exceptionStrategy', label: '未达标处理策略', icon: <RotateCcw size={12} /> },
];

export function GateStandardPanel({
  standard,
  compact = false,
  evidenceHint = false,
  className = '',
}: GateStandardPanelProps) {
  if (!standard) return null;

  return (
    <div className={`${compact ? 'space-y-3' : 'space-y-4'} ${className}`}>
      {sections.map(({ key, label, icon }) => {
        const items = standard[key] || [];
        if (items.length === 0) return null;

        return (
          <div key={key}>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
              {icon}
              <span>{label}</span>
            </div>
            <div className="space-y-1.5">
              {items.map((item, index) => (
                <div key={`${key}-${index}`} className="flex items-start gap-2 text-xs text-foreground leading-relaxed">
                  <CheckCircle2 size={11} className="text-primary shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {evidenceHint && (
        <div className="text-[11px] text-primary bg-[color:var(--acc-soft)] border border-[color:var(--acc-border)] rounded-[7px] px-3 py-2">
          证据附件请上传到对应 Gate 评审任务，评审通过前应完成附件归档。
        </div>
      )}
    </div>
  );
}
