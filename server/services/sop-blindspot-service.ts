import { nanoid } from "nanoid";
import { and, desc, eq, inArray, lt, lte } from "drizzle-orm";
import {
  actionItems,
  certificateRenewalAlerts,
  productCertificates,
  productWaivers,
  products,
  projectChangeScopeDeclarations,
  projectCloseHandoffs,
  projectConditions,
  projectDeliverableReviews,
  projectExpenses,
  projectFiles,
  projectIssues,
  projectMembers,
  projectPhases,
  projects,
  projectTasks,
  projectTerminationItems,
  projectTerminationReviews,
  projectTransitions,
  sopChangeEvents,
  sopChangeRequests,
  PRODUCT_WAIVER_SCOPE_TYPES,
  PROJECT_TERMINATION_ITEM_KEYS,
  type InsertProductWaiver,
  type ProductWaiver,
  type ProjectTerminationItemKey,
  type SopChangeRequest,
} from "../../drizzle/schema";
import { getPhasesForCategory, SOP_TEMPLATE_VERSION_CURRENT, type ProjectCategory } from "../../shared/sop-templates";
import { getDb, refreshProjectTaskStatuses } from "../db";

const ACTIVE_ACTION_STATUSES = ["open", "sent", "read", "escalated", "snoozed"] as const;
const OPEN_ISSUE_STATUSES = ["open", "in_progress"] as const;

function assertDateOrder(start: string, end: string, message: string) {
  if (end < start) throw new Error(message);
}

export async function listProductWaivers(productId: string): Promise<ProductWaiver[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productWaivers)
    .where(eq(productWaivers.productId, productId))
    .orderBy(desc(productWaivers.createdAt), desc(productWaivers.id));
}

export async function saveProductWaiverDraft(input: {
  id?: number | null;
  productId: string;
  projectId?: string | null;
  title: string;
  deviationDescription: string;
  impactAssessment: string;
  containmentPlan: string;
  scopeType: (typeof PRODUCT_WAIVER_SCOPE_TYPES)[number];
  lotOrBatch?: string | null;
  quantityLimit?: number | null;
  affectedPartNumbers: string[];
  effectiveFrom: string;
  expiresOn: string;
  riskLevel: "low" | "medium" | "high";
  ownerUserId: number;
  approverUserId: number;
  evidenceReference?: string | null;
  actorUserId: number;
}): Promise<ProductWaiver> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (input.ownerUserId === input.approverUserId) throw new Error("让步责任人与批准人不能是同一人");
  assertDateOrder(input.effectiveFrom, input.expiresOn, "让步到期日不能早于生效日");
  if (["lot", "batch"].includes(input.scopeType) && !input.lotOrBatch?.trim()) throw new Error("批次/批号范围必须填写批次标识");
  if (input.scopeType === "quantity" && (!input.quantityLimit || input.quantityLimit <= 0)) throw new Error("数量范围必须填写大于 0 的数量上限");
  const [product] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new Error("产品不存在");
  const values: Omit<InsertProductWaiver, "id" | "waiverNumber" | "status" | "linkedEcoProjectId" | "resolutionNote" | "submittedBy" | "submittedAt" | "approvedBy" | "approvedAt" | "resolvedBy" | "resolvedAt" | "createdAt" | "updatedAt"> = {
    productId: input.productId,
    projectId: input.projectId ?? null,
    revisionId: product.currentRevisionId ?? null,
    title: input.title.trim(),
    deviationDescription: input.deviationDescription.trim(),
    impactAssessment: input.impactAssessment.trim(),
    containmentPlan: input.containmentPlan.trim(),
    scopeType: input.scopeType,
    lotOrBatch: input.lotOrBatch?.trim() || null,
    quantityLimit: input.quantityLimit ?? null,
    affectedPartNumbers: Array.from(new Set(input.affectedPartNumbers.map((item) => item.trim()).filter(Boolean))),
    effectiveFrom: input.effectiveFrom,
    expiresOn: input.expiresOn,
    riskLevel: input.riskLevel,
    ownerUserId: input.ownerUserId,
    approverUserId: input.approverUserId,
    evidenceReference: input.evidenceReference?.trim() || null,
    createdBy: input.actorUserId,
  };
  if (input.id) {
    const [existing] = await db.select().from(productWaivers).where(and(eq(productWaivers.id, input.id), eq(productWaivers.productId, input.productId))).limit(1);
    if (!existing) throw new Error("让步单不存在");
    if (!["draft", "rejected"].includes(existing.status)) throw new Error("只有草稿或被拒绝的让步单可以修改");
    const [row] = await db.update(productWaivers).set({ ...values, status: "draft", updatedAt: new Date() })
      .where(eq(productWaivers.id, input.id)).returning();
    return row;
  }
  const [row] = await db.insert(productWaivers).values({
    ...values,
    waiverNumber: `WVR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${nanoid(6).toUpperCase()}`,
    status: "draft",
  }).returning();
  return row;
}

