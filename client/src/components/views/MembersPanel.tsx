// MembersPanel: project team member management
// Shows member list, invite by email, change roles, remove members

import { useState } from 'react';
import {
  Users, UserPlus, Shield, Trash2, ChevronDown, Crown,
  Eye, Edit3, CheckCircle2, X, AlertCircle, Loader2,
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
    color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200',
    icon: <Crown size={11} />,
    description: '全部权限，不可被移除',
  },
  manager: {
    label: '管理层', labelEn: 'Manager',
    color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200',
    icon: <Shield size={11} />,
    description: '可通过 Gate 评审、管理成员、编辑所有内容',
  },
  pm: {
    label: '产品经理', labelEn: 'PM',
    color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200',
    icon: <Edit3 size={11} />,
    description: '可编辑项目信息、任务、问题、变更记录，可管理成员',
  },
  rd_hw: {
    label: '硬件研发', labelEn: 'HW Eng',
    color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200',
    icon: <Edit3 size={11} />,
    description: '可编辑任务和问题',
  },
  rd_sw: {
    label: '软件研发', labelEn: 'SW Eng',
    color: 'text-teal-700', bg: 'bg-teal-50', border: 'border-teal-200',
    icon: <Edit3 size={11} />,
    description: '可编辑任务和问题',
  },
  rd_mech: {
    label: '结构/ID', labelEn: 'Mech/ID',
    color: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200',
    icon: <Edit3 size={11} />,
    description: '可编辑任务和问题',
  },
  qa: {
    label: '测试/品质', labelEn: 'QA',
    color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200',
    icon: <CheckCircle2 size={11} />,
    description: '可编辑问题清单（Issue List）',
  },
  scm: {
    label: '供应链', labelEn: 'SCM',
    color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200',
    icon: <Edit3 size={11} />,
    description: '可编辑变更记录中的成本相关字段',
  },
  viewer: {
    label: '只读', labelEn: 'Viewer',
    color: 'text-stone-600', bg: 'bg-stone-50', border: 'border-stone-200',
    icon: <Eye size={11} />,
    description: '仅查看，不可修改任何内容',
  },
};

const ASSIGNABLE_ROLES = ['manager', 'pm', 'rd_hw', 'rd_sw', 'rd_mech', 'qa', 'scm', 'viewer'] as const;
type AssignableRole = typeof ASSIGNABLE_ROLES[number];

interface MembersPanelProps {
  projectId: string;
  canManage: boolean;
}

