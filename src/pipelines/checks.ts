// What the workspace route checks of a model: the ADF pack's checks of the copies, and the
// standard's trigger rules applied to the default trigger as the schedule it is here.
import { adf } from "@ingestron/pack-adf";
import {
  clockTime,
  outsideHours,
  type ResolvedModel,
  type ResolvedTrigger,
} from "@ingestron/definitions";
import { copyModel } from "./method.js";
import { isDefaultTrigger, type Resource } from "./shape.js";

/** A default trigger: its name, and how often it runs and from when. */
interface Default {
  name: string;
  every: ResolvedTrigger["every"];
  start: string;
}

/**
 * The ADF pack's problems with the copied tables, which include its checks of a flow's triggers,
 * parameters and filters. It judges the default trigger as the tumbling window it writes, so it
 * is told the standard allows one at any hour; `defaultTriggerProblems` judges the schedule instead.
 */
export function pipelineProblems(model: ResolvedModel): string[] {
  const copied = copyModel(model);
  if (copied.tables.length === 0) return [];
  const { timezone, types } = copied.operations.triggers;
  const anywhere = { timezone, types: [...new Set([...types, "tumbling-window" as const])] };
  const adfs = adf.check?.({
    ...copied,
    operations: { ...copied.operations, triggers: anywhere },
  });
  return [...(adfs ?? []), ...defaultTriggerProblems(copied)];
}

/** The default triggers the ADF builder writes, which a full snapshot turns into schedules. */
function defaults(model: ResolvedModel): Default[] {
  try {
    return Object.entries(adf.build(model))
      .filter(([path]) => path.startsWith("trigger/"))
      .map(([, text]) => JSON.parse(text) as Resource)
      .filter(isDefaultTrigger)
      .map(({ name, properties }) => {
        const window = properties.typeProperties as Record<string, unknown>;
        return {
          name,
          every: { frequency: window.frequency, interval: window.interval },
          start: String(window.startTime),
        } as Default;
      });
  } catch {
    // The ADF pack's own check reports a model it cannot build.
    return [];
  }
}

/** The default trigger as a trigger a flow could write: a schedule in UTC, no parameters. */
function asTrigger({ name, every, start }: Default): ResolvedTrigger {
  return {
    flow: "",
    name,
    type: "schedule",
    every,
    start,
    timezone: "UTC",
    parameters: {},
    // Not written in any document; outsideHours does not read it.
    at_source: undefined as never,
  };
}

/**
 * The default triggers that break the standard's `operations.triggers`: a type it does not
 * allow, or a run outside its hours, in the words the ADF pack uses for its default trigger.
 */
export function defaultTriggerProblems(model: ResolvedModel): string[] {
  const { types, hours } = model.operations.triggers;
  if (types.includes("schedule") && !hours) return [];
  return defaults(model).flatMap((found) => {
    const problems: string[] = [];
    if (!types.includes("schedule"))
      problems.push(
        `The standard allows only ${types.join(" and ")} triggers. The default trigger "${found.name}" is a schedule trigger; write the flow's own triggers, or ask for schedule in the standard's \`operations.triggers.types\``,
      );
    const outside = hours && outsideHours(asTrigger(found), hours);
    if (hours && outside)
      problems.push(
        `"${found.name}" starts a run at ${clockTime(outside, hours.timezone)} (${hours.timezone}), outside the hours the standard allows here: ${hours.from}–${hours.to}`,
      );
    return problems;
  });
}