export async function submitProductWaiver(id: number, productId: string, actorUserId: number): Promise<ProductWaiver> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(productWaivers).where(and(eq(productWaivers.id, id), eq(productWaivers.productId, productId))).limit(1);
  if (!existing || !["draft", "rejected"].includes(existing.status)) throw new Error("让步单当前状态不能提交");
  if (!existing.evidenceReference?.trim()) throw new Error("提交让步审批前必须提供受控证据引用");
  const [row] = await db.update(productWaivers).set({ status: "pending_approval", submittedBy: actorUserId, submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(productWaivers.id, id)).returning();
  return row;
}

export async function decideProductWaiver(input: {
  id: number;
  productId: string;
  actorUserId: number;
  approve: boolean;
  allowAdmin: boolean;
  note?: string | null;
}): Promise<ProductWaiver> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(productWaivers).where(and(eq(productWaivers.id, input.id), eq(productWaivers.productId, input.productId))).limit(1);
  if (!existing || existing.status !== "pending_approval") throw new Error("让步单不在待审批状态");
  if (existing.createdBy === input.actorUserId) throw new Error("让步单编制人不能自批");
  if (!input.allowAdmin && existing.approverUserId !== input.actorUserId) throw new Error("只有指定批准人可以审批让步单");
  if (!input.approve && !input.note?.trim()) throw new Error("拒绝让步必须填写原因");
  const [row] = await db.update(productWaivers).set({
    status: input.approve ? "approved" : "rejected",
    approvedBy: input.approve ? input.actorUserId : null,
    approvedAt: input.approve ? new Date() : null,
    resolutionNote: input.note?.trim() || null,
    updatedAt: new Date(),
  }).where(eq(productWaivers.id, input.id)).returning();
  return row;
}

export async function resolveProductWaiver(input: {
  id: number;
  productId: string;
  actorUserId: number;
  resolution: "closed" | "converted_to_eco" | "cancelled";
  note: string;
  linkedEcoProjectId?: string | null;
}): Promise<ProductWaiver> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(productWaivers).where(and(eq(productWaivers.id, input.id), eq(productWaivers.productId, input.productId))).limit(1);
  if (!existing || ["closed", "converted_to_eco", "cancelled"].includes(existing.status)) throw new Error("让步单已经闭环");
  if (input.resolution === "cancelled" && !["draft", "rejected"].includes(existing.status)) throw new Error("只有草稿或退回的让步单可以取消");
  if (input.resolution !== "cancelled" && !["approved", "expired"].includes(existing.status)) throw new Error("只有已批准或已到期的让步单可以关闭或转 ECO");
  if (!input.note.trim()) throw new Error("闭环说明不能为空");
  if (input.resolution === "converted_to_eco") {
    if (!input.linkedEcoProjectId) throw new Error("转 ECO 必须选择目标项目");
    const [eco] = await db.select().from(projects).where(eq(projects.id, input.linkedEcoProjectId)).limit(1);
    if (!eco || eco.category !== "eco" || eco.productId !== input.productId) throw new Error("目标必须是同一产品的 ECO 项目");
  }
  const [row] = await db.update(productWaivers).set({
    status: input.resolution,
    linkedEcoProjectId: input.resolution === "converted_to_eco" ? input.linkedEcoProjectId : null,
    resolutionNote: input.note.trim(),
    resolvedBy: input.actorUserId,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(productWaivers.id, input.id)).returning();
  return row;
}

