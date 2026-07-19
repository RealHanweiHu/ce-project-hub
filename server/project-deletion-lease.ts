export function projectExternalOperationLockKey(projectId: string): string {
  return `project-external:${projectId}`;
}

export class ProjectDeletionLeaseLostError extends Error {
  constructor(message = "项目删除租约已失效，不能继续删除") {
    super(message);
    this.name = "ProjectDeletionLeaseLostError";
  }
}
