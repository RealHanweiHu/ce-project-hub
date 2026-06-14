// AdminPanel: System admin page for managing users, roles, and permissions
// Only accessible to users with role === 'admin'

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLocation } from 'wouter';
import {
  Shield, Users, CheckCircle2, XCircle, ChevronDown,
  Crown, User, AlertTriangle, RefreshCw, Search, UserPlus, KeyRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { AutomationSettings } from '@/components/views/AutomationSettings';

type UserRow = {
  id: number;
  name: string;
  username: string | null;
  email: string | null;
  role: 'admin' | 'user';
  canCreateProject: boolean;
  createdAt: Date | null;
  lastSignedIn: Date | null;
};

export default function AdminPanel() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');

  // Create user dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [newCanCreate, setNewCanCreate] = useState(false);

  // Reset password dialog state
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetUserName, setResetUserName] = useState('');
  const [newPwd, setNewPwd] = useState('');

  // Redirect non-admins
  if (!loading && (!isAuthenticated || user?.role !== 'admin')) {
    navigate('/');
    return null;
  }

  const { data: users, isLoading, refetch } = trpc.admin.listUsers.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === 'admin',
  });

  const setRoleMutation = trpc.admin.setUserRole.useMutation({
    onSuccess: () => { refetch(); toast.success('角色已更新'); },
    onError: (err) => toast.error(err.message),
  });

  const setCanCreateMutation = trpc.admin.setCanCreateProject.useMutation({
    onSuccess: () => { refetch(); toast.success('权限已更新'); },
    onError: (err) => toast.error(err.message),
  });

  const createUserMutation = trpc.auth.createUser.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('用户已创建');
      setCreateOpen(false);
      setNewUsername(''); setNewPassword(''); setNewName('');
      setNewRole('user'); setNewCanCreate(false); setNewEmail('');
    },
    onError: (err) => toast.error(err.message),
  });

  const resetPasswordMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      toast.success('密码已重置');
      setResetOpen(false);
      setNewPwd('');
    },
    onError: (err) => toast.error(err.message),
  });

  const filteredUsers = (users as UserRow[] | undefined)?.filter((u) => {
    const q = search.toLowerCase();
    return (
      (u.name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  }) ?? [];

  const adminCount = (users as UserRow[] | undefined)?.filter((u) => u.role === 'admin').length ?? 0;
  const canCreateCount = (users as UserRow[] | undefined)?.filter((u) => u.canCreateProject).length ?? 0;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-stone-900 text-stone-50 px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="text-stone-400 hover:text-stone-200 transition-colors text-sm font-mono mr-2"
        >
          ← 返回
        </button>
        <Shield size={18} className="text-amber-400" />
        <div>
          <h1 className="font-serif text-lg leading-tight">系统管理</h1>
          <p className="text-[10px] font-mono uppercase tracking-widest text-stone-500">Admin Panel</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Crown size={14} className="text-amber-400" />
          <span className="text-sm text-stone-300">{user?.name}</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white border border-stone-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users size={14} className="text-stone-400" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">总用户数</span>
            </div>
            <div className="text-2xl font-serif text-stone-900">{users?.length ?? '—'}</div>
          </div>
          <div className="bg-white border border-stone-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Shield size={14} className="text-amber-500" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">管理员</span>
            </div>
            <div className="text-2xl font-serif text-stone-900">{adminCount}</div>
          </div>
          <div className="bg-white border border-stone-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={14} className="text-emerald-500" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">可创建项目</span>
            </div>
            <div className="text-2xl font-serif text-stone-900">{canCreateCount}</div>
          </div>
        </div>

        {/* Permission Guide */}
        <div className="bg-amber-50 border border-amber-200 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-800 space-y-1">
              <p className="font-semibold">权限说明</p>
              <p><strong>系统角色（admin/user）</strong>：admin 可访问本管理页面、管理所有用户权限。提升为 admin 时自动获得项目创建权限。</p>
              <p><strong>项目创建权限（canCreateProject）</strong>：控制用户是否可以新建项目。可单独授权给非 admin 用户（如产品经理、项目负责人）。</p>
              <p><strong>项目内角色</strong>：在各项目的「成员」标签页中单独设置（owner/manager/pm/rd_hw 等），与系统角色相互独立。</p>
            </div>
          </div>
        </div>

        <AutomationSettings />

        {/* User Table */}
        <div className="bg-white border border-stone-200">
          <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-3">
            <h2 className="font-serif text-base text-stone-900 flex-1">用户管理</h2>
            <div className="relative w-56">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索姓名或用户名..."
                className="pl-8 h-8 text-sm"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="h-8 w-8 p-0"
            >
              <RefreshCw size={13} />
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-amber-500 hover:bg-amber-600 text-stone-900 text-xs"
              onClick={() => setCreateOpen(true)}
            >
              <UserPlus size={13} />
              新建用户
            </Button>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-stone-400 text-sm font-mono">加载中...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-stone-400 text-sm font-mono">暂无用户</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50">
                  <th className="text-left px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-stone-400">用户</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-stone-400">用户名</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-stone-400">系统角色</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-stone-400">可创建项目</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-stone-400">最近登录</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-stone-400">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-stone-50 hover:bg-stone-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {u.role === 'admin' ? (
                          <Crown size={13} className="text-amber-500 shrink-0" />
                        ) : (
                          <User size={13} className="text-stone-400 shrink-0" />
                        )}
                        <span className="font-medium text-stone-900">{u.name}</span>
                        {u.id === user?.id && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">你</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-stone-500 font-mono text-xs">{u.username || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            disabled={u.id === user?.id}
                          >
                            {u.role === 'admin' ? (
                              <span className="text-amber-600 font-semibold">管理员</span>
                            ) : (
                              <span className="text-stone-500">普通用户</span>
                            )}
                            {u.id !== user?.id && <ChevronDown size={11} />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center">
                          <DropdownMenuItem
                            onClick={() => setRoleMutation.mutate({ userId: u.id, role: 'admin' })}
                            disabled={u.role === 'admin'}
                          >
                            <Crown size={13} className="mr-2 text-amber-500" />
                            提升为管理员
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setRoleMutation.mutate({ userId: u.id, role: 'user' })}
                            disabled={u.role === 'user'}
                            className="text-rose-600"
                          >
                            <User size={13} className="mr-2" />
                            降级为普通用户
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() =>
                          setCanCreateMutation.mutate({
                            userId: u.id,
                            canCreate: !u.canCreateProject,
                          })
                        }
                        className="flex items-center gap-1 mx-auto transition-colors"
                        title={u.canCreateProject ? '点击撤销创建权限' : '点击授予创建权限'}
                      >
                        {u.canCreateProject ? (
                          <CheckCircle2 size={16} className="text-emerald-500 hover:text-emerald-700" />
                        ) : (
                          <XCircle size={16} className="text-stone-300 hover:text-rose-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-xs font-mono">
                      {u.lastSignedIn
                        ? new Date(u.lastSignedIn).toLocaleDateString('zh-CN', {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs px-2 gap-1"
                          onClick={() => {
                            setResetUserId(u.id);
                            setResetUserName(u.name || u.username || '');
                            setNewPwd('');
                            setResetOpen(true);
                          }}
                          disabled={u.id === user?.id}
                          title="重置密码"
                        >
                          <KeyRound size={11} />
                          重置密码
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Role Reference Table */}
        <div className="bg-white border border-stone-200 p-4">
          <h3 className="font-serif text-sm text-stone-900 mb-3 flex items-center gap-2">
            <Shield size={13} className="text-amber-500" />
            项目内角色权限对照表
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-100">
                  <th className="text-left py-2 pr-4 text-stone-500 font-mono uppercase tracking-wider">角色</th>
                  <th className="text-center py-2 px-2 text-stone-500 font-mono uppercase tracking-wider">查看</th>
                  <th className="text-center py-2 px-2 text-stone-500 font-mono uppercase tracking-wider">编辑任务</th>
                  <th className="text-center py-2 px-2 text-stone-500 font-mono uppercase tracking-wider">问题/变更</th>
                  <th className="text-center py-2 px-2 text-stone-500 font-mono uppercase tracking-wider">Gate评审</th>
                  <th className="text-center py-2 px-2 text-stone-500 font-mono uppercase tracking-wider">项目信息</th>
                  <th className="text-center py-2 px-2 text-stone-500 font-mono uppercase tracking-wider">成员管理</th>
                  <th className="text-center py-2 px-2 text-stone-500 font-mono uppercase tracking-wider">删除项目</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {[
                  { role: 'owner', label: 'Owner（创建者）', perms: [true, true, true, true, true, true, true] },
                  { role: 'manager', label: '管理层', perms: [true, true, true, true, true, true, false] },
                  { role: 'pm', label: '产品经理 PM', perms: [true, true, true, true, true, true, false] },
                  { role: 'rd_hw', label: '硬件研发 EE', perms: [true, true, true, false, false, false, false] },
                  { role: 'rd_sw', label: '软件研发 SW', perms: [true, true, true, false, false, false, false] },
                  { role: 'rd_mech', label: '结构研发 ME', perms: [true, true, true, false, false, false, false] },
                  { role: 'qa', label: '质量工程师 QA', perms: [true, true, true, true, false, false, false] },
                  { role: 'scm', label: '供应链 SCM', perms: [true, true, false, false, false, false, false] },
                  { role: 'viewer', label: '只读访客', perms: [true, false, false, false, false, false, false] },
                ].map(({ role, label, perms }) => (
                  <tr key={role} className="hover:bg-stone-50/50">
                    <td className="py-2 pr-4 font-medium text-stone-700">{label}</td>
                    {perms.map((p, i) => (
                      <td key={i} className="py-2 px-2 text-center">
                        {p ? (
                          <CheckCircle2 size={13} className="text-emerald-500 mx-auto" />
                        ) : (
                          <XCircle size={13} className="text-stone-200 mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif flex items-center gap-2">
              <UserPlus size={16} className="text-amber-500" />
              新建用户
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-700">用户名 <span className="text-rose-500">*</span></Label>
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="仅字母、数字、下划线、点、横线"
                className="text-sm"
              />
              <p className="text-xs text-stone-400">用于登录，创建后不可修改</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-700">显示名称 <span className="text-rose-500">*</span></Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例：张三"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-700">邮箱</Label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="example@company.com"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-700">初始密码 <span className="text-rose-500">*</span></Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少6位"
                className="text-sm"
              />
            </div>
            <div className="flex gap-4">
              <div className="space-y-1.5 flex-1">
                <Label className="text-sm text-stone-700">系统角色</Label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
                  className="w-full h-9 border border-stone-200 rounded-md px-3 text-sm bg-white"
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-stone-700">可创建项目</Label>
                <div className="flex items-center h-9">
                  <input
                    type="checkbox"
                    checked={newCanCreate}
                    onChange={(e) => setNewCanCreate(e.target.checked)}
                    className="w-4 h-4 accent-amber-500"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="text-sm">取消</Button>
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-stone-900 text-sm"
              disabled={createUserMutation.isPending}
              onClick={() => {
                if (!newUsername.trim() || !newPassword || !newName.trim()) {
                  toast.error('请填写所必填项（显示名称和用户名不能为空）');
                  return;
                }
                createUserMutation.mutate({
                  username: newUsername.trim(),
                  password: newPassword,
                  name: newName.trim(),
                  email: newEmail.trim() || undefined,
                  role: newRole,
                  canCreateProject: newCanCreate,
                });
              }}
            >
              {createUserMutation.isPending ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif flex items-center gap-2">
              <KeyRound size={16} className="text-amber-500" />
              重置密码
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-stone-600">
              正在重置 <strong>{resetUserName}</strong> 的密码
            </p>
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-700">新密码 <span className="text-rose-500">*</span></Label>
              <Input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="至少6位"
                className="text-sm"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} className="text-sm">取消</Button>
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-stone-900 text-sm"
              disabled={resetPasswordMutation.isPending}
              onClick={() => {
                if (!newPwd || newPwd.length < 6) {
                  toast.error('密码至少6位');
                  return;
                }
                if (resetUserId !== null) {
                  resetPasswordMutation.mutate({ userId: resetUserId, newPassword: newPwd });
                }
              }}
            >
              {resetPasswordMutation.isPending ? '重置中...' : '确认重置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
