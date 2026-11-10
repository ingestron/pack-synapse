// A contract's table checks as T-SQL (spec/behaviour.md, "Table checks"): what each counts over
// a table's rows, as Databricks counts it, and how its rule compares the count.
import type { TableCheck } from "@ingestron/definitions";
import { value } from "./conditions.js";
import { literal, quote } from "./sql.js";

/** True when T-SQL can count the check: every metric but a pattern, which needs a regular expression. */
export function appliesTableCheck(check: TableCheck): boolean {
  return !(check.metric === "invalidValues" && typeof check.arguments.pattern === "string");
}

/**
 * How a check is counted: an aggregate over the rows; the rows less the distinct rows of
 * `columns` with no null part; or a query of its own.
 */
export type Count = { aggregate: string } | { distinct: string[] } | { query: string };

/**
 * The check's count. `columns` are the contract's, for the whole row. A `sql` check's query keeps
 * `${object}`, which the writer replaces with the view's name.
 */
export function countOf(check: TableCheck, columns: readonly string[]): Count {
  const names = check.columns.map(quote);
  const [column = "*"] = names;
  switch (check.metric) {
    case "sql":
      return { query: check.query ?? "" };
    case "rowCount":
      return { aggregate: "COUNT_BIG(*)" };
    case "duplicateValues":
      if (names.length === 1) return { aggregate: `COUNT_BIG(*) - COUNT_BIG(DISTINCT ${column})` };
      return { distinct: names.length > 1 ? names : columns.map(quote) };
    case "nullValues":
      return { aggregate: countWhere(`${column} IS NULL`) };
    case "missingValues":
      return { aggregate: countWhere(missing(column, check.arguments.missingValues)) };
    default:
      return {
        aggregate: countWhere(
          `${column} IS NOT NULL AND NOT (${column} IN (${valuesOf(check.arguments.validValues)}))`,
        ),
      };
  }
}

/** A missing value: null, or one of the values listed. */
function missing(column: string, listed: unknown): string {
  return Array.isArray(listed)
    ? `${column} IS NULL OR ${column} IN (${valuesOf(listed)})`
    : `${column} IS NULL`;
}

const countWhere = (condition: string) => `COUNT_BIG(CASE WHEN ${condition} THEN 1 END)`;

function valuesOf(values: unknown): string {
  const list = Array.isArray(values) && values.length > 0 ? values : [""];
  return list.map(value).join(", ");
}

const operators: Record<string, string> = {
  mustBe: "=",
  mustNotBe: "<>",
  mustBeGreaterThan: ">",
  mustBeGreaterOrEqualTo: ">=",
  mustBeLessThan: "<",
  mustBeLessOrEqualTo: "<=",
};

/** The number a check's rule compares: its count, null read as 0. */
export const measuredOf = (variable: string): string => `ISNULL(${variable}, 0)`;

/**
 * True when the count in `variable` meets the rule: rows, or a percentage of `rows`.
 * @example comparison(check, "@check_1_1", "@rows_1") // "ISNULL(@check_1_1, 0) > 0"
 */
export function comparison(check: TableCheck, variable: string, rows: string): string {
  const measured =
    check.unit === "percent"
      ? `CASE WHEN ${rows} = 0 THEN 0 ELSE ${measuredOf(variable)} * 100.0 / ${rows} END`
      : measuredOf(variable);
  const operator = operators[check.operator];
  if (operator) return `${measured} ${operator} ${value(check.value)}`;
  const [low, high] = Array.isArray(check.value) ? check.value : [check.value, check.value];
  const between = check.operator === "mustNotBeBetween" ? "NOT BETWEEN" : "BETWEEN";
  return `${measured} ${between} ${value(low)} AND ${value(high)}`;
}

/** The text of a message, as a T-SQL Unicode literal. */
export const unicode = (text: string): string => `N${literal(text)}`;
