import { and, eq } from "drizzle-orm";
import { projectFiles, projects, projectTasks, type ProjectMemberRole, type ProjectRow, type ProjectTask } from "../drizzle/schema";
import { decideTaskApproval, getDb } from "./db";
import { assertTaskApprovalFinalizeAllowed } from "./task-completion-guard";
import { assertFourEyes, redlineKindForTask } from "../shared/redline-four-eyes";

export type FinalizeTaskApprovalInput = {
  projectId: string;
  phaseId: string;
  taskId: string;
  decision: "approved" | "rejected";
  actor: number;
  note: string | null;
  isProxy: boolean;
  actedAsRole?: ProjectMemberRole | null;
  viaDelegationId?: number | null;
};

export type FinalizeTaskApprovalResult = {
  project: ProjectRow;
  taskBefore: ProjectTask;
};

/** Current-state validation and the pending→terminal CAS share one transaction. */
export async function finalizeTaskApproval(
  input: FinalizeTaskApprovalInput,
): Promise<FinalizeTaskApprovalResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new Error("项目不存在");
    const allTasks = await tx.select().from(projectTasks).where(eq(projectTasks.projectId, input.projectId));
    const taskBefore = allTasks.find((task) =>
      task.phaseId === input.phaseId && task.taskId === input.taskId
    );
    if (!taskBefore) throw new Error("任务不存在");

    if (input.decision === "approved") {
      if (redlineKindForTask(project, taskBefore.taskId)) {
        assertFourEyes(taskBefore.approvalRequestedBy, input.actor);
      }
      const files = await tx.select({ uploadedBy: projectFiles.uploadedBy }).from(projectFiles).where(and(
        eq(projectFiles.projectId, input.projectId),
        eq(projectFiles.phaseId, input.phaseId),
        eq(projectFiles.taskId, input.taskId),
      ));
      await assertTaskApprovalFinalizeAllowed({ project, task: taskBefore, allTasks }, {
        loadTaskFiles: async () => files,
      });
    } else if (
      !taskBefore.requiresApproval ||
      taskBefore.status !== "pending_approval" ||
      taskBefore.approvalStatus !== "pending"
    ) {
      throw new Error("任务当前不在待审批状态");
    }

    await decideTaskApproval(
      input.projectId,
      input.phaseId,
      input.taskId,
      input.decision,
      input.actor,
      input.note,
      input.isProxy,
      input.actedAsRole,
      input.viaDelegationId,
      tx,
    );
    return { project, taskBefore };
  });
}
