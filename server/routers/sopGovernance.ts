import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { isSystemAdminRole } from "../../shared/system-roles";
import { isISODate } from "../../shared/scheduling";
import { PROJECT_CATEGORIES } from "../../drizzle/schema";
import { decideSopChangeRequest, listSopChangeEvents, listSopChangeRequests, publishSopChangeRequest, saveSopChangeDraft, submitSopChangeRequest } from "../services/sop-blindspot-service";

function assertAdmin(role: string) {
  if (!isSystemAdminRole(role)) throw new TRPCError({ code: "FORBIDDEN", message: "只有系统拥有者或管理员可以治理 SOP" });
}

export const sopGovernanceRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => { assertAdmin(ctx.user.role); return listSopChangeRequests(); }),
  events: protectedProcedure.input(z.object({ requestId: z.number().int().positive() })).query(async ({ ctx, input }) => { assertAdmin(ctx.user.role); return listSopChangeEvents(input.requestId); }),
  saveDraft: protectedProcedure.input(z.object({
    id: z.number().int().positive().nullable().optional(), title: z.string().trim().min(1).max(256), currentVersion: z.string().trim().min(1).max(32), proposedVersion: z.string().trim().min(1).max(32),
    affectedTracks: z.array(z.enum(PROJECT_CATEGORIES)).min(1), changeSummary: z.string().trim().min(1).max(10000), rationale: z.string().trim().min(1).max(10000), impactAnalysis: z.string().trim().min(1).max(10000),
    migrationStrategy: z.string().trim().min(1).max(10000), rollbackPlan: z.string().trim().min(1).max(10000), effectiveDate: z.string().refine(isISODate), approverUserId: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => { assertAdmin(ctx.user.role); try { return await saveSopChangeDraft({ ...input, requesterUserId: ctx.user.id }); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "SOP 申请保存失败" }); } }),
  submit: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { assertAdmin(ctx.user.role); try { return await submitSopChangeRequest(input.id, ctx.user.id); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "SOP 申请提交失败" }); } }),
  decide: protectedProcedure.input(z.object({ id: z.number().int().positive(), approve: z.boolean(), note: z.string().trim().min(1).max(5000) })).mutation(async ({ ctx, input }) => { assertAdmin(ctx.user.role); try { return await decideSopChangeRequest({ ...input, actorUserId: ctx.user.id, allowAdmin: false }); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "SOP 审批失败" }); } }),
  publish: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { assertAdmin(ctx.user.role); try { return await publishSopChangeRequest(input.id, ctx.user.id); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "SOP 发布失败" }); } }),
});
