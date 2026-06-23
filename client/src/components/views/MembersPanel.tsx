// MembersPanel: project team member management
// Shows member list, invite by searching registered users, change roles, remove members

import { useState, useRef, useEffect } from 'react';
import {
  Users, UserPlus, Shield, Trash2, Crown,
  Eye, Edit3, CheckCircle2, X, AlertCircle, Loader2, Search, UserCheck,
  Wrench, Factory, Megaphone, BadgeCheck, BatteryCharging,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useQueryClient } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';

// Role metadata for display
const ROLE_META: Record<string, {
  label: string;
  labelEn: string;
  color: string;
  bg: string;
  border: string;
  icon: React.ReactNode;
  description: string;
}> = {
  owner: {
    label: '创建者', labelEn: 'Owner',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Crown size={11} />,
    description: '全部权限，不可被移除',
  },
  manager: {
    label: '管理层', labelEn: 'Manager',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Shield size={11} />,
    description: '可通过 Gate 评审、管理成员、编辑所有内容',
  },
  pm: {
    label: '产品经理', labelEn: 'PM',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Edit3 size={11} />,
    description: '可编辑项目信息、任务、问题、变更记录，可管理成员',
  },
  rd_hw: {
    label: '硬件研发', labelEn: 'HW Eng',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Edit3 size={11} />,
    description: '可编辑任务和问题',
  },
  rd_sw: {
    label: '软件研发', labelEn: 'SW Eng',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Edit3 size={11} />,
    description: '可编辑任务和问题',
  },
  rd_mech: {
    label: '结构/ID', labelEn: 'Mech/ID',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Edit3 size={11} />,
    description: '可编辑任务和问题',
  },
  qa: {
    label: '测试/品质', labelEn: 'QA',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <CheckCircle2 size={11} />,
    description: '可编辑问题清单（Issue List）',
  },
  scm: {
    label: '供应链', labelEn: 'SCM',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Edit3 size={11} />,
    description: '可编辑变更记录中的成本相关字段',
  },
  pe: {
    label: '工艺/设备', labelEn: 'Process/Equip',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Wrench size={11} />,
    description: 'DFM/工装/量产准备，负责/会签任务',
  },
  mfg: {
    label: '生产', labelEn: 'Manufacturing',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Factory size={11} />,
    description: '试产/量产爬坡，负责/会签任务',
  },
  sales: {
    label: '销售/渠道', labelEn: 'Sales',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Megaphone size={11} />,
    description: '需求/市场输入，可提问题与需求',
  },
  cert: {
    label: '认证', labelEn: 'Certification',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <BadgeCheck size={11} />,
    description: '安规/认证资料，Gate 会签责任人',
  },
  battery_safety: {
    label: '电池安全', labelEn: 'Battery Safety',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <BatteryCharging size={11} />,
    description: '电池/安全合规，Gate 会签责任人',
  },
  viewer: {
    label: '只读', labelEn: 'Viewer',
    color: 'text-primary', bg: 'bg-[color:var(--acc-soft)]', border: 'border-[color:var(--acc-border)]',
    icon: <Eye size={11} />,
    description: '仅查看，不可修改任何内容',
  },
};

