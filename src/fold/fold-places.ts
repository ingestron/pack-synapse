// One value of views.sql in every target: written as it is when it is the same
// everywhere, else a SQLCMD variable, shared by every place with the same values
// (spec/behaviour.md, section 8.1).
import type { DeployValue, EnvironmentsProblem } from "@ingestron/definitions";
import {
  deployParts,
  deployProblem,
  differ,
  inEach,
  wholeValue,
  type Models,
} from "./fold-problems.js";

/** What a variable stands for, which names it (spec section 8.2). */
export type Kind =
  "database" | "schema" | "view" | "path" | "data_source" | "delimiter" | "principal" | "value";

/** A value of views.sql, with each target's text. */
export interface Place {
  kind: Kind;
  /** The layer or table that qualifies the variable's name. */
  qualifier: string;
  values: Readonly<Record<string, string>>;
  /** The place in words, for messages: `the schema of view [bronze].[orders]`. */
  what: string;
  /** The setting the value comes from, and where it is written, when the pack knows. */
  setting?: Setting;
}

/** A setting's name, and the file and line it is written at, when known. */
export interface Setting {
  /** Left out when the value comes from no single setting, such as a transform's code. */
  name?: string;
  file?: string;
  line?: number;
}

/** A SQLCMD variable of views.sql. */
export interface Variable {
  kind: Kind;
  qualifier: string;
  /** The deploy-time value some targets supply for it, when there is one. */
  deploy?: DeployValue;
  /** The value each target sets with `:setvar`; a target that supplies it is absent. */
  values: Record<string, string>;
  /** The targets that leave it for the deploying pipeline. */
  supplied: string[];
  /** Set once every place is found (spec section 8.2). */
  name: string;
}

/** The fold in progress: the variables found so far and what stops the fold. */
export interface Fold {
  targets: string[];
  models: Models;
  variables: Variable[];
  problems: EnvironmentsProblem[];
}

/** Stands for a variable in the folded plan until every variable is named. */
const marker = (index: number) => `\u0000${index}\u0000`;

/** Every marker in a text, with the index of its variable. */
export const markers = /\u0000(\d+)\u0000/g;

/**
 * A value's text in the folded plan: the value itself when it is the same in every
 * target and holds no deploy-time value, else its variable's marker.
 */
export function placeText(fold: Fold, place: Place): string {
  const first = place.values[fold.targets[0]!]!;
  const supplied = suppliedIn(fold, place);
  if (!supplied) return first;
  const literal = Object.fromEntries(
    Object.entries(place.values).filter(([target]) => !(target in supplied.by)),
  );
  if (!supplied.value && new Set(Object.values(literal)).size === 1) return first;
  const unfit = Object.values(literal).find((value) => unfitFor(place.kind, value) !== undefined);
  if (unfit !== undefined) {
    fold.problems.push(cannotHold(place, unfit));
    return first;
  }
  return marker(variableFor(fold, place, { values: literal, by: supplied.by }, supplied.value));
}

/**
 * The targets that supply the value when deploying, and its deploy-time value; a
 * problem and undefined when no variable can stand for it.
 */
function suppliedIn(fold: Fold, place: Place) {
  const by: Record<string, DeployValue> = {};
  for (const [target, text] of Object.entries(place.values)) {
    const { values, whole } = deployParts(text, fold.models[target]!);
    if (values.length === 0) continue;
    if (!whole) return void fold.problems.push(embedded(place, target, text, values[0]!));
    by[target] = values[0]!;
  }
  const names = [...new Set(Object.values(by).map((value) => value.name))];
  if (names.length > 1) return void fold.problems.push(twoNames(place, by));
  return { by, value: Object.values(by)[0] };
}

