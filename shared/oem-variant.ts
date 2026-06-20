// OEM 客户版本（PLM 生命轴侧）——可持久化类型 + 纯计算。
// Customer Revision 基于 Product Revision 登记差异；SKU 是客户版本下的可销售编号。
// Customer BOM Revision 基于标准 BOM 受控派生，所有变化必须通过 ECO/ECN 留痕。
// 两类查询：1) 按客户查全部客户版本；2) 按产品型号查下游 SKU 影响清单（平台级 ECO Gate 数据源）。

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
  /** 是否沿用产品主版本认证 */
  reuseParent: boolean;
  /** 因变更（CMF / 标签 / 铭牌）而受影响、需复核的认证标识 */
  affectedMarks?: string[];
  notes?: string;
}

/** 下游影响清单的单行结果（主版本 / BOM Revision 一改即列出受影响客户版本） */
export interface DownstreamImpactRow {
  /** 客户版本号（Customer Revision） */
  variantCode: string;
  /** 可销售 SKU */
  customerSku: string | null;
  /** 基于标准 BOM 派生的客户 BOM Revision */
  customerBomRevision: string | null;
  customer: string;
  status: VariantStatus;
  /** 是否沿用产品主版本认证（false = 该客户版本认证需独立维护） */
  certReuseParent: boolean;
  /** 这次 BOM 变更是否命中该客户版本的差异料 */
  bomTouched: boolean;
  /** 该客户版本受影响、需复核的认证标识 */
  affectedMarks: string[];
}

/** 用于计算下游影响的最小客户版本形状（DB 行可直接满足） */
export interface ImpactableVariant {
  /** 客户版本号（Customer Revision） */
  variantCode: string;
  /** 可销售 SKU */
  customerSku?: string | null;
  customerName: string;
  status: VariantStatus;
  deltas: VariantDelta[];
  certReuseParent: boolean;
  certAffectedMarks?: string[] | null;
}

/**
 * 某产品型号的下游 SKU 影响清单（纯函数，便于单测）。
 * 用于自有 ECO 的 Gate：主版本 / BOM Revision 一改，立即列出受影响的客户版本与 SKU，
 * 并标出哪些客户版本的认证 / 物料会被这次变更波及。
 */
export function computeDownstreamImpact(
  variants: ImpactableVariant[],
  opts?: { onlyActive?: boolean; changedBomLines?: string[] },
): DownstreamImpactRow[] {
  const changed = new Set(opts?.changedBomLines ?? []);
  return variants
    .filter((v) => (opts?.onlyActive ? v.status === 'active' : true))
    .map((v) => {
      const customerBomRevision =
        v.deltas.find((d) => d.note === 'customer_bom_revision')?.variantValue ?? null;
      const bomTouched =
        changed.size > 0 &&
        v.deltas.some((d) => (d.bomImpact ?? []).some((line) => changed.has(line)));
      return {
        variantCode: v.variantCode,
        customerSku: v.customerSku ?? null,
        customerBomRevision,
        customer: v.customerName,
        status: v.status,
        certReuseParent: v.certReuseParent,
        bomTouched,
        affectedMarks: v.certAffectedMarks ?? [],
      };
    });
}