export async function expireApprovedProductWaivers(todayISO: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.update(productWaivers).set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(productWaivers.status, "approved"), lt(productWaivers.expiresOn, todayISO)))
    .returning({ id: productWaivers.id });
  return rows.length;
}

export async function updateCertificateRenewalPlan(input: {
  certificateId: number;
  renewalOwnerUserId: number;
  renewalStatus: "not_started" | "planned" | "in_progress" | "renewed";
  renewalNotes?: string | null;
  replacementCertificateId?: number | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (input.renewalStatus === "renewed" && !input.replacementCertificateId) throw new Error("标记续期完成时必须关联替代证书");
  const [row] = await db.update(productCertificates).set({
    renewalOwnerUserId: input.renewalOwnerUserId,
    renewalStatus: input.renewalStatus,
    renewalNotes: input.renewalNotes?.trim() || null,
    replacementCertificateId: input.replacementCertificateId ?? null,
    updatedAt: new Date(),
  }).where(eq(productCertificates.id, input.certificateId)).returning();
  if (!row) throw new Error("证书不存在");
  return row;
}

export async function listCertificateRenewalCandidates(todayISO: string, horizonISO: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    certificate: productCertificates,
    productManagerUserId: products.productManagerUserId,
    maintenanceOwnerUserId: products.maintenanceOwnerUserId,
  }).from(productCertificates)
    .innerJoin(products, eq(products.id, productCertificates.productId))
    .where(and(
      eq(productCertificates.status, "valid"),
      lte(productCertificates.validUntil, horizonISO),
    ));
}