/** The variable for the place's values, shared with an earlier place that has them. */
function variableFor(
  fold: Fold,
  place: Place,
  { values, by }: { values: Record<string, string>; by: Record<string, DeployValue> },
  deploy: DeployValue | undefined,
): number {
  const same = (variable: Variable) =>
    deploy
      ? variable.deploy?.name === deploy.name
      : !variable.deploy &&
        variable.kind === place.kind &&
        // A value in a transform's code is shared only within that transform's code.
        (place.kind !== "value" || variable.qualifier === place.qualifier) &&
        JSON.stringify(variable.values) === JSON.stringify(values);
  const index = fold.variables.findIndex(same);
  if (index < 0) {
    const { kind, qualifier } = place;
    const supplied = Object.keys(by);
    fold.variables.push({ kind, qualifier, ...(deploy && { deploy }), values, supplied, name: "" });
    return fold.variables.length - 1;
  }
  merge(fold, place, fold.variables[index]!, { values, by });
  return index;
}

/**
 * Adds a place's values to the deploy-time value's variable it shares: each target
 * sets it to one value, or leaves it for the pipeline, never both.
 */
function merge(
  fold: Fold,
  place: Place,
  variable: Variable,
  { values, by }: { values: Record<string, string>; by: Record<string, DeployValue> },
): void {
  const deploy = variable.deploy!;
  for (const [target, value] of Object.entries(values)) {
    const set = variable.values[target];
    if ((set !== undefined && set !== value) || variable.supplied.includes(target))
      fold.problems.push(oneValue(place, deploy, target, [set ?? deploy.text, value]));
    variable.values[target] = value;
  }
  for (const target of Object.keys(by)) {
    if (target in variable.values)
      fold.problems.push(oneValue(place, deploy, target, [variable.values[target]!, deploy.text]));
    if (!variable.supplied.includes(target)) variable.supplied.push(target);
  }
}

/**
 * Why sqlcmd cannot put a value into views.sql as it is, or undefined when it can. A
 * variable's value goes in unescaped, so names and texts cannot hold `'` or `]`; no
 * value can hold a line break, which ends `:setvar`, or `$(`, which starts a variable.
 */
function unfitFor(kind: Kind, value: string): string | undefined {
  if (/[\r\n]/.test(value)) return "a line break";
  if (value.includes("$(")) return '"$("';
  if (kind !== "value" && value.includes("'")) return "'";
  if (kind !== "value" && value.includes("]")) return "]";
  return undefined;
}

function cannotHold(place: Place, value: string): EnvironmentsProblem {
  const character = unfitFor(place.kind, value);
  const setting = place.setting?.name ? ` (setting ${place.setting.name})` : "";
  const problem = differ(
    `${capital(place.what)}${setting} is ${inEach(place.values)}, and a value that differs between environments cannot hold ${character}: sqlcmd puts a variable's value into views.sql as it is.`,
    place.setting?.file,
    place.kind === "value" && character === "a line break"
      ? "Keep each value that differs between environments within one line of the code."
      : "Make this value the same in every environment, or leave that character out of it.",
  );
  return place.setting?.line === undefined ? problem : { ...problem, line: place.setting.line };
}

function embedded(place: Place, target: string, text: string, value: DeployValue) {
  return deployProblem(
    `"${value.text}" is supplied only when deploying, but in ${target} it is part of a longer value, "${text}", in ${place.what}; a SQLCMD variable in views.sql stands for a whole value.`,
    value,
    wholeValue,
  );
}

function twoNames(place: Place, by: Record<string, DeployValue>) {
  const [first, ...others] = Object.keys(by);
  const other = others.find((target) => by[target]!.name !== by[first!]!.name)!;
  return deployProblem(
    `In ${place.what}, this value is ${by[first!]!.text} in ${first} and ${by[other]!.text} in ${other}.`,
    by[other]!,
    "Use one variable name and give it a different value in each pipeline stage.",
  );
}

function oneValue(place: Place, value: DeployValue, target: string, texts: string[]) {
  return deployProblem(
    `${value.text} stands for one value in each environment, but ${target} writes it as ${texts.map((text) => `"${text}"`).join(" and ")}, the second in ${place.what}.`,
    value,
    "Write the value the same way in every place of that environment.",
  );
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
