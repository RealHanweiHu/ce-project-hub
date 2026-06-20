/**
 * MyTasksView – dedicated「我的任务」first-class page for execution roles
 * (structural/ID engineers, etc.). Reuses the「mine」workbench perspective so a
 * user lands directly on their own queue + task list, and clicking a task
 * deep-links into the project at the right phase with the task detail open.
 */
import { PerspectivePanel } from "./overview/PerspectivePanel";
import type { TaskFocus } from "./TaskListView";

export function MyTasksView({ onSelectProject }: { onSelectProject: (id: string, focus?: TaskFocus) => void }) {
  return (
    <div className="ce-page">
      <div className="ce-page-header flex-col items-start gap-1">
        <h1 className="font-serif text-xl text-stone-900">我的任务</h1>
        <p className="mt-1 text-xs text-stone-500">只聚合指派给你的待办、待审核与质量复测；点击任意条目直达对应项目阶段与任务详情。</p>
      </div>
      <div>
        <PerspectivePanel lens="mine" rows={[]} onSelectProject={onSelectProject} />
      </div>
    </div>
  );
}