export async function claimCertificateRenewalAlert(input: {
  certificateId: number;
  validUntil: string;
  leadDays: number;
  recipientUserId: number;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.insert(certificateRenewalAlerts).values(input).onConflictDoNothing().returning({ id: certificateRenewalAlerts.id });
  return rows.length > 0;
}

export async function releaseCertificateRenewalAlert(input: {
  certificateId: number;
  validUntil: string;
  leadDays: number;
  recipientUserId: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(certificateRenewalAlerts).where(and(
    eq(certificateRenewalAlerts.certificateId, input.certificateId),
    eq(certificateRenewalAlerts.validUntil, input.validUntil),
    eq(certificateRenewalAlerts.leadDays, input.leadDays),
    eq(certificateRenewalAlerts.recipientUserId, input.recipientUserId),
  ));
}

export async function executeProjectTransition(input: {
  sourceProjectId: string;
  targetProjectId: string;
  targetProjectNumber: string;
  targetName: string;
  toCategory: ProjectCategory;
  reason: string;
  actorUserId: number;
}): Promise<{ targetProjectId: string; issues: number; files: number; members: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [source] = await db.select().from(projects).where(eq(projects.id, input.sourceProjectId)).limit(1);
  if (!source || source.archived || source.lifecycle !== "active") throw new Error("只有活跃项目可以转轨");
  if (source.category === input.toCategory) throw new Error("目标轨道必须与当前轨道不同");
  const [existingTransition] = await db.select().from(projectTransitions).where(eq(projectTransitions.sourceProjectId, source.id)).limit(1);
  if (existingTransition) throw new Error("该项目已经完成过受控转轨");
  const [linkedProduct, declaration] = await Promise.all([
    source.productId ? db.select().from(products).where(eq(products.id, source.productId)).limit(1).then((rows) => rows[0] ?? null) : Promise.resolve(null),
    db.select().from(projectChangeScopeDeclarations).where(eq(projectChangeScopeDeclarations.projectId, source.id)).orderBy(desc(projectChangeScopeDeclarations.version)).limit(1).then((rows) => rows[0] ?? null),
  ]);
  if (["eco", "derivative", "idr"].includes(input.toCategory) && !linkedProduct?.currentRevisionId) {
    throw new Error("ECO/DRV/IDR 转轨必须关联已有产品和已发布基线 Revision");
  }
  if (["jdm", "obt"].includes(input.toCategory)) {
    const missing = [!source.customerInputVersion, !source.customerPartNumber, !source.commercialBoundary, !source.customerSignoffOwnerUserId].some(Boolean);
    if (missing) throw new Error("转入 JDM/OBT 前必须先补齐客户输入、客户料号、商务边界和签核责任人");
  }
  const phases = getPhasesForCategory(input.toCategory, SOP_TEMPLATE_VERSION_CURRENT);
  const firstPhaseId = phases[0]?.id ?? "concept";
  const summary = await db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: input.targetProjectId,
      name: input.targetName.trim(),
      projectNumber: input.targetProjectNumber.trim(),
      category: input.toCategory,
      sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
      pmUserId: source.pmUserId,
      description: source.description,
      customer: source.customer,
      background: source.background,
      value: source.value,
      risk: source.risk,
      currentPhase: firstPhaseId,
      progress: 0,
      startDate: new Date().toISOString().slice(0, 10),
      targetDate: source.targetDate,
      createdBy: input.actorUserId,
      archived: false,
      lifecycle: "active",
      productId: source.productId,
      productDefinitionSnapshotId: source.productDefinitionSnapshotId,
      baseRevisionId: ["eco", "derivative", "idr"].includes(input.toCategory) ? linkedProduct?.currentRevisionId ?? null : source.baseRevisionId,
      safetyRiskLevel: source.safetyRiskLevel,
      regulatoryRiskLevel: source.regulatoryRiskLevel,
      customerInputVersion: source.customerInputVersion,
      customerPartNumber: source.customerPartNumber,
      commercialBoundary: source.commercialBoundary,
      customerSignoffOwnerUserId: source.customerSignoffOwnerUserId,
      inputBaselineFrozenAt: ["jdm", "obt"].includes(input.toCategory) ? new Date() : null,
      inputBaselineFrozenBy: ["jdm", "obt"].includes(input.toCategory) ? input.actorUserId : null,
      customFields: source.customFields,
      meetingConfig: source.meetingConfig,
    });
    if (declaration) {
      await tx.insert(projectChangeScopeDeclarations).values({
        projectId: input.targetProjectId,
        version: 1,
        declaration: declaration.declaration,
        assessment: declaration.assessment,
        ruleVersion: declaration.ruleVersion,
        declaredBy: input.actorUserId,
      });
    }
    for (const phase of phases) {
      await tx.insert(projectPhases).values({ projectId: input.targetProjectId, phaseId: phase.id });
      await tx.insert(projectTasks).values(phase.tasks.map((task) => ({
        projectId: input.targetProjectId,
        phaseId: phase.id,
        taskId: task.id,
        completed: false,
        visibleRoles: task.visibleRoles,
        updatedBy: input.actorUserId,
      })));
    }
    const memberRows = await tx.select().from(projectMembers).where(eq(projectMembers.projectId, source.id));
    if (memberRows.length > 0) {
      await tx.insert(projectMembers).values(memberRows.map((member) => ({
        projectId: input.targetProjectId,
        userId: member.userId,
        role: member.role,
        jobTitle: member.jobTitle,
        invitedBy: input.actorUserId,
      })));
    }
    const issueRows = await tx.select().from(projectIssues).where(and(
      eq(projectIssues.projectId, source.id),
      inArray(projectIssues.status, [...OPEN_ISSUE_STATUSES]),
    ));
    if (issueRows.length > 0) {
      await tx.insert(projectIssues).values(issueRows.map((issue) => ({
        projectId: input.targetProjectId,
        phaseId: firstPhaseId,
        title: issue.title,
        description: `${issue.description ?? ""}\n\n转轨来源：${source.projectNumber || source.id} / Issue #${issue.id}`.trim(),
        severity: issue.severity,
        status: issue.status,
        category: issue.category,
        owner: issue.owner,
        reporter: issue.reporter,
        foundDate: issue.foundDate,
        targetDate: issue.targetDate,
        rootCause: issue.rootCause,
        solution: issue.solution,
        creatorId: input.actorUserId,
        productId: issue.productId ?? source.productId,
        sourceIssueId: issue.id,
      })));
    }
    const fileRows = await tx.select().from(projectFiles).where(eq(projectFiles.projectId, source.id));
    if (fileRows.length > 0) {
      await tx.insert(projectFiles).values(fileRows.map((file) => ({
        projectId: input.targetProjectId,
        phaseId: firstPhaseId,
        taskId: null,
        deliverableName: file.deliverableName,
        fileType: file.fileType,
        fileVersion: file.fileVersion,
        visibility: file.visibility,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        storageKey: file.storageKey,
        storageUrl: file.storageUrl,
        uploadedBy: file.uploadedBy,
        sourceFileId: file.id,
      })));
    }
    await tx.insert(projectTransitions).values({
      sourceProjectId: source.id,
      targetProjectId: input.targetProjectId,
      fromCategory: source.category,
      toCategory: input.toCategory,
      reason: input.reason.trim(),
      migrationSummary: { issues: issueRows.length, files: fileRows.length, members: memberRows.length },
      status: "completed",
      createdBy: input.actorUserId,
    });
    await tx.update(projects).set({
      lifecycle: "terminated",
      lifecycleReason: `受控转轨至 ${input.targetProjectNumber || input.targetProjectId}：${input.reason.trim()}`,
      lifecycleChangedAt: new Date(),
      lifecycleChangedBy: input.actorUserId,
      archived: true,
      updatedAt: new Date(),
    }).where(eq(projects.id, source.id));
    return { issues: issueRows.length, files: fileRows.length, members: memberRows.length };
  });
  await refreshProjectTaskStatuses(input.targetProjectId);
  return { targetProjectId: input.targetProjectId, ...summary };
}

