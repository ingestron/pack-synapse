// A transform's code in every target: the same text where the targets' code is
// the same, and a variable for each run of tokens that differs (spec section 8.1).
import type { EnvironmentsProblem } from "@ingestron/definitions";
import type { CodePart, TransformPlan, ViewReference } from "./plan.js";
import { placeText, type Fold } from "./fold-places.js";
import { deployParts, deployProblem, differ, listOf } from "./fold-problems.js";
import { stretches, tokens, type Stretch } from "./token-diff.js";

/** Each target's view of one table, for messages and names. */
export interface Owner {
  table: string;
  file: string;
}

/**
 * The transform's code for every target, its inputs' views named through the same
 * variables as the views themselves.
 */
export function foldTransform(
  fold: Fold,
  queries: Readonly<Record<string, TransformPlan>>,
  owner: Owner,
): TransformPlan {
  const first = queries[fold.targets[0]!]!;
  const problem = shapeProblem(fold, queries, owner);
  if (problem) {
    fold.problems.push(problem);
    return first;
  }
  const code = first.code.map((part, index) => {
    const values = (pick: (part: CodePart) => string) =>
      Object.fromEntries(
        fold.targets.map((target) => [target, pick(queries[target]!.code[index]!)]),
      );
    if (typeof part === "string")
      return foldText(
        fold,
        values((text) => text as string),
        owner,
      );
    return foldReference(fold, part, (key) => values((item) => (item as ViewReference)[key]!));
  });
  return { ...first, code };
}

/** The targets' code differs in more than values: other inputs, columns or databases. */
function shapeProblem(
  fold: Fold,
  queries: Readonly<Record<string, TransformPlan>>,
  owner: Owner,
): EnvironmentsProblem | undefined {
  const shape = (query: TransformPlan) =>
    JSON.stringify([
      query.columns,
      query.code.map((part) =>
        typeof part === "string" ? "" : [part.table, part.database !== undefined],
      ),
    ]);
  const first = shape(queries[fold.targets[0]!]!);
  const others = fold.targets.filter((target) => shape(queries[target]!) !== first);
  if (others.length === 0) return undefined;
  return differ(
    `The code of transform "${owner.table}" differs between ${listOf([fold.targets[0]!, ...others])} in more than values: it reads other inputs, selects other columns, or reads an input in another database.`,
    owner.file,
    "Make the transform's inputs, columns and databases the same in every environment; only values in its code, such as ${values.<name>}, may differ.",
  );
}

/** An input's view: the same names, and variables, as the input's own view. */
function foldReference(
  fold: Fold,
  reference: ViewReference,
  values: (key: "database" | "schema" | "name") => Record<string, string>,
): ViewReference {
  const view = `view of input "${reference.table}"`;
  const at = (kind: "database" | "schema" | "view", key: "database" | "schema" | "name") =>
    placeText(fold, {
      kind,
      qualifier: kind === "view" ? reference.table : reference.layer,
      values: values(key),
      what: `the ${key === "name" ? "name" : key} of the ${view}`,
    });
  return {
    ...reference,
    ...(reference.database !== undefined && { database: at("database", "database") }),
    schema: at("schema", "schema"),
    name: at("view", "name"),
  };
}

/**
 * Literal code in every target: the tokens common to every target as they are, and a
 * variable for each stretch of tokens between them that differs.
 */
function foldText(fold: Fold, values: Record<string, string>, owner: Owner): string {
  if (holdsDeployValue(fold, values, owner)) return values[fold.targets[0]!]!;
  const lists = fold.targets.map((target) => tokens(values[target]!));
  const text = (index: number, stretch: Stretch) =>
    lists[index]!.slice(stretch.starts[index], stretch.ends[index]).join("");
  return stretches(lists)
    .map((stretch) =>
      stretch.same
        ? text(0, stretch)
        : placeText(fold, {
            kind: "value",
            qualifier: owner.table,
            values: Object.fromEntries(
              fold.targets.map((target, index) => [target, text(index, stretch)]),
            ),
            what: `a value in the code of transform "${owner.table}"`,
            setting: { file: owner.file },
          }),
    )
    .join("");
}

/** A transform's code is written as it is, so it cannot hold a value supplied when deploying. */
function holdsDeployValue(fold: Fold, values: Record<string, string>, owner: Owner): boolean {
  for (const target of fold.targets) {
    const [value] = deployParts(values[target]!, fold.models[target]!).values;
    if (!value) continue;
    fold.problems.push(
      deployProblem(
        `The code of transform "${owner.table}" holds ${value.text} in ${target}, which is supplied only when deploying; views.sql holds a transform's code as it is written, so every value in it must be known when generating.`,
        value,
        "Write the value in project.yaml for each environment, and use it in the code as ${values.<name>}.",
      ),
    );
    return true;
  }
  return false;
}
