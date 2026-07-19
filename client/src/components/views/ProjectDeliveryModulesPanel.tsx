import { Boxes, CheckCircle2, Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LinearCard } from '@/components/linear/primitives';
import { trpc } from '@/lib/trpc';
import { KeyModulePicker, type DrvKeyModuleChoice } from './key-modules/KeyModulePicker';
import {
  MODULE_TYPE_LABEL,
  MODULE_TYPE_OPTIONS,
  type KeyModuleType,
} from './key-modules/types';

type ModuleSnapshot = {
  moduleNumber?: unknown;
  name?: unknown;
  category?: unknown;
  model?: unknown;
  internalBomHash?: unknown;
  items?: unknown;
};

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function itemCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function requestCustomerConfirmationRef(action: string, required: boolean) {
  if (!required) return undefined;
  const value = window.prompt(
    `JDM/OBT ${action}需要客户书面确认。请输入本次确认引用（邮件主题、文件名、批准单号或链接）：`,
    '',
  );
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized) {
    toast.error('请填写本次客户书面确认引用');
    return null;
  }
  return normalized;
}

export function ProjectDeliveryModulesPanel({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const list = trpc.projectDeliveryModules.list.useQuery({ projectId });
  const refresh = () => utils.projectDeliveryModules.list.invalidate({ projectId });
  const bind = trpc.projectDeliveryModules.bind.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success('产品交付模块已确认');
    },
    onError: error => toast.error(error.message),
  });
  const unbind = trpc.projectDeliveryModules.unbind.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success('产品交付模块已移除');
    },
    onError: error => toast.error(error.message),
  });
  const bindings = new Map(
    (list.data?.bindings ?? []).map(binding => [binding.moduleType, binding]),
  );
  const isReleased = list.data?.isReleased ?? false;
  const requiresCustomerConfirmation = list.data?.requiresCustomerConfirmation ?? false;
  const requiredModuleTypes = new Set(list.data?.requiredModuleTypes ?? []);
  const isChanging = bind.isPending || unbind.isPending;

  return (
    <LinearCard className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
            <Boxes size={17} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">产品交付模块</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
              确认项目最终交付的电池、核心功能与电子硬件模块。这里记录最终选型；模块内部任一部件发生变化，必须先在 PLM 派生新模块编号并完成批准。
            </p>
          </div>
        </div>
        {isReleased ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <Lock size={11} /> 已随产品技术基线冻结
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary">
            <CheckCircle2 size={11} /> 仅可选择已批准模块
          </span>
        )}
      </div>

      {list.isLoading ? (
        <div className="px-5 py-8 text-center text-xs text-muted-foreground">正在读取产品交付模块…</div>
      ) : list.error ? (
        <div className="px-5 py-6 text-sm text-destructive">{list.error.message}</div>
      ) : (
        <div className="grid gap-px bg-border lg:grid-cols-3">
          {MODULE_TYPE_OPTIONS.map(option => {
            const binding = bindings.get(option.value);
            const isRequiredByReuseBaseline = requiredModuleTypes.has(option.value);
            const snapshot = (binding?.moduleSnapshot ?? {}) as ModuleSnapshot;
            const selected: DrvKeyModuleChoice | undefined = binding ? {
              keyModuleId: binding.moduleId,
              moduleNumber: text(snapshot.moduleNumber) || binding.moduleId,
              name: text(snapshot.name) || MODULE_TYPE_LABEL[option.value],
              model: text(snapshot.model) || null,
              category: text(snapshot.category),
            } : undefined;
            const count = itemCount(snapshot.items);

            return (
              <section key={option.value} className="min-w-0 bg-card px-4 py-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-foreground">{option.label}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {binding
                        ? `${count} 个内部部件 · ${isRequiredByReuseBaseline ? 'DRV 建项复用' : '快照已盖章'}`
                        : '尚未确认最终模块'}
                    </div>
                  </div>
                  {binding && canEdit && !isReleased && !isRequiredByReuseBaseline ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={isChanging}
                      aria-label={`移除${option.label}交付模块`}
                      onClick={() => {
                        const customerConfirmationRef = requestCustomerConfirmationRef(
                          `移除${option.label}交付模块`,
                          requiresCustomerConfirmation,
                        );
                        if (customerConfirmationRef === null) return;
                        unbind.mutate({
                          projectId,
                          moduleType: option.value,
                          customerConfirmationRef,
                        });
                      }}
                    >
                      <Trash2 size={13} />
                    </Button>
                  ) : null}
                </div>

                {canEdit && !isReleased ? (
                  <KeyModulePicker
                    moduleType={option.value as KeyModuleType}
                    category={selected?.category ?? ''}
                    value={selected}
                    label={option.label}
                    onChange={choice => {
                      const customerConfirmationRef = requestCustomerConfirmationRef(
                        `${binding ? '更换' : '确认'}${option.label}交付模块`,
                        requiresCustomerConfirmation,
                      );
                      if (customerConfirmationRef === null) return;
                      bind.mutate({
                        projectId,
                        moduleType: option.value,
                        moduleId: choice.keyModuleId,
                        customerConfirmationRef,
                      });
                    }}
                  />
                ) : selected ? (
                  <div className="rounded-md border border-border bg-background px-3 py-2">
                    <div className="truncate text-xs font-semibold text-foreground">
                      {selected.moduleNumber} · {selected.name}
                    </div>
                    <div className="mt-1 truncate text-[10px] text-muted-foreground">
                      {[selected.category, selected.model].filter(Boolean).join(' · ') || '已批准模块'}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                    未绑定
                  </div>
                )}
                {binding?.customerConfirmationRef ? (
                  <div className="mt-2 break-words text-[10px] leading-4 text-muted-foreground">
                    客户确认：{binding.customerConfirmationRef}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </LinearCard>
  );
}
