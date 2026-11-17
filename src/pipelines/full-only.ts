// The workspace route copies full snapshots, so a trigger may not ask for an incremental load.
import type { ResolvedTable } from "@ingestron/definitions";

const refusal = "The Synapse workspace route copies full snapshots only;";

/**
 * A trigger that sets `load: incremental`, and a tumbling window that would pass a window to
 * an incremental table. A tumbling window on a full table is allowed.
 */
export function fullOnlyProblems(table: ResolvedTable): string[] {
  const incremental = table.ingest?.settings.mode === "incremental";
  return (table.ingest?.triggers ?? []).flatMap((trigger) => [
    ...(trigger.parameters.load === "incremental"
      ? [`${refusal} remove \`load: incremental\` from "${trigger.name}"`]
      : []),
    ...(incremental && trigger.type === "tumbling-window"
      ? [
          `${refusal} the tumbling-window trigger "${trigger.name}" would pass a window to the incremental table "${table.name}"`,
        ]
      : []),
  ]);
}
