// Who may read each view, as views.sql grants it (spec/behaviour.md, "Access"). The definitions
// package has judged each table's access and recorded what is not applied; this reads that
// judgement and the platform's switch, and never judges again.
import type { AccessGrant, ResolvedModel, ResolvedTable } from "@ingestron/definitions";

/** One role, and the principal views.sql grants SELECT to for it. */
export interface ViewGrant {
  role: string;
  principal: string;
}

/** What views.sql grants on a view, and whether it revokes what the grants do not give. */
export interface ViewAccess {
  /** Each role once, in the order the table's access first names it. */
  grants: ViewGrant[];
  exact: boolean;
}

/** True when the Platform turns on `synapse.manage.grants`. */
export function grantsOn(model: ResolvedModel): boolean {
  const manage = model.platform.sections.synapse?.manage;
  return (
    typeof manage === "object" && manage !== null && "grants" in manage && manage.grants === true
  );
}

const notApplied = (table: ResolvedTable, feature: string) =>
  (table.notApplied ?? []).some((item) => item.feature === feature);

/**
 * The access views.sql gives a view `synapse-view` keeps: none with the switch off, without
 * access, or when the table's grants are not applied. A view `synapse-serve` serves gets none:
 * its access is judged against the pack that stores the table.
 */
export function viewAccess(model: ResolvedModel, table: ResolvedTable): ViewAccess | undefined {
  if (table.store?.method !== "synapse-view" || !grantsOn(model)) return undefined;
  const access = table.access;
  if (!access || notApplied(table, "grants")) return undefined;
  const exact = access.exact && !notApplied(table, "exact");
  const grants = byRole(access.grants);
  return grants.length > 0 || exact ? { grants, exact } : undefined;
}

/** Each role once: a role the contract and the layer both name has one principal. */
function byRole(grants: readonly AccessGrant[]): ViewGrant[] {
  const seen = new Map<string, string>();
  for (const { role, principal } of grants) if (!seen.has(role)) seen.set(role, principal);
  return [...seen].map(([role, principal]) => ({ role, principal }));
}
