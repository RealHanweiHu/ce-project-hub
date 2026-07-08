import { type ReactNode, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, Clock, History, Save, Send, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

function PressureMetric({ icon, label, value, tone }: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <div className="rounded-[7px] border border-border bg-secondary/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn('num text-base font-semibold text-foreground', tone === 'warn' && 'text-destructive')}>
        {value}
      </div>
    </div>
  );
}

export function AutomationSettings() {
  const utils = trpc.useUtils();
  const { data: rules = [], isLoading } = trpc.automation.listRules.useQuery();
  const { data: runs = [] } = trpc.automation.listRuns.useQuery({ limit: 8 });
  const { data: schedulerStatus } = trpc.automation.schedulerStatus.useQuery();
  const { data: eventTailerStatus } = trpc.automation.eventTailerStatus.useQuery();
  const { data: pressure } = trpc.automation.pressureMetrics.useQuery({ windowDays: 7 });
  const [open, setOpen] = useState(false);
  // drafts 只存"用户改过"的草稿；未改的 textarea 直接回退到规则当前 config（避免用 effect 同步导致死循环）
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftFor = (ruleKey: string, config: unknown) => drafts[ruleKey] ?? JSON.stringify(config, null, 2);
  const configFor = (rule: (typeof rules)[number]) => rule.effectiveConfig ?? rule.config;
  const tierLabel = (tier: string) => ({
    immediate_action: '即时行动',
    daily_digest: '每日摘要',
    weekly_digest: '每周摘要',
    inbox_only: '仅站内',
    broadcast: '播报',
  }[tier] ?? tier);
  const channelLabel = (channel: string) => channel === 'dingtalk' ? '钉钉' : channel === 'site' ? '站内' : channel;
  const kindLabel = (kind: string) => ({
    task_approval: '任务审批',
    task_rework: '任务返工',
    deliverable_review: '交付物审核',
    deliverable_rework: '交付物返工',
    issue_validation: '问题验证',
    critical_issue: '关键问题',
  }[kind] ?? kind);
  const formatMetric = (value: number | null | undefined, suffix = '') => (
    value == null ? '—' : `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${suffix}`
  );
  const formatHours = (value: number | null | undefined) => {
    if (value == null) return '—';
    if (value < 1) return `${Math.round(value * 60)} 分`;
    return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 小时`;
  };
  const renderHeartbeat = (
    label: string,
    status?: typeof schedulerStatus,
    cursor = false,
  ) => (
    <div>
      <span className="font-medium text-foreground">{label}：</span>
      {status ? (
        <>
          <span>{status.status}</span>
          <span className="mx-2">·</span>
          <span>上次完成 {status.lastFinishedAt ? new Date(status.lastFinishedAt).toLocaleString('zh-CN') : '尚未完成'}</span>
          {status.durationMs != null && <span className="ml-2">耗时 {status.durationMs}ms</span>}
          {cursor && <span className="ml-2">游标 {status.lastCursorId ?? 0}</span>}
          {status.lastError && <span className="ml-2 text-destructive">{status.lastError}</span>}
        </>
      ) : (
        <span>暂无心跳记录</span>
      )}
    </div>
  );

  const updateRule = trpc.automation.updateRule.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.automation.listRules.invalidate(),
        utils.automation.listRuns.invalidate(),
      ]);
      toast.success('自动化规则已更新');
    },
    onError: (err) => toast.error(err.message),
  });

  const saveConfig = (ruleKey: string, config: unknown) => {
    try {
      const parsed = JSON.parse(draftFor(ruleKey, config)) as Record<string, unknown>;
      updateRule.mutate({ ruleKey: ruleKey as (typeof rules)[number]['key'], config: parsed });
    } catch {
      toast.error('配置不是有效 JSON');
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-[11px] border border-border bg-card overflow-hidden">
      <CollapsibleTrigger className="w-full">
        <div className={cn('px-4 py-3 flex items-center gap-2 text-left', open && 'border-b border-border')}>
          <Bot size={14} className="text-primary" />
          <h2 className="text-base font-semibold text-foreground flex-1">自动化规则</h2>
          <Badge variant="outline" className="text-[10px]">{rules.filter((r) => r.enabled).length} 启用</Badge>
          <ChevronDown
            size={15}
            className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">加载中...</div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
              {renderHeartbeat('定时扫描', schedulerStatus)}
              {renderHeartbeat('事件尾随', eventTailerStatus, true)}
            </div>
            {pressure && (
              <div className="border-b border-border px-4 py-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Send size={13} className="text-muted-foreground" />
                  <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    通知压力 · 近 {pressure.windowDays} 天
                  </h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                  <PressureMetric icon={<Send size={13} />} label="即时/人/日" value={formatMetric(pressure.actionItems.perRecipientPerDay)} />
                  <PressureMetric icon={<CheckCircle2 size={13} />} label="闭环率" value={formatMetric(pressure.actionItems.closeRatePct, '%')} />
                  <PressureMetric icon={<AlertTriangle size={13} />} label="升级率" value={formatMetric(pressure.actionItems.escalationRatePct, '%')} tone={pressure.actionItems.escalationRatePct && pressure.actionItems.escalationRatePct > 15 ? 'warn' : undefined} />
                  <PressureMetric icon={<Clock size={13} />} label="24h未处理" value={formatMetric(pressure.actionItems.openOver24h)} tone={pressure.actionItems.openOver24h > 0 ? 'warn' : undefined} />
                  <PressureMetric icon={<Timer size={13} />} label="响应中位" value={formatHours(pressure.actionItems.medianResponseHours)} />
                  <PressureMetric icon={<History size={13} />} label="错误率" value={formatMetric(pressure.runs.errorRatePct, '%')} tone={pressure.runs.errors > 0 ? 'warn' : undefined} />
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-3">
                  <div className="overflow-hidden rounded-[7px] border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-secondary text-[10px] uppercase tracking-widest text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">行动类型</th>
                          <th className="px-3 py-2 text-right font-medium">总数</th>
                          <th className="px-3 py-2 text-right font-medium">未处理</th>
                          <th className="px-3 py-2 text-right font-medium">升级</th>
                          <th className="px-3 py-2 text-right font-medium">中位响应</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {pressure.actionItems.byKind.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-3 text-muted-foreground">暂无行动项数据</td>
                          </tr>
                        ) : (
                          pressure.actionItems.byKind.slice(0, 6).map((row) => (
                            <tr key={row.kind}>
                              <td className="px-3 py-2 text-foreground">{kindLabel(row.kind)}</td>
                              <td className="num px-3 py-2 text-right">{row.total}</td>
                              <td className="num px-3 py-2 text-right">{row.open}</td>
                              <td className="num px-3 py-2 text-right">{row.escalated}</td>
                              <td className="num px-3 py-2 text-right">{formatHours(row.medianResponseHours)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-[7px] border border-border p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">站内通知</span>
                      <span className="num text-foreground">{pressure.notifications.total}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">站内未读</span>
                      <span className="num text-foreground">{pressure.notifications.unread}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">站内/人/日</span>
                      <span className="num text-foreground">{formatMetric(pressure.notifications.perRecipientPerDay)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">已读未动</span>
                      <span className="num text-foreground">{formatMetric(pressure.actionItems.readNoActionRatePct, '%')}</span>
                    </div>
                    <div className="border-t border-border pt-2" />
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">钉钉原生卡</span>
                      <span className="num text-foreground">{pressure.dingtalkCards.total}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">卡片闭环率</span>
                      <span className="num text-foreground">{formatMetric(pressure.dingtalkCards.handleRatePct, '%')}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">卡片失败率</span>
                      <span className="num text-foreground">{formatMetric(pressure.dingtalkCards.failureRatePct, '%')}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border">
              {rules.map((rule) => {
                const config = configFor(rule);
                return (
                  <div key={rule.key} className="bg-card p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{rule.label}</span>
                          <Badge variant={rule.enabled ? 'default' : 'outline'} className="text-[10px]">
                            {rule.enabled ? '启用' : '关闭'}
                          </Badge>
                        </div>
                        <p className="num text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                          {rule.key} · {rule.triggerType}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Badge variant="outline" className="text-[10px]">{tierLabel(rule.deliveryTier)}</Badge>
                          {rule.personalChannels.map((channel) => (
                            <Badge key={channel} variant="outline" className="text-[10px]">{channelLabel(channel)}</Badge>
                          ))}
                          {rule.requiresAction && <Badge variant="default" className="text-[10px]">行动项</Badge>}
                        </div>
                      </div>
                      <button
                        onClick={() => updateRule.mutate({ ruleKey: rule.key, enabled: !rule.enabled })}
                        className={`w-10 h-5 rounded-full p-0.5 transition-colors ${rule.enabled ? 'bg-[color:var(--success)]' : 'bg-secondary'}`}
                        title={rule.enabled ? '关闭规则' : '启用规则'}
                      >
                        <span className={`block w-4 h-4 rounded-full bg-card transition-transform ${rule.enabled ? 'translate-x-5' : ''}`} />
                      </button>
                    </div>

                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">有效配置 JSON</div>
                    <textarea
                      value={draftFor(rule.key, config)}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [rule.key]: e.target.value }))}
                      className="num w-full min-h-[132px] rounded-[7px] border border-border bg-secondary p-2 text-xs text-foreground outline-none focus:border-[color:var(--acc-border)]"
                      spellCheck={false}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs"
                      disabled={updateRule.isPending}
                      onClick={() => saveConfig(rule.key, config)}
                    >
                      <Save size={12} />
                      保存配置
                    </Button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="border-t border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <History size={13} className="text-muted-foreground" />
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">最近运行</h3>
          </div>
          {runs.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无运行记录</div>
          ) : (
            <div className="divide-y divide-border border border-border rounded-[7px] overflow-hidden">
              {runs.map((run) => (
                <div key={run.id} className="px-3 py-2 flex items-center gap-3 text-xs">
                  <Badge variant={run.status === 'fired' ? 'default' : 'outline'} className="text-[10px]">
                    {run.status}
                  </Badge>
                  <span className="num text-foreground">{run.ruleKey}</span>
                  <span className="text-muted-foreground flex-1 truncate">{run.detail || run.eventType}</span>
                  <span className="num flex items-center gap-1 text-muted-foreground">
                    <Clock size={11} />
                    {run.createdAt ? new Date(run.createdAt).toLocaleString('zh-CN') : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
