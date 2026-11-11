// A view's grants in every target (spec/behaviour.md, "Access"): the same roles and grant
// mode everywhere, each role's principal written as it is or as the variable
// `principal_<role>`; anything else that differs stops the fold.
import { isDeepStrictEqual } from "node:util";
import type { ResolvedTable } from "@ingestron/definitions";
import type { ViewAccess, ViewPlan } from "../plan/index.js";
import { placeText, type Fold } from "./fold-places.js";
import { differ } from "./fold-problems.js";

const hint =
  "Turn synapse.manage.grants on or off in every environment alike, and give the table the same roles and grant mode in each; only the principals may differ.";

/** What must be the same in every target: whether there are grants, their roles and exact. */
const shapeOf = (access: ViewAccess | undefined) =>
  access && { exact: access.exact, roles: access.grants.map((grant) => grant.role) };

/** The view's folded access; the first target's on a problem. */
export function foldAccess(
  fold: Fold,
  views: Readonly<Record<string, ViewPlan>>,
  table: ResolvedTable,
  label: string,
): ViewAccess | undefined {
  const [first, ...others] = fold.targets.map((target) => views[target]!.access);
  const other = others.findIndex((access) => !isDeepStrictEqual(shapeOf(access), shapeOf(first)));
  if (other >= 0) {
    const targets = `${fold.targets[0]} and ${fold.targets[other + 1]}`;
    const message = `The grants on ${label} differ between ${targets} in more than their principals.`;
    fold.problems.push(differ(message, table.origin.file, hint));
    return first;
  }
  if (!first) return undefined;
  const grants = first.grants.map(({ role }, index) => {
    const values = Object.fromEntries(
      fold.targets.map((target) => [target, views[target]!.access!.grants[index]!.principal]),
    );
    const what = `the principal of the role "${role}" on ${label}`;
    const setting = { name: `principals.${role}` };
    return {
      role,
      principal: placeText(fold, { kind: "principal", qualifier: role, values, what, setting }),
    };
  });
  return { ...first, grants };
}