export async function getMemberHandoffPreview(projectId: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [tasks, approvals, reviews, conditions, actions, expenses] = await Promise.all([
    db.select({ id: projectTasks.id }).from(projectTasks).where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.assigneeUserId, userId), inArray(projectTasks.status, ["todo", "in_progress", "blocked", "pending_approval"]))),
    db.select({ id: projectTasks.id }).from(projectTasks).where(and(eq(projectTasks.projectId, projectId), eq(projectTasks.approverUserId, userId), eq(projectTasks.approvalStatus, "pending"))),
    db.select({ id: projectDeliverableReviews.id }).from(projectDeliverableReviews).where(and(eq(projectDeliverableReviews.projectId, projectId), eq(projectDeliverableReviews.reviewerUserId, userId), eq(projectDeliverableReviews.status, "pending"))),
    db.select({ id: projectConditions.id }).from(projectConditions).where(and(eq(projectConditions.projectId, projectId), eq(projectConditions.ownerUserId, userId), eq(projectConditions.status, "open"))),
    db.select({ id: actionItems.id }).from(actionItems).where(and(eq(actionItems.projectId, projectId), eq(actionItems.recipientUserId, userId), inArray(actionItems.status, [...ACTIVE_ACTION_STATUSES]))),
    db.select({ id: projectExpenses.id }).from(projectExpenses).where(and(eq(projectExpenses.projectId, projectId), eq(projectExpenses.ownerUserId, userId), inArray(projectExpenses.status, ["planned", "committed", "paid"]))),
  ]);
  const [project] = await db.select({ pmUserId: projects.pmUserId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  return { tasks: tasks.length, taskApprovals: approvals.length, deliverableReviews: reviews.length, conditions: conditions.length, actionItems: actions.length, expenses: expenses.length, isProjectManager: project?.pmUserId === userId };
}

export async function handoffAndRemoveProjectMember(input: {
  projectId: string;
  userId: number;
  replacementUserId: number;
  actorUserId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (input.userId === input.replacementUserId) throw new Error("接收人不能是被移除成员本人");
  const [project, replacement] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1).then((rows) => rows[0]),
    db.select().from(projectMembers).where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.replacementUserId))).limit(1).then((rows) => rows[0]),
  ]);
  if (!project) throw new Error("项目不存在");
  if (project.createdBy === input.userId) throw new Error("不能移除项目创建者");
  if (!replacement) throw new Error("接收人必须已经是项目成员");
  const summary = await getMemberHandoffPreview(input.projectId, input.userId);
  await db.transaction(async (tx) => {
    await tx.update(projectTasks).set({ assigneeUserId: input.replacementUserId, updatedAt: new Date() })
      .where(and(eq(projectTasks.projectId, input.projectId), eq(projectTasks.assigneeUserId, input.userId), inArray(projectTasks.status, ["todo", "in_progress", "blocked", "pending_approval"])));
    await tx.update(projectTasks).set({ approverUserId: input.replacementUserId, updatedAt: new Date() })
      .where(and(eq(projectTasks.projectId, input.projectId), eq(projectTasks.approverUserId, input.userId), eq(projectTasks.approvalStatus, "pending")));
    await tx.update(projectDeliverableReviews).set({ reviewerUserId: input.replacementUserId, updatedAt: new Date() })
      .where(and(eq(projectDeliverableReviews.projectId, input.projectId), eq(projectDeliverableReviews.reviewerUserId, input.userId), eq(projectDeliverableReviews.status, "pending")));
    await tx.update(projectConditions).set({ ownerUserId: input.replacementUserId, updatedAt: new Date() })
      .where(and(eq(projectConditions.projectId, input.projectId), eq(projectConditions.ownerUserId, input.userId), eq(projectConditions.status, "open")));
    await tx.update(actionItems).set({ recipientUserId: input.replacementUserId, updatedAt: new Date() })
      .where(and(eq(actionItems.projectId, input.projectId), eq(actionItems.recipientUserId, input.userId), inArray(actionItems.status, [...ACTIVE_ACTION_STATUSES])));
    await tx.update(projectExpenses).set({ ownerUserId: input.replacementUserId, updatedAt: new Date() })
      .where(and(eq(projectExpenses.projectId, input.projectId), eq(projectExpenses.ownerUserId, input.userId), inArray(projectExpenses.status, ["planned", "committed", "paid"])));
    await tx.update(projectCloseHandoffs).set({ maintenanceOwnerUserId: input.replacementUserId, updatedAt: new Date() })
      .where(and(eq(projectCloseHandoffs.projectId, input.projectId), eq(projectCloseHandoffs.maintenanceOwnerUserId, input.userId)));
    await tx.update(projectCloseHandoffs).set({ afterSalesOwnerUserId: input.replacementUserId, updatedAt: new Date() })
      .where(and(eq(projectCloseHandoffs.projectId, input.projectId), eq(projectCloseHandoffs.afterSalesOwnerUserId, input.userId)));
    if (project.pmUserId === input.userId) await tx.update(projects).set({ pmUserId: input.replacementUserId, updatedAt: new Date() }).where(eq(projects.id, input.projectId));
    await tx.delete(projectMembers).where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)));
  });
  return summary;
}

