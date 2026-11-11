// What the pack does with the quality and cleansing paths of intent (spec/behaviour.md,
// "Intent" and "Quality and cleansing"): checks in a layer whose does lists check, written in the
// view and counted in checks.sql; cleansing and deduplicate in the view wherever the model gives
// them. A view keeps nothing and stops nothing, so fail, quarantine and results are not applied.
import type { FeatureStatus, IntentUse, LayerDuty } from "@ingestron/definitions";

/** The Microsoft Learn pages each entry's status comes from; all were read on 2026-11-10. */
const pages = {
  features: "https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/overview-features",
  countBig: "https://learn.microsoft.com/en-us/sql/t-sql/functions/count-big-transact-sql",
  trim: "https://learn.microsoft.com/en-us/sql/t-sql/functions/trim-transact-sql",
  nullif: "https://learn.microsoft.com/en-us/sql/t-sql/language-elements/nullif-transact-sql",
  case: "https://learn.microsoft.com/en-us/sql/t-sql/language-elements/case-transact-sql",
  upper: "https://learn.microsoft.com/en-us/sql/t-sql/functions/upper-transact-sql",
  coalesce: "https://learn.microsoft.com/en-us/sql/t-sql/language-elements/coalesce-transact-sql",
  atTimeZone: "https://learn.microsoft.com/en-us/sql/t-sql/queries/at-time-zone-transact-sql",
  rowNumber: "https://learn.microsoft.com/en-us/sql/t-sql/functions/row-number-transact-sql",
};

/** Generally available: serverless SQL pools support it, and the page carries no release label. */
const ga = (source: string): FeatureStatus => ({ level: "ga", checked: "2026-11-10", source });
const used = (does: string, source: string, onlyWhere?: LayerDuty): IntentUse => ({
  use: "used",
  does,
  status: ga(source),
  ...(onlyWhere && { onlyWhere }),
});
/** Reasons start in lower case: they follow "<What> isn't applied on <pack>: ". */
const notApplicable = (reason: string): IntentUse => ({ use: "not-applicable", reason });

/**
 * The zones the definitions package accepts that src/zones/windows.json has no Windows name for
 * (CLDR release 49 against definitions 1.13's zone list, checked 2026-11-10).
 */
export const noWindowsZone: readonly string[] = [
  "Antarctica/Troll",
  "CST6CDT",
  "EST5EDT",
  "MST7MDT",
  "PST8PDT",
];

/** The quality and cleansing entries of the pack. */
export const qualityIntent: Record<string, IntentUse> = {
  "quality.rules": used(
    "A condition in the view for drop, and a count in checks.sql, written from the rule.",
    pages.features,
    "check",
  ),
  "quality.rules=pattern": notApplicable("serverless T-SQL has no regular expressions."),
  "quality.rules=items": notApplicable("views type no arrays."),
  "quality.actions=warn": used(
    "The view keeps the row; checks.sql returns how many rows fail.",
    pages.countBig,
    "check",
  ),
  "quality.actions=drop": used(
    "The view's WHERE leaves the row out; checks.sql counts how many rows fail.",
    pages.features,
    "check",
  ),
  "quality.actions=fail": notApplicable(
    "a view can't stop a load; checks.sql checks this rule and raises an error when it runs.",
  ),
  "quality.table-checks": used(
    "Counted in checks.sql over the rows the view keeps: fail raises an error, warn returns the count.",
    pages.countBig,
    "check",
  ),
  "quality.quarantine": notApplicable(
    "a view keeps no rows to quarantine; checks.sql returns how many rows each drop check leaves out instead.",
  ),
  "quality.results": notApplicable(
    "a view keeps no results; checks.sql returns each check's counts instead when it runs.",
  ),
  "cleanse.trim": used("TRIM() in the view's SELECT.", pages.trim),
  "cleanse.empty": used("NULLIF(<column>, '') in the view's SELECT.", pages.nullif),
  "cleanse.map": used("A CASE expression in the view's SELECT.", pages.case),
  "cleanse.case": used("UPPER() or LOWER() in the view's SELECT.", pages.upper),
  "cleanse.default": used("COALESCE() in the view's SELECT.", pages.coalesce),
  "cleanse.timezone": {
    use: "used",
    does: "AT TIME ZONE with the zones' Windows names in the view's SELECT.",
    status: ga(pages.atTimeZone),
    zonesNotApplied: Object.fromEntries(
      noWindowsZone.map((zone) => [zone, `Windows has no zone for ${zone}.`]),
    ),
  },
  deduplicate: used(
    "A ROW_NUMBER() subquery in the view keeps the last row per primary key.",
    pages.rowNumber,
  ),
};
