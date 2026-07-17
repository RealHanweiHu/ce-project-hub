import { useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type { KeyModuleType } from './types';

export type DrvKeyModuleChoice = {
  keyModuleId: string;
  moduleNumber: string;
  name: string;
  model: string | null;
  category: string;
};

export function KeyModulePicker({ moduleType, category, value, onChange, label }: {
  moduleType: KeyModuleType;
  category: string;
  value?: DrvKeyModuleChoice;
  onChange: (value: DrvKeyModuleChoice) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const results = trpc.keyModules.list.useQuery({
    query: query.trim() || undefined,
    moduleType,
    category: category.trim() || undefined,
    statuses: ['approved'],
    page: 1,
    pageSize: 30,
  }, { enabled: open });

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={`选择${label}关键模块`} className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left font-normal">
        {value ? <span className="min-w-0"><span className="block truncate text-xs font-semibold">{value.moduleNumber} · {value.name}</span><span className="block truncate text-[10px] text-muted-foreground">{[value.category, value.model].filter(Boolean).join(' · ') || '已批准模块'}</span></span> : <span className="text-xs text-muted-foreground">搜索并选择已批准模块…</span>}
        <ChevronsUpDown size={14} className="ml-2 shrink-0 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[min(420px,calc(100vw-2rem))] p-0">
      <div className="relative border-b border-border p-2"><Search size={14} className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={query} onChange={event => setQuery(event.target.value)} className="pl-9" placeholder="搜索模块编号、名称、型号或品类" aria-label={`搜索${label}模块`} /></div>
      <Command shouldFilter={false}>
        <CommandList>
          {results.isLoading ? <div className="py-6 text-center text-xs text-muted-foreground">搜索中…</div> : null}
          {!results.isLoading && (results.data?.data.length ?? 0) === 0 ? <CommandEmpty>没有可选模块；请先到 PLM「关键模块」创建并批准。</CommandEmpty> : null}
          <CommandGroup heading={category ? `同品类“${category}”优先` : '已批准模块'}>
            {results.data?.data.map(module => <CommandItem key={module.id} value={module.id} onSelect={() => {
              onChange({ keyModuleId: module.id, moduleNumber: module.moduleNumber, name: module.name, model: module.model, category: module.category });
              setOpen(false);
            }} className="items-start py-2.5">
              <Check size={14} className={cn('mt-0.5', value?.keyModuleId === module.id ? 'opacity-100' : 'opacity-0')} />
              <span className="min-w-0"><span className="block truncate text-xs font-semibold">{module.moduleNumber} · {module.name}</span><span className="block truncate text-[10px] text-muted-foreground">{[module.category, module.model].filter(Boolean).join(' · ') || '未限定品类'}</span></span>
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
