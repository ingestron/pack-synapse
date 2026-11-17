// Keep observed fixed-point numeric precision without copying arbitrary source SQL into a type.
import type { SourceColumnDoc } from "@ingestron/definitions";

/** Synapse decimal type for an observed fixed-point numeric column, else the logical fallback. */
export function metadataType(column: SourceColumnDoc): string | undefined {
  if (column.logicalType !== "number") return undefined;
  const source = (column.sourceType ?? "").trim().toLowerCase();
  if (source === "money") return "DECIMAL(19,4)";
  if (source === "smallmoney") return "DECIMAL(10,4)";
  return decimalType(column, source);
}

function decimalType(column: SourceColumnDoc, source: string): string | undefined {
  const match = /^(?:decimal|numeric)\(\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(source);
  const options = column.logicalTypeOptions ?? {};
  const precision = match ? Number(match[1]) : options.precision;
  const scale = match ? Number(match[2]) : options.scale;
  if (!validPrecision(precision)) return undefined;
  if (typeof scale !== "number" || !Number.isInteger(scale)) return undefined;
  if (scale < 0 || scale > precision) return undefined;
  return `DECIMAL(${precision},${scale})`;
}

function validPrecision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 38;
}
