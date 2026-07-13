import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("状态维护入口必须汇入服务端总闸", () => {
  it("任务完成路由调用证据/阶段/依赖 guard", () => {
    const tasks = source("../server/routers/tasks.ts");
    expect(tasks).toContain("assertTaskCompletionAllowed");
    expect(tasks).toContain("assertTaskStartAllowed");
  });

  it("任务分配通知不再铸造无证据的直接完成 token", () => {
    const projects = source("../server/routers/projects.ts");
    expect(projects).not.toContain('kind: "task_complete"');
    expect(projects).toContain("buildTaskCompletionActionPath");
  });

  it("MyTasks 与项目复选框把完成动作导向 evidence-aware 页面", () => {
    const mine = source("../client/src/components/views/MyTasksView.tsx");
    const detail = source("../client/src/components/views/ProjectDetailView.tsx");
    expect(mine).toContain("window.location.assign(buildTaskCompletionActionPath");
    expect(detail).toContain("window.location.assign(buildTaskCompletionActionPath");
    expect(detail).toContain("completeEvidenceMut.mutate");
  });

  it("Gate 交付物上传组件本身不附带任务完成 mutation", () => {
    const detail = source("../client/src/components/views/ProjectDetailView.tsx");
    const gateUpload = detail.slice(
      detail.indexOf("function DeliverableEvidenceUploadButton"),
      detail.indexOf("function DeliverableReviewControls"),
    );
    expect(gateUpload).not.toContain("setCompleted");
    expect(gateUpload).not.toContain("completeEvidenceMut");
  });
});
