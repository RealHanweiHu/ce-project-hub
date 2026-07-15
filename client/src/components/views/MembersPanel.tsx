// MembersPanel: project team member management
// Shows member list, invite by searching registered users, change roles, remove members

import { useState, useRef, useEffect } from 'react';
import {
  Users, UserPlus, Shield, Trash2, Crown,
  Eye, Edit3, CheckCircle2, X, AlertCircle, Loader2, Search, UserCheck,
  Wrench, Factory, Megaphone, BadgeCheck, BatteryCharging, BriefcaseBusiness, Handshake,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useQueryClient } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';
import { toast } from 'sonner';

// Role metadata for display
const ROLE_META: Record<string, {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: React.ReactNode;
  description: string;
}> = {
  owner: {
    label: '创建者',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Crown size={11} />,
    description: '全部权限，不可被移除',
  },
  manager: {
    label: '管理层',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Shield size={11} />,
    description: '可通过 Gate 评审、管理成员、编辑所有内容',
  },
  project_manager: {
    label: '项目经理/PMO',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <BriefcaseBusiness size={11} />,
    description: '负责计划、成员、任务推进和 Gate 组织',
  },
  pm: {
    label: '产品经理',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Edit3 size={11} />,
    description: '负责产品定义、需求范围、目标成本和产品变更',
  },
  rd_hw: {
    label: '硬件研发',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Edit3 size={11} />,
    description: '可编辑任务和问题',
  },
  rd_sw: {
    label: '软件研发',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Edit3 size={11} />,
    description: '可编辑任务和问题',
  },
  rd_mech: {
    label: '结构/ID',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Edit3 size={11} />,
    description: '可编辑任务和问题',
  },
  qa: {
    label: '测试/品质',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <CheckCircle2 size={11} />,
    description: '可编辑问题清单（Issue List）',
  },
  scm: {
    label: '供应链',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Edit3 size={11} />,
    description: '可编辑变更记录中的成本相关字段',
  },
  pe: {
    label: '工艺/设备',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Wrench size={11} />,
    description: 'DFM/工装/量产准备，负责/会签任务',
  },
  mfg: {
    label: '生产',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Factory size={11} />,
    description: '试产/量产爬坡，负责/会签任务',
  },
  sales: {
    label: '销售/渠道',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Megaphone size={11} />,
    description: '需求/市场输入，可提问题与需求',
  },
  cert: {
    label: '认证',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <BadgeCheck size={11} />,
    description: '安规/认证资料，Gate 会签责任人',
  },
  battery_safety: {
    label: '电池安全',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <BatteryCharging size={11} />,
    description: '电池/安全合规，Gate 会签责任人',
  },
  external_customer: {
    label: '外部客户',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Handshake size={11} />,
    description: '仅可访问授权的客户可见文件',
  },
  supplier: {
    label: '外部供应商',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Factory size={11} />,
    description: '仅可访问授权的供应商可见文件',
  },
  viewer: {
    label: '只读',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Eye size={11} />,
    description: '仅查看，不可修改任何内容',
  },
};

const ASSIGNABLE_ROLES = [
  'manager', 'project_manager', 'pm',                               // 管理/产品
  'rd_hw', 'rd_sw', 'rd_mech', 'qa', 'scm', 'pe', 'mfg', 'cert', 'battery_safety', 'sales', // 负责/会签
  'external_customer', 'supplier', 'viewer',
] as const;
/** 角色按职能分组,便于选人时区分「能编辑项目」与「负责/会签任务」 */
const ROLE_GROUPS: Array<{ title: string; roles: AssignableRole[] }> = [
  { title: '项目 / 产品管理', roles: ['manager', 'project_manager', 'pm'] },
  { title: '负责 / 会签任务', roles: ['rd_hw', 'rd_sw', 'rd_mech', 'qa', 'scm', 'pe', 'mfg', 'cert', 'battery_safety', 'sales'] },
  { title: '外部协作 / 只读', roles: ['external_customer', 'supplier', 'viewer'] },
];
type AssignableRole = typeof ASSIGNABLE_ROLES[number];

type SearchUser = { id: number; name: string | null; username: string | null; email: string | null };

