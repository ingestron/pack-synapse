// The pack: views in Azure Synapse serverless SQL over files and tables other
// packs land or store, and transforms as views.
import type { Pack, ResolvedModel } from "@ingestron/definitions";
import { build, hasView } from "./build.js";
import { contract } from "./contract.js";
import { request } from "./request.js";
import { synapseServe, synapseSql, synapseView } from "./methods.js";
import { synapseTypes } from "./types.js";

/**
 * The Synapse serverless SQL pack.
 * @example loadDefinitions("definitions", { packs: [adf, synapse] })
 */
export const synapse: Pack = {
  id: "synapse",
  version: 1,
  defaults: {
    naming: {
      catalog: "{{ project }}_{{ environment }}",
      schema: "{{ layer }}",
      table: "{{ table }}",
      pipeline: "{{ project }}",
      job: "{{ project }}_refresh",
    },
    layers: ["bronze", "silver", "gold"],
    types: synapseTypes,
    quality: { required: "warn", default: "warn" },
  },
  rules: { store: { default: "synapse-view" }, transform: { default: "synapse-sql" } },
  methods: {
    "synapse-view": synapseView,
    "synapse-sql": synapseSql,
    "synapse-serve": synapseServe,
  },
  build,
  check: transformInputs,
  request,
  contract,
};

/** A T-SQL transform reads other tables' views, so each input needs one. */
function transformInputs(model: ResolvedModel): string[] {
  return model.tables
    .filter((table) => table.transform?.method === "synapse-sql")
    .flatMap((table) =>
      Object.keys(table.transform!.inputs)
        .filter((input) => !model.tables.some((item) => item.name === input && hasView(item)))
        .map(
          (input) =>
            `transform "${table.name}" reads "${input}", which has no Synapse view; store it with synapse-view or serve it with synapse-serve`,
        ),
    );
}
