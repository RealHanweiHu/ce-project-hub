import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Bot, ChevronDown, Clock, History, Save } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function AutomationSettings() {
  const utils = trpc.useUtils();
  const { data: rules = [], isLoading } = trpc.automation.listRules.useQuery();
  const { data: runs = [] } = trpc.automation.listRuns.useQuery({ limit: 8 });
  const [open, setOpen] = useState(false);
  // drafts 只存"用户改过"的草稿；未改的 textarea 直接回退到规则当前 config（避免用 effect 同步导致死循环）
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftFor = (ruleKey: string, config: unknown) => drafts[ruleKey] ?? JSON.stringify(config, null, 2);
  const configFor = (rule: (typeof rules)[number]) => rule.effectiveConfig ?? rule.config;

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
