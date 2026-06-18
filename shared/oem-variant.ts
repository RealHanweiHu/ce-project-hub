// OEM 客户变体（PLM 生命轴侧）——可持久化类型 + 纯计算。
// 变体只在 PLM 侧登记，不开项目；只记录与 base 的差异(delta)，不复制整份 BOM。
// 两类查询：1) 按客户查全部变体；2) 按母平台查下游引用 SKU 影响清单（平台级 ECO Gate 数据源）。

/** 变体差异维度 */
export type VariantDimension =
  | 'color_cmf'         // 颜色 / CMF
  | 'logo_marking'      // logo / 丝印 / 镭雕
  | 'packaging'         // 彩盒 / 内托 / 说明书 / 吊牌 / 条码
  | 'label_nameplate'   // 标签 / 铭牌 / 认证标识
  | 'language_doc'      // 语言 / 文档
  | 'accessory'         // 配件清单
  | 'firmware_branding' // 固件品牌化（开机 logo / 默认参数 / UI 主题）
  | 'customer_pn'       // 客户料号
  | 'other';

export const VARIANT_DIMENSIONS: VariantDimension[] = [
  'color_cmf', 'logo_marking', 'packaging', 'label_nameplate',
  'language_doc', 'accessory', 'firmware_branding', 'customer_pn', 'other',
];

export type VariantStatus = 'draft' | 'active' | 'on_hold' | 'eol';

export interface VariantDelta {
  dimension: VariantDimension;
  /** 基础版本的值（可选，便于对比展示） */
  baseValue?: string;
  /** 变体的值 */
  variantValue: string;
  /** 受影响的 BOM 行 partNumber（仅差异项；对齐 bom_items.partNumber） */
  bomImpact?: string[];
  /** 关联稿件：artwork / die-line / 丝印图 / 铭牌图 文件引用 */
  artworkRef?: string;
  note?: string;
}

/** 认证适用性 */
export interface VariantCertification {
  /** 是否沿用母平台认证 */
  reuseParent: boolean;
  /** 因变更（CMF / 标签 / 铭牌）而受影响、需复核的认证标识 */
  affectedMarks?: string[];
  notes?: string;
}

/** 下游影响清单的单行结果（平台一改即列出受影响变体） */
export interface DownstreamImpactRow {
  variantCode: string;
  customerSku: string | null;
  customer: string;
  status: VariantStatus;
  /** 是否沿用母平台认证（false = 该变体认证需独立维护） */
  certReuseParent: boolean;
  /** 这次 BOM 变更是否命中该变体的差异料 */
  bomTouched: boolean;
  /** 该变体受影响、需复核的认证标识 */
  affectedMarks: string[];
}

/** 用于计算下游影响的最小变体形状（DB 行可直接满足） */
export interface ImpactableVariant {
  variantCode: string;
  customerSku?: string | null;
  customerName: string;
  status: VariantStatus;
  deltas: VariantDelta[];
  certReuseParent: boolean;
  certAffectedMarks?: string[] | null;
}

/**
 * 某母平台的下游引用 SKU 影响清单（纯函数，便于单测）。
 * 用于自有 ECO 的 Gate：平台一改，立即列出受影响的客户变体，
 * 并标出哪些变体的认证 / 物料会被这次变更波及。
 */
export function computeDownstreamImpact(
  variants: ImpactableVariant[],
  opts?: { onlyActive?: boolean; changedBomLines?: string[] },
): DownstreamImpactRow[] {
  const changed = new Set(opts?.changedBomLines ?? []);
  return variants
    .filter((v) => (opts?.onlyActive ? v.status === 'active' : true))
    .map((v) => {
      const bomTouched =
        changed.size > 0 &&
        v.deltas.some((d) => (d.bomImpact ?? []).some((line) => changed.has(line)));
      return {
        variantCode: v.variantCode,
        customerSku: v.customerSku ?? null,
        customer: v.customerName,
        status: v.status,
        certReuseParent: v.certReuseParent,
        bomTouched,
        affectedMarks: v.certAffectedMarks ?? [],
      };
    });
}
