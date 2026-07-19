export type BomImportLine = {
  partNumber: string;
  name: string;
  spec: string;
  quantity: number;
  refDesignator: string;
  supplierName: string;
  unitCost: string;
};

export type BomImportError = {
  /** Spreadsheet row number, including the header row. */
  row: number;
  message: string;
};

export type BomImportResult = {
  lines: BomImportLine[];
  errors: BomImportError[];
  ignoredRows: number;
};

export const BOM_DIGEST_VERSION = 1 as const;

export type BomCommercialFields = {
  supplierName: string;
  unitCost: string;
};

/**
 * Spreadsheet blanks mean "not supplied", not "erase an existing SCM value".
 * Explicit clearing remains a single-row edit operation where intent is clear.
 */
export function resolveImportedBomCommercials(
  imported: Partial<BomCommercialFields>,
  current?: BomCommercialFields,
  canEditCommercials = true,
): BomCommercialFields {
  const supplierName = String(imported.supplierName ?? "").trim();
  const unitCost = String(imported.unitCost ?? "").trim();

  if (!current) {
    return {
      supplierName: canEditCommercials ? supplierName : "",
      unitCost: canEditCommercials ? unitCost : "",
    };
  }

  return {
    supplierName: canEditCommercials && supplierName
      ? supplierName
      : current.supplierName,
    unitCost: canEditCommercials && unitCost
      ? unitCost
      : current.unitCost,
  };
}

/** Stable JSON input for the server-side working-BOM digest. */
export function stableBomDigestPayload(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableBomDigestPayload(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableBomDigestPayload(record[key])}`)
    .join(",")}}`;
}

type CanonicalField = keyof Omit<BomImportLine, "quantity"> | "quantity";

const HEADER_ALIASES: Record<CanonicalField, readonly string[]> = {
  partNumber: ["料号", "物料编码", "物料编号", "partnumber", "pn"],
  name: ["名称", "物料名称", "零件名称", "name", "description"],
  spec: ["规格", "规格型号", "型号规格", "spec", "specification"],
  quantity: ["用量", "数量", "qty", "quantity"],
  refDesignator: ["位号", "参考位号", "ref", "refdesignator", "reference"],
  supplierName: ["供应商", "供应商名称", "supplier", "vendor"],
  unitCost: ["单价", "单位成本", "unitcost", "cost", "price"],
};

const FIELD_BY_HEADER = new Map<string, CanonicalField>(
  Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) =>
    aliases.map((alias) => [normalizeHeader(alias), field as CanonicalField] as const),
  ),
);

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-/（）()]+/g, "");
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function canonicalizeRow(raw: Record<string, unknown>) {
  const row: Partial<Record<CanonicalField, unknown>> = {};
  for (const [header, value] of Object.entries(raw)) {
    const field = FIELD_BY_HEADER.get(normalizeHeader(header));
    if (field && row[field] === undefined) row[field] = value;
  }
  return row;
}

function isEmptyRow(raw: Record<string, unknown>): boolean {
  return Object.values(raw).every((value) => text(value) === "");
}

/**
 * Convert SheetJS `sheet_to_json` records into the stable API input shape.
 * Invalid rows are kept out of `lines`; row errors can be shown before upload.
 */
export function parseBomImportRows(
  rawRows: Array<Record<string, unknown>>,
): BomImportResult {
  const lines: BomImportLine[] = [];
  const errors: BomImportError[] = [];
  const firstRowByIdentity = new Map<string, number>();
  let ignoredRows = 0;

  rawRows.forEach((raw, index) => {
    const spreadsheetRow = index + 2;
    if (isEmptyRow(raw)) {
      ignoredRows += 1;
      return;
    }

    const row = canonicalizeRow(raw);
    const partNumber = text(row.partNumber);
    const name = text(row.name);
    const spec = text(row.spec);
    const refDesignator = text(row.refDesignator);
    const supplierName = text(row.supplierName);
    const unitCost = text(row.unitCost);
    const rawQuantity = text(row.quantity);
    const quantity = rawQuantity === "" ? 1 : Number(rawQuantity);

    if (!name) {
      errors.push({ row: spreadsheetRow, message: "缺少名称" });
      return;
    }
    if (!partNumber && !refDesignator) {
      errors.push({ row: spreadsheetRow, message: "至少填写料号或位号" });
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      errors.push({ row: spreadsheetRow, message: "用量必须是大于 0 的整数" });
      return;
    }
    if (unitCost && (!Number.isFinite(Number(unitCost)) || Number(unitCost) < 0)) {
      errors.push({ row: spreadsheetRow, message: "单价必须是大于或等于 0 的数字" });
      return;
    }

    const identity = `${partNumber ? "pn" : "ref"}:${(partNumber || refDesignator).toLowerCase()}`;
    const duplicateOf = firstRowByIdentity.get(identity);
    if (duplicateOf) {
      errors.push({
        row: spreadsheetRow,
        message: `料号或位号与第 ${duplicateOf} 行重复`,
      });
      return;
    }
    firstRowByIdentity.set(identity, spreadsheetRow);

    lines.push({
      partNumber,
      name,
      spec,
      quantity,
      refDesignator,
      supplierName,
      unitCost,
    });
  });

  return { lines, errors, ignoredRows };
}

export const BOM_IMPORT_TEMPLATE_HEADERS = [
  "料号",
  "名称",
  "规格",
  "用量",
  "位号",
  "供应商",
  "单价",
] as const;
