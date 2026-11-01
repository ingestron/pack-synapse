// The pack: views in Azure Synapse serverless SQL over files and tables other
// packs land or store, and transforms as views.
import type { Pack, ResolvedModel } from "@ingestron/definitions";
import { build, hasView } from "./build.js";
import { contract } from "./contract.js";
import { request } from "./request.js";
import { synapseServe, synapseSql, synapseView } from "./methods.js";
import { synapseTypes } from "./types.js";
import { canonical } from "./locations.js";

/**
 * The Synapse serverless SQL pack.
 * @example loadDefinitions("definitions", { packs: [synapse, adf] })
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
  check: (model) => [...transformInputs(model), ...dataSourceLocations(model)],
  request,
  contract,
};

/** A T-SQL transform is kept by synapse-view and reads other tables' views. */
function transformInputs(model: ResolvedModel): string[] {
  return model.tables
    .filter((table) => table.transform?.method === "synapse-sql")
    .flatMap((table) => [
      ...(table.store?.method === "synapse-view"
        ? []
        : [
            `transform "${table.name}" is T-SQL (synapse-sql), so only synapse-view can keep it, not "${table.store?.method}"`,
          ]),
      ...Object.keys(table.transform!.inputs)
        .filter((input) => !model.tables.some((item) => item.name === input && hasView(item)))
        .map(
          (input) =>
            `transform "${table.name}" reads "${input}", which has no Synapse view; store it with synapse-view or serve it with synapse-serve`,
        ),
    ]);
}

/** One data source name is one location: the platform team creates it once per database. */
function dataSourceLocations(model: ResolvedModel): string[] {
  const seen = new Map<string, Set<string>>();
  for (const table of model.tables) {
    const step = table.serve?.method === "synapse-serve" ? table.serve : table.store;
    if (!step || !/^synapse-(view|serve)$/.test(step.method)) continue;
    const name = String(step.settings.data_source);
    const locations = seen.get(name) ?? new Set<string>();
    locations.add(canonical(String(step.settings.data_source_location)).replace(/\/+$/, ""));
    seen.set(name, locations);
  }
  return [...seen]
    .filter(([, locations]) => locations.size > 1)
    .map(
      ([name, locations]) =>
        `the data source \`${name}\` is at two locations, ${[...locations].join(" and ")}; give each location its own data_source name`,
    );
}
