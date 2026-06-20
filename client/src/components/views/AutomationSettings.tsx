import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bot, Clock, History, Save } from 'lucide-react';
import { toast } from 'sonner';

export function AutomationSettings() {
  const utils = trpc.useUtils();
  const { data: rules = [], isLoading } = trpc.automation.listRules.useQuery();
  const { data: runs = [] } = trpc.automation.listRuns.useQuery({ limit: 8 });
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
    <div className="bg-white border border-stone-200">
      <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-2">
        <Bot size={14} className="text-amber-500" />
        <h2 className="font-serif text-base text-stone-900 flex-1">自动化规则</h2>
        <Badge variant="outline" className="text-[10px]">{rules.filter((r) => r.enabled).length} 启用</Badge>
      </div>

      {isLoading ? (
        <div className="p-6 text-sm text-stone-400 font-mono">加载中...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-stone-200">
          {rules.map((rule) => {
            const config = configFor(rule);
            return (
              <div key={rule.key} className="bg-white p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-stone-900">{rule.label}</span>
                      <Badge variant={rule.enabled ? 'default' : 'outline'} className="text-[10px]">
                        {rule.enabled ? '启用' : '关闭'}
                      </Badge>
                    </div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mt-0.5">
                      {rule.key} · {rule.triggerType}
                    </p>
                  </div>
                  <button
                    onClick={() => updateRule.mutate({ ruleKey: rule.key, enabled: !rule.enabled })}
                    className={`w-10 h-5 rounded-full p-0.5 transition-colors ${rule.enabled ? 'bg-emerald-500' : 'bg-stone-300'}`}
                    title={rule.enabled ? '关闭规则' : '启用规则'}
                  >
                    <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${rule.enabled ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400">有效配置 JSON</div>
                <textarea
                  value={draftFor(rule.key, config)}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [rule.key]: e.target.value }))}
                  className="w-full min-h-[132px] border border-stone-200 bg-stone-50 p-2 text-xs font-mono text-stone-700 outline-none focus:border-stone-400"
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

      <div className="border-t border-stone-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <History size={13} className="text-stone-400" />
          <h3 className="text-[11px] font-mono uppercase tracking-widest text-stone-400">最近运行</h3>
        </div>
        {runs.length === 0 ? (
          <div className="text-sm text-stone-400">暂无运行记录</div>
        ) : (
          <div className="divide-y divide-stone-100 border border-stone-100">
            {runs.map((run) => (
              <div key={run.id} className="px-3 py-2 flex items-center gap-3 text-xs">
                <Badge variant={run.status === 'fired' ? 'default' : 'outline'} className="text-[10px]">
                  {run.status}
                </Badge>
                <span className="font-mono text-stone-700">{run.ruleKey}</span>
                <span className="text-stone-400 flex-1 truncate">{run.detail || run.eventType}</span>
                <span className="flex items-center gap-1 text-stone-400 font-mono">
                  <Clock size={11} />
                  {run.createdAt ? new Date(run.createdAt).toLocaleString('zh-CN') : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
