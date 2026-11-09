// Where a view reads: the previous step's output, as a path under the
// external data source that the platform names.
import type { ResolvedTable, Step, StepOutput } from "@ingestron/definitions";

/**
 * The Synapse step that views the table: its serve step when Synapse serves it, else
 * its store step when Synapse keeps it; undefined when Synapse does neither.
 */
export function viewingStep(table: ResolvedTable): Step | undefined {
  const step = table.serve?.method === "synapse-serve" ? table.serve : table.store;
  return step && /^synapse-(view|serve)$/.test(step.method) ? step : undefined;
}

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
  if (abfss) return `https://${abfss[2]!.toLowerCase()}/${abfss[1]}${abfss[3] ?? ""}`;
  const https = /^https:\/\/([^/]+)(\/.*)?$/i.exec(location);
  if (https) return `https://${https[1]!.toLowerCase()}${https[2] ?? ""}`;
  return location;
}

/** The output's path relative to the data source, or a problem. */
export function relativePath(
  output: StepOutput,
  settings: Record<string, unknown>,
): { path: string } | { problem: string; outside?: true } {
  // A folder keeps its trailing slash: without it, a path names a file.
  const root = canonical(String(settings.data_source_location ?? "")).replace(/\/+$/, "");
  const location = canonical(output.location);
  if (!location.startsWith(`${root}/`))
    return {
      problem: `${output.location} is not under the data source ${String(settings.data_source)} (${String(settings.data_source_location)})`,
      outside: true,
    };
  const path = location.slice(root.length + 1);
  if (/\*\*(?!$)/.test(path)) return { problem: `${path}: a path can use ** only at its end` };
  return { path };
}

/**
 * True when a text holds a value supplied only when deploying, `${envvar:NAME}`, as a
 * model resolved with `deployTime` writes it. A method's check gets only the table, not
 * the model's `deployValues`, so it cannot use the definitions package's
 * `splitDeployText`, which the fold uses; this matches the text the configuration
 * specification gives those values (NAME is `[A-Za-z_][A-Za-z0-9_]*`).
 */
export function holdsDeployText(text: string): boolean {
  return /\$\{envvar:[A-Za-z_][A-Za-z0-9_]*\}/.test(text);
}

/**
 * Problems with the files a step reads, as METHOD_CHECK messages. Whether files are
 * under a location supplied only when deploying is not known yet, so it is not judged.
 */
export function filesProblems(table: ResolvedTable, settings: Record<string, unknown>): string[] {
  const output = sourceStep(table)?.output;
  if (!output) return [];
  if (output.format !== "parquet" && output.format !== "csv")
    return [`it reads parquet and csv files, not ${output.format}`];
  const relative = relativePath(output, settings);
  if (!("problem" in relative)) return [];
  const location = String(settings.data_source_location ?? "");
  const unknown = holdsDeployText(output.location) || holdsDeployText(location);
  return relative.outside && unknown ? [] : [relative.problem];
}
