// Every target's plan of views.sql folded into one: the same statements in the
// same order, each value written as it is or as a variable (spec section 8.1).
import { isDeepStrictEqual } from "node:util";
import type { EnvironmentsProblem, ResolvedTable, Step } from "@ingestron/definitions";
import { foldAccess } from "./fold-access.js";
import { foldTransform, type Owner } from "./fold-code.js";
import { placeText, type Fold, type Kind, type Setting } from "./fold-places.js";
import { sourceStep, viewingStep } from "../sql/index.js";
import { differ, inEach, listOf } from "./fold-problems.js";
import type { FilesPlan, Statement, ViewPlan, ViewsPlan } from "../plan/index.js";
import { quote } from "../sql/index.js";

/** Each target's plan, by target name. */
export type Plans = Readonly<Record<string, ViewsPlan>>;

/** The folded plan, its values written as markers where they differ; the first plan on a problem. */
export function foldPlans(
  fold: Fold,
  plans: Plans,
  tables: Readonly<Record<string, ResolvedTable>>,
): ViewsPlan {
  const first = plans[fold.targets[0]!]!;
  const files = Object.fromEntries(
    Object.entries(tables).map(([name, table]) => [name, table.origin.file]),
  );
  const problem = orderProblem(fold, plans, files);
  if (problem) {
    fold.problems.push(problem);
    return first;
  }
  const statements = first.statements.map((statement, index) => {
    const each = <T>(pick: (statement: Statement) => T) =>
      Object.fromEntries(
        fold.targets.map((target) => [target, pick(plans[target]!.statements[index]!)]),
      );
    if (statement.kind === "use")
      return {
        ...statement,
        database: placeText(fold, {
          kind: "database",
          qualifier: statement.layer,
          values: each((item) => (item as typeof statement).database),
          what: `the database of the views in layer ${statement.layer}`,
          setting: { name: "naming.catalog" },
        }),
      };
    const views = each((item) => item as ViewPlan);
    return foldView(fold, views, tables[statement.table]!);
  });
  return { ...first, statements };
}

/**
 * The targets switch database between the same views. The tables are the same in every
 * target (compareTargets), so only the databases that hold them can make this differ.
 */
function orderProblem(
  fold: Fold,
  plans: Plans,
  files: Record<string, string>,
): EnvironmentsProblem | undefined {
  const order = (plan: ViewsPlan) =>
    plan.statements.map((statement) => (statement.kind === "use" ? "" : statement.table));
  const first = order(plans[fold.targets[0]!]!);
  const other = fold.targets.find((target) => !isDeepStrictEqual(order(plans[target]!), first));
  if (!other) return undefined;
  const otherOrder = order(plans[other]!);
  const at = first.findIndex((table, index) => table !== otherOrder[index]);
  const table = first[at] || otherOrder[at] || first[at - 1]!;
  return differ(
    `In ${fold.targets[0]} and ${other}, the views are in databases grouped differently, from the view of "${table}": views.sql switches database between views, so each view must share its database with the same other views in every environment.`,
    files[table],
    "Name the databases so that the same tables share a database in every environment, such as one database per environment or per layer.",
  );
}

/** One view in every target. */
function foldView(
  fold: Fold,
  views: Readonly<Record<string, ViewPlan>>,
  table: ResolvedTable,
): ViewPlan {
  const first = views[fold.targets[0]!]!;
  const owner: Owner = { table: table.name, file: table.origin.file };
  const label = `view ${quote(first.schema)}.${quote(first.name)}`;
  const at = (kind: Kind, pick: (view: ViewPlan) => string, what: string, setting: string) =>
    placeText(fold, {
      kind,
      qualifier: kind === "view" ? first.table : first.layer,
      values: valuesOf(views, pick),
      what: `${what} of ${label}`,
      setting: { name: setting },
    });
  const schema = at("schema", (view) => view.schema, "the schema", "naming.schema");
  const name = at("view", (view) => view.name, "the name", "naming.table");
  const access = foldAccess(fold, views, table, label);
  const folded = { ...first, schema, name, ...(access && { access }) };
  if (first.query.kind === "transform") {
    const queries = valuesOf(views, (view) => view.query as typeof first.query);
    return { ...folded, query: foldTransform(fold, queries, owner) };
  }
  const files = valuesOf(views, (view) => view.query as FilesPlan);
  return { ...folded, query: foldFiles(fold, files, table, label) };
}

