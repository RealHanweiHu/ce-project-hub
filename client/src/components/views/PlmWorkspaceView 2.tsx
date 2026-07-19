import { useState } from 'react';
import { Boxes, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KeyModuleLibraryView } from './KeyModuleLibraryView';
import { ProductLibraryView } from './ProductLibraryView';

type PlmSection = 'products' | 'modules';

export function PlmWorkspaceView() {
  const [section, setSection] = useState<PlmSection>('products');
  return <div>
    <nav aria-label="PLM 功能" className="mb-6 flex gap-1 border-b border-border">
      <button className={cn('flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium', section === 'products' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => setSection('products')} aria-current={section === 'products' ? 'page' : undefined}><Package size={16} /> 产品主数据</button>
      <button className={cn('flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium', section === 'modules' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => setSection('modules')} aria-current={section === 'modules' ? 'page' : undefined}><Boxes size={16} /> 关键模块</button>
    </nav>
    {section === 'products' ? <ProductLibraryView /> : <KeyModuleLibraryView />}
  </div>;
}
