// A transform's code in every target: the same text where the targets' code is
// the same, and a variable for each run of tokens that differs (spec section 8.1).
import type { EnvironmentsProblem } from "@ingestron/definitions";
import type { CodePart, TransformPlan, ViewReference } from "./plan.js";
import { placeText, type Fold } from "./fold-places.js";
import { deployParts, deployProblem, differ, listOf } from "./fold-problems.js";

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

/** Words, runs of space, and single other characters. */
function tokens(text: string): string[] {
  return text.match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/g) ?? [];
}

/**
 * Literal code in every target: a variable for each run of tokens that differs, or,
 * when the targets have different numbers of tokens, one for the span between the
 * first and the last token that differ.
 */
function foldText(fold: Fold, values: Record<string, string>, owner: Owner): string {
  if (holdsDeployValue(fold, values, owner)) return values[fold.targets[0]!]!;
  const lists = fold.targets.map((target) => tokens(values[target]!));
  const spans = new Set(lists.map((list) => list.length)).size === 1 ? runs(lists) : [span(lists)];
  const first = lists[0]!;
  const parts: string[] = [];
  let at = 0;
  for (const { start, ends } of spans) {
    parts.push(first.slice(at, start).join(""));
    const texts = Object.fromEntries(
      fold.targets.map((target, index) => [
        target,
        lists[index]!.slice(start, ends[index]).join(""),
      ]),
    );
    parts.push(
      placeText(fold, {
        kind: "value",
        qualifier: owner.table,
        values: texts,
        what: `a value in the code of transform "${owner.table}"`,
      }),
    );
    at = ends[0]!;
  }
  parts.push(first.slice(at).join(""));
  return parts.join("");
}

/** A run of tokens that differs: where it starts, and where it ends in each target. */
interface Span {
  start: number;
  ends: number[];
}

/** Each run of positions where the targets' tokens are not all the same. */
function runs(lists: string[][]): Span[] {
  const found: Span[] = [];
  lists[0]!.forEach((_, position) => {
    if (new Set(lists.map((list) => list[position])).size === 1) return;
    const last = found.at(-1);
    if (last && last.ends[0] === position) last.ends = last.ends.map((end) => end + 1);
    else found.push({ start: position, ends: lists.map(() => position + 1) });
  });
  return found;
}

/** The tokens between the targets' common start and common end, never empty in any target. */
function span(lists: string[][]): Span {
  const shortest = Math.min(...lists.map((list) => list.length));
  const same = (pick: (list: string[]) => string | undefined) =>
    new Set(lists.map(pick)).size === 1;
  let start = 0;
  while (start < shortest && same((list) => list[start])) start += 1;
  let end = 0;
  while (end < shortest - start && same((list) => list[list.length - 1 - end])) end += 1;
  // A target whose span would be empty takes a token next to it, so :setvar has a value.
  const empty = lists.some((list) => list.length - end === start);
  if (empty && start > 0) start -= 1;
  else if (empty && end > 0) end -= 1;
  return { start, ends: lists.map((list) => list.length - end) };
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
