// AdminPanel: system page for managing users, roles, and permissions.

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLocation } from 'wouter';
import {
  Shield, Users, CheckCircle2, XCircle, ChevronDown,
  Crown, User, AlertTriangle, RefreshCw, Search, UserPlus, KeyRound, Trash2, FileCheck2, Bot,
  Home as HomeIcon,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { AutomationSettings } from '@/components/views/AutomationSettings';
import {
  SYSTEM_ROLE_LABELS,
  SYSTEM_ROLES,
  type SystemRole,
  isSystemAdminRole,
  systemRoleCanCreateProject,
} from '@shared/system-roles';

type UserRow = {
  id: number;
  name: string;
  username: string | null;
  email: string | null;
  mobile: string | null;
  role: SystemRole;
  canCreateProject: boolean;
  createdAt: Date | null;
  lastSignedIn: Date | null;
};

type ApprovalConfigRow = {
  id: number;
  businessType: string;
  processCode: string | null;
  enabled: boolean;
  defaultDeptId: number | null;
};

const APPROVAL_CONFIG_TYPES = [
  { key: 'mp_release', label: 'MP Release' },
  { key: 'task_approval', label: '任务审批' },
  { key: 'deliverable_review', label: '交付物审核' },
  { key: 'issue_validation', label: '问题验证' },
] as const;

type ApprovalConfigType = typeof APPROVAL_CONFIG_TYPES[number]['key'];
type ApprovalDraft = { enabled: boolean; processCode: string; defaultDeptId: string };

type DingtalkStatus = {
  app: { configured: boolean; corpIdConfigured: boolean };
  workNotice: { ready: boolean; agentConfigured: boolean };
  approvals: {
    ready: boolean;
    enabled: number;
    total: number;
    configs: Array<{ businessType: string; enabled: boolean; hasProcessCode: boolean }>;
  };
  interactiveCard: {
    ready: boolean;
    enabled: boolean;
    templateConfigured: boolean;
    templateId: string | null;
    robotCodeConfigured: boolean;
    robotCodeMasked: string | null;
    appBaseUrlConfigured: boolean;
    callbackReady: boolean;
    callbackRouteConfigured: boolean;
    callbackRouteKey: string | null;
    callbackSecretConfigured: boolean;
    deliveryApi: string;
  };
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
  const [newMobile, setNewMobile] = useState('');
  const [newRole, setNewRole] = useState<SystemRole>('member');
  const [newCanCreate, setNewCanCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  // Reset password dialog state
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetUserName, setResetUserName] = useState('');
  const [newPwd, setNewPwd] = useState('');

  // 无权限：路由层先验证（管理接口均有 enabled 门控，不会先请求再跳转），
  // 显示明确页面并提供返回工作台入口（P1-管理后台）
  if (!loading && (!isAuthenticated || !isSystemAdminRole(user?.role))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Shield className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mb-2 text-xl font-semibold text-foreground">没有访问权限</h1>
          <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
            管理后台仅系统管理员可用。如需相关权限，请联系管理员开通。
          </p>
          <Button size="lg" className="min-h-11" onClick={() => navigate('/')}>
            <HomeIcon className="h-4 w-4" aria-hidden="true" />
            回到工作台
          </Button>
        </div>
      </div>
    );
  }

  const { data: users, isLoading, refetch } = trpc.admin.listUsers.useQuery(undefined, {
    enabled: isAuthenticated && isSystemAdminRole(user?.role),
  });

  const setRoleMutation = trpc.admin.setUserRole.useMutation({
    onSuccess: () => { refetch(); toast.success('角色已更新'); },
    onError: (err) => toast.error(err.message),
  });

  const setCanCreateMutation = trpc.admin.setCanCreateProject.useMutation({
    onSuccess: () => { refetch(); toast.success('权限已更新'); },
    onError: (err) => toast.error(err.message),
  });

  const createUserMutation = trpc.admin.createUser.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('用户已创建');
      setCreateOpen(false);
      setNewUsername(''); setNewPassword(''); setNewName('');
      setNewRole('member'); setNewCanCreate(false); setNewEmail(''); setNewMobile('');
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteUserMutation = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('用户已删除');
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const setMobileMutation = trpc.auth.setUserMobile.useMutation({
    onSuccess: () => { refetch(); toast.success('手机号已更新'); },
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

  const { data: calExceptions, refetch: refetchCal } = trpc.admin.calendarExceptions.list.useQuery(undefined, {
    enabled: isAuthenticated && isSystemAdminRole(user?.role),
  });
  const upsertCal = trpc.admin.calendarExceptions.upsert.useMutation({ onSuccess: () => { void refetchCal(); } });
  const removeCal = trpc.admin.calendarExceptions.remove.useMutation({ onSuccess: () => { void refetchCal(); } });
  const [calForm, setCalForm] = useState({ date: '', type: 'holiday' as 'holiday' | 'makeup_workday', name: '' });

  const { data: approvalConfigs, refetch: refetchApprovalConfigs } = trpc.admin.approvalConfigs.list.useQuery(undefined, {
    enabled: isAuthenticated && isSystemAdminRole(user?.role),
  });
  const { data: dingtalkStatus, refetch: refetchDingtalkStatus } = trpc.admin.dingtalkStatus.useQuery(undefined, {
    enabled: isAuthenticated && isSystemAdminRole(user?.role),
  });
  const [approvalDrafts, setApprovalDrafts] = useState<Record<ApprovalConfigType, ApprovalDraft>>(() => Object.fromEntries(
    APPROVAL_CONFIG_TYPES.map((item) => [item.key, { enabled: false, processCode: '', defaultDeptId: '' }]),
  ) as Record<ApprovalConfigType, ApprovalDraft>);
  useEffect(() => {
    const rows = approvalConfigs as ApprovalConfigRow[] | undefined;
    if (!rows) return;
    setApprovalDrafts(Object.fromEntries(APPROVAL_CONFIG_TYPES.map((item) => {
      const config = rows.find((row) => row.businessType === item.key);
      return [item.key, {
        enabled: config?.enabled ?? false,
        processCode: config?.processCode ?? '',
        defaultDeptId: config?.defaultDeptId == null ? '' : String(config.defaultDeptId),
      }];
    })) as Record<ApprovalConfigType, ApprovalDraft>);
  }, [approvalConfigs]);
  const saveApprovalConfig = trpc.admin.approvalConfigs.upsert.useMutation({
    onSuccess: () => {
      void refetchApprovalConfigs();
      void refetchDingtalkStatus();
      toast.success('审批配置已更新');
    },
    onError: (err) => toast.error(err.message),
  });
  const enabledApprovalCount = APPROVAL_CONFIG_TYPES.filter((item) => approvalDrafts[item.key]?.enabled).length;
  const setApprovalDraft = (key: ApprovalConfigType, patch: Partial<ApprovalDraft>) => {
    setApprovalDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const filteredUsers = (users as UserRow[] | undefined)?.filter((u) => {
    const q = search.toLowerCase();
    return (
      (u.name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  }) ?? [];

  const adminCount = (users as UserRow[] | undefined)?.filter((u) => isSystemAdminRole(u.role)).length ?? 0;
  const canCreateCount = (users as UserRow[] | undefined)?.filter((u) => systemRoleCanCreateProject(u)).length ?? 0;
  const ding = dingtalkStatus as DingtalkStatus | undefined;
  const visibleApprovalStatuses = APPROVAL_CONFIG_TYPES.map((item) => {
    const config = ding?.approvals.configs.find((row) => row.businessType === item.key);
    return { ...item, ready: !!config?.enabled && !!config?.hasProcessCode };
  });
  const visibleApprovalReadyCount = visibleApprovalStatuses.filter((item) => item.ready).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-foreground text-background px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="text-muted-foreground hover:text-background transition-colors text-sm mr-2"
        >
          ← 返回
        </button>
        <Shield size={18} className="text-primary" />
        <div>
          <h1 className="text-lg leading-tight">系统管理</h1>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Admin Panel</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Crown size={14} className="text-primary" />
          <span className="text-sm text-background/80">{user?.name}</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users size={14} className="text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">总用户数</span>
            </div>
            <div className="text-2xl text-foreground">{users?.length ?? '—'}</div>
          </div>
          <div className="bg-card border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <Shield size={14} className="text-primary" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">拥有者/管理员</span>
            </div>
            <div className="text-2xl text-foreground">{adminCount}</div>
          </div>
          <div className="bg-card border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={14} className="text-[color:var(--success)]" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">可创建项目</span>
            </div>
            <div className="text-2xl text-foreground">{canCreateCount}</div>
          </div>
        </div>

        {/* Permission Guide */}
        <div className="bg-[color:var(--warning-soft)] border border-[color:var(--warning)] p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-[color:var(--warning)] mt-0.5 shrink-0" />
            <div className="text-sm text-[color:var(--warning)] space-y-1">
              <p className="font-semibold">权限说明</p>
              <p><strong>系统角色</strong>：只管理系统边界，分为 owner/admin/member/external/viewer；业务分工放在项目内角色。</p>
              <p><strong>项目创建权限（canCreateProject）</strong>：控制用户是否可以新建项目。可单独授权给非 admin 用户（如产品经理、项目负责人）。</p>
              <p><strong>项目内角色</strong>：在各项目的「成员」标签页中单独设置（owner/manager/pm/rd_hw 等），与系统角色相互独立。</p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Bot size={14} className="text-primary" />
            <h2 className="text-base text-foreground flex-1">钉钉通知状态</h2>
            <Badge variant={ding?.interactiveCard.callbackReady ? 'default' : ding?.interactiveCard.ready ? 'outline' : 'secondary'} className="text-[10px]">
              {ding?.interactiveCard.callbackReady ? '原生回调可用' : ding?.interactiveCard.ready ? '卡片可发送' : '待配置'}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchDingtalkStatus()}
              className="h-8 w-8 p-0"
              title="刷新状态"
            >
              <RefreshCw size={13} />
            </Button>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="border border-border bg-secondary/40 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm text-foreground">工作通知</span>
                <Badge variant={ding?.workNotice.ready ? 'default' : 'secondary'} className="text-[10px]">
                  {ding?.workNotice.ready ? '可用' : '缺配置'}
                </Badge>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>应用凭证：{ding?.app.configured ? '已配置' : '缺失'}</p>
                <p>AgentId：{ding?.workNotice.agentConfigured ? '已配置' : '缺失'}</p>
                <p>CorpId：{ding?.app.corpIdConfigured ? '已配置' : '缺失'}</p>
              </div>
            </div>

            <div className="border border-border bg-secondary/40 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm text-foreground">OA 审批</span>
                <Badge variant={ding?.approvals.ready ? 'default' : 'secondary'} className="text-[10px]">
                  {ding ? `${visibleApprovalReadyCount}/${APPROVAL_CONFIG_TYPES.length}` : '—'}
                </Badge>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {visibleApprovalStatuses.map((item) => {
                  return (
                    <p key={item.key} className="flex items-center justify-between gap-3">
                      <span>{item.label}</span>
                      <span className={item.ready ? 'text-[color:var(--success)]' : 'text-muted-foreground'}>
                        {item.ready ? '已启用' : '未启用'}
                      </span>
                    </p>
                  );
                })}
              </div>
            </div>

            <div className="border border-border bg-secondary/40 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm text-foreground">原生互动卡片</span>
                <Badge variant={ding?.interactiveCard.callbackReady ? 'default' : ding?.interactiveCard.ready ? 'outline' : 'secondary'} className="text-[10px]">
                  {ding?.interactiveCard.callbackReady ? '回调可用' : ding?.interactiveCard.ready ? '可发送' : '缺配置'}
                </Badge>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>开关：{ding?.interactiveCard.enabled ? '已开启' : '已关闭'}</p>
                <p className="break-all">模板：{ding?.interactiveCard.templateId || '未配置'}</p>
                <p>机器人：{ding?.interactiveCard.robotCodeConfigured ? ding.interactiveCard.robotCodeMasked : '未配置'}</p>
                <p>站点地址：{ding?.interactiveCard.appBaseUrlConfigured ? '已配置' : '缺失'}</p>
                <p className="break-all">回调路由：{ding?.interactiveCard.callbackRouteKey || '未配置'}</p>
                <p>回调密钥：{ding?.interactiveCard.callbackSecretConfigured ? '已配置' : '未配置'}</p>
                <p>入口：{ding?.interactiveCard.deliveryApi || '—'}</p>
              </div>
            </div>
          </div>
        </div>

        <AutomationSettings />

        <div className="bg-card border border-border">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <FileCheck2 size={14} className="text-primary" />
            <h2 className="text-base text-foreground flex-1">钉钉审批配置</h2>
            <Badge variant={enabledApprovalCount > 0 ? 'default' : 'secondary'} className="text-[10px]">
              {enabledApprovalCount > 0 ? `${enabledApprovalCount} 类已启用` : '未启用'}
            </Badge>
          </div>
          <div className="p-4 space-y-3">
            {APPROVAL_CONFIG_TYPES.map((item) => {
              const draft = approvalDrafts[item.key];
              return (
                <div key={item.key} className="grid grid-cols-1 md:grid-cols-[140px_1fr_150px_auto] gap-3 items-end">
                  <div>
                    <Label className="text-xs text-muted-foreground">业务类型</Label>
                    <div className="mt-1 h-9 flex items-center text-sm text-foreground">{item.label}</div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">processCode</Label>
                    <Input
                      value={draft.processCode}
                      onChange={(e) => setApprovalDraft(item.key, { processCode: e.target.value })}
                      placeholder="PROC-..."
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">默认部门 ID</Label>
                    <Input
                      value={draft.defaultDeptId}
                      onChange={(e) => setApprovalDraft(item.key, { defaultDeptId: e.target.value.replace(/[^\d-]/g, '') })}
                      placeholder="-1"
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setApprovalDraft(item.key, { enabled: !draft.enabled })}
                      className={`h-9 px-3 text-xs border transition-colors ${draft.enabled ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-secondary-foreground border-border'}`}
                    >
                      {draft.enabled ? '停用' : '启用'}
                    </button>
                    <Button
                      size="sm"
                      disabled={saveApprovalConfig.isPending}
                      onClick={() => saveApprovalConfig.mutate({
                        businessType: item.key,
                        processCode: draft.processCode.trim() || null,
                        enabled: draft.enabled,
                        defaultDeptId: draft.defaultDeptId.trim() ? Number(draft.defaultDeptId) : null,
                      })}
                      className="h-9 text-xs"
                    >
                      保存
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* User Table */}
        <div className="bg-card border border-border">
          <div className="px-4 py-3 border-b border-border flex items-center gap-3">
            <h2 className="text-base text-foreground flex-1">用户管理</h2>
            <div className="relative w-56">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
              className="h-8 gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
              onClick={() => setCreateOpen(true)}
            >
              <UserPlus size={13} />
              新建用户
            </Button>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">加载中...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">暂无用户</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary">
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">用户</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">用户名</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">手机号(钉钉)</th>
                  <th className="text-center px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">系统角色</th>
                  <th className="text-center px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">可创建项目</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">最近登录</th>
                  <th className="text-center px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const effectiveCanCreate = systemRoleCanCreateProject(u);
                  const isSystemAdmin = isSystemAdminRole(u.role);
                  const cannotDelete = u.id === user?.id || (isSystemAdmin && adminCount <= 1);
                  return (
                  <tr key={u.id} className="border-b border-border hover:bg-secondary/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isSystemAdmin ? (
                          <Crown size={13} className="text-primary shrink-0" />
                        ) : (
                          <User size={13} className="text-muted-foreground shrink-0" />
                        )}
                        <span className="font-medium text-foreground">{u.name}</span>
                        {u.id === user?.id && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">你</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{u.username || '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      <button
                        className={`hover:underline ${u.mobile ? 'text-foreground' : 'text-muted-foreground'}`}
                        title="点击设置/修改手机号(用于钉钉日程映射)"
                        onClick={() => {
                          const v = window.prompt(`设置 ${u.name} 的手机号(与钉钉一致):`, u.mobile || '');
                          if (v === null) return;
                          setMobileMutation.mutate({ userId: u.id, mobile: v.trim() });
                        }}
                      >
                        {u.mobile || '＋ 设置'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            disabled={u.id === user?.id}
                          >
                            <span className={isSystemAdmin ? "text-primary font-semibold" : "text-muted-foreground"}>
                              {SYSTEM_ROLE_LABELS[u.role]}
                            </span>
                            {u.id !== user?.id && <ChevronDown size={11} />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center">
                          {SYSTEM_ROLES.map((role) => (
                            <DropdownMenuItem
                              key={role}
                              onClick={() => setRoleMutation.mutate({ userId: u.id, role })}
                              disabled={u.role === role}
                              className={!isSystemAdminRole(role) ? "text-muted-foreground" : undefined}
                            >
                              {isSystemAdminRole(role) ? <Crown size={13} className="mr-2 text-primary" /> : <User size={13} className="mr-2" />}
                              {SYSTEM_ROLE_LABELS[role]}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() =>
                          setCanCreateMutation.mutate({
                            userId: u.id,
                            canCreate: !effectiveCanCreate,
                          })
                        }
                        disabled={isSystemAdmin || u.role === 'external' || u.role === 'viewer'}
                        className="flex items-center gap-1 mx-auto transition-colors"
                        title={isSystemAdmin ? '拥有者/管理员默认拥有项目创建权限' : u.role === 'external' || u.role === 'viewer' ? '外部/只读账号不能创建项目' : effectiveCanCreate ? '点击撤销创建权限' : '点击授予创建权限'}
                      >
                        {effectiveCanCreate ? (
                          <CheckCircle2 size={16} className="text-[color:var(--success)] hover:opacity-80" />
                        ) : (
                          <XCircle size={16} className="text-muted-foreground hover:text-[color:var(--destructive)]" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
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
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs px-2 gap-1 text-[color:var(--destructive)] hover:text-[color:var(--destructive)]"
                          onClick={() => setDeleteTarget(u)}
                          disabled={cannotDelete || deleteUserMutation.isPending}
                          title={
                            u.id === user?.id
                              ? '不能删除自己的账号'
                              : isSystemAdmin && adminCount <= 1
                                ? '不能删除最后一个拥有者/管理员'
                                : '删除用户'
                          }
                        >
                          <Trash2 size={11} />
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Calendar Exceptions Table */}
        <div className="bg-card border border-border p-4">
          <h2 className="text-base text-foreground mb-1">工作日历例外（节假日 / 调休）</h2>
          <p className="text-xs text-muted-foreground mb-3">默认周一~六工作、周日休息。此处登记法定假（休）与调休上班日（工）。</p>
          <div className="flex gap-2 mb-3 items-end flex-wrap">
            <input
              type="date"
              value={calForm.date}
              onChange={(e) => setCalForm({ ...calForm, date: e.target.value })}
              className="border border-border rounded px-2 py-1 text-sm"
            />
            <select
              value={calForm.type}
              onChange={(e) => setCalForm({ ...calForm, type: e.target.value as 'holiday' | 'makeup_workday' })}
              className="border border-border rounded px-2 py-1 text-sm"
            >
              <option value="holiday">法定假（休）</option>
              <option value="makeup_workday">调休上班（工）</option>
            </select>
            <input
              placeholder="名称"
              value={calForm.name}
              onChange={(e) => setCalForm({ ...calForm, name: e.target.value })}
              className="border border-border rounded px-2 py-1 text-sm"
            />
            <button
              disabled={!calForm.date || upsertCal.isPending}
              onClick={() => upsertCal.mutate(calForm)}
              className="bg-primary text-primary-foreground text-sm rounded px-3 py-1 disabled:opacity-40"
            >
              添加/更新
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-1">日期</th>
                <th>类型</th>
                <th>名称</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(calExceptions ?? []).map((row) => (
                <tr key={row.date} className="border-b border-border">
                  <td className="py-1">{row.date}</td>
                  <td>{row.type === 'holiday' ? '法定假' : '调休上班'}</td>
                  <td>{row.name}</td>
                  <td className="text-right">
                    <button
                      onClick={() => removeCal.mutate({ date: row.date })}
                      className="text-[color:var(--destructive)] text-xs"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Role Reference Table */}
        <div className="bg-card border border-border p-4">
          <h3 className="text-sm text-foreground mb-3 flex items-center gap-2">
            <Shield size={13} className="text-primary" />
            项目内角色权限对照表
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-muted-foreground uppercase tracking-wider">角色</th>
                  <th className="text-center py-2 px-2 text-muted-foreground uppercase tracking-wider">查看</th>
                  <th className="text-center py-2 px-2 text-muted-foreground uppercase tracking-wider">编辑任务</th>
                  <th className="text-center py-2 px-2 text-muted-foreground uppercase tracking-wider">问题/变更</th>
                  <th className="text-center py-2 px-2 text-muted-foreground uppercase tracking-wider">Gate评审</th>
                  <th className="text-center py-2 px-2 text-muted-foreground uppercase tracking-wider">项目信息</th>
                  <th className="text-center py-2 px-2 text-muted-foreground uppercase tracking-wider">成员管理</th>
                  <th className="text-center py-2 px-2 text-muted-foreground uppercase tracking-wider">删除项目</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { role: 'owner', label: 'Owner（创建者）', perms: [true, true, true, true, true, true, true] },
                  { role: 'manager', label: '管理层', perms: [true, true, true, true, true, true, false] },
                  { role: 'project_manager', label: '项目经理 / PMO', perms: [true, true, true, false, true, true, false] },
                  { role: 'pm', label: '产品经理 PM', perms: [true, false, true, false, false, false, false] },
                  { role: 'rd_hw', label: '硬件研发 EE', perms: [true, true, true, false, false, false, false] },
                  { role: 'rd_sw', label: '软件研发 SW', perms: [true, true, true, false, false, false, false] },
                  { role: 'rd_mech', label: '结构研发 ME', perms: [true, true, true, false, false, false, false] },
                  { role: 'qa', label: '质量工程师 QA', perms: [true, false, true, false, false, false, false] },
                  { role: 'scm', label: '供应链 SCM', perms: [true, false, true, false, false, false, false] },
                  { role: 'external_customer', label: '外部客户', perms: [true, false, false, false, false, false, false] },
                  { role: 'supplier', label: '外部供应商', perms: [true, false, false, false, false, false, false] },
                  { role: 'viewer', label: '只读访客', perms: [true, false, false, false, false, false, false] },
                ].map(({ role, label, perms }) => (
                  <tr key={role} className="hover:bg-secondary/50">
                    <td className="py-2 pr-4 font-medium text-foreground">{label}</td>
                    {perms.map((p, i) => (
                      <td key={i} className="py-2 px-2 text-center">
                        {p ? (
                          <CheckCircle2 size={13} className="text-[color:var(--success)] mx-auto" />
                        ) : (
                          <XCircle size={13} className="text-muted-foreground mx-auto" />
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
            <DialogTitle className="flex items-center gap-2">
              <UserPlus size={16} className="text-primary" />
              新建用户
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">用户名 <span className="text-[color:var(--destructive)]">*</span></Label>
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="仅字母、数字、下划线、点、横线"
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">用于登录，创建后不可修改</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">显示名称 <span className="text-[color:var(--destructive)]">*</span></Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例：张三"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">邮箱</Label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="example@company.com"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">手机号（钉钉日程）</Label>
              <Input
                value={newMobile}
                onChange={(e) => setNewMobile(e.target.value)}
                placeholder="与钉钉一致，留空则不建日程"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">初始密码 <span className="text-[color:var(--destructive)]">*</span></Label>
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
                <Label className="text-sm text-foreground">系统角色</Label>
                <select
                  value={newRole}
                  onChange={(e) => {
                    const role = e.target.value as SystemRole;
                    setNewRole(role);
                    if (isSystemAdminRole(role)) setNewCanCreate(true);
                    if (role === 'external' || role === 'viewer') setNewCanCreate(false);
                  }}
                  className="w-full h-9 border border-border rounded-md px-3 text-sm bg-card"
                >
                  {SYSTEM_ROLES.map((role) => (
                    <option key={role} value={role}>{SYSTEM_ROLE_LABELS[role]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-foreground">可创建项目</Label>
                <div className="flex items-center h-9">
                  <input
                    type="checkbox"
                    checked={systemRoleCanCreateProject({ role: newRole, canCreateProject: newCanCreate })}
                    disabled={isSystemAdminRole(newRole) || newRole === 'external' || newRole === 'viewer'}
                    onChange={(e) => setNewCanCreate(e.target.checked)}
                    className="w-4 h-4 accent-[var(--primary)]"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="text-sm">取消</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
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
                  mobile: newMobile.trim() || undefined,
                  role: newRole,
                  canCreateProject: systemRoleCanCreateProject({ role: newRole, canCreateProject: newCanCreate }),
                });
              }}
            >
              {createUserMutation.isPending ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-[color:var(--destructive)]">
              <Trash2 size={16} />
              删除用户
            </AlertDialogTitle>
            <AlertDialogDescription>
              确认删除「{deleteTarget?.name || deleteTarget?.username}」？系统会同步清理 RDS 中该用户的成员关系、通知、日志、评论，并解除或转交项目、任务、审核、产品等引用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUserMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[color:var(--destructive)] text-white hover:bg-[color:var(--destructive)]/90"
              disabled={!deleteTarget || deleteUserMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) deleteUserMutation.mutate({ userId: deleteTarget.id });
              }}
            >
              {deleteUserMutation.isPending ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound size={16} className="text-primary" />
              重置密码
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              正在重置 <strong>{resetUserName}</strong> 的密码
            </p>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">新密码 <span className="text-[color:var(--destructive)]">*</span></Label>
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
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
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
