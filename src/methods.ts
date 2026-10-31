// The pack's methods: a view as a table's store, a transform in T-SQL, and a
// view over a table another pack stores.
import type { Method, ResolvedTable } from "@ingestron/definitions";
import { filesProblems } from "./locations.js";

/** Where the views read files: the external data source the platform team creates. */
const placement = { platform: ["data_source", "data_source_location"], standard: ["csv"] };

const settings = {
  type: "object",
  additionalProperties: false,
  required: ["data_source", "data_source_location"],
  properties: {
    data_source: {
      type: "string",
      description: "The external data source's name in the serverless database.",
      examples: ["landing"],
    },
    data_source_location: {
      type: "string",
      pattern: "^(abfss|https)://",
      description: "The data source's location; every file a view reads must be under it.",
      examples: ["abfss://landing@acct.dfs.core.windows.net"],
    },
    csv: {
      type: "object",
      additionalProperties: false,
      description: "How CSV files are read.",
      properties: {
        header: { type: "boolean", description: "The first row names the columns." },
        delimiter: {
          type: "string",
          description: "The field separator.",
          examples: [",", ";", "|"],
        },
      },
    },
  },
};

const defaults = { csv: { header: true, delimiter: "," } };

/** A view keeps a synapse-sql transform, or reads its ingest's recorded files. */
function checkView(table: ResolvedTable): string[] {
  const transform = table.transform?.method;
  if (transform)
    return transform === "synapse-sql"
      ? []
      : [`it keeps synapse-sql transforms only, not "${transform}"`];
  if (!table.ingest?.output)
    return [
      `"${table.ingest?.method}" does not say where its files land, so no view can read them`,
    ];
  return filesProblems(table, table.store!.settings);
}

const reference = /\{\{\s*tables\.([A-Za-z0-9_-]+)\s*\}\}/g;

/** A transform's SQL can sit inside a view: no leading WITH, and only its listed inputs. */
function checkSql(table: ResolvedTable): string[] {
  const { code, inputs } = table.transform!;
  const leadingWith = /^\s*with\b/i.test(code)
    ? ["a view's SQL cannot start with WITH; write the common table expression as a subquery"]
    : [];
  const unlisted = [...code.matchAll(reference)]
    .map((match) => match[1]!)
    .filter((input) => !(input in inputs))
    .map((input) => `the SQL names {{ tables.${input} }}, which is not in inputs`);
  return [...leadingWith, ...unlisted];
}

/** A view over a table's landed files, or over its transform's query. */
export const synapseView: Method = {
  action: "store",
  description:
    "A view in Synapse serverless SQL: over the table's landed files, or over its transform's query. Nothing runs after a load.",
  accepts: ["files", "query"],
  produces: "table",
  placement,
  defaults,
  settings,
  check: checkView,
};

/** A transform's SQL in T-SQL, kept as a view by synapse-view. */
export const synapseSql: Method = {
  action: "transform",
  description: "The transform's SQL in T-SQL, over other tables' views; synapse-view keeps it.",
  accepts: ["table"],
  produces: "query",
  settings: { type: "object", additionalProperties: false, properties: {} },
  check: checkSql,
};

/** A view over the files a table's last step records. */
export const synapseServe: Method = {
  action: "serve",
  description:
    "A view in Synapse serverless SQL over the files the table's last step records, such as a table another pack stores.",
  accepts: ["table", "files"],
  produces: "table",
  needsOutput: true,
  placement,
  defaults,
  settings,
  check: (table) => filesProblems(table, table.serve!.settings),
};
