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

/** `*`, or each column under its contract name when a file name differs. */
function selectList(columns: Column[], options: ColumnOptions): string {
  if (columns.every((column) => fileName(column, options) === column.name)) return "*";
  return columns
    .map((column) => {
      const file = fileName(column, options);
      return file === column.name ? quote(column.name) : `${quote(file)} AS ${quote(column.name)}`;
    })
    .join(", ");
}

function fileName(column: Column, { renamed = true }: ColumnOptions): string {
  return !renamed && column.physicalName ? column.physicalName : column.name;
}

/** The resolved type when it is Synapse's; otherwise from the logicalType. */
function typeOf(column: Column, { resolvedTypes = false }: ColumnOptions): string {
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
  csv?: { header: boolean; delimiter: string };
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
    `SELECT ${selectList(input.columns, input)}`,
    "FROM OPENROWSET(",
    options.join(",\n"),
    ") WITH (",
    columnList(input.columns, input),
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
function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}
