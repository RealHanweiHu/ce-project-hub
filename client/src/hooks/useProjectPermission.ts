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
  canConveneGateReview: boolean;
  canManageMembers: boolean;
  canDeleteProject: boolean;
  canCloseIssues: boolean;
  canViewInternalWorkspace: boolean;
  canViewInternalFiles: boolean;
  canViewCustomerFiles: boolean;
  canViewSupplierFiles: boolean;
  canViewCommercials: boolean;
  canQualityGateBlock: boolean;
  canNpiGateBlock: boolean;
  /** 结构性 BOM 编辑（工程师）；服务端仅在 rd_hw/rd_mech 上带该键 */
  canEditBomStructure?: boolean;
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
  canConveneGateReview: true,
  canManageMembers: true,
  canDeleteProject: true,
  canCloseIssues: true,
  canViewInternalWorkspace: true,
  canViewInternalFiles: true,
  canViewCustomerFiles: true,
  canViewSupplierFiles: true,
  canViewCommercials: true,
  canQualityGateBlock: true,
  canNpiGateBlock: true,
  canEditBomStructure: true,
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
  canConveneGateReview: false,
  canManageMembers: false,
  canDeleteProject: false,
  canCloseIssues: false,
  canViewInternalWorkspace: false,
  canViewInternalFiles: false,
  canViewCustomerFiles: false,
  canViewSupplierFiles: false,
  canViewCommercials: false,
  canQualityGateBlock: false,
  canNpiGateBlock: false,
  canEditBomStructure: false,
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
