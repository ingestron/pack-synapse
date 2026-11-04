// What views.sql holds for one environment, as plain data: the databases it
// switches to and each view's names and query, before any of it is written as
// T-SQL. Building one environment writes the plan as it is; building every
// environment together compares the targets' plans value by value.
import type { Column, ResolvedModel, ResolvedTable, Step } from "@ingestron/definitions";
import { relativePath, sourceStep } from "./locations.js";
import type { FilesInput } from "./sql.js";

/** Everything views.sql holds, in order. */
export interface ViewsPlan {
  project: string;
  statements: Statement[];
}

/** A `USE` before the views of one database, or a view. */
export type Statement = UseStatement | ViewPlan;

/** Switches to the database of the views that follow. */
export interface UseStatement {
  kind: "use";
  database: string;
  /** The layer of the first view that follows, which names the database's variable. */
  layer: string;
}

/** One view: its table, its names and what it selects. */
export interface ViewPlan {
  kind: "view";
  table: string;
  layer: string;
  schema: string;
  name: string;
  query: FilesPlan | TransformPlan;
}

/** A view over files under a data source. */
export interface FilesPlan extends FilesInput {
  kind: "files";
}

/** A view over a transform's query, which selects the contract's columns. */
export interface TransformPlan {
  kind: "transform";
  columns: string[];
  /** The transform's code, with each `{{ tables.<input> }}` as the input's view. */
  code: CodePart[];
}

/** Literal code, or the view of an input. */
export type CodePart = string | ViewReference;

/** An input's view, named in three parts when it is in another database. */
export interface ViewReference {
  table: string;
  layer: string;
  database?: string;
  schema: string;
  name: string;
}

/** True when the table has a Synapse view, kept or served. */
export function hasView(table: ResolvedTable): boolean {
  return table.store?.method === "synapse-view" || table.serve?.method === "synapse-serve";
}

/**
 * The plan of views.sql, in the model's order so each view follows the views it reads.
 * A `USE` comes before the first view and whenever the next view's database differs.
 * @example plan(model).statements[0] // { kind: "use", database: "erp_dev", layer: "bronze" }
 */
export function plan(model: ResolvedModel): ViewsPlan {
  const statements: Statement[] = [];
  let current: string | undefined;
  for (const table of model.tables.filter(hasView)) {
    const view = viewOf(model, table);
    if (!view) continue;
    if (table.fullName.catalog !== current) {
      current = table.fullName.catalog;
      statements.push({ kind: "use", database: current, layer: table.layer });
    }
    statements.push(view);
  }
  return { project: model.project.id, statements };
}

function viewOf(model: ResolvedModel, table: ResolvedTable): ViewPlan | undefined {
  // Resolved types are Synapse's only when Synapse provides the defaults.
  const resolvedTypes = model.standard.packs[0]?.startsWith("synapse@") ?? false;
  const names = { table: table.name, layer: table.layer, ...twoPart(table) };
  if (table.serve?.method === "synapse-serve")
    return { kind: "view", ...names, query: filesPlan(table, table.serve, { resolvedTypes }) };
  if (table.store?.method !== "synapse-view") return undefined;
  const renamed = table.ingest?.renamed ?? true;
  const query = table.transform
    ? transformPlan(model, table)
    : filesPlan(table, table.store, { renamed, resolvedTypes });
  return { kind: "view", ...names, query };
}

const twoPart = (table: ResolvedTable) => ({
  schema: table.fullName.schema,
  name: table.fullName.table,
});

/** A view over the files the table's source step records, read through the data source. */
function filesPlan(
  table: ResolvedTable,
  step: Step,
  options: { renamed?: boolean; resolvedTypes: boolean },
): FilesPlan {
  const output = sourceStep(table)!.output!;
  const relative = relativePath(output, step.settings);
  // The method's check refuses this before a build; never write a wrong path.
  if ("problem" in relative) throw new Error(relative.problem);
  return {
    kind: "files",
    ...options,
    path: relative.path,
    dataSource: String(step.settings.data_source),
    format: output.format === "csv" ? "csv" : "parquet",
    columns: table.contract.columns,
    extra: (output as { columns?: Column[] }).columns ?? [],
    csv: csvOf(table, step),
  };
}

/** The transform's code, its inputs named by their views, selecting the contract's columns. */
function transformPlan(model: ResolvedModel, table: ResolvedTable): TransformPlan {
  const code = withoutSemicolon(table.transform!.code);
  const parts: CodePart[] = [];
  let at = 0;
  for (const match of code.matchAll(tableReference)) {
    const found = model.tables.find((item) => item.name === match[1]);
    if (!found) continue;
    parts.push(code.slice(at, match.index), referenceTo(found, table));
    at = match.index + match[0].length;
  }
  parts.push(code.slice(at));
  return {
    kind: "transform",
    columns: table.contract.columns.map((column) => column.name),
    code: parts.filter((part) => part !== ""),
  };
}

/** An input's view; one in another database is named in three parts. */
function referenceTo(input: ResolvedTable, reader: ResolvedTable): ViewReference {
  const other = input.fullName.catalog !== reader.fullName.catalog;
  return {
    table: input.name,
    layer: input.layer,
    ...(other && { database: input.fullName.catalog }),
    ...twoPart(input),
  };
}

/** `{{ tables.x }}`, with or without Jinja's `-` whitespace markers. */
export const tableReference = /\{\{-?\s*tables\.([A-Za-z0-9_-]+)\s*-?\}\}/g;

/** A view's subquery cannot end with `;`. */
function withoutSemicolon(code: string): string {
  return code.trim().replace(/;\s*$/, "");
}

/**
 * How CSV files are read: the Synapse step's own `csv` when written, else the
 * landing step's, else the default.
 */
function csvOf(table: ResolvedTable, step: Step): { header: boolean; delimiter: string } {
  const own = step.settings.csv as { header: boolean; delimiter: string };
  if (step.origins.csv?.layer !== "pack") return own;
  const settings = sourceStep(table)?.settings ?? {};
  const landed = (settings.csv as Partial<typeof own> | undefined) ?? fromOptions(settings.options);
  return { ...own, ...landed };
}

/** ADF's free-form reader options: `header` (true or "true") and `sep` or `delimiter`. */
function fromOptions(options: unknown): Partial<{ header: boolean; delimiter: string }> {
  if (typeof options !== "object" || options === null) return {};
  const { header, sep, delimiter } = options as Record<string, unknown>;
  const separator = sep ?? delimiter;
  return {
    ...(header !== undefined && { header: header === true || header === "true" }),
    ...(typeof separator === "string" && { delimiter: separator }),
  };
}
