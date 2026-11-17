// How the workspace route reshapes what the ADF builder writes: the default trigger becomes a
// schedule and its pipeline drops the window, while a flow's triggers and pipeline stay as written.
/** A workspace resource file as JSON: its name and its properties. */
export interface Resource {
  name: string;
  properties: Record<string, unknown>;
}

/** The annotation the ADF pack puts on a tumbling window a flow writes; the default has none. */
export const flowAnnotation = "ingestron:flow-trigger";

/** The pipeline parameters a tumbling window passes, which a full snapshot does not need. */
const windows = ["windowStart", "windowEnd"];

/** The default trigger: a tumbling window no flow wrote. */
export function isDefaultTrigger(resource: Resource): boolean {
  const { type, annotations = [] } = resource.properties as {
    type?: string;
    annotations?: string[];
  };
  return type === "TumblingWindowTrigger" && !annotations.includes(flowAnnotation);
}

interface Reference {
  pipelineReference?: { referenceName?: string };
}

/** The names of the pipelines the triggers a flow wrote start. */
export function flowPipelines(resources: Resource[]): Set<string> {
  const names = new Set<string>();
  for (const { properties } of resources.filter((resource) => !isDefaultTrigger(resource))) {
    const { pipeline, pipelines = [] } = properties as {
      pipeline?: Reference;
      pipelines?: Reference[];
    };
    for (const reference of pipeline ? [pipeline] : pipelines)
      names.add(String(reference.pipelineReference?.referenceName));
  }
  return names;
}

/**
 * Drops `windowStart` and `windowEnd` from a pipeline the default trigger starts, unless a table's
 * filter reads one; the parameters a flow declares stay. Returns the window parameters that remain.
 */
export function dropWindow(resource: Resource): string[] {
  const used = JSON.stringify(resource.properties.activities);
  const parameters = { ...(resource.properties.parameters as Record<string, unknown>) };
  for (const name of windows)
    if (!used.includes(`pipeline().parameters.${name}`)) delete parameters[name];
  if (Object.keys(parameters).length === 0) delete resource.properties.parameters;
  else resource.properties.parameters = parameters;
  return windows.filter((name) => name in parameters);
}

/**
 * A full snapshot uses a ScheduleTrigger: no tumbling-window-only expressions survive. It passes
 * the time it ran as each window parameter its pipeline still declares.
 */
export function schedule(resource: Resource, declared: string[]): void {
  const properties = resource.properties;
  const window = properties.typeProperties as Record<string, unknown>;
  const pipeline = properties.pipeline as { pipelineReference: unknown };
  resource.properties = {
    type: "ScheduleTrigger",
    runtimeState: properties.runtimeState,
    typeProperties: {
      recurrence: {
        frequency: window.frequency,
        interval: window.interval,
        startTime: window.startTime,
        timeZone: "UTC",
      },
    },
    pipelines: [
      {
        pipelineReference: pipeline.pipelineReference,
        parameters: Object.fromEntries(declared.map((name) => [name, "@trigger().scheduledTime"])),
      },
    ],
  };
}
