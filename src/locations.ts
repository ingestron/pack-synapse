// Where a view reads: the previous step's output, as a path under the
// external data source that the platform names.
import type { ResolvedTable, Step, StepOutput } from "@ingestron/definitions";

/** The step whose output a Synapse step reads: the store, else the ingest. */
export function sourceStep(table: ResolvedTable): Step | undefined {
  return table.serve ? (table.store ?? table.ingest) : table.ingest;
}

/**
 * A location in one form for comparing: `https://<account host, lower case>/<file system>/<path>`,
 * from either `abfss://<file system>@<host>/<path>` or `https://<host>/<file system>/<path>`.
 */
export function canonical(location: string): string {
  const abfss = /^abfss:\/\/([^@/]+)@([^/]+)(\/.*)?$/i.exec(location);
  if (abfss)
    return `https://${abfss[2]!.toLowerCase()}/${abfss[1]}${abfss[3] ?? ""}`.replace(/\/+$/, "");
  const https = /^https:\/\/([^/]+)(\/.*)?$/i.exec(location);
  if (https) return `https://${https[1]!.toLowerCase()}${https[2] ?? ""}`.replace(/\/+$/, "");
  return location.replace(/\/+$/, "");
}

/** The output's path relative to the data source, or a problem. */
export function relativePath(
  output: StepOutput,
  settings: Record<string, unknown>,
): { path: string } | { problem: string } {
  const root = canonical(String(settings.data_source_location ?? ""));
  const location = canonical(output.location);
  if (!location.startsWith(`${root}/`))
    return {
      problem: `${output.location} is not under the data source ${String(settings.data_source)} (${String(settings.data_source_location)})`,
    };
  const path = location.slice(root.length + 1);
  if (/\*\*(?!$)/.test(path)) return { problem: `${path}: a path can use ** only at its end` };
  return { path };
}

/** Problems with the files a step reads, as METHOD_CHECK messages. */
export function filesProblems(table: ResolvedTable, settings: Record<string, unknown>): string[] {
  const output = sourceStep(table)?.output;
  if (!output) return [];
  if (output.format !== "parquet" && output.format !== "csv")
    return [`it reads parquet and csv files, not ${output.format}`];
  const relative = relativePath(output, settings);
  return "problem" in relative ? [relative.problem] : [];
}
