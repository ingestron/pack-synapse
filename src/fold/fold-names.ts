// The names of views.sql's SQLCMD variables (spec section 8.2): a deploy-time value
// keeps its NAME, so sqlcmd reads it from the environment variable the pipeline sets;
// every other variable is named after what it stands for.
import type { EnvironmentsProblem } from "@ingestron/definitions";
import type { Fold, Variable } from "./fold-places.js";
import { deployProblem } from "./fold-problems.js";
import type { Plans } from "./fold-plan.js";

/**
 * Names every variable, deploy-time values first, then the others in the order they
 * were found; a name already taken, in any case, gets `_2`, `_3` and so on.
 */
export function nameVariables(fold: Fold, plans: Plans): void {
  const taken = new Set<string>();
  const ordered = [
    ...fold.variables.filter((variable) => variable.deploy),
    ...fold.variables.filter((variable) => !variable.deploy),
  ];
  for (const variable of ordered) {
    const wanted = variable.deploy ? variable.deploy.name : derived(variable, plans);
    if (variable.deploy && /^sqlcmd/i.test(wanted)) fold.problems.push(reserved(variable));
    if (variable.deploy && taken.has(wanted.toLowerCase())) fold.problems.push(sameName(variable));
    variable.name = free(wanted, taken);
    taken.add(variable.name.toLowerCase());
  }
}

function free(wanted: string, taken: ReadonlySet<string>): string {
  let name = wanted;
  for (let count = 2; taken.has(name.toLowerCase()); count += 1) name = `${wanted}_${count}`;
  return name;
}

/**
 * `database` and `data_source` when each target has one database and one data source;
 * otherwise each name is qualified by the layer or the table it belongs to.
 */
function derived(variable: Variable, plans: Plans): string {
  const { kind, qualifier } = variable;
  const single =
    (kind === "database" && everyPlanHasOne(plans, databasesOf)) ||
    (kind === "data_source" && everyPlanHasOne(plans, dataSourcesOf));
  const name = single ? kind : `${kind}_${qualifier}`;
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function everyPlanHasOne(plans: Plans, of: (plan: Plans[string]) => string[]): boolean {
  return Object.values(plans).every((plan) => new Set(of(plan)).size === 1);
}

const databasesOf = (plan: Plans[string]) =>
  plan.statements.flatMap((statement) => (statement.kind === "use" ? [statement.database] : []));

const dataSourcesOf = (plan: Plans[string]) =>
  plan.statements.flatMap((statement) =>
    statement.kind === "view" && statement.query.kind === "files"
      ? [statement.query.dataSource]
      : [],
  );

function sameName(variable: Variable): EnvironmentsProblem {
  const value = variable.deploy!;
  return deployProblem(
    `${value.text} differs from another value supplied when deploying only in the case of its name, but SQLCMD variable names are the same in any case.`,
    value,
    "Give the environment variables names that differ in more than their case.",
  );
}

function reserved(variable: Variable): EnvironmentsProblem {
  const value = variable.deploy!;
  return deployProblem(
    `${value.text} would be the SQLCMD variable ${value.name}, but sqlcmd keeps names that start with SQLCMD for its own settings.`,
    value,
    "Rename the environment variable so that its name does not start with SQLCMD.",
  );
}
