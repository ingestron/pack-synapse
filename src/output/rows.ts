// A view's query as T-SQL (spec/behaviour.md, "The view"): its rows, cleansed and deduplicated,
// then, when it has drop checks, only the rows that pass them. checks.sql counts row checks over
// the rows before the drop checks, and table checks over the rows the view keeps.
import type { CodePart, TransformPlan, ViewPlan } from "../plan/index.js";
import { fileColumn, filesQuery, quote } from "../sql/index.js";

/** The view's query: its rows, less the rows a drop check fails. */
export function viewQuery(view: ViewPlan): string {
  const rows = rowsQuery(view);
  const drops = view.quality?.drops ?? [];
  if (drops.length === 0) return rows;
  const where = drops.map((condition) => `(${condition})`).join("\n  AND ");
  return ["SELECT *", "FROM (", rows, ") AS [checked]", `WHERE ${where}`].join("\n");
}

/** The view's rows: read, cleansed, and one per key when the table deduplicates. */
export function rowsQuery(view: ViewPlan): string {
  const { query } = view;
  const base = query.kind === "files" ? filesQuery(query) : transformQuery(query);
  const deduplicate = view.quality?.deduplicate;
  if (!deduplicate) return base;
  const keys = deduplicate.keys.map(quote).join(", ");
  const order = [...deduplicate.orderBy, ...(query.kind === "files" ? [fileColumn] : [])]
    .map((column) => `${quote(column)} DESC`)
    .join(", ");
  return [
    `SELECT ${view.quality!.outputs.map(quote).join(", ")}`,
    "FROM (",
    `SELECT *, ROW_NUMBER() OVER (PARTITION BY ${keys} ORDER BY ${order}) AS [_ingestron_row]`,
    "FROM (",
    base,
    ") AS [cleansed]",
    ") AS [numbered]",
    "WHERE [_ingestron_row] = 1",
  ].join("\n");
}

/** The transform's SQL inside the view, selecting the contract's columns, each cleansed one as its expression. */
function transformQuery(query: TransformPlan): string {
  const code = codeOf(query);
  const cleansed = query.cleansed ?? {};
  const select =
    Object.keys(cleansed).length === 0
      ? `SELECT ${query.columns.map(quote).join(", ")}`
      : `SELECT\n${query.columns.map((name) => `  ${cleansed[name] === undefined ? quote(name) : `${cleansed[name]} AS ${quote(name)}`}`).join(",\n")}`;
  return [select, "FROM (", code, ") AS [source]"].join("\n");
}

/** The transform's code as views.sql holds it, each input named by its view. */
export function codeOf(query: TransformPlan): string {
  return query.code.map(codeText).join("");
}

function codeText(part: CodePart): string {
  if (typeof part === "string") return part;
  const database = part.database === undefined ? "" : `${quote(part.database)}.`;
  return `${database}${quote(part.schema)}.${quote(part.name)}`;
}
