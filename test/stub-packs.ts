// Packs that stand in for the ones Synapse serves, so this pack is tested
// through the pack interface alone. Tests with real packs live in the CLI.
import type { Pack, ResolvedTable } from "@ingestron/definitions";
import { synapse } from "../src/index.js";

const defaults = synapse.defaults;
const object = (table: ResolvedTable) => table.ingest!.object;

/** Lands each table's files as one Parquet file, or where the `location` setting says. */
export const landing: Pack = {
  id: "landing",
  version: 1,
  defaults,
  rules: { ingest: { default: "land" } },
  methods: {
    land: {
      action: "ingest",
      description: "Lands files.",
      connectors: ["files"],
      produces: "files",
      settings: {
        type: "object",
        properties: { location: { type: "string" }, format: { type: "string" } },
      },
      output: (table) => ({
        location: String(
          table.ingest!.settings.location ??
            `abfss://landing@acct.dfs.core.windows.net/erp/${object(table)}/${object(table)}.parquet`,
        ),
        format: (table.ingest!.settings.format as "parquet" | "csv" | "json") ?? "parquet",
        loads: "replace",
      }),
    },
  },
  build: () => ({}),
};

/** Stores tables: `keep` says where its Parquet files are, `opaque` does not. */
export const tables: Pack = {
  id: "tables",
  version: 1,
  defaults,
  rules: {},
  methods: {
    keep: {
      action: "store",
      description: "Keeps the table as Parquet files.",
      accepts: ["files"],
      produces: "table",
      settings: { type: "object" },
      output: (table) => ({
        location: `abfss://landing@acct.dfs.core.windows.net/published/${table.name}/*.parquet`,
        format: "parquet",
        loads: "add",
      }),
    },
    opaque: {
      action: "store",
      description: "Keeps the table where only its platform knows.",
      accepts: ["files"],
      produces: "table",
      settings: { type: "object" },
    },
  },
  build: () => ({}),
};
