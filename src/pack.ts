// The pack: views in Azure Synapse serverless SQL over files and tables other
// packs land or store, and transforms as views.
import type { Pack, ResolvedModel } from "@ingestron/definitions";
import { build as sqlBuild } from "./output/index.js";
import { buildEnvironments as sqlEnvironments } from "./fold/index.js";
import { adf } from "@ingestron/pack-adf";
import {
  pipelineConnectors,
  pipelineProblems,
  synapseCopy,
  pipelineEnvironments,
  pipelineFiles,
  pipelineRequest,
} from "./pipelines/index.js";
import { hasView } from "./plan/index.js";
import { sqlcmdProblems } from "./fold/index.js";
import { capabilities, contract, platformSection } from "./methods/index.js";
import { intent, request } from "./methods/index.js";
import { synapseServe, synapseSql, synapseView } from "./methods/index.js";
import { synapseTypes } from "./sql/index.js";
import { metadataType } from "./sql/index.js";
import { canonical, viewingStep } from "./sql/index.js";

/**
 * The Synapse serverless SQL pack.
 * @example loadDefinitions("definitions", { packs: [synapse, adf] })
 * @public
 */
export const synapse: Pack = {
  id: "synapse",
  version: 2,
  metadataType,
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
    "synapse-copy": synapseCopy,
  },
  connectors: pipelineConnectors,
  build: (model) => ({ ...sqlBuild(model), ...pipelineFiles(model) }),
  buildEnvironments: (models) => {
    const sql = sqlEnvironments(models);
    const pipelines = pipelineEnvironments(models);
    const problems = [...sql.problems, ...pipelines.problems];
    const failed = problems.some((problem) => problem.severity === "error");
    return {
      files: failed ? {} : { ...sql.files, ...pipelines.files },
      deployValues: sql.deployValues,
      problems,
    };
  },
  check: (model) => [
    ...transformInputs(model),
    ...dataSourceLocations(model),
    ...sqlcmdProblems(model),
    ...pipelineProblems(model),
  ],
  request: (model) => [...request(model), ...pipelineRequest(model)],
  checkFirstWrites: (files, generatedBefore, now) =>
    adf.checkFirstWrites?.(workspaceFiles(files), generatedBefore, now) ?? [],
  contract,
  platformSection,
  capabilities,
  intent,
};

/** The workspace artifacts among a build's files, the ones the ADF pack's first-write rules read. */
function workspaceFiles(files: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => path.startsWith("workspace/")),
  );
}

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
    const step = viewingStep(table);
    if (!step) continue;
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
