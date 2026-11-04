// Every environment in one views.sql: SQLCMD variables where the environments
// differ, and a wrapper per environment that sets them. Each fold is checked
// against every environment's own views.sql before it is returned (spec/behaviour.md).
import {
  compareTargets,
  type EnvironmentsBuild,
  type EnvironmentsProblem,
  type ResolvedModel,
  type ResolvedTable,
  type SuppliedValue,
  type TargetDifference,
} from "@ingestron/definitions";
import { build, viewsFile, writeViews } from "./build.js";
import { caseNotices } from "./fold-notices.js";
import { foldPlans, type Plans } from "./fold-plan.js";
import { markers, type Fold, type Variable } from "./fold-places.js";
import { nameVariables } from "./fold-names.js";
import {
  deployProblem,
  differ,
  firstSettingAt,
  listOf,
  once,
  settingsThatDiffer,
  type Models,
} from "./fold-problems.js";
import { hasView, plan } from "./plan.js";
import { holdsDeployText, relativePath, sourceStep, viewingStep } from "./locations.js";
import { environmentFile, reference, substituted, wrapper } from "./sqlcmd.js";

/**
 * One views.sql for every target, with a wrapper per target. With an error among the
 * problems, the files are empty.
 * @example
 * const { files, deployValues, problems } = buildEnvironments({ dev: devModel, prod: prodModel });
 */
export function buildEnvironments(models: Models): EnvironmentsBuild {
  const targets = Object.keys(models);
  if (targets.length === 0) return empty([]);
  const { structural, differing } = compareTargets(models);
  if (structural.length > 0) return empty(structural);
  if (!models[targets[0]!]!.tables.some(hasView)) return empty([]);
  const unknown = Object.values(models).flatMap(unknownPaths);
  if (unknown.length > 0) return empty(unknown);
  const plans: Plans = Object.fromEntries(targets.map((target) => [target, plan(models[target]!)]));
  const fold: Fold = { targets, models, variables: [], problems: [] };
  const template = foldPlans(fold, plans, tablesOf(models[targets[0]!]!));
  nameVariables(fold, plans);
  if (fold.problems.length > 0) return empty(withSettings(fold.problems, models, differing));
  const views = writeViews(template).replace(markers, (_, index: string) =>
    reference(fold.variables[Number(index)]!.name),
  );
  const left = leftInViews(models, views);
  if (left.length > 0) return empty(left);
  const files: Record<string, string> = { [viewsFile]: views };
  for (const target of targets)
    files[environmentFile(target)] = wrapper(template.project, target, fold.variables);
  const deployValues = suppliedValues(fold);
  const unlike = viewProblems(models, files, deployValues);
  if (unlike.length > 0) return empty(withSettings(unlike, models, differing));
  return { files, deployValues, problems: caseNotices(models, deployValues) };
}

function empty(problems: EnvironmentsProblem[]): EnvironmentsBuild {
  return { files: {}, deployValues: [], problems: once(problems) };
}

/**
 * Each structural problem with no fix of its own names the settings that differ
 * between the targets, and is located at the first of them.
 */
function withSettings(
  problems: EnvironmentsProblem[],
  models: Models,
  differing: readonly TargetDifference[],
) {
  const settings = settingsThatDiffer(differing);
  const at = firstSettingAt(models, differing);
  return problems.map((problem) =>
    problem.code === "ENVIRONMENTS_DIFFER" && !problem.hint
      ? { ...problem, message: problem.message + settings, ...at }
      : problem,
  );
}

/** Each table by name, for problems about one table and the settings it comes from. */
function tablesOf(model: ResolvedModel): Record<string, ResolvedTable> {
  return Object.fromEntries(model.tables.map((table) => [table.name, table]));
}

/**
 * A view reads files by their path under the data source; when a location supplied only
 * when deploying hides that path, nothing can be generated for it.
 */
function unknownPaths(model: ResolvedModel): EnvironmentsProblem[] {
  return model.tables.flatMap((table) => {
    const step = viewingStep(table);
    const output = sourceStep(table)?.output;
    if (!step || table.transform || !output) return [];
    const relative = relativePath(output, step.settings);
    if (!("problem" in relative) || !relative.outside) return [];
    const location = String(step.settings.data_source_location);
    const text = holdsDeployText(location) ? location : output.location;
    const value = (model.deployValues ?? []).find((item) => text.includes(item.text));
    if (!value) return [];
    return [
      deployProblem(
        `The view of table "${table.name}" reads ${output.location} by its path under data_source_location, ${location}, in ${model.project.environment}; with ${value.text} supplied only when deploying, that path is not known when generating.`,
        value,
        "Write data_source_location and the landing location in project.yaml for each environment, or supply only the part that both share, such as the storage account.",
      ),
    ];
  });
}

/** A deploy-time value where no variable stands for it, such as in a column's name. */
function leftInViews(models: Models, views: string): EnvironmentsProblem[] {
  return Object.values(models).flatMap((model) =>
    (model.deployValues ?? [])
      .filter((value) => views.includes(value.text))
      .map((value) =>
        deployProblem(
          `views.sql would hold ${value.text}, which is supplied only when deploying, where the pack cannot make it a SQLCMD variable; only a database, schema or view name, a file path, a data source and a CSV delimiter can be.`,
          value,
        ),
      ),
  );
}

/** Each deploy-time value the files take, in the order the models first hold it. */
function suppliedValues(fold: Fold): SuppliedValue[] {
  const variables = new Map(
    fold.variables.flatMap((variable): [string, Variable][] =>
      variable.deploy && variable.supplied.length > 0 ? [[variable.deploy.name, variable]] : [],
    ),
  );
  const names = Object.values(fold.models).flatMap((model) =>
    (model.deployValues ?? []).map((value) => value.name),
  );
  return [...new Set(names)]
    .filter((name) => variables.has(name))
    .map((name) => ({ name, suppliedAs: [variables.get(name)!.name] }));
}

/**
 * The fold property, checked when generating: what sqlcmd runs for each target is the
 * views.sql that `build` gives for that target alone.
 */
function viewProblems(
  models: Models,
  files: Record<string, string>,
  deployValues: readonly SuppliedValue[],
): EnvironmentsProblem[] {
  const supplied = Object.fromEntries(
    deployValues.flatMap((value) =>
      value.suppliedAs.map((name) => [name, `\${envvar:${value.name}}`]),
    ),
  );
  const unlike = Object.keys(models).filter(
    (target) =>
      substituted(files, target, supplied)[viewsFile] !== build(models[target]!)[viewsFile],
  );
  if (unlike.length === 0) return [];
  return [
    differ(
      `views.sql cannot be generated once for every environment: in ${listOf(unlike)} it would not be what that environment gets on its own, because the environments differ there in more than values.`,
    ),
  ];
}