export function MembersPanel({ projectId, canManage }: MembersPanelProps) {
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
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
      setInviteEmail('');
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
    if (!inviteEmail.trim()) { setInviteError('请输入邮箱地址'); return; }
    inviteMutation.mutate({
      projectId,
      email: inviteEmail.trim(),
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
          <h2 className="font-serif text-2xl text-stone-900 flex items-center gap-2">
            <Users size={22} className="text-amber-500" />
            项目成员
          </h2>
          <p className="text-xs font-mono text-stone-400 mt-1 uppercase tracking-wider">
            {members.length} MEMBERS · TEAM COLLABORATION
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => { setShowInvite(!showInvite); setInviteError(''); setInviteSuccess(''); }}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-stone-900 text-sm font-medium transition-colors"
          >
            <UserPlus size={14} />
            邀请成员
          </button>
        )}
      </div>

      {/* Invite Form */}
      {showInvite && canManage && (
        <div className="bg-amber-50 border border-amber-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-800">邀请新成员</h3>
            <button onClick={() => setShowInvite(false)} className="text-stone-400 hover:text-stone-700">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-1">邮箱地址 *</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 text-sm border border-stone-300 bg-white focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-1">职位/头衔（可选）</label>
              <input
                type="text"
                value={inviteJobTitle}
                onChange={(e) => setInviteJobTitle(e.target.value)}
                placeholder="如：硬件工程师、测试主管"
                className="w-full px-3 py-2 text-sm border border-stone-300 bg-white focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-2">项目角色 *</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ASSIGNABLE_ROLES.map((role) => {
                const meta = ROLE_META[role];
                const isSelected = inviteRole === role;
                return (
                  <button
                    key={role}
                    onClick={() => setInviteRole(role)}
                    className={`p-2.5 text-left border transition-all ${
                      isSelected
                        ? `${meta.bg} ${meta.border} border-2`
                        : 'bg-white border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    <div className={`flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider mb-0.5 ${isSelected ? meta.color : 'text-stone-500'}`}>
                      {meta.icon}
                      {meta.label}
                    </div>
                    <div className="text-[9px] text-stone-400 leading-tight">{meta.description}</div>
                  </button>
                );
              })}
            </div>
          </div>
          {inviteError && (
            <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2">
              <AlertCircle size={14} />
              {inviteError}
            </div>
          )}
          {inviteSuccess && (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2">
              <CheckCircle2 size={14} />
              {inviteSuccess}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleInvite}
              disabled={inviteMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {inviteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              发送邀请
            </button>
            <button
              onClick={() => setShowInvite(false)}
              className="px-4 py-2 border border-stone-300 text-stone-600 text-sm hover:bg-stone-50 transition-colors"
            >
              取消
            </button>
          </div>
          <p className="text-[10px] text-stone-400">
            注意：被邀请的用户必须已注册 CE Project Hub 账号，系统将通过邮箱匹配用户。
          </p>
        </div>
      )}

      {/* Permission Legend - only visible to project managers (owner/manager/pm) */}
      {canManage && (
      <div className="bg-stone-50 border border-stone-200 p-4">
        <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-3">权限说明</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-stone-200">
                <th className="text-left py-1.5 pr-4 font-mono text-stone-500 font-normal">角色</th>
                <th className="text-center py-1.5 px-2 font-mono text-stone-500 font-normal">任务</th>
                <th className="text-center py-1.5 px-2 font-mono text-stone-500 font-normal">问题</th>
                <th className="text-center py-1.5 px-2 font-mono text-stone-500 font-normal">变更</th>
                <th className="text-center py-1.5 px-2 font-mono text-stone-500 font-normal">项目信息</th>
                <th className="text-center py-1.5 px-2 font-mono text-stone-500 font-normal">Gate评审</th>
                <th className="text-center py-1.5 px-2 font-mono text-stone-500 font-normal">管理成员</th>
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
                  <tr key={role} className="border-b border-stone-100">
                    <td className="py-1.5 pr-4">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono ${meta.color} ${meta.bg} border ${meta.border}`}>
                        {meta.icon}{meta.label}
                      </span>
                    </td>
                    {[perms.canEditTasks, perms.canEditIssues, perms.canEditChangelog, perms.canEditProjectInfo, perms.canGateReview, perms.canManageMembers].map((can, i) => (
                      <td key={i} className="text-center py-1.5 px-2">
                        {can
                          ? <span className="text-emerald-600">✓</span>
                          : <span className="text-stone-300">—</span>}
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
          <Loader2 size={20} className="animate-spin text-amber-500" />
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member) => {
            const meta = ROLE_META[member.role] || ROLE_META.viewer;
            const isEditing = editingUserId === member.userId;
            return (
              <div key={member.userId} className="bg-white border border-stone-200 p-4">
                {isEditing ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-1">职位/头衔</label>
                        <input
                          type="text"
                          value={editJobTitle}
                          onChange={(e) => setEditJobTitle(e.target.value)}
                          placeholder="如：硬件工程师"
                          className="w-full px-3 py-1.5 text-sm border border-stone-300 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-2">角色</label>
                      <div className="flex flex-wrap gap-2">
                        {ASSIGNABLE_ROLES.map((role) => {
                          const m = ROLE_META[role];
                          return (
                            <button
                              key={role}
                              onClick={() => setEditRole(role)}
                              className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono border transition-all ${
                                editRole === role
                                  ? `${m.bg} ${m.border} border-2 ${m.color}`
                                  : 'bg-white border-stone-200 text-stone-500 hover:border-stone-300'
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
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 text-white text-xs font-medium hover:bg-stone-700 transition-colors disabled:opacity-50"
                      >
                        {updateRoleMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        保存
                      </button>
                      <button
                        onClick={() => setEditingUserId(null)}
                        className="px-3 py-1.5 border border-stone-300 text-stone-600 text-xs hover:bg-stone-50 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="w-9 h-9 bg-stone-200 flex items-center justify-center text-sm font-mono text-stone-600 shrink-0 uppercase">
                      {(member.userName || member.userEmail || '?').charAt(0)}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-stone-900 truncate">
                          {member.userName || '未知用户'}
                        </span>
                        {member.isOwner && (
                          <Crown size={12} className="text-amber-500 shrink-0" />
                        )}
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono border ${meta.color} ${meta.bg} ${meta.border}`}>
                          {meta.icon}{meta.label}
                        </span>
                      </div>
                      <div className="text-xs text-stone-400 mt-0.5 flex items-center gap-3">
                        {member.userEmail && <span className="font-mono">{member.userEmail}</span>}
                        {member.jobTitle && (
                          <span className="text-stone-500">{member.jobTitle}</span>
                        )}
                      </div>
                    </div>
                    {/* Permission badges */}
                    <div className="hidden md:flex items-center gap-1 shrink-0">
                      {meta.description && (
                        <span className="text-[10px] text-stone-400 max-w-[160px] text-right leading-tight">{meta.description}</span>
                      )}
                    </div>
                    {/* Actions */}
                    {canManage && !member.isOwner && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleEditStart(member)}
                          className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
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
                          className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
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
            <div className="text-center py-12 text-stone-400">
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
