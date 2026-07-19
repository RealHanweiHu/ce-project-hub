import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('key module audit UI', () => {
  it('loads immutable lifecycle history with the selected module', () => {
    const library = source('../client/src/components/views/KeyModuleLibraryView.tsx');
    expect(library).toContain('trpc.keyModules.history.useQuery');
    expect(library).toContain("请输入退回草稿的原因");
    expect(library).toContain('historyLoading={history.isLoading}');
  });

  it('shows approver, status transition, reason, and time in module details', () => {
    const detail = source('../client/src/components/views/key-modules/KeyModuleDetailDialog.tsx');
    expect(detail).toContain('审批与变更记录');
    expect(detail).toContain('操作人：');
    expect(detail).toContain('event.fromStatus');
    expect(detail).toContain('event.reason');
    expect(detail).toContain("toLocaleString('zh-CN')");
  });
});
