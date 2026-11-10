// What a view cleanses, deduplicates and checks, as plain data (spec/behaviour.md, "Quality and
// cleansing"): only for a table synapse-view keeps; checks only in a layer whose does lists check.
import type {
  Column,
  Expectation,
  LayerDuty,
  ResolvedTable,
  TableCheck,
} from "@ingestron/definitions";
import {
  appliesRule,
  appliesTableCheck,
  cleansed,
  conditionOf,
  countOf,
  fileName,
  quote,
  typeOf,
  type Count,
  type FilesInput,
} from "../sql/index.js";

/** A row check: its condition, written from its rule or its check text. */
export interface RowCheckPlan {
  kind: "row";
  name: string;
  action: Expectation["action"];
  condition: string;
}

/** A table check: how it is counted, and the rule that compares the count. */
export interface TableCheckPlan {
  kind: "table";
  name: string;
  action: TableCheck["action"];
  count: Count;
  check: TableCheck;
}

/** One check of checks.sql. */
export type CheckPlan = RowCheckPlan | TableCheckPlan;

/** What a view does beyond reading its rows. */
export interface QualityPlan {
  /** The view's columns: the contract's, then those the landing step adds. */
  outputs: string[];
  /** The key and order that keep one row per key, when the table deduplicates. */
  deduplicate?: { keys: string[]; orderBy: string[] };
  /** The conditions of the `drop` checks; a row that fails one is left out. */
  drops: string[];
  /** Every check checks.sql counts: the row checks, then the table checks. */
  checks: CheckPlan[];
}

/** True when the table's layer's `does` lists the duty. */
const lists = (table: ResolvedTable, duty: LayerDuty) =>
  Array.isArray(table.does) && table.does.includes(duty);

/** Each cleansed column's expression, by name, read from the column as `start` gives it. */
export function cleansedColumns(
  table: ResolvedTable,
  start: (column: Column) => string,
): Record<string, string> {
  const columns = table.cleanse?.columns ?? {};
  return Object.fromEntries(
    table.contract.columns.flatMap((column) => {
      const operations = columns[column.name];
      const from = start(column);
      const expression = operations && cleansed(operations, column, from);
      // A conversion Windows cannot name leaves the column as it is.
      return expression && expression !== from ? [[column.name, expression]] : [];
    }),
  );
}

/** A view over files' column, as the files name it. */
export const fileColumnOf =
  (input: FilesInput) =>
  (column: Column): string =>
    quote(fileName(column, input));

/** Each column's type in a view over files, by name. */
export function typesOf(input: FilesInput): Record<string, string> {
  return Object.fromEntries(input.columns.map((column) => [column.name, typeOf(column, input)]));
}

/**
 * What the view does beyond reading, or undefined when it only reads: no deduplicate, no
 * `drop` check and no check for checks.sql. `types` are the columns' types where the view
 * types them; `extra` the columns the landing step adds.
 */
export function qualityPlan(
  table: ResolvedTable,
  types: Readonly<Record<string, string>>,
  extra: readonly Column[],
): QualityPlan | undefined {
  const checking = lists(table, "check");
  const rows = (checking ? table.expectations : [])
    .filter(appliesRule)
    .map((expectation): RowCheckPlan => ({
      kind: "row",
      name: expectation.name,
      action: expectation.action,
      condition: conditionOf(expectation, types),
    }));
  const checks = [...rows, ...(checking ? tableChecks(table) : [])];
  const drops = rows.filter((check) => check.action === "drop").map((check) => check.condition);
  const deduplicate = table.cleanse?.deduplicate && {
    keys: table.contract.primaryKey,
    orderBy: table.cleanse.deduplicate.orderBy,
  };
  if (!deduplicate && checks.length === 0) return undefined;
  const outputs = [...table.contract.columns, ...extra].map((column) => column.name);
  return { outputs, ...(deduplicate && { deduplicate }), drops, checks };
}

function tableChecks(table: ResolvedTable): TableCheckPlan[] {
  const columns = table.contract.columns.map((column) => column.name);
  return table.contract.tableChecks.filter(appliesTableCheck).map((check) => ({
    kind: "table",
    name: check.name,
    action: check.action,
    count: countOf(check, columns),
    check,
  }));
}
