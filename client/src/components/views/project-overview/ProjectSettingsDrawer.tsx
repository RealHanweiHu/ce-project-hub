// Linear redesign — 项目设置抽屉
// Houses the project-editing sections (基础信息 / 风险生命周期 / 团队与分工 / 排期与周会 /
// 钉钉对接群 / 自定义字段) that previously lived in the 总览 tab. The 总览 tab now renders a
// read-only <ProjectDashboard>; editing is moved behind this right-side Sheet, opened from the
// dashboard's 「设置 →」 and the project-detail header ⚙ button.
//
// Reuses <OverviewPanel> as-is (passed in as children) — does NOT modify OverviewPanel internals.

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

export function ProjectSettingsDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl gap-0 p-0"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="text-lg">项目设置</SheetTitle>
          <SheetDescription>
            编辑基础信息、团队与分工、排期与周会、钉钉对接群、风险生命周期与自定义字段。
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
