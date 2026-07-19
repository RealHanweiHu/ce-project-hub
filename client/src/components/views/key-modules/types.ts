export type KeyModuleType = 'battery_energy' | 'core_function' | 'electronics_hardware';
export type KeyModuleStatus = 'draft' | 'technical_confirmed' | 'approved' | 'restricted' | 'obsolete';

export type KeyModuleRow = {
  id: string;
  moduleNumber: string;
  moduleType: KeyModuleType;
  name: string;
  category: string;
  model: string | null;
  status: KeyModuleStatus;
  derivedFromModuleId: string | null;
  restrictionReason: string | null;
  createdBy: number;
  updatedAt: Date | string;
};

export type KeyModuleItemRow = {
  id: number;
  moduleId: string;
  partNumber: string;
  name: string;
  spec: string;
  quantity: number;
  refDesignator: string;
  componentProductId: string | null;
  sortOrder: number;
};

export type KeyModuleBundle = { module: KeyModuleRow; items: KeyModuleItemRow[] };

export const MODULE_TYPE_OPTIONS: Array<{ value: KeyModuleType; label: string }> = [
  { value: 'battery_energy', label: '电池 / 能源' },
  { value: 'core_function', label: '核心功能' },
  { value: 'electronics_hardware', label: '电子硬件' },
];

export const MODULE_TYPE_LABEL = Object.fromEntries(
  MODULE_TYPE_OPTIONS.map(option => [option.value, option.label]),
) as Record<KeyModuleType, string>;

export const MODULE_STATUS_LABEL: Record<KeyModuleStatus, string> = {
  draft: '草稿',
  technical_confirmed: '待批准',
  approved: '已批准',
  restricted: '限制选用',
  obsolete: '已停用',
};
