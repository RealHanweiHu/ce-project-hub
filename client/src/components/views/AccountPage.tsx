import { useEffect, useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { LinearCard, PageHeader, Kicker } from '@/components/linear/primitives';
import { Shield, BookOpen, LogOut } from 'lucide-react';
import { SYSTEM_ROLE_LABELS, isSystemAdminRole, normalizeSystemRole } from '@shared/system-roles';

type View = 'overview' | 'mytasks' | 'projects' | 'calendar' | 'products' | 'requirements' | 'sop' | 'account';

export function AccountPage({ onNavigate, onOpenAdmin }: { onNavigate: (v: View) => void; onOpenAdmin: () => void }) {
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();
  const systemRole = normalizeSystemRole((user as { role?: string } | null)?.role);
  const isAdmin = isSystemAdminRole(systemRole);

  const [name, setName] = useState(user?.name ?? '');
  const [mobile, setMobile] = useState((user as { mobile?: string | null } | null)?.mobile ?? '');
  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: () => { utils.auth.me.invalidate(); toast.success('资料已保存'); },
    onError: (e) => toast.error(e.message || '保存失败'),
  });

  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [cf, setCf] = useState('');
  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => { setCur(''); setNw(''); setCf(''); toast.success('密码已修改'); },
    onError: (e) => toast.error(e.message || '修改失败'),
  });

  const notificationPrefs = trpc.auth.notificationPrefs.useQuery(undefined, {
    enabled: Boolean(user),
    refetchOnWindowFocus: false,
  });
  const [dingtalkEnabled, setDingtalkEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState(22);
  const [quietEnd, setQuietEnd] = useState(8);
  const [maxImmediatePerDay, setMaxImmediatePerDay] = useState(10);
  const saveNotificationPrefs = trpc.auth.updateNotificationPrefs.useMutation({
    onSuccess: () => {
      utils.auth.notificationPrefs.invalidate();
      toast.success('通知偏好已保存');
    },
    onError: (e) => toast.error(e.message || '保存失败'),
  });

  useEffect(() => {
    const prefs = notificationPrefs.data;
    if (!prefs) return;
    const dingtalk = prefs.dingtalk ?? {};
    setDingtalkEnabled(dingtalk.enabled !== false);
    setQuietStart(clampHour(dingtalk.quietHours?.startHour ?? 22));
    setQuietEnd(clampHour(dingtalk.quietHours?.endHour ?? 8));
    setMaxImmediatePerDay(clampImmediateCap(dingtalk.maxImmediatePerDay ?? 10));
  }, [notificationPrefs.data]);

  const roleLabel = SYSTEM_ROLE_LABELS[systemRole];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader title="账户设置" sub="管理你的个人资料、密码与登录" />

      <LinearCard className="p-5">
        <Kicker>个人资料</Kicker>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground">显示名</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="显示名" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground">手机号</span>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="手机号（选填）" />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground">用户名</span>
            <div className="num text-[14px] text-foreground">{user?.username ?? '—'}</div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground">角色</span>
            <div className="text-[14px] text-foreground">{roleLabel}</div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button disabled={!name.trim() || updateProfile.isPending}
            onClick={() => updateProfile.mutate({ name: name.trim(), mobile: mobile.trim() || null })}>
            {updateProfile.isPending ? '保存中…' : '保存资料'}
          </Button>
        </div>
      </LinearCard>

      <LinearCard className="p-5">
        <Kicker>修改密码</Kicker>
        <div className="mt-3 flex flex-col gap-3">
          <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="当前密码" />
          <Input type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder="新密码（至少 6 位）" />
          <Input type="password" value={cf} onChange={(e) => setCf(e.target.value)} placeholder="确认新密码" />
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="outline"
            disabled={!cur || nw.length < 6 || nw !== cf || changePassword.isPending}
            onClick={() => changePassword.mutate({ currentPassword: cur, newPassword: nw })}>
            {changePassword.isPending ? '修改中…' : '修改密码'}
          </Button>
        </div>
        {nw && cf && nw !== cf && <p className="mt-2 text-[12px] text-[color:var(--destructive)]">两次输入的新密码不一致</p>}
      </LinearCard>

      <LinearCard className="p-5">
        <div className="flex items-center justify-between gap-4">
          <Kicker>通知偏好</Kicker>
          <Switch
            checked={dingtalkEnabled}
            onCheckedChange={setDingtalkEnabled}
            disabled={notificationPrefs.isLoading || saveNotificationPrefs.isPending}
            aria-label="钉钉工作通知"
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-[10px] border border-border bg-background/50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-foreground">钉钉工作通知</span>
              <span className="text-[12px] text-muted-foreground">{dingtalkEnabled ? '开启' : '关闭'}</span>
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground">每日即时上限</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={maxImmediatePerDay}
              onChange={(e) => setMaxImmediatePerDay(clampImmediateCap(Number(e.target.value)))}
              disabled={notificationPrefs.isLoading || saveNotificationPrefs.isPending}
            />
          </label>
        </div>
        <div className="mt-4 rounded-[10px] border border-border bg-background/50 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-foreground">静默时段</span>
            <span className="num text-[12px] text-muted-foreground">{formatHour(quietStart)} - {formatHour(quietEnd)}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <HourSlider
              label="开始"
              value={quietStart}
              disabled={notificationPrefs.isLoading || saveNotificationPrefs.isPending}
              onChange={setQuietStart}
            />
            <HourSlider
              label="结束"
              value={quietEnd}
              disabled={notificationPrefs.isLoading || saveNotificationPrefs.isPending}
              onChange={setQuietEnd}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            disabled={notificationPrefs.isLoading || saveNotificationPrefs.isPending}
            onClick={() => saveNotificationPrefs.mutate({
              dingtalk: {
                enabled: dingtalkEnabled,
                quietHours: {
                  startHour: quietStart,
                  endHour: quietEnd,
                  timezone: 'Asia/Shanghai',
                },
                maxImmediatePerDay,
              },
            })}
          >
            {saveNotificationPrefs.isPending ? '保存中…' : '保存通知偏好'}
          </Button>
        </div>
      </LinearCard>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {isAdmin && (
          <button onClick={onOpenAdmin} className="flex items-center gap-3 rounded-[11px] border border-border bg-card p-4 text-left transition-colors hover:border-[color:var(--acc-border)] hover:bg-secondary">
            <Shield size={18} className="text-primary" />
            <div><div className="text-[14px] font-semibold">系统管理</div><div className="text-[12px] text-muted-foreground">成员与权限管理</div></div>
          </button>
        )}
        <button onClick={() => onNavigate('sop')} className="flex items-center gap-3 rounded-[11px] border border-border bg-card p-4 text-left transition-colors hover:border-[color:var(--acc-border)] hover:bg-secondary">
          <BookOpen size={18} className="text-primary" />
          <div><div className="text-[14px] font-semibold">SOP 流程库</div><div className="text-[12px] text-muted-foreground">查看各类项目阶段与任务模板</div></div>
        </button>
      </div>

      <div className="flex justify-start">
        <Button variant="outline" onClick={() => logout()} className="text-[color:var(--destructive)]">
          <LogOut size={15} /> 退出登录
        </Button>
      </div>
    </div>
  );
}

function clampHour(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(23, Math.max(0, Math.round(value)));
}

function clampImmediateCap(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function formatHour(hour: number): string {
  return `${String(clampHour(hour)).padStart(2, '0')}:00`;
}

function HourSlider({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        <span className="num text-[12px] text-foreground">{formatHour(value)}</span>
      </div>
      <Slider
        min={0}
        max={23}
        step={1}
        value={[value]}
        disabled={disabled}
        onValueChange={(next) => onChange(clampHour(next[0] ?? value))}
      />
    </div>
  );
}