interface MembersPanelProps {
  projectId: string;
  canManage: boolean;
}

/** Searchable user picker for inviting members */
function UserSearchCombobox({
  projectId,
  selectedUser,
  onSelect,
}: {
  projectId: string;
  selectedUser: SearchUser | null;
  onSelect: (user: SearchUser | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce: only search when query >= 1 char
  const { data: results = [], isFetching } = trpc.admin.searchUsersForInvite.useQuery(
    { query: query.trim(), projectId },
    { enabled: query.trim().length >= 1 }
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (selectedUser) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 bg-[color:var(--acc-soft)] border border-[color:var(--acc-border)]">
        <div className="w-7 h-7 bg-[color:var(--acc-soft)] flex items-center justify-center text-xs num text-primary uppercase shrink-0">
          {(selectedUser.name || selectedUser.username || '?').charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">
            {selectedUser.name || selectedUser.username}
          </div>
          <div className="text-[10px] num text-muted-foreground truncate">{selectedUser.email}</div>
        </div>
        <button
          onClick={() => { onSelect(null); setQuery(''); }}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.trim().length >= 1) setOpen(true); }}
          placeholder="输入姓名、用户名或邮箱搜索…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-border bg-card focus:outline-none focus:border-[color:var(--acc-border)]"
        />
        {isFetching && (
          <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && query.trim().length >= 1 && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-border shadow-lg max-h-52 overflow-y-auto">
          {results.length === 0 && !isFetching && (
            <div className="px-4 py-3 text-sm text-muted-foreground text-center">
              未找到匹配用户（已注册且不在项目中）
            </div>
          )}
          {results.map((user) => (
            <button
              key={user.id}
              onClick={() => { onSelect(user); setOpen(false); setQuery(''); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary transition-colors text-left"
            >
              <div className="w-7 h-7 bg-secondary flex items-center justify-center text-xs num text-muted-foreground uppercase shrink-0">
                {(user.name || user.username || '?').charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {user.name || user.username}
                </div>
                <div className="text-[10px] num text-muted-foreground truncate">
                  {user.username && <span className="mr-2">@{user.username}</span>}
                  {user.email}
                </div>
              </div>
              <UserCheck size={14} className="text-primary shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MembersPanel({ projectId, canManage }: MembersPanelProps) {
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);
  const [inviteRole, setInviteRole] = useState<AssignableRole>('viewer');
  const [inviteExtraRoles, setInviteExtraRoles] = useState<AssignableRole[]>([]);
  const [inviteJobTitle, setInviteJobTitle] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<AssignableRole>('viewer');
  const [editExtraRoles, setEditExtraRoles] = useState<AssignableRole[]>([]);
  const [editJobTitle, setEditJobTitle] = useState('');
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);
  const [replacementUserId, setReplacementUserId] = useState<number | null>(null);
  const [delegationRole, setDelegationRole] = useState<AssignableRole>('qa');
  const [delegationFromUserId, setDelegationFromUserId] = useState<number | ''>('');
  const [delegationToUserId, setDelegationToUserId] = useState<number | ''>('');
  const [delegationStartDate, setDelegationStartDate] = useState('');
  const [delegationEndDate, setDelegationEndDate] = useState('');
  const [delegationReason, setDelegationReason] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.members.list) });
  };

  const { data: members = [], isLoading } = trpc.members.list.useQuery({ projectId });
  const delegations = trpc.delegations.list.useQuery({ projectId }, { enabled: canManage });
  const createDelegation = trpc.delegations.create.useMutation({
    onSuccess: () => {
      delegations.refetch();
      setDelegationReason('');
      toast.success('代理人已生效');
    },
    onError: (error) => toast.error(error.message),
  });
  const revokeDelegation = trpc.delegations.revoke.useMutation({
    onSuccess: () => delegations.refetch(),
    onError: (error) => toast.error(error.message),
  });
  const staffingGaps = trpc.staffing.gaps.useQuery(
    { projectId },
    { enabled: canManage },
  );
  const transferGap = trpc.staffing.transfer.useMutation({
    onSuccess: () => {
      staffingGaps.refetch();
      invalidate();
      toast.success('已移交');
    },
    onError: (error) => toast.error(`移交失败：${error.message}`),
  });

  const inviteMutation = trpc.members.invite.useMutation({
    onSuccess: (res) => {
      invalidate();
      setInviteSuccess(res.updated ? '已更新该成员的角色' : '邀请成功！对方现在可以访问此项目');
      setSelectedUser(null);
      setInviteExtraRoles([]);
      setInviteJobTitle('');
      setInviteError('');
      setTimeout(() => { setInviteSuccess(''); setShowInvite(false); }, 2000);
    },
    onError: (err) => {
      setInviteError(err.message);
    },
  });

  const updateRoleMutation = trpc.members.updateRole.useMutation({
    onSuccess: () => { invalidate(); setEditingUserId(null); },
    onError: (error) => toast.error(`保存角色失败：${error.message}`),
  });

  const handoffPreview = trpc.members.handoffPreview.useQuery(
    { projectId, userId: removingUserId ?? 0 },
    { enabled: removingUserId != null },
  );
  const handoffAndRemoveMutation = trpc.members.handoffAndRemove.useMutation({
    onSuccess: () => {
      invalidate();
      setRemovingUserId(null);
      setReplacementUserId(null);
    },
  });

  const handleInvite = () => {
    setInviteError('');
    if (!selectedUser) { setInviteError('请先搜索并选择一位用户'); return; }
    inviteMutation.mutate({
      projectId,
      userId: selectedUser.id,
      role: inviteRole,
      extraRoles: inviteExtraRoles.filter((role) => role !== inviteRole),
      jobTitle: inviteJobTitle.trim() || undefined,
    });
  };

  const handleEditStart = (member: typeof members[0]) => {
    setEditingUserId(member.userId);
    setEditRole(member.role as AssignableRole);
    setEditExtraRoles((member.extraRoles ?? []) as AssignableRole[]);
    setEditJobTitle(member.jobTitle || '');
  };

  const handleEditSave = (userId: number) => {
    updateRoleMutation.mutate({
      projectId,
      userId,
      role: editRole,
      extraRoles: editExtraRoles.filter((role) => role !== editRole),
      jobTitle: editJobTitle || null,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl text-foreground flex items-center gap-2">
            <Users size={22} className="text-primary" />
            项目成员
          </h2>
          <p className="text-xs num text-muted-foreground mt-1 uppercase tracking-wider">
            {members.length} MEMBERS · TEAM COLLABORATION
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => { setShowInvite(!showInvite); setInviteError(''); setInviteSuccess(''); }}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors"
          >
            <UserPlus size={14} />
            邀请成员
          </button>
        )}
      </div>

      {/* Invite Form */}
      {showInvite && canManage && (
        <div className="bg-[color:var(--acc-soft)] border border-[color:var(--acc-border)] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">邀请新成员</h3>
            <button
              onClick={() => { setShowInvite(false); setSelectedUser(null); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>

          <div>
            <label className="block text-[10px] num uppercase tracking-wider text-muted-foreground mb-2">
              兼任角色（可选）
            </label>
            <div className="flex flex-wrap gap-2">
              {ASSIGNABLE_ROLES.filter((role) => role !== inviteRole).map((role) => {
                const meta = ROLE_META[role];
                const selected = inviteExtraRoles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setInviteExtraRoles(selected
                      ? inviteExtraRoles.filter((item) => item !== role)
                      : [...inviteExtraRoles, role])}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] border ${selected ? `${meta.bg} ${meta.border} ${meta.color}` : 'bg-card border-border text-muted-foreground'}`}
                  >
                    {meta.icon}{meta.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">主角色用于展示；实际权限按主角色与兼任角色合并。</p>
          </div>

          {/* User search */}
          <div>
            <label className="block text-[10px] num uppercase tracking-wider text-muted-foreground mb-1">
              搜索用户 *
            </label>
            <UserSearchCombobox
              projectId={projectId}
              selectedUser={selectedUser}
              onSelect={setSelectedUser}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              输入姓名、用户名或邮箱，仅显示已注册且不在本项目中的用户
            </p>
          </div>

          {/* Job title */}
          <div>
            <label className="block text-[10px] num uppercase tracking-wider text-muted-foreground mb-1">
              职位/头衔（可选）
            </label>
            <input
              type="text"
              value={inviteJobTitle}
              onChange={(e) => setInviteJobTitle(e.target.value)}
              placeholder="如：硬件工程师、测试主管"
              className="w-full px-3 py-2 text-sm border border-border bg-card focus:outline-none focus:border-[color:var(--acc-border)]"
            />
          </div>

          {/* Role selection */}
          <div>
            <label className="block text-[10px] num uppercase tracking-wider text-muted-foreground mb-2">
              项目角色 *
            </label>
            <div className="space-y-3">
              {ROLE_GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="text-[9px] num uppercase tracking-widest text-muted-foreground mb-1.5">{group.title}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {group.roles.map((role) => {
                      const meta = ROLE_META[role];
                      const isSelected = inviteRole === role;
                      return (
                        <button
                          key={role}
                          onClick={() => setInviteRole(role)}
                          className={`p-2.5 text-left border transition-all ${
                            isSelected ? `${meta.bg} ${meta.border} border-2` : 'bg-card border-border hover:border-border'
                          }`}
                        >
                          <div className={`flex items-center gap-1 text-[10px] num uppercase tracking-wider mb-0.5 ${isSelected ? meta.color : 'text-muted-foreground'}`}>
                            {meta.icon}{meta.label}
                          </div>
                          <div className="text-[9px] text-muted-foreground leading-tight">{meta.description}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {inviteError && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-[color:var(--destructive-soft)] border border-destructive/30 px-3 py-2">
              <AlertCircle size={14} />
              {inviteError}
            </div>
          )}
          {inviteSuccess && (
            <div className="flex items-center gap-2 text-sm text-[color:var(--success)] bg-[color:var(--success-soft)] border border-[color:var(--success)]/30 px-3 py-2">
              <CheckCircle2 size={14} />
              {inviteSuccess}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleInvite}
              disabled={inviteMutation.isPending || !selectedUser}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors disabled:opacity-50"
            >
              {inviteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              确认邀请
            </button>
            <button
              onClick={() => { setShowInvite(false); setSelectedUser(null); }}
              className="px-4 py-2 border border-border text-muted-foreground text-sm hover:bg-secondary transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 角色职权矩阵已按需求移除：不在项目详情显示角色具体职权 */}

      {canManage && (staffingGaps.data?.length ?? 0) > 0 && (
        <div className="rounded-[10px] border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] p-4">
          <div className="text-sm font-semibold text-foreground">待补岗位与临时承接</div>
          <p className="mt-1 text-xs text-muted-foreground">空岗任务已由项目经理临时承接；岗位补齐后可在这里移交未完成任务。</p>
          <div className="mt-3 space-y-2">
            {staffingGaps.data?.map((gap) => {
              const candidate = members.find((member) => member.userId === gap.candidateUserId);
              return (
                <div key={gap.role} className="flex items-center justify-between gap-3 rounded border border-border bg-card px-3 py-2 text-xs">
                  <span>{ROLE_META[gap.role]?.label ?? gap.role} · {gap.taskCount} 项临时承接任务</span>
                  {candidate ? (
                    <button
                      disabled={transferGap.isPending}
                      onClick={() => transferGap.mutate({ projectId, role: gap.role, toUserId: candidate.userId })}
                      className="rounded bg-primary px-2.5 py-1 text-primary-foreground disabled:opacity-50"
                    >移交给 {candidate.userName || candidate.userEmail}</button>
                  ) : (
                    <span className="text-[color:var(--warning)]">待补人</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {canManage && (
        <div className="rounded-[10px] border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground">岗位代理</div>
          <p className="mt-1 text-xs text-muted-foreground">适合休假、兼职支援或待补岗位；到期后权限自动失效。</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <select value={delegationRole} onChange={(event) => setDelegationRole(event.target.value as AssignableRole)} className="rounded border border-border bg-card px-2 py-1.5 text-xs">
              {ASSIGNABLE_ROLES.filter((role) => role !== 'viewer').map((role) => <option key={role} value={role}>{ROLE_META[role].label}</option>)}
            </select>
            <select value={delegationFromUserId} onChange={(event) => setDelegationFromUserId(event.target.value ? Number(event.target.value) : '')} className="rounded border border-border bg-card px-2 py-1.5 text-xs">
              <option value="">待补岗位（无原持有人）</option>
              {members.map((member) => <option key={member.userId} value={member.userId}>由 {member.userName || member.userEmail}</option>)}
            </select>
            <select value={delegationToUserId} onChange={(event) => setDelegationToUserId(event.target.value ? Number(event.target.value) : '')} className="rounded border border-border bg-card px-2 py-1.5 text-xs">
              <option value="">选择代理人</option>
              {members.map((member) => <option key={member.userId} value={member.userId}>{member.userName || member.userEmail}</option>)}
            </select>
            <input type="date" value={delegationStartDate} onChange={(event) => setDelegationStartDate(event.target.value)} className="rounded border border-border bg-card px-2 py-1.5 text-xs" />
            <input type="date" value={delegationEndDate} onChange={(event) => setDelegationEndDate(event.target.value)} className="rounded border border-border bg-card px-2 py-1.5 text-xs" />
            <input value={delegationReason} onChange={(event) => setDelegationReason(event.target.value)} placeholder="代理原因" className="rounded border border-border bg-card px-2 py-1.5 text-xs" />
          </div>
          <button
            disabled={!delegationToUserId || !delegationStartDate || !delegationEndDate || delegationReason.trim().length < 2 || createDelegation.isPending}
            onClick={() => delegationToUserId && createDelegation.mutate({
              projectId, role: delegationRole, fromUserId: delegationFromUserId || null,
              toUserId: delegationToUserId, startDate: delegationStartDate, endDate: delegationEndDate,
              reason: delegationReason.trim(),
            })}
            className="mt-2 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
          >建立代理</button>
          <div className="mt-3 space-y-1.5">
            {delegations.data?.filter((item) => item.active).map((item) => {
              const target = members.find((member) => member.userId === item.toUserId);
              return (
                <div key={item.id} className="flex items-center justify-between rounded border border-border bg-secondary/30 px-2.5 py-1.5 text-xs">
                  <span>{ROLE_META[item.role]?.label ?? item.role} → {target?.userName || target?.userEmail || `用户${item.toUserId}`} · {item.startDate} 至 {item.endDate}</span>
                  <button onClick={() => revokeDelegation.mutate({ projectId, id: item.id })} className="text-muted-foreground hover:text-destructive">撤销</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {removingUserId != null && canManage && (
        <div className="space-y-3 rounded-[10px] border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] p-4">
          <div>
            <div className="text-sm font-semibold text-foreground">先交接责任，再移除成员</div>
            <div className="mt-1 text-xs text-muted-foreground">系统会原子转移任务、待审批、条件项、行动项、费用、关闭移交责任及 PM 身份；任一步失败都不会移除成员。</div>
          </div>
          {handoffPreview.data && (
            <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              {Object.entries(handoffPreview.data).map(([key, value]) => (
                (typeof value === 'number' && value > 0) || (key === 'isProjectManager' && value)
                  ? <span key={key} className="rounded border border-border bg-card px-2 py-1">{key === 'isProjectManager' ? '项目经理身份' : `${key}: ${value}`}</span>
                  : null
              ))}
            </div>
          )}
          <select
            value={replacementUserId ?? ''}
            onChange={(event) => setReplacementUserId(event.target.value ? Number(event.target.value) : null)}
            className="w-full rounded border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="">选择责任接收人</option>
            {members.filter((member) => member.userId !== removingUserId).map((member) => (
              <option key={member.userId} value={member.userId}>{member.userName || member.userEmail}</option>
            ))}
          </select>
          {handoffAndRemoveMutation.error && <div className="text-xs text-destructive">{handoffAndRemoveMutation.error.message}</div>}
          <div className="flex gap-2">
            <button
              disabled={!replacementUserId || handoffAndRemoveMutation.isPending}
              onClick={() => replacementUserId && handoffAndRemoveMutation.mutate({ projectId, userId: removingUserId, replacementUserId })}
              className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
            >确认交接并移除</button>
            <button onClick={() => { setRemovingUserId(null); setReplacementUserId(null); }} className="rounded border border-border bg-card px-3 py-1.5 text-xs">取消</button>
          </div>
        </div>
      )}

      {/* Member List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member) => {
            const meta = ROLE_META[member.role] || ROLE_META.viewer;
            const isEditing = editingUserId === member.userId;
            return (
              <div key={member.userId} className="bg-card border border-border p-4">
                {isEditing ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] num uppercase tracking-wider text-muted-foreground mb-1">职位/头衔</label>
                        <input
                          type="text"
                          value={editJobTitle}
                          onChange={(e) => setEditJobTitle(e.target.value)}
                          placeholder="如：硬件工程师"
                          className="w-full px-3 py-1.5 text-sm border border-border focus:outline-none focus:border-[color:var(--acc-border)]"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] num uppercase tracking-wider text-muted-foreground mb-2">主角色</label>
                      <div className="flex flex-wrap gap-2">
                        {ASSIGNABLE_ROLES.map((role) => {
                          const m = ROLE_META[role];
                          return (
                            <button
                              key={role}
                              onClick={() => setEditRole(role)}
                              className={`flex items-center gap-1 px-2.5 py-1 text-[11px] num border transition-all ${
                                editRole === role
                                  ? `${m.bg} ${m.border} border-2 ${m.color}`
                                  : 'bg-card border-border text-muted-foreground hover:border-border'
                              }`}
                            >
                              {m.icon}{m.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] num uppercase tracking-wider text-muted-foreground mb-2">兼任角色</label>
                      <div className="flex flex-wrap gap-2">
                        {ASSIGNABLE_ROLES.filter((role) => role !== editRole).map((role) => {
                          const m = ROLE_META[role];
                          const selected = editExtraRoles.includes(role);
                          return (
                            <button
                              key={role}
                              type="button"
                              onClick={() => setEditExtraRoles(selected
                                ? editExtraRoles.filter((item) => item !== role)
                                : [...editExtraRoles, role])}
                              className={`flex items-center gap-1 px-2.5 py-1 text-[11px] border ${selected ? `${m.bg} ${m.border} ${m.color}` : 'bg-card border-border text-muted-foreground'}`}
                            >
                              {m.icon}{m.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditSave(member.userId)}
                        disabled={updateRoleMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {updateRoleMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        保存
                      </button>
                      <button
                        onClick={() => setEditingUserId(null)}
                        className="px-3 py-1.5 border border-border text-muted-foreground text-xs hover:bg-secondary transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="w-9 h-9 bg-secondary flex items-center justify-center text-sm num text-muted-foreground shrink-0 uppercase">
                      {(member.userName || member.userEmail || '?').charAt(0)}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground truncate">
                          {member.userName || '未知用户'}
                        </span>
                        {member.isOwner && (
                          <Crown size={12} className="text-[color:var(--star)] shrink-0" />
                        )}
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] num border ${meta.color} ${meta.bg} ${meta.border}`}>
                          {meta.icon}{meta.label}
                        </span>
                        {(member.extraRoles ?? []).map((role) => {
                          const extra = ROLE_META[role] || ROLE_META.viewer;
                          return (
                            <span key={role} className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] num border border-dashed ${extra.color} ${extra.bg} ${extra.border}`}>
                              {extra.icon}兼任·{extra.label}
                            </span>
                          );
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                        {member.userEmail && <span className="num">{member.userEmail}</span>}
                        {member.jobTitle && (
                          <span className="text-muted-foreground">{member.jobTitle}</span>
                        )}
                      </div>
                    </div>
                    {/* Permission description */}
                    <div className="hidden md:flex items-center gap-1 shrink-0">
                      {meta.description && (
                        <span className="text-[10px] text-muted-foreground max-w-[160px] text-right leading-tight">{meta.description}</span>
                      )}
                    </div>
                    {/* Actions */}
                    {canManage && !member.isOwner && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleEditStart(member)}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          title="修改角色"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => { setRemovingUserId(member.userId); setReplacementUserId(null); }}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-[color:var(--destructive-soft)] transition-colors"
                          title="移除成员"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {members.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Users size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">暂无成员</p>
              {canManage && (
                <p className="text-xs mt-1">点击「邀请成员」添加团队成员</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
