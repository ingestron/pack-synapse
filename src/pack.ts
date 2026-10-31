// The pack: views in Azure Synapse serverless SQL over files and tables other
// packs land or store, and transforms as views.
import type { Pack } from "@ingestron/definitions";
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
  methods: {},
  build: () => ({}),
};
