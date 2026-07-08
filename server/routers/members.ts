import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getProjectById,
  getProjectMembers,
  getProjectMember,
  addProjectMember,
  updateProjectMember,
  removeProjectMember,
  getUserByEmail,
  getUserById,
  createActivityLog,
} from "../db";
import { PROJECT_MEMBER_ROLES, ProjectMemberRole } from "../../drizzle/schema";
import { getEffectiveProjectRoleById } from "../project-access";

/**
 * Permission matrix for project roles.
 * Defines what each role can do within a project.
 */
export const ROLE_PERMISSIONS: Record<ProjectMemberRole, {
  label: string;
  labelEn: string;
  canView: boolean;
  canEditTasks: boolean;      // check/uncheck tasks
  canEditIssues: boolean;     // create/edit/close issues
  canEditRequirements: boolean; // create/edit requirement pool items
  canEditChangelog: boolean;  // create/edit change records
  canEditProjectInfo: boolean;// edit project name, dates, PM, risk
  canGateReview: boolean;     // decide gate reviews (approved/conditional) and advance phase
  canConveneGateReview: boolean; // convene/record gate review meetings (rejected + minutes), no pass authority
  canManageMembers: boolean;  // invite/remove/change roles
  canDeleteProject: boolean;  // archive/delete project
  canCloseIssues: boolean;    // confirm issue closure after verification
  canViewInternalWorkspace: boolean; // view internal tasks/issues/risks/changelog
  canViewInternalFiles: boolean;
  canViewCustomerFiles: boolean;
  canViewSupplierFiles: boolean;
  canViewCommercials: boolean;
  canQualityGateBlock: boolean;
  canNpiGateBlock: boolean;
  /** 结构性 BOM 编辑（料号/规格/数量/位号）：设计工程师是 EBOM 作者；
   *  商业字段（成本/供应商）仍归 SCM/管理路径，结构权不可写。缺省视为 false。 */
  canEditBomStructure?: boolean;
}> = {
  owner: {
    label: "创建者",
    labelEn: "Owner",
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
  },
  manager: {
    label: "管理层",
    labelEn: "Manager",
    canView: true,
    canEditTasks: true,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: true,
    canEditProjectInfo: true,
    canGateReview: true,
    canConveneGateReview: true,
    canManageMembers: true,
    canDeleteProject: false,
    canCloseIssues: true,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: true,
    canViewSupplierFiles: true,
    canViewCommercials: true,
    canQualityGateBlock: true,
    canNpiGateBlock: true,
  },
  project_manager: {
    label: "项目经理/PMO",
    labelEn: "Project Manager",
    canView: true,
    canEditTasks: true,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: true,
    canEditProjectInfo: true,
    canGateReview: false,
    canConveneGateReview: true,
    canManageMembers: true,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: true,
    canViewSupplierFiles: true,
    canViewCommercials: true,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  pm: {
    label: "产品经理",
    labelEn: "Product Manager",
    canView: true,
    canEditTasks: false,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: true,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: true,
    canViewSupplierFiles: false,
    canViewCommercials: true,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  rd_hw: {
    label: "硬件研发",
    labelEn: "HW Engineer",
    canEditBomStructure: true,
    canView: true,
    canEditTasks: true,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: false,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: false,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  rd_sw: {
    label: "软件研发",
    labelEn: "SW Engineer",
    canView: true,
    canEditTasks: true,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: false,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: false,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  rd_mech: {
    label: "结构/ID",
    labelEn: "Mech/ID Engineer",
    canEditBomStructure: true,
    canView: true,
    canEditTasks: true,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: false,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: false,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  qa: {
    label: "测试/品质",
    labelEn: "QA Engineer",
    canView: true,
    canEditTasks: false,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: false,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: true,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: false,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: true,
    canNpiGateBlock: false,
  },
  scm: {
    label: "供应链",
    labelEn: "SCM",
    canView: true,
    canEditTasks: false,
    canEditIssues: false,
    canEditRequirements: true,
    canEditChangelog: true,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: false,
    canViewSupplierFiles: true,
    canViewCommercials: true,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  pe: {
    label: "工艺/设备",
    labelEn: "Process/Equip",
    canView: true,
    canEditTasks: true,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: false,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: false,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: true,
  },
  mfg: {
    label: "生产",
    labelEn: "Manufacturing",
    canView: true,
    canEditTasks: true,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: false,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: false,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: true,
  },
  sales: {
    label: "销售/渠道",
    labelEn: "Sales",
    canView: true,
    canEditTasks: false,
    canEditIssues: false,
    canEditRequirements: true,
    canEditChangelog: false,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: false,
    canViewCustomerFiles: true,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  cert: {
    label: "认证",
    labelEn: "Certification",
    canView: true,
    canEditTasks: false,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: false,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: false,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  battery_safety: {
    label: "电池安全",
    labelEn: "Battery Safety",
    canView: true,
    canEditTasks: false,
    canEditIssues: true,
    canEditRequirements: true,
    canEditChangelog: false,
    canEditProjectInfo: false,
    canGateReview: false,
    canConveneGateReview: false,
    canManageMembers: false,
    canDeleteProject: false,
    canCloseIssues: false,
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: false,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  external_customer: {
    label: "外部客户",
    labelEn: "External Customer",
    canView: true,
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
    canViewCustomerFiles: true,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  supplier: {
    label: "外部供应商",
    labelEn: "Supplier",
    canView: true,
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
    canViewSupplierFiles: true,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
  viewer: {
    label: "只读成员",
    labelEn: "Viewer",
    canView: true,
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
    canViewInternalWorkspace: true,
    canViewInternalFiles: true,
    canViewCustomerFiles: false,
    canViewSupplierFiles: false,
    canViewCommercials: false,
    canQualityGateBlock: false,
    canNpiGateBlock: false,
  },
};

/**
 * Determine a user's effective role in a project.
 * Delegates to the canonical resolver so all three call sites (project-access,
 * this router, and tasks/gate routers) agree on rank-based upgrades and the
 * admin floor — see P1-10.
 */
async function getUserProjectRole(projectId: string, userId: number): Promise<ProjectMemberRole | null> {
  return getEffectiveProjectRoleById(projectId, userId);
}

export const membersRouter = router({
  /** Get all members of a project (requires view access) */
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getUserProjectRole(input.projectId, ctx.user.id);
      if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "无访问权限" });

      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const members = await getProjectMembers(input.projectId);

      // Always include the owner (project creator) in the list
      const ownerUser = await getUserById(project.createdBy);
      const ownerInList = members.some((m) => m.userId === project.createdBy);

      const result = members.map((m) => ({
        userId: m.userId,
        role: m.role,
        jobTitle: m.jobTitle,
        userName: m.userName,
        userEmail: m.userEmail,
        mentionName: m.userUsername ?? m.userOpenId ?? `u${m.userId}`,
        isOwner: m.userId === project.createdBy,
        permissions: ROLE_PERMISSIONS[m.role],
      }));

      if (!ownerInList && ownerUser) {
        result.unshift({
          userId: ownerUser.id,
          role: "owner" as ProjectMemberRole,
          jobTitle: null,
          userName: ownerUser.name ?? null,
          userEmail: ownerUser.email ?? null,
          mentionName: ownerUser.username ?? ownerUser.openId ?? `u${ownerUser.id}`,
          isOwner: true,
          permissions: ROLE_PERMISSIONS["owner"],
        });
      }

      return result;
    }),

  /** Get current user's role & permissions in a project */
  myRole: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const role = await getUserProjectRole(input.projectId, ctx.user.id);
      if (!role) return null;
      return {
        role,
        permissions: ROLE_PERMISSIONS[role],
      };
    }),

  /** Get all role definitions (for UI display) */
  roleDefinitions: protectedProcedure.query(() => {
    return PROJECT_MEMBER_ROLES.map((role) => ({
      role,
      ...ROLE_PERMISSIONS[role],
    }));
  }),

  /** Invite a member by email (requires canManageMembers) */
  invite: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      // Prefer userId (direct invite from search); email is kept for backward compat
      userId: z.number().optional(),
      email: z.string().email().optional(),
      role: z.enum(PROJECT_MEMBER_ROLES),
      jobTitle: z.string().optional(),
    }).refine((d) => d.userId != null || d.email != null, {
      message: "userId 或 email 至少提供一个",
    }))
    .mutation(async ({ ctx, input }) => {
      const myRole = await getUserProjectRole(input.projectId, ctx.user.id);
      if (!myRole || !ROLE_PERMISSIONS[myRole].canManageMembers) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有成员管理权限" });
      }
      // Cannot invite as owner
      if (input.role === "owner") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能邀请为创建者角色" });
      }

      // Resolve target user: prefer userId, fall back to email lookup
      let targetUser: Awaited<ReturnType<typeof getUserById>> | null = null;
      if (input.userId != null) {
        targetUser = await getUserById(input.userId);
        if (!targetUser) {
          throw new TRPCError({ code: "NOT_FOUND", message: "未找到该用户" });
        }
      } else {
        targetUser = await getUserByEmail(input.email!);
        if (!targetUser) {
          throw new TRPCError({ code: "NOT_FOUND", message: "未找到该邮箱对应的用户，请确认对方已注册" });
        }
      }

      // Check if already a member
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      if (project.createdBy === targetUser.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该用户是项目创建者，无需邀请" });
      }

      const existing = await getProjectMember(input.projectId, targetUser.id);
      if (existing) {
        // Update role if already exists
        await updateProjectMember(input.projectId, targetUser.id, {
          role: input.role,
          jobTitle: input.jobTitle ?? null,
        });
        await createActivityLog({
          projectId: input.projectId,
          userId: ctx.user.id,
          action: "member.update_role",
          entityType: "member",
          entityId: String(targetUser.id),
          meta: { role: input.role, jobTitle: input.jobTitle ?? null },
        });
        return { success: true, updated: true };
      }

      await addProjectMember({
        projectId: input.projectId,
        userId: targetUser.id,
        role: input.role,
        jobTitle: input.jobTitle ?? null,
        invitedBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "member.invite",
        entityType: "member",
        entityId: String(targetUser.id),
        meta: { role: input.role, jobTitle: input.jobTitle ?? null },
      });
      return { success: true, updated: false };
    }),

  /** Update a member's role (requires canManageMembers) */
  updateRole: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      userId: z.number(),
      role: z.enum(PROJECT_MEMBER_ROLES),
      jobTitle: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const myRole = await getUserProjectRole(input.projectId, ctx.user.id);
      if (!myRole || !ROLE_PERMISSIONS[myRole].canManageMembers) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有成员管理权限" });
      }
      if (input.role === "owner") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能设置为创建者角色" });
      }
      // Cannot change the owner's role
      const project = await getProjectById(input.projectId);
      if (project?.createdBy === input.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能修改创建者的角色" });
      }
      await updateProjectMember(input.projectId, input.userId, {
        role: input.role,
        jobTitle: input.jobTitle ?? null,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "member.update_role",
        entityType: "member",
        entityId: String(input.userId),
        meta: { role: input.role, jobTitle: input.jobTitle ?? null },
      });
      return { success: true };
    }),

  /** Remove a member (requires canManageMembers; cannot remove owner) */
  remove: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      userId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const myRole = await getUserProjectRole(input.projectId, ctx.user.id);
      if (!myRole || !ROLE_PERMISSIONS[myRole].canManageMembers) {
        throw new TRPCError({ code: "FORBIDDEN", message: "没有成员管理权限" });
      }
      const project = await getProjectById(input.projectId);
      if (project?.createdBy === input.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能移除项目创建者" });
      }
      await removeProjectMember(input.projectId, input.userId);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "member.remove",
        entityType: "member",
        entityId: String(input.userId),
      });
      return { success: true };
    }),
});
