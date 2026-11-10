// The T-SQL of Synapse serverless views: quoted names, typed column lists,
// OPENROWSET over files, and re-runnable view statements.
import type { Column } from "@ingestron/definitions";
import { synapseTypes } from "./types.js";

/** Text when a column has neither a logicalType Synapse knows nor a type. */
const fallbackType = synapseTypes.string!;

/**
 * A name in brackets, with `]` doubled.
 * @example quote("order") // "[order]"
 */
export function quote(name: string): string {
  return `[${name.replaceAll("]", "]]")}]`;
}

/** How a view's columns are named and typed. */
export interface ColumnOptions {
  /** False when the files hold columns under their physicalName (the ingest did not rename). */
  renamed?: boolean;
  /** True when each column's resolved type is Synapse's (Synapse provides the defaults). */
  resolvedTypes?: boolean;
}

/**
 * The column list for OPENROWSET's WITH clause: each column under its name in
 * the files, typed from its logicalType (or by the type written for it).
 * @example columnList([{ name: "id", logicalType: "integer", nullable: false }]) // "  [id] BIGINT"
 */
export function columnList(columns: Column[], options: ColumnOptions = {}): string {
  return columns
    .map((column) => `  ${quote(fileName(column, options))} ${typeOf(column, options)}`)
    .join(",\n");
}

/**
 * The `SELECT` of a view over files: `*`, or each column under its contract name when a file
 * name differs, then the extra columns. With cleansing or the file column, one column a line,
 * each cleansed column as its expression.
 */
function selectClause(input: FilesInput): string {
  const { columns, extra = [], cleansed = {} } = input;
  const listed = Object.keys(cleansed).length > 0 || input.withFile === true;
  const same = columns.every((column) => fileName(column, input) === column.name);
  if (same && extra.length === 0 && !listed) return "SELECT *";
  const items = [
    ...columns.map((column) => {
      const file = fileName(column, input);
      const expression = cleansed[column.name];
      if (expression !== undefined) return `${expression} AS ${quote(column.name)}`;
      return file === column.name ? quote(column.name) : `${quote(file)} AS ${quote(column.name)}`;
    }),
    ...extra.map((column) =>
      column.logicalType === "timestamp"
        ? `CONVERT(DATETIME2(7), ${quote(column.name)}, 127) AS ${quote(column.name)}`
        : quote(column.name),
    ),
    ...(input.withFile ? [`[rows].filepath() AS ${quote(fileColumn)}`] : []),
  ];
  return listed
    ? `SELECT\n${items.map((item) => `  ${item}`).join(",\n")}`
    : `SELECT ${items.join(", ")}`;
}

/** The column that names each row's file, for deduplicate; no file holds it. */
export const fileColumn = "_ingestron_file";

/** Extra columns are written as text by the step that adds them; timestamps are ISO 8601 text. */
function extraList(extra: Column[]): string[] {
  return extra.map(
    (column) =>
      `  ${quote(column.name)} ${column.logicalType === "timestamp" ? `VARCHAR(40) ${utf8}` : fallbackType}`,
  );
}

const utf8 = "COLLATE Latin1_General_100_BIN2_UTF8";

/** The column's name in the files: its physicalName when the ingest did not rename it. */
export function fileName(column: Column, { renamed = true }: ColumnOptions): string {
  return !renamed && column.physicalName ? column.physicalName : column.name;
}

/** The column's type in the view: the resolved type when it is Synapse's; otherwise from the logicalType. */
export function typeOf(column: Column, { resolvedTypes = false }: ColumnOptions): string {
  const mapped = column.logicalType ? synapseTypes[column.logicalType] : undefined;
  const type = resolvedTypes ? (column.type ?? mapped) : (mapped ?? column.type);
  return type ?? fallbackType;
}

/** What a view over files reads. */
export interface FilesInput extends ColumnOptions {
  /** The file or pattern, relative to the data source. */
  path: string;
  dataSource: string;
  format: "parquet" | "csv";
  columns: Column[];
  /** Columns the files carry beyond the contract, such as audit columns, in order. */
  extra?: Column[];
  csv?: { header: boolean; delimiter: string };
  /** Each cleansed column's expression, by its contract name. */
  cleansed?: Record<string, string>;
  /** Adds the file each row came from, `[rows].filepath()`, as `[_ingestron_file]`. */
  withFile?: boolean;
}

/**
 * `SELECT * FROM OPENROWSET(...) WITH (...) AS [rows]` over files under a data source.
 * @example filesQuery({ path: "erp/orders/*.parquet", dataSource: "landing", format: "parquet", columns })
 */
export function filesQuery(input: FilesInput): string {
  const options = [
    `  BULK ${literal(input.path)}`,
    `  DATA_SOURCE = ${literal(input.dataSource)}`,
    ...formatOptions(input),
  ];
  return [
    selectClause(input),
    "FROM OPENROWSET(",
    options.join(",\n"),
    ") WITH (",
    [columnList(input.columns, input), ...extraList(input.extra ?? [])].join(",\n"),
    ") AS [rows]",
  ].join("\n");
}

function formatOptions({ format, csv }: FilesInput): string[] {
  if (format === "parquet") return ["  FORMAT = 'PARQUET'"];
  const { header, delimiter } = csv ?? { header: true, delimiter: "," };
  return [
    "  FORMAT = 'CSV'",
    "  PARSER_VERSION = '2.0'",
    ...(header ? ["  HEADER_ROW = TRUE"] : []),
    `  FIELDTERMINATOR = ${literal(delimiter)}`,
  ];
}

/**
 * Creates the schema when it is missing, then creates or alters the view; each
 * statement ends with `GO`, so the script runs again safely.
 * @example viewStatement({ schema: "bronze", table: "orders" }, "SELECT 1")
 */
export function viewStatement(fullName: { schema: string; table: string }, query: string): string {
  const create = `CREATE SCHEMA ${quote(fullName.schema)}`;
  return [
    `IF SCHEMA_ID(N${literal(fullName.schema)}) IS NULL EXEC(N${literal(create)});`,
    "GO",
    `CREATE OR ALTER VIEW ${quote(fullName.schema)}.${quote(fullName.table)} AS`,
    `${query};`,
    "GO",
  ].join("\n");
}

/** A T-SQL string literal, with `'` doubled. */
export function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}
