// Projects resolved for every environment, as the CLI resolves them for a pack that
// builds environments together, and what sqlcmd runs for each environment.
import { memoryFiles } from "@ingestron/config";
import {
  checkFold,
  resolveDefinitions,
  type FoldView,
  type Pack,
  type ResolvedModel,
} from "@ingestron/definitions";
import { synapse } from "../src/index.js";
import { base } from "./project.js";
import { runSqlcmd, type Run } from "./sqlcmd-model.js";
import { landing, tables } from "./stub-packs.js";

/** Each target's model, by name. */
export type Models = Record<string, ResolvedModel>;

/** A transform over orders whose code holds a value of each environment. */
export const totals = [
  "apiVersion: ingestron.io/v1",
  "kind: Transform",
  "id: totals",
  "inputs: [orders]",
  "code: \"SELECT id, total FROM {{ tables.orders }} WHERE region = '${values.region}'\"",
  "contract: orders",
  "",
].join("\n");

/** Orders with the region each was placed in, and their totals. */
const contract = base["orders.yaml"]!.replace(
  "  - name: orders\n",
  "  - name: totals\n    logicalType: object\n    properties:\n      - { name: id, logicalType: integer }\n      - { name: total, logicalType: number }\n  - name: orders\n",
).replace(/number \}\n$/, "number }\n      - { name: region, logicalType: string }\n");

/**
 * The ERP project in dev, test and prod. The data source is the same in test and prod
 * but differs in dev; the database and the region in the transform's code differ in each.
 */
export function erpEnvironments(changes: Record<string, string> = {}): Record<string, string> {
  const values = (source: string, region: string) => `{ source: ${source}, region: ${region} }`;
  const project = [
    "id: erp",
    `values: ${values("landing_dev", "north-east")}`,
    "environments:",
    "  dev: {}",
    `  test: { values: ${values("landing", "north")} }`,
    `  prod: { values: ${values("landing", "west")} }`,
    "imports: ['*.yaml']",
    "",
  ].join("\n");
  const platform = base["platform.yaml"]!.replaceAll(
    "data_source: landing",
    "data_source: ${values.source}",
  );
  return {
    ...base,
    "project.yaml": project,
    "platform.yaml": platform,
    "orders.yaml": contract,
    "totals.yaml": totals,
    ...changes,
  };
}

/** A project.yaml for the ERP project with the environments given, as YAML lines. */
export function erpProject(environments: string[], values = ""): string {
  return [
    "id: erp",
    ...(values ? [`values: ${values}`] : []),
    "environments:",
    ...environments,
    "imports: ['*.yaml']",
    "",
  ].join("\n");
}

/** Each environment's model, resolved with deploy-time values; fails on any error. */
export function resolveAll(files: Record<string, string>, environments: string[]): Models {
  return Object.fromEntries(
    environments.map((environment) => {
      const result = resolveDefinitions(memoryFiles(files), {
        packs: [landing, synapse, tables],
        environment,
        deployTime: true,
        environmentsTogether: true,
      });
      const errors = result.diagnostics.filter((item) => item.severity === "error");
      if (errors.length > 0 || !result.model)
        throw new Error(`${environment}: ${errors.map((item) => item.message).join("; ")}`);
      return [environment, result.model];
    }),
  );
}

/** The folded files for the models. */
export function fold(models: Models) {
  return synapse.buildEnvironments!(models);
}

/**
 * What sqlcmd runs for one target, started in the pack's output folder with
 * `-i environments/<target>.sql`, each value the pipeline supplies set as an
 * environment variable holding its deploy-time text.
 */
export function sqlcmdRun(
  files: Readonly<Record<string, string>>,
  target: string,
  supplied: Readonly<Record<string, string>> = {},
): Run {
  return runSqlcmd({ files, input: `environments/${target}.sql`, environment: supplied });
}

/** The fold property's view: the lines sqlcmd sends from views.sql, and its errors. */
export function sqlcmdFold(supplied: Readonly<Record<string, string>>): FoldView {
  return {
    view(files, target) {
      const run = sqlcmdRun(files, target, supplied);
      const views = run.lines.filter((line) => line.file === "views.sql");
      return {
        ...(views.length > 0 && { "views.sql": `${views.map((line) => line.text).join("\n")}\n` }),
        ...(run.errors.length > 0 && { "sqlcmd errors": run.errors.join("\n") }),
      };
    },
  };
}

/** The text standing for each value the pipeline supplies, by the name it supplies it as. */
export function suppliedTexts(models: Models): Record<string, string> {
  return Object.fromEntries(
    fold(models).deployValues.flatMap((value) =>
      value.suppliedAs.map((name) => [name, `\${envvar:${value.name}}`]),
    ),
  );
}

/** The fold property's failures for the models of the first one, two and more targets. */
export function foldFailures(models: Models, pack: Pack = synapse): string[] {
  return checkFold(pack, models, sqlcmdFold(suppliedTexts(models)));
}