export type TerminationItemInput = { itemKey: ProjectTerminationItemKey; disposition: string; completed: boolean; evidenceReference?: string | null };

export async function getProjectTerminationReview(projectId: string) {
  const db = await getDb();
  if (!db) return null;
  const [review] = await db.select().from(projectTerminationReviews).where(eq(projectTerminationReviews.projectId, projectId)).limit(1);
  if (!review) return null;
  const items = await db.select().from(projectTerminationItems).where(eq(projectTerminationItems.reviewId, review.id)).orderBy(projectTerminationItems.id);
  return { review, items };
}

export async function saveProjectTerminationDraft(input: {
  projectId: string;
  reason: string;
  sunkCostSummary: string;
  customerCommunication: string;
  ownerUserId: number;
  approverUserId: number;
  items: TerminationItemInput[];
  actorUserId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (input.ownerUserId === input.approverUserId) throw new Error("终止责任人与批准人不能是同一人");
  if (input.items.length !== PROJECT_TERMINATION_ITEM_KEYS.length) throw new Error("终止善后清单不完整");
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(projectTerminationReviews).where(eq(projectTerminationReviews.projectId, input.projectId)).limit(1);
    if (existing && !["draft", "rejected"].includes(existing.status)) throw new Error("终止评审当前状态不能修改");
    const [review] = existing
      ? await tx.update(projectTerminationReviews).set({
          reason: input.reason.trim(), sunkCostSummary: input.sunkCostSummary.trim(), customerCommunication: input.customerCommunication.trim(),
          ownerUserId: input.ownerUserId, approverUserId: input.approverUserId, status: "draft", rejectionReason: null, updatedAt: new Date(),
        }).where(eq(projectTerminationReviews.id, existing.id)).returning()
      : await tx.insert(projectTerminationReviews).values({
          projectId: input.projectId, reason: input.reason.trim(), sunkCostSummary: input.sunkCostSummary.trim(), customerCommunication: input.customerCommunication.trim(),
          ownerUserId: input.ownerUserId, approverUserId: input.approverUserId, createdBy: input.actorUserId, status: "draft",
        }).returning();
    for (const item of input.items) {
      await tx.insert(projectTerminationItems).values({
        reviewId: review.id,
        itemKey: item.itemKey,
        disposition: item.disposition.trim(),
        completed: item.completed,
        evidenceReference: item.evidenceReference?.trim() || null,
        completedBy: item.completed ? input.actorUserId : null,
        completedAt: item.completed ? new Date() : null,
      }).onConflictDoUpdate({
        target: [projectTerminationItems.reviewId, projectTerminationItems.itemKey],
        set: {
          disposition: item.disposition.trim(), completed: item.completed, evidenceReference: item.evidenceReference?.trim() || null,
          completedBy: item.completed ? input.actorUserId : null, completedAt: item.completed ? new Date() : null, updatedAt: new Date(),
        },
      });
    }
    return { review, items: await tx.select().from(projectTerminationItems).where(eq(projectTerminationItems.reviewId, review.id)) };
  });
}

