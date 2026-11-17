// Synapse workspace copies reuse the public SQL copy contract, narrowed to supported artifacts.
import { adf } from "@ingestron/pack-adf";
import { fullOnlyProblems } from "./full-only.js";
import type { Method, ResolvedModel, ResolvedTable } from "@ingestron/definitions";

const copy = adf.methods["adf-copy"]!;
const schema = copy.settings as { properties: Record<string, unknown> };
const keys = [
  "landing",
  "key_vault",
  "integration_runtime",
  "every",
  "start",
  "retries",
  "paused",
  "encrypt",
];

/** Only tables owned by this workspace method are passed to the shared SQL copy builder. */
export function copyModel(model: ResolvedModel): ResolvedModel {
  return {
    ...model,
    tables: model.tables.filter((table) => table.ingest?.method === "synapse-copy").map(copyTable),
  };
}

function copyTable(table: ResolvedTable): ResolvedTable {
  return { ...table, ingest: { ...table.ingest!, pack: "adf", method: "adf-copy" } };
}

/** A full Azure SQL snapshot into Parquet, orchestrated inside the Synapse workspace. */
export const synapseCopy: Method = {
  ...copy,
  description:
    "Synapse pipelines copy an Azure SQL Database table into landing storage as a full Parquet snapshot. Uses an existing workspace integration runtime; no separate Data Factory is needed.",
  connectors: ["azure-sql-database"],
  connectivity: ["public", "workspace"],
  defaults: {
    ...copy.defaults,
    runtime_kind: "azure",
    mode: "full",
    layout: "snapshot",
    paused: true,
  },
  filters: true,
  intent: {
    "load.mode=full": {
      use: "used",
      does: "A full Azure SQL snapshot copied by the workspace pipeline.",
    },
    "load.mode=incremental": {
      use: "not-yet",
      reason: "This workspace route supports full snapshots only.",
    },
    "load.cursor": { use: "not-applicable", reason: "A full snapshot has no incremental cursor." },
    "operations.retries": {
      use: "used",
      does: "Each Copy activity's retry count, five minutes apart.",
    },
    "operations.timeout": adf.intent!["operations.timeout"]!,
    "operations.schedule=project": {
      use: "used",
      does: "UTC ScheduleTriggers from the workspace copy settings.",
    },
    "operations.schedule=flow": {
      use: "used",
      does: "A flow's own ScheduleTrigger or TumblingWindowTrigger resources, written as the Data Factory pack writes them.",
    },
    "operations.concurrency": {
      use: "not-applicable",
      reason:
        "This workspace route runs each pipeline one at a time, so full snapshots never overlap.",
    },
  },
  placement: {
    platform: ["landing", "key_vault", "integration_runtime", "paused"],
    standard: ["every", "start", "retries", "mode", "layout", "encrypt"],
  },
  settings: {
    type: "object",
    additionalProperties: false,
    required: ["landing", "key_vault", "integration_runtime", "start"],
    properties: {
      ...Object.fromEntries(keys.map((key) => [key, schema.properties[key]])),
      start: {
        ...(schema.properties.start as object),
        description: "First full snapshot schedule time (UTC)",
      },
      every: {
        ...(schema.properties.every as object),
        description: "Full snapshot schedule frequency",
      },
      format: {
        enum: ["parquet"],
        description: "Typed Parquet snapshots for the serverless views.",
      },
      runtime_kind: {
        enum: ["azure"],
        description: "This workspace route references an existing Azure runtime only.",
      },
      integration_runtime: {
        type: "string",
        minLength: 1,
        default: "AutoResolveIntegrationRuntime",
        description:
          "An existing Azure integration runtime in this Synapse workspace. It is referenced, never generated or reset.",
        examples: ["AutoResolveIntegrationRuntime"],
      },
      paused: {
        type: "boolean",
        description:
          "Keep the workspace schedule trigger stopped. Defaults to true in every environment.",
      },
      retries: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description:
          "Retries for each failed Copy activity, five minutes apart; this route has no tumbling-window retries.",
      },
      mode: {
        enum: ["full"],
        description:
          "Full snapshots only; incremental windows are not supported by this workspace route.",
      },
      layout: {
        enum: ["snapshot"],
        description: "One Parquet file per source table, replaced by each full copy.",
      },
    },
  },
  check: (table) => [
    ...(copy.check?.(copyTable(table)) ?? []),
    ...fullOnlyProblems(table),
    ...((table.ingest?.connection.settings.authentication ?? "SQL") !== "SQL"
      ? [
          "This Synapse workspace route currently supports SQL authentication only; use a Key Vault password reference.",
        ]
      : []),
    ...((table.intent.audit ?? []).some((item) =>
      ["window_start", "window_end"].includes(item.value),
    )
      ? [
          "Synapse full snapshots have no window boundaries; window_start and window_end audit columns are not supported.",
        ]
      : []),
  ],
};

/** Connector facts for the supported workspace route; all other connectors stay on their own routes. */
export const pipelineConnectors = (adf.connectors ?? [])
  .filter((connector) => connector.id === "azure-sql-database" && connector.method === "adf-copy")
  .map((connector) => ({
    ...connector,
    method: "synapse-copy",
    settings: connector.settings
      .filter((setting) =>
        ["server", "user", "password", "authentication", "host_name_in_certificate"].includes(
          setting.name,
        ),
      )
      .map((setting) =>
        setting.name === "authentication" ? { ...setting, values: ["SQL"] } : setting,
      ),
    maturity: { status: "Preview", checked: "2026-11-14" },
    generates:
      "Synapse workspace linked services, datasets, a full snapshot pipeline and a schedule trigger",
    docs: "https://learn.microsoft.com/en-us/azure/data-factory/connector-azure-sql-database",
  }));
