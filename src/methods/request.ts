// What the platform team creates for the views: the database, the external
// data source and its credential, and access for the workspace and report users.
import type { RequestSection, ResolvedModel, ResolvedTable, Step } from "@ingestron/definitions";
import { canonical, quote, viewingStep } from "../sql/index.js";
import { code, exactSection, grantedViews, principalLines } from "./request-access.js";

/** The Synapse sections of the platform request; none when no table uses the pack. */
export function request(model: ResolvedModel): RequestSection[] {
  const steps = model.tables.flatMap(synapseStep);
  if (steps.length === 0) return [];
  const databases = unique(steps.map(({ table }) => table.fullName.catalog));
  const sources = sourcesOf(steps);
  const where = databases.map(code).join(", ");
  const reportUsers = reportUserLines(
    model,
    steps.map(({ table }) => table),
    sources,
  );
  return [
    {
      title: "Synapse serverless database",
      lines: databases.map(
        (name) => `Create the serverless SQL database ${code(name)}; the views live in it.`,
      ),
    },
    {
      title: "External data source",
      lines: sources.flatMap(([name, location]) => [
        `In ${where}, create a master key if the database has none (\`CREATE MASTER KEY ENCRYPTION BY PASSWORD = '<a strong password>'\`), the database scoped credential ${code(credential(name))} with \`IDENTITY = 'Managed Identity'\`, and the external data source ${code(name)} at ${code(location)} using it.`,
        `Give the Synapse workspace's managed identity Storage Blob Data Reader on the storage behind ${code(location)}; if the storage account has a firewall, allow the workspace with a resource instance rule.`,
      ]),
    },
    { title: "Report users", lines: reportUsers },
    ...exactSection(grantedViews(model)),
  ];
}

function synapseStep(table: ResolvedTable): { table: ResolvedTable; step: Step }[] {
  const step = viewingStep(table);
  return step ? [{ table, step }] : [];
}

const unique = (values: string[]) => [...new Set(values)];

/** One data source per name and place, however its location is written; the first form wins. */
function sourcesOf(steps: readonly { step: Step }[]): [string, string][] {
  const byPlace = new Map<string, [string, string]>();
  for (const { step } of steps) {
    const name = String(step.settings.data_source);
    const location = String(step.settings.data_source_location);
    const key = `${name}\n${canonical(location).replace(/\/+$/, "")}`;
    if (!byPlace.has(key)) byPlace.set(key, [name, location]);
  }
  return [...byPlace.values()];
}

/**
 * The report users section's lines: SELECT on the schemas for every report user; with views
 * granted to principals, a line for each principal, and SELECT on the other views only.
 */
function reportUserLines(
  model: ResolvedModel,
  tables: readonly ResolvedTable[],
  sources: readonly [string, string][],
): string[] {
  const credentials = sources.map(([name]) => credential(name));
  const granted = grantedViews(model).filter(({ access }) => access.grants.length > 0);
  if (granted.length === 0) return [reportUsersLine(tables, "schemas", credentials)];
  // A view with exact grants and no role is left out: views.sql revokes its SELECT each run.
  const withAccess = grantedViews(model).map((item) => item.table);
  const others = tables.filter((table) => !withAccess.includes(table));
  const locations = sources.map(([, location]) => location);
  return [
    ...(others.length > 0 ? [reportUsersLine(others, "views", credentials)] : []),
    ...principalLines(granted, { credentials, locations }),
  ];
}

/**
 * The line about report users: SELECT on the tables' schemas, or, beside views granted to
 * principals, on the views themselves, since SELECT on a schema would reach those too.
 */
function reportUsersLine(
  tables: readonly ResolvedTable[],
  on: "schemas" | "views",
  credentials: readonly string[],
): string {
  const where = unique(tables.map((table) => table.fullName.catalog))
    .map(code)
    .join(", ");
  const names = unique(
    tables.map(({ fullName }) =>
      on === "schemas" ? fullName.schema : `${quote(fullName.schema)}.${quote(fullName.table)}`,
    ),
  );
  const noun = names.length === 1 ? on.slice(0, -1) : on;
  const plural = credentials.length === 1 ? "credential" : "credentials";
  return `In ${where}, give each report user SELECT on the ${noun} ${names.map(code).join(", ")}, REFERENCES on the database scoped ${plural} ${credentials.map(code).join(", ")}, and ADMINISTER DATABASE BULK OPERATIONS, which views over files need.`;
}

/** The credential a data source reads with: `<data source>_identity`. */
const credential = (dataSource: string) => `${dataSource}_identity`;
