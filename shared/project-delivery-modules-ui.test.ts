import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('project delivery modules UI', () => {
  it('places final module selection beside the working BOM for supported project types', () => {
    const detail = source('../client/src/components/views/ProjectDetailView.tsx');
    expect(detail).toContain("import { ProjectDeliveryModulesPanel }");
    expect(detail).toContain("['npd', 'jdm', 'obt', 'derivative', 'eco']");
    expect(detail).toContain('<ProjectDeliveryModulesPanel');
    expect(detail).toContain('perms.canViewInternalWorkspace');
  });

  it('supports searching approved modules and freezes the selection after release', () => {
    const panel = source('../client/src/components/views/ProjectDeliveryModulesPanel.tsx');
    expect(panel).toContain('trpc.projectDeliveryModules.list.useQuery');
    expect(panel).toContain('trpc.projectDeliveryModules.bind.useMutation');
    expect(panel).toContain('trpc.projectDeliveryModules.unbind.useMutation');
    expect(panel).toContain('<KeyModulePicker');
    expect(panel).toContain('已随产品技术基线冻结');
    expect(panel).toContain('DRV 建项复用');
    expect(panel).toContain('模块内部任一部件发生变化');
    expect(panel).toContain('requestCustomerConfirmationRef');
    expect(panel).toContain('requiresCustomerConfirmation');
    expect(panel).toContain('客户确认：');
  });
});
