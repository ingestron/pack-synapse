// What the pack does with access (spec/behaviour.md, "Access"): it grants SELECT on the views
// it keeps, and with exact grants revokes what they do not give; a view cannot be written,
// and serverless SQL pools have no data masking or row-level security.
import type { Capability, FeatureStatus, IntentUse, JsonSchema } from "@ingestron/definitions";

/** The Microsoft Learn pages each entry's status comes from; all were read on 2026-11-11. */
const pages = {
  grant:
    "https://learn.microsoft.com/en-us/sql/t-sql/statements/grant-object-permissions-transact-sql",
  revoke: "https://learn.microsoft.com/en-us/sql/t-sql/statements/revoke-transact-sql",
};

/** Generally available: serverless SQL pools support it, and the page carries no release label. */
const ga = (source: string): FeatureStatus => ({ level: "ga", checked: "2026-11-11", source });

/** Reasons start in lower case: they follow "<What> isn't applied on <pack>: ". */
const notApplicable = (reason: string): IntentUse => ({ use: "not-applicable", reason });

/** The access entries of the pack's coverage. */
export const accessIntent: Record<string, IntentUse> = {
  "access.grants=read": {
    use: "used",
    does: "GRANT SELECT ON OBJECT:: each view, in views.sql after the view.",
    status: ga(pages.grant),
  },
  "access.grants=write": notApplicable("views are read-only."),
  "access.exact=true": {
    use: "used",
    does: "REVOKE of each permission granted directly on the view that its access does not give, in views.sql after its grants.",
    status: ga(pages.revoke),
  },
  "access.masks": notApplicable(
    "Synapse serverless has no data masking, and readers of views over files can read the files directly.",
  ),
  "access.filters": notApplicable(
    "Synapse serverless has no row-level security, and readers of views over files can read the files directly.",
  ),
};

/** The Synapse pack's capabilities, each turned on with `synapse.manage.<id>`. */
export const capabilities: Capability[] = [
  {
    id: "grants",
    title: "Grants",
    does: "Grants SELECT on each view to the principals of its contract's roles and its layer's, in views.sql after the view; with exact grants, revokes what they do not give.",
    needs: [
      "The identity that runs views.sql owns the views, or has CONTROL on them through db_owner or on their schema or database, so it may grant and revoke on them; with exact grants, it keeps its own direct permissions on a view, but not those of a group it belongs to",
      "Each principal is a database user in the view's database; ingestron request lists them",
    ],
  },
];

/** `synapse.manage.grants`: grant each view's roles in views.sql. */
const manageGrants: JsonSchema = {
  type: "boolean",
  description:
    "Grant SELECT on each view to the principals its contract's roles and its layer name, in views.sql after the view; with exact grants, also revoke what they do not give. Default: false.",
  find: "Ask your Synapse administrator: the identity that runs views.sql needs CONTROL on the views, as db_owner has, and each principal must be a database user; ingestron request lists them.",
  examples: [true],
};

/** The Platform's `synapse` section: the features the pack may change in the databases. */
export const platformSection: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    manage: {
      type: "object",
      additionalProperties: false,
      description: "What the pack may change in the serverless databases besides the views.",
      properties: { grants: manageGrants },
    },
  },
};
