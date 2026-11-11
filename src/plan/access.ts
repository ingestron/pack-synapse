// Who may read each view, as views.sql grants it (spec/behaviour.md, "Access"). The definitions
// package has judged each table's access and recorded what is not applied; this reads that
// judgement and the platform's switch, and never judges again.
import type { AccessGrant, NotApplied, ResolvedModel, ResolvedTable } from "@ingestron/definitions";

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

/**
 * What the definitions package judged the table's Synapse step does not apply: the table's
 * own `notApplied` for a view synapse-view keeps; the serve step's for one synapse-serve serves
 * over a table another pack's store step keeps, which is judged a second time by its serve
 * step. Undefined for any other table: no step of Synapse is judged there.
 */
function judgementOf(table: ResolvedTable): NotApplied[] | undefined {
  if (table.store?.method === "synapse-view") return table.notApplied ?? [];
  const { store, serve } = table;
  if (serve?.method === "synapse-serve" && store && store.pack !== serve.pack)
    return serve.notApplied ?? [];
  return undefined;
}

/**
 * The access views.sql gives a view: none with the switch off, without access, on a view
 * whose step is not judged, or when its grants are not applied there.
 */
export function viewAccess(model: ResolvedModel, table: ResolvedTable): ViewAccess | undefined {
  const judged = judgementOf(table);
  if (!judged || !grantsOn(model) || !table.access) return undefined;
  const notApplied = (feature: string) => judged.some((item) => item.feature === feature);
  if (notApplied("grants")) return undefined;
  const exact = table.access.exact && !notApplied("exact");
  const grants = byRole(table.access.grants);
  return grants.length > 0 || exact ? { grants, exact } : undefined;
}

/** Each role once: a role the contract and the layer both name has one principal. */
function byRole(grants: readonly AccessGrant[]): ViewGrant[] {
  const seen = new Map<string, string>();
  for (const { role, principal } of grants) if (!seen.has(role)) seen.set(role, principal);
  return [...seen].map(([role, principal]) => ({ role, principal }));
}