const ASSIGNABLE_ROLES = [
  'manager', 'pm',                                                  // 可编辑项目
  'rd_hw', 'rd_sw', 'rd_mech', 'qa', 'scm', 'pe', 'mfg', 'cert', 'battery_safety', 'sales', // 负责/会签
  'viewer',
] as const;
/** 角色按职能分组,便于选人时区分「能编辑项目」与「负责/会签任务」 */
const ROLE_GROUPS: Array<{ title: string; roles: AssignableRole[] }> = [
  { title: '可编辑项目', roles: ['manager', 'pm'] },
  { title: '负责 / 会签任务', roles: ['rd_hw', 'rd_sw', 'rd_mech', 'qa', 'scm', 'pe', 'mfg', 'cert', 'battery_safety', 'sales'] },
  { title: '只读', roles: ['viewer'] },
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
  const [inviteJobTitle, setInviteJobTitle] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<AssignableRole>('viewer');
  const [editJobTitle, setEditJobTitle] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.members.list) });
  };

  const { data: members = [], isLoading } = trpc.members.list.useQuery({ projectId });

  const inviteMutation = trpc.members.invite.useMutation({
    onSuccess: (res) => {
      invalidate();
      setInviteSuccess(res.updated ? '已更新该成员的角色' : '邀请成功！对方现在可以访问此项目');
      setSelectedUser(null);
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
  });

  const removeMutation = trpc.members.remove.useMutation({
    onSuccess: () => { invalidate(); },
  });

  const handleInvite = () => {
    setInviteError('');
    if (!selectedUser) { setInviteError('请先搜索并选择一位用户'); return; }
    inviteMutation.mutate({
      projectId,
      userId: selectedUser.id,
      role: inviteRole,
      jobTitle: inviteJobTitle.trim() || undefined,
    });
  };

  const handleEditStart = (member: typeof members[0]) => {
    setEditingUserId(member.userId);
    setEditRole(member.role as AssignableRole);
    setEditJobTitle(member.jobTitle || '');
  };

  const handleEditSave = (userId: number) => {
    updateRoleMutation.mutate({
      projectId,
      userId,
      role: editRole,
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

      {/* Permission Legend - only visible to project managers (owner/manager/pm) */}
      {canManage && (
        <div className="bg-secondary border border-border p-4">
          <div className="text-[10px] num uppercase tracking-wider text-muted-foreground mb-3">权限说明</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 pr-4 num text-muted-foreground font-normal">角色</th>
                  <th className="text-center py-1.5 px-2 num text-muted-foreground font-normal">任务</th>
                  <th className="text-center py-1.5 px-2 num text-muted-foreground font-normal">问题</th>
                  <th className="text-center py-1.5 px-2 num text-muted-foreground font-normal">变更</th>
                  <th className="text-center py-1.5 px-2 num text-muted-foreground font-normal">项目信息</th>
                  <th className="text-center py-1.5 px-2 num text-muted-foreground font-normal">Gate评审</th>
                  <th className="text-center py-1.5 px-2 num text-muted-foreground font-normal">管理成员</th>
                </tr>
              </thead>
              <tbody>
                {(['owner', 'manager', 'pm', 'rd_hw', 'rd_sw', 'rd_mech', 'qa', 'scm', 'viewer'] as const).map((role) => {
                  const meta = ROLE_META[role];
                  const perms = {
                    canEditTasks: role !== 'qa' && role !== 'scm' && role !== 'viewer',
                    canEditIssues: role !== 'scm' && role !== 'viewer',
                    canEditChangelog: ['owner', 'manager', 'pm', 'scm'].includes(role),
                    canEditProjectInfo: ['owner', 'manager', 'pm'].includes(role),
                    canGateReview: ['owner', 'manager'].includes(role),
                    canManageMembers: ['owner', 'manager', 'pm'].includes(role),
                  };
                  return (
                    <tr key={role} className="border-b border-border">
                      <td className="py-1.5 pr-4">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] num ${meta.color} ${meta.bg} border ${meta.border}`}>
                          {meta.icon}{meta.label}
                        </span>
                      </td>
                      {[perms.canEditTasks, perms.canEditIssues, perms.canEditChangelog, perms.canEditProjectInfo, perms.canGateReview, perms.canManageMembers].map((can, i) => (
                        <td key={i} className="text-center py-1.5 px-2">
                          {can
                            ? <span className="text-[color:var(--success)]">✓</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                      <label className="block text-[10px] num uppercase tracking-wider text-muted-foreground mb-2">角色</label>
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
                          onClick={() => {
                            if (confirm(`确认移除成员 ${member.userName || member.userEmail}？`)) {
                              removeMutation.mutate({ projectId, userId: member.userId });
                            }
                          }}
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
