import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('product technical baseline UI', () => {
  it('integrates the read-only technical baseline in product details', () => {
    const library = source('../client/src/components/views/ProductLibraryView.tsx');
    expect(library).toContain("import { ProductTechnicalBaselinePanel }");
    expect(library).toContain('<ProductTechnicalBaselinePanel productId={product.id} />');
  });

  it('loads and distinguishes project technical delivery from lightweight revisions', () => {
    const panel = source('../client/src/components/views/ProductTechnicalBaselinePanel.tsx');
    expect(panel).toContain('trpc.products.currentTechnicalBaseline.useQuery');
    expect(panel).toContain('项目交付生成技术配置');
    expect(panel).toContain('Revision 只维护包装、印刷、标签等轻微改版');
    expect(panel).toContain('暂无已发布的产品技术基线');
  });

  it('shows all three controlled module types and a frozen BOM summary', () => {
    const panel = source('../client/src/components/views/ProductTechnicalBaselinePanel.tsx');
    expect(panel).toContain("type: 'battery_energy'");
    expect(panel).toContain("type: 'core_function'");
    expect(panel).toContain("type: 'electronics_hardware'");
    expect(panel).toContain('关键模块快照');
    expect(panel).toContain('规格基线');
    expect(panel).toContain('项目任务提交后随发布冻结');
    expect(panel).toContain('冻结 BOM 摘要');
    expect(panel).toContain("record.reuseState !== 'reused'");
  });

  it('exposes technical-baseline history and a previous-version delta summary', () => {
    const panel = source('../client/src/components/views/ProductTechnicalBaselinePanel.tsx');
    expect(panel).toContain('trpc.products.technicalBaselines.useQuery');
    expect(panel).toContain('trpc.products.technicalBaseline.useQuery');
    expect(panel).toContain('技术基线历史');
    expect(panel).toContain('技术基线差异摘要');
    expect(panel).toContain('关键模块变更');
  });
});
