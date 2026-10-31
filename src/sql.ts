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

/**
 * The column list for OPENROWSET's WITH clause: each column typed from its
 * logicalType, or by the type written for it when it has none.
 * @example columnList([{ name: "id", logicalType: "integer", nullable: false }]) // "  [id] BIGINT"
 */
export function columnList(columns: Column[]): string {
  return columns
    .map((column) => {
      const type = (column.logicalType && synapseTypes[column.logicalType]) ?? column.type;
      return `  ${quote(column.name)} ${type ?? fallbackType}`;
    })
    .join(",\n");
}

/** What a view over files reads. */
export interface FilesInput {
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
    "SELECT *",
    "FROM OPENROWSET(",
    options.join(",\n"),
    ") WITH (",
    columnList(input.columns),
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