export async function submitProjectTermination(projectId: string, actorUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bundle = await getProjectTerminationReview(projectId);
  if (!bundle || !["draft", "rejected"].includes(bundle.review.status)) throw new Error("终止评审当前状态不能提交");
  const incomplete = bundle.items.filter((item) => !item.completed || !item.disposition.trim() || !item.evidenceReference?.trim());
  if (incomplete.length > 0) throw new Error(`终止善后仍有 ${incomplete.length} 项未完成或缺少证据`);
  const [row] = await db.update(projectTerminationReviews).set({ status: "pending_approval", submittedBy: actorUserId, submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(projectTerminationReviews.id, bundle.review.id)).returning();
  return row;
}

export async function decideProjectTermination(input: { projectId: string; actorUserId: number; approve: boolean; allowAdmin: boolean; note?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bundle = await getProjectTerminationReview(input.projectId);
  if (!bundle || bundle.review.status !== "pending_approval") throw new Error("终止评审不在待审批状态");
  if (bundle.review.createdBy === input.actorUserId) throw new Error("终止评审编制人不能自批");
  if (!input.allowAdmin && bundle.review.approverUserId !== input.actorUserId) throw new Error("只有指定批准人可以审批");
  if (!input.approve && !input.note?.trim()) throw new Error("拒绝必须填写原因");
  const [row] = await db.update(projectTerminationReviews).set({
    status: input.approve ? "approved" : "rejected",
    approvedBy: input.approve ? input.actorUserId : null,
    approvedAt: input.approve ? new Date() : null,
    rejectionReason: input.approve ? null : input.note!.trim(),
    updatedAt: new Date(),
  }).where(eq(projectTerminationReviews.id, bundle.review.id)).returning();
  return row;
}

async function createSopEvent(requestId: number, action: string, actorUserId: number, snapshot: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(sopChangeEvents).values({ requestId, action, actorUserId, snapshot });
}

export async function listSopChangeRequests(): Promise<SopChangeRequest[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sopChangeRequests).orderBy(desc(sopChangeRequests.createdAt), desc(sopChangeRequests.id));
}

export async function listSopChangeEvents(requestId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sopChangeEvents).where(eq(sopChangeEvents.requestId, requestId)).orderBy(sopChangeEvents.createdAt, sopChangeEvents.id);
}

