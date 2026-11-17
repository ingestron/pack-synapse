// Native workspace artifacts, not Data Factory ARM exports. The shared builder supplies Copy JSON.
import { adf } from "@ingestron/pack-adf";
import type { EnvironmentsBuild, RequestSection, ResolvedModel } from "@ingestron/definitions";
import { copyModel } from "./method.js";
import { dropWindow, flowPipelines, isDefaultTrigger, schedule, type Resource } from "./shape.js";

/** Workspace artifact files for one environment. Existing runtimes are referenced, never emitted. */
export function pipelineFiles(model: ResolvedModel): Record<string, string> {
  const copied = copyModel(model);
  if (!copied.tables.length) return {};
  const resources = Object.entries(adf.build(copied))
    .filter(([path]) => /^(dataset|linkedService|pipeline|trigger)\//.test(path))
    .map(([path, text]) => [path, JSON.parse(text) as Resource] as const);
  reshape(
    resources.map(([, resource]) => resource),
    model,
  );
  const files = Object.fromEntries(
    resources.map(([path, resource]) => [
      `workspace/${model.project.environment}/${path}`,
      JSON.stringify(resource, null, 2) + "\n",
    ]),
  );
  return { ...files, ...queryFiles(files, model.project.environment) };
}

/** Full copies have no required window parameters; retries belong to the Copy activity. */
function fullPipeline(resource: Resource, model: ResolvedModel): void {
  resource.properties.concurrency = 1;
  const activities = resource.properties.activities as {
    name: string;
    policy?: Record<string, unknown>;
  }[];
  const tables = copyModel(model).tables;
  for (const activity of activities) {
    const table = tables.find((item) => activity.name === `copy_${item.name}`);
    const retries = table?.ingest?.settings.retries ?? model.operations.retries?.count ?? 2;
    activity.policy = { ...activity.policy, retry: retries, retryIntervalInSeconds: 300 };
  }
}

/**
 * Full pipelines, and schedules for the default triggers. A flow's own triggers and the pipelines
 * they start stay as the ADF builder wrote them, which declare the parameters the triggers pass.
 */
function reshape(resources: Resource[], model: ResolvedModel): void {
  const owned = flowPipelines(resources);
  const declared = new Map<string, string[]>();
  for (const resource of resources.filter((item) => "activities" in item.properties)) {
    fullPipeline(resource, model);
    declared.set(resource.name, owned.has(resource.name) ? [] : dropWindow(resource));
  }
  for (const resource of resources.filter(isDefaultTrigger)) {
    const pipeline = resource.properties.pipeline as {
      pipelineReference: { referenceName: string };
    };
    schedule(resource, declared.get(pipeline.pipelineReference.referenceName) ?? []);
  }
}

/** Readable SQL companions outside the native workspace folder, matching each embedded source query. */
function queryFiles(files: Record<string, string>, environment: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, text] of Object.entries(files).filter(([name]) =>
    name.includes("/pipeline/"),
  )) {
    const pipeline = JSON.parse(text) as Resource;
    const activities = pipeline.properties.activities as {
      name: string;
      typeProperties: { source: { sqlReaderQuery: string | { value: string } } };
    }[];
    for (const activity of activities)
      result[`queries/${environment}/${pipeline.name}/${activity.name}.sql`] = review(
        path,
        activity.typeProperties.source.sqlReaderQuery,
      );
  }
  return result;
}

/** A query as text; one that reads a pipeline parameter is an expression the pipeline evaluates. */
function review(path: string, query: string | { value: string }): string {
  if (typeof query === "string")
    return `-- Source query embedded in ${path}. Review only.\n${query};\n`;
  return `-- Source query embedded in ${path} as an expression, which the pipeline evaluates at run time. Review only.\n${query.value}\n`;
}

/** One immutable artifact holds explicitly separated workspace files for every environment. */
export function pipelineEnvironments(
  models: Readonly<Record<string, ResolvedModel>>,
): EnvironmentsBuild {
  const files: Record<string, string> = {};
  for (const model of Object.values(models)) {
    const rendered = pipelineFiles(model);
    if (Object.values(rendered).some((text) => /\$\{envvar:/.test(text)))
      return {
        files: {},
        deployValues: [],
        problems: [
          {
            code: "DEPLOY_VALUE",
            severity: "error",
            file: "project.yaml",
            message:
              "Synapse workspace pipeline artifacts need explicit environment values; deploy-time substitutions are not supported for this route.",
          },
        ],
      };
    Object.assign(files, rendered);
  }
  return { files, deployValues: [], problems: [] };
}

/** Prerequisites for the workspace's own identity and existing Azure runtime. */
export function pipelineRequest(model: ResolvedModel): RequestSection[] {
  const tables = copyModel(model).tables;
  if (!tables.length) return [];
  const settings = tables[0]!.ingest!.settings;
  return [
    {
      title: "Synapse workspace pipelines",
      intro:
        "Generation does not inspect Azure or validate credentials. Review the workspace artifacts for the selected environment before arranging deployment separately.",
      lines: [
        `Workspace Git artifacts: \`workspace/${model.project.environment}/\`. These are Synapse pipeline artifacts, not a Data Factory ARM export.`,
        `Use the existing workspace Azure integration runtime \`${String(settings.integration_runtime)}\`; it is referenced and no integration runtime definition is generated.`,
        `Give the workspace identity write access to \`${String(settings.landing)}\` and access to the referenced secrets in \`${String(settings.key_vault)}\`. Check source connectivity and reader permissions.`,
        ...Object.entries(pipelineFiles(model))
          .filter(([path]) => path.includes("/trigger/"))
          .map(([, text]) => {
            const trigger = JSON.parse(text) as Resource;
            const kind =
              trigger.properties.type === "TumblingWindowTrigger" ? "tumbling-window" : "schedule";
            return `Synapse ${kind} trigger \`${trigger.name}\`: ${String(trigger.properties.runtimeState).toLowerCase()}. Full snapshots only; no incremental window state is managed.`;
          }),
      ],
    },
  ];
}
