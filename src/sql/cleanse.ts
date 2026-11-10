// Cleansing as T-SQL (spec/behaviour.md, "Cleansing"): each column's operations applied in the
// model's order, in the view's SELECT, with time zones named as Windows names them.
import type { Column, ColumnCleanse } from "@ingestron/definitions";
import { windowsZone } from "../zones/index.js";
import { literal } from "./sql.js";

/** A number column's value: a number, or text that reads as one. */
const numeric = (item: unknown, text: string) =>
  typeof item === "number" || /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text) ? text : literal(text);

/** How each logical type writes a value, given the value and its text. */
const writers: Record<string, (item: unknown, text: string) => string> = {
  string: (_item, text) => literal(text),
  integer: numeric,
  number: numeric,
  // The column is BIT; an int would make the expression int.
  boolean: (_item, text) =>
    text === "true" || text === "false" ? `CAST(${text === "true" ? 1 : 0} AS BIT)` : literal(text),
  date: (_item, text) => `CAST(${literal(text)} AS DATE)`,
  timestamp: (_item, text) => `CAST(${literal(text)} AS DATETIME2(7))`,
};

/** A value written for the column's logical type; a `map` key, which is text, too. */
function literalOf(item: unknown, column: Column): string {
  if (item === null) return "NULL";
  const text = String(item);
  const type = column.logicalType ?? "";
  const writer = Object.hasOwn(writers, type) ? writers[type] : undefined;
  if (writer) return writer(item, text);
  if (typeof item === "number") return text;
  return literal(text);
}

/** True when Windows names both zones, so T-SQL can convert between them. */
export function convertible(zones: { from: string; to: string }): boolean {
  return windowsZone(zones.from) !== undefined && windowsZone(zones.to) !== undefined;
}

/** The conversion, or the column as it is when Windows lacks either zone. */
function converted(start: string, zones: { from: string; to: string }): string {
  if (!convertible(zones)) return start;
  const from = literal(windowsZone(zones.from)!);
  const to = literal(windowsZone(zones.to)!);
  return `CAST((${start} AT TIME ZONE ${from}) AT TIME ZONE ${to} AS DATETIME2(7))`;
}

/**
 * The column, read as `start`, with each of its cleansing operations applied in the model's
 * order.
 * @example cleansed({ trim: true }, column, "[name]") // "TRIM([name])"
 */
export function cleansed(operations: ColumnCleanse, column: Column, start: string): string {
  const value = (item: unknown) => literalOf(item, column);
  let text = operations.timezone ? converted(start, operations.timezone) : start;
  if (operations.trim) text = `TRIM(${text})`;
  if (operations.empty) text = `NULLIF(${text}, '')`;
  if (operations.map) {
    const cases = Object.entries(operations.map).map(
      ([key, to]) => `WHEN ${value(key)} THEN ${value(to)}`,
    );
    text = `CASE ${text} ${cases.join(" ")} ELSE ${text} END`;
  }
  if (operations.case) text = `${operations.case.toUpperCase()}(${text})`;
  if (operations.default !== undefined) text = `COALESCE(${text}, ${value(operations.default)})`;
  return text;
}
