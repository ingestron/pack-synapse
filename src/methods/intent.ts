// What the pack does with each intent path and value (definitions specification, section 11).
// Synapse serverless builds views, which keep and run nothing, so it applies none of it.
import { type IntentUse } from "@ingestron/definitions";

const keepsNothing: IntentUse = {
  use: "not-applicable",
  reason: "Views keep nothing; they read files or a query each time.",
};
const landsFiles: IntentUse = { use: "elsewhere", reason: "Another pack lands the files." };
const addsNoColumns: IntentUse = {
  use: "not-applicable",
  reason: "A view adds no columns of its own.",
};

/**
 * The pack's coverage. A view keeps no table, so what a store or the load would keep is
 * `not-applicable`; the landing pack's work is `elsewhere`. The view is the step that
 * writes the table and reads the files, so the audit values those steps add are
 * `not-applicable`; the ingest step's audit values stay `elsewhere`.
 */
export const intent: Record<string, IntentUse> = {
  history: keepsNothing,
  sequence: keepsNothing,
  storage: keepsNothing,
  "retention.time_travel": keepsNothing,
  "retention.log": keepsNothing,
  rescued: keepsNothing,
  "quality.results": keepsNothing,
  "load.deletes": keepsNothing,
  load: landsFiles,
  "retention.landed_files": landsFiles,
  audit: landsFiles,
  ...Object.fromEntries(
    ["loaded_at", "row_hash", "source_file", "source_modified_at"].map((value) => [
      `audit=${value}`,
      addsNoColumns,
    ]),
  ),
  operations: { use: "not-applicable", reason: "Synapse serverless runs no jobs." },
};
