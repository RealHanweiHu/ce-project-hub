import { trpc } from '@/lib/trpc';

export type ProjectPermissions = {
  role: string;
  canView: boolean;
  canEditTasks: boolean;
  canEditIssues: boolean;
  canEditRequirements: boolean;
  canEditChangelog: boolean;
  canEditProjectInfo: boolean;
  canGateReview: boolean;
  canManageMembers: boolean;
  canDeleteProject: boolean;
};

const FULL_PERMISSIONS: ProjectPermissions = {
  role: 'owner',
  canView: true,
  canEditTasks: true,
  canEditIssues: true,
  canEditRequirements: true,
  canEditChangelog: true,
  canEditProjectInfo: true,
  canGateReview: true,
  canManageMembers: true,
  canDeleteProject: true,
};

const NO_PERMISSIONS: ProjectPermissions = {
  role: 'viewer',
  canView: false,
  canEditTasks: false,
  canEditIssues: false,
  canEditRequirements: false,
  canEditChangelog: false,
  canEditProjectInfo: false,
  canGateReview: false,
  canManageMembers: false,
  canDeleteProject: false,
};

/**
 * Returns the current user's permissions for a given project.
 * Falls back to full permissions while loading (optimistic UX).
 */
export function useProjectPermission(projectId: string | null) {
  const { data, isLoading } = trpc.members.myRole.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  if (!projectId || isLoading) {
    // Security-first: default to NO_PERMISSIONS while loading
    // This prevents unauthorized users from briefly seeing editable UI
    return { ...NO_PERMISSIONS, isLoading: true };
  }

  if (!data) {
    // Not a member at all (shouldn't happen if project list is filtered correctly)
    return { ...NO_PERMISSIONS, isLoading: false };
  }

  return {
    role: data.role,
    ...data.permissions,
    isLoading: false,
  };
}
