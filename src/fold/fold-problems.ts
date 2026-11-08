// The problems that stop one views.sql covering every environment, and the words
// they use (spec/behaviour.md, section 10).
import {
  splitDeployText,
  type DeployValue,
  type EnvironmentsProblem,
  type ResolvedModel,
  type TargetDifference,
} from "@ingestron/definitions";

/** Each target's model, by name, in the order project.yaml declares the environments. */
export type Models = Readonly<Record<string, ResolvedModel>>;

/** Where values that differ between environments are written. */
const valuesFile = "project.yaml";

/** An `ENVIRONMENTS_DIFFER` error. */
export function differ(message: string, file = valuesFile, hint?: string): EnvironmentsProblem {
  return { code: "ENVIRONMENTS_DIFFER", severity: "error", message, file, ...(hint && { hint }) };
}

/** A `DEPLOY_VALUE` error at the first use of a deploy-time value. */
export function deployProblem(
  message: string,
  value: DeployValue,
  hint?: string,
): EnvironmentsProblem {
  const use = value.uses[0];
  return {
    code: "DEPLOY_VALUE",
    severity: "error",
    message,
    file: use?.file ?? valuesFile,
    ...(use?.line !== undefined && { line: use.line }),
    ...(hint && { hint }),
  };
}

/**
 * The deploy-time values a target's text holds, and whether one is the whole text.
 * @example deployParts("${envvar:SOURCE}", model) // { values: [SOURCE], whole: true }
 */
export function deployParts(
  text: string,
  model: ResolvedModel,
): { values: DeployValue[]; whole: boolean } {
  const parts = splitDeployText(text, model.deployValues ?? []);
  const values = parts.filter((part): part is DeployValue => typeof part !== "string");
  return { values, whole: values.length === 1 && parts.length === 1 };
}

/** Target names joined with `, `, the last two with ` and `. */
export function listOf(targets: readonly string[]): string {
  if (targets.length < 2) return targets.join("");
  return `${targets.slice(0, -1).join(", ")} and ${targets[targets.length - 1]}`;
}

/** A value as a message quotes it, shortened. */
export function quoted(value: unknown): string {
  const text = value === undefined ? "not set" : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** `"a" in dev and "b" in test and prod`, for each target's value. */
export function inEach(values: Readonly<Record<string, unknown>>): string {
  const groups = new Map<string, string[]>();
  for (const [target, value] of Object.entries(values))
    groups.set(quoted(value), [...(groups.get(quoted(value)) ?? []), target]);
  return listOf([...groups].map(([value, targets]) => `${value} in ${listOf(targets)}`));
}

/** Each problem once. */
export function once(problems: readonly EnvironmentsProblem[]): EnvironmentsProblem[] {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const key = JSON.stringify([problem.code, problem.message, problem.file, problem.line]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A table's step setting in compareTargets' pointers. Names differ in every project, so are left out. */
const settingPointer = /^\/tables\/(\d+)\/(ingest|store|serve)\/(?:settings|output)\/([^/]+)/;

/**
 * The settings that differ between the targets, as a sentence naming each with its
 * values, so a refusal says which setting to make the same; empty when none does.
 */
export function settingsThatDiffer(differing: readonly TargetDifference[]): string {
  const settings = new Map<string, string>();
  for (const { pointer, values } of differing) {
    const match = settingPointer.exec(pointer);
    const setting = match?.[3];
    if (setting && !settings.has(setting) && settings.size < 3)
      settings.set(setting, `${setting} (${inEach(values)})`);
  }
  if (settings.size === 0) return "";
  return ` Settings that differ: ${[...settings.values()].join("; ")}.`;
}

/**
 * Where the first step setting that differs is written in the first target, so a
 * refusal points at it; undefined when no step setting differs or none records it.
 */
export function firstSettingAt(
  models: Models,
  differing: readonly TargetDifference[],
): { file: string; line?: number } | undefined {
  const first = Object.values(models)[0];
  for (const { pointer } of differing) {
    const match = settingPointer.exec(pointer);
    if (!match || !first) continue;
    const table = first.tables[Number(match[1])];
    const step = table?.[match[2] as "ingest" | "store" | "serve"];
    const origin = step?.origins[match[3]!];
    if (origin?.file)
      return { file: origin.file, ...(origin.line !== undefined && { line: origin.line }) };
  }
  return undefined;
}

/** The fix for a deploy-time value inside a longer text. */
export const wholeValue =
  "Make the variable hold the whole value, or write the value in project.yaml for each environment.";
