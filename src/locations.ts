// Where a view reads: the previous step's output, as a path under the
// external data source that the platform names.
import type { ResolvedTable, Step, StepOutput } from "@ingestron/definitions";

/** The step whose output a Synapse step reads: the store, else the ingest. */
export function sourceStep(table: ResolvedTable): Step | undefined {
  return table.serve ? (table.store ?? table.ingest) : table.ingest;
}

/** The output's path relative to the data source, or a problem. */
export function relativePath(
  output: StepOutput,
  settings: Record<string, unknown>,
): { path: string } | { problem: string } {
  const root = String(settings.data_source_location ?? "").replace(/\/+$/, "");
  if (!output.location.startsWith(`${root}/`))
    return {
      problem: `${output.location} is not under the data source ${String(settings.data_source)} (${root})`,
    };
  return { path: output.location.slice(root.length + 1) };
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