/** Where a setting of a step is written, when the definitions write it. */
function settingOf(step: Step | undefined, name: string, label = name): Setting {
  const origin = step?.origins[name];
  return {
    name: label,
    ...(origin?.file && { file: origin.file }),
    ...(origin?.line !== undefined && { line: origin.line }),
  };
}

/** A view over files: its path, data source and delimiter may differ, nothing else. */
function foldFiles(
  fold: Fold,
  queries: Readonly<Record<string, FilesPlan>>,
  table: ResolvedTable,
  label: string,
): FilesPlan {
  const owner: Owner = { table: table.name, file: table.origin.file };
  const first = queries[fold.targets[0]!]!;
  const differing = fixedKeys(first).find(
    (key) =>
      !fold.targets.every((target) =>
        isDeepStrictEqual(fixed(queries[target]!)[key], fixed(first)[key]),
      ),
  );
  if (differing) {
    fold.problems.push(readsDifferently(fold, queries, { ...owner, table: label }, differing));
    return first;
  }
  const at = (kind: Kind, pick: (query: FilesPlan) => string, what: string) =>
    placeText(fold, {
      kind,
      qualifier: owner.table,
      values: valuesOf(queries, pick),
      what: `${what} of ${label}`,
      setting: filesSetting(table, kind),
    });
  const delimiter =
    first.csv && at("delimiter", (query) => query.csv!.delimiter, "the CSV delimiter");
  return {
    ...first,
    path: at("path", (query) => query.path, "the file path"),
    dataSource: at("data_source", (query) => query.dataSource, "the data source"),
    ...(first.csv && { csv: { ...first.csv, delimiter: delimiter! } }),
  };
}

/** The setting a value of a view over files comes from, and where it is written. */
function filesSetting(table: ResolvedTable, kind: Kind): Setting {
  const step = viewingStep(table);
  if (kind === "data_source") return settingOf(step, "data_source");
  if (kind === "delimiter") {
    const csv = step?.origins.csv?.layer === "pack" ? sourceStep(table) : step;
    return settingOf(csv, "csv", "csv.delimiter");
  }
  const landing = settingOf(sourceStep(table), "location", "the landing location");
  return { ...landing, file: landing.file ?? table.origin.file };
}

/** A view over files without the values that may differ between targets. */
function fixed(query: FilesPlan): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...query, csv: query.csv?.header };
  delete rest.path;
  delete rest.dataSource;
  return rest;
}

const fixedKeys = (query: FilesPlan) => Object.keys(fixed(query));

function readsDifferently(
  fold: Fold,
  queries: Readonly<Record<string, FilesPlan>>,
  owner: Owner,
  key: string,
): EnvironmentsProblem {
  const values = valuesOf(queries, (query) => fixed(query)[key]);
  const first = values[fold.targets[0]!];
  const others = fold.targets.filter((target) => !isDeepStrictEqual(values[target], first));
  return differ(
    `The ${owner.table} reads its files differently in ${listOf([fold.targets[0]!, ...others])}: its ${fieldNames[key] ?? key} is ${inEach(values)}.`,
    owner.file,
    "Make the files' format, header and columns the same in every environment; only names, paths and the data source may differ.",
  );
}

/** What each part of a view over files is called in messages. */
const fieldNames: Record<string, string> = {
  format: "format",
  csv: "CSV header",
  columns: "columns",
  extra: "extra columns the landing step adds",
  renamed: "column naming",
  resolvedTypes: "column typing",
};

function valuesOf<T, U>(
  items: Readonly<Record<string, T>>,
  pick: (item: T) => U,
): Record<string, U> {
  return Object.fromEntries(Object.entries(items).map(([target, item]) => [target, pick(item)]));
}
