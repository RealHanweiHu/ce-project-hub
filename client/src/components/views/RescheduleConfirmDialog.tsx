import { trpc } from '@/lib/trpc';

export function RescheduleConfirmDialog({
  projectId, taskId, startDate, newDue, onClose, onDone,
}: {
  projectId: string;
  taskId: string;
  startDate: string;
  newDue: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: impact, isLoading } = trpc.tasks.delayImpact.useQuery(
    { projectId, taskId, startDate, dueDate: newDue },
    { staleTime: 0 },
  );
  const reschedule = trpc.tasks.reschedule.useMutation();
  const confirm = async () => {
    await reschedule.mutateAsync({ projectId, taskId, startDate, dueDate: newDue });
    onDone();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30" onClick={onClose}>
      <div className="bg-card border border-border rounded-[11px] w-[440px] max-w-[90vw] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-semibold text-foreground mb-2">改期影响确认</div>
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4">正在计算延期影响...</p>
        ) : !impact ? (
          <p className="text-xs text-muted-foreground py-4">无法计算影响（任务未排期或项目缺失）。</p>
        ) : (
          <div className="space-y-2 text-xs text-foreground">
            <p>将顺延 <b>{impact.shifted.length}</b> 个下游任务（最大 {impact.maxDeltaDays} 天）。</p>
            {impact.gateImpacts.length > 0 && (
              <div className="text-destructive">
                <div className="font-medium">Gate 滑期：</div>
                <ul className="pl-3 list-disc">
                  {impact.gateImpacts.map((g) => <li key={g.taskId}>{g.gateName ?? g.taskId} 滑 {g.deltaDays} 天</li>)}
                </ul>
              </div>
            )}
            {impact.targetBreach && (
              <p className="text-destructive">
                {impact.targetBreach.newlyBreaches ? "原本可按期，改后" : "目标日已超，本次再"}
                破 {impact.targetBreach.slipDays} 天（预计 {impact.targetBreach.newProjectedEnd}）。
              </p>
            )}
            {!impact.hasImpact && <p className="text-muted-foreground">仅顺延下游，不冲击 Gate / 目标日。</p>}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-[7px] border border-border text-muted-foreground hover:bg-secondary">取消</button>
          <button
            onClick={confirm}
            disabled={reschedule.isPending}
            className="text-xs px-3 py-1.5 rounded-[7px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {reschedule.isPending ? "改期中..." : "确认改期"}
          </button>
        </div>
      </div>
    </div>
  );
}