export async function saveSopChangeDraft(input: {
  id?: number | null;
  title: string;
  currentVersion: string;
  proposedVersion: string;
  affectedTracks: ProjectCategory[];
  changeSummary: string;
  rationale: string;
  impactAnalysis: string;
  migrationStrategy: string;
  rollbackPlan: string;
  effectiveDate: string;
  requesterUserId: number;
  approverUserId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (input.requesterUserId === input.approverUserId) throw new Error("SOP 申请人与批准人不能是同一人");
  if (input.currentVersion === input.proposedVersion) throw new Error("建议版本必须与当前版本不同");
  if (!/^\d{4}-\d{2}-v\d+$/.test(input.proposedVersion)) throw new Error("建议版本格式应为 YYYY-MM-vN");
  const values = {
    title: input.title.trim(), currentVersion: input.currentVersion.trim(), proposedVersion: input.proposedVersion.trim(), affectedTracks: input.affectedTracks,
    changeSummary: input.changeSummary.trim(), rationale: input.rationale.trim(), impactAnalysis: input.impactAnalysis.trim(), migrationStrategy: input.migrationStrategy.trim(),
    rollbackPlan: input.rollbackPlan.trim(), effectiveDate: input.effectiveDate, requesterUserId: input.requesterUserId, approverUserId: input.approverUserId,
  };
  let row: SopChangeRequest;
  if (input.id) {
    const [existing] = await db.select().from(sopChangeRequests).where(eq(sopChangeRequests.id, input.id)).limit(1);
    if (!existing || !["draft", "rejected"].includes(existing.status)) throw new Error("SOP 申请当前状态不能修改");
    if (existing.requesterUserId !== input.requesterUserId) throw new Error("只有原申请人可以修改 SOP 变更草稿");
    [row] = await db.update(sopChangeRequests).set({ ...values, status: "draft", approvalNote: null, updatedAt: new Date() }).where(eq(sopChangeRequests.id, input.id)).returning();
  } else {
    [row] = await db.insert(sopChangeRequests).values({ ...values, requestNumber: `SOPCR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${nanoid(6).toUpperCase()}`, status: "draft" }).returning();
  }
  await createSopEvent(row.id, input.id ? "draft_updated" : "draft_created", input.requesterUserId, { proposedVersion: row.proposedVersion, affectedTracks: row.affectedTracks });
  return row;
}

export async function submitSopChangeRequest(id: number, actorUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(sopChangeRequests).where(eq(sopChangeRequests.id, id)).limit(1);
  if (!existing || !["draft", "rejected"].includes(existing.status)) throw new Error("SOP 申请当前状态不能提交");
  if (existing.requesterUserId !== actorUserId) throw new Error("只有申请人可以提交 SOP 变更");
  const [row] = await db.update(sopChangeRequests).set({ status: "pending_approval", submittedAt: new Date(), updatedAt: new Date() }).where(eq(sopChangeRequests.id, id)).returning();
  await createSopEvent(id, "submitted", actorUserId, { approverUserId: row.approverUserId });
  return row;
}

export async function decideSopChangeRequest(input: { id: number; actorUserId: number; approve: boolean; allowAdmin: boolean; note: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(sopChangeRequests).where(eq(sopChangeRequests.id, input.id)).limit(1);
  if (!existing || existing.status !== "pending_approval") throw new Error("SOP 申请不在待审批状态");
  if (existing.requesterUserId === input.actorUserId) throw new Error("SOP 申请人不能自批");
  if (!input.allowAdmin && existing.approverUserId !== input.actorUserId) throw new Error("只有指定批准人可以审批");
  if (!input.note.trim()) throw new Error("审批必须填写意见");
  const [row] = await db.update(sopChangeRequests).set({
    status: input.approve ? "approved" : "rejected", approvalNote: input.note.trim(), approvedAt: input.approve ? new Date() : null, updatedAt: new Date(),
  }).where(eq(sopChangeRequests.id, input.id)).returning();
  await createSopEvent(row.id, input.approve ? "approved" : "rejected", input.actorUserId, { note: input.note.trim() });
  return row;
}

export async function publishSopChangeRequest(id: number, actorUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(sopChangeRequests).where(eq(sopChangeRequests.id, id)).limit(1);
  if (!existing || existing.status !== "approved") throw new Error("只有已批准的 SOP 申请可以发布");
  const [row] = await db.update(sopChangeRequests).set({ status: "published", publishedAt: new Date(), updatedAt: new Date() }).where(eq(sopChangeRequests.id, id)).returning();
  await createSopEvent(row.id, "published", actorUserId, { proposedVersion: row.proposedVersion, effectiveDate: row.effectiveDate, migrationStrategy: row.migrationStrategy });
  return row;
}
