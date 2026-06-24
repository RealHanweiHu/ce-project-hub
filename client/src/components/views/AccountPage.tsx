import { useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LinearCard, PageHeader, Kicker } from '@/components/linear/primitives';
import { Shield, BookOpen, LogOut } from 'lucide-react';

type View = 'overview' | 'mytasks' | 'projects' | 'calendar' | 'products' | 'requirements' | 'sop' | 'account';

export function AccountPage({ onNavigate, onOpenAdmin }: { onNavigate: (v: View) => void; onOpenAdmin: () => void }) {
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();
  const isAdmin = (user as { role?: string } | null)?.role === 'admin';

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

  const roleLabel = isAdmin ? '管理员' : '成员';

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
