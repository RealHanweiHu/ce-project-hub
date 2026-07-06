const BATTERY_RE = /电池|电芯|电池包|保护电路|危害|un38\.?3|msds|battery|bms|cell|pack/i;
const CERT_RE = /认证|安规|合规|cert|compliance|emc|fcc|ce\b|ul\b|rohs|safety/i;
const SAFETY_FMEA_RE = /安全\s*fmea|dfmea/i;
const SCM_RE = /bom|openbom|物料|料件|供应|供应商|采购|成本|替代料|报价|nre|库存|物流|包装|supplier|supply|cost|material/i;
const PE_RE = /pfmea|ctq|eol|治具|测试程序|sop|wi|工艺|产线|试产|良率|fai/i;
// 只匹配真正的商业/市场词——不含裸「确认/签核」，否则「关键料件规格确认」「图纸完整性确认」等
// 工程交付物会被误判成 sales 所有，使 sales 成为工程评审默认审核人。
const SALES_RE = /客户|签样|渠道|销售|市场|售后|上市|voc|voice of customer|customer|channel|sales|market/i;
const QA_RE = /测试报告|验证报告|可靠性报告|检验报告|品质报告|功能测试|性能测试|可靠|检验|品质|test|qa|reliability|evt|dvt|pvt/i;

export function preferredDeliverableReviewerRoles(deliverableName: string): string[] {
  if (BATTERY_RE.test(deliverableName)) return ["battery_safety", "cert", "qa"];
  if (CERT_RE.test(deliverableName)) return ["cert", "battery_safety", "qa"];
  if (SAFETY_FMEA_RE.test(deliverableName)) return ["battery_safety", "qa", "cert"];
  if (SCM_RE.test(deliverableName)) return ["scm"];
  if (PE_RE.test(deliverableName)) return ["pe", "qa", "battery_safety"];
  if (SALES_RE.test(deliverableName)) return ["sales", "pm"];
  if (QA_RE.test(deliverableName)) return ["qa"];
  return [];
}

export function deliverableContributorRoles(deliverableName: string): string[] {
  return preferredDeliverableReviewerRoles(deliverableName);
}

export function canRoleContributeToDeliverable(role: string | null | undefined, deliverableName: string): boolean {
  if (!role || ["viewer", "external_customer", "supplier"].includes(role)) return false;
  return deliverableContributorRoles(deliverableName).includes(role);
}

export function canRoleReviewDeliverables(role: string | null | undefined): boolean {
  return !!role && !["viewer", "external_customer", "supplier"].includes(role);
}
