// What the platform team creates for the views: the database, the external
// data source and its credential, and access for the workspace and report users.
import type { RequestSection, ResolvedModel, ResolvedTable, Step } from "@ingestron/definitions";

/** The Synapse sections of the platform request; none when no table uses the pack. */
export function request(model: ResolvedModel): RequestSection[] {
  const steps = model.tables.flatMap(synapseStep);
  if (steps.length === 0) return [];
  const databases = unique(steps.map(({ table }) => table.fullName.catalog));
  const sources = unique(
    steps.map(
      ({ step }) =>
        `${String(step.settings.data_source)}\n${String(step.settings.data_source_location)}`,
    ),
  ).map((key) => key.split("\n") as [string, string]);
  const schemas = unique(steps.map(({ table }) => table.fullName.schema));
  const where = databases.map(code).join(", ");
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
    {
      title: "Report users",
      lines: [
        `In ${where}, give each report user SELECT on the ${schemas.length === 1 ? "schema" : "schemas"} ${schemas.map(code).join(", ")}, REFERENCES on the database scoped ${sources.length === 1 ? "credential" : "credentials"} ${sources.map(([name]) => code(credential(name))).join(", ")}, and ADMINISTER DATABASE BULK OPERATIONS, which views over files need.`,
      ],
    },
  ];
}

function synapseStep(table: ResolvedTable): { table: ResolvedTable; step: Step }[] {
  const step = table.serve?.method === "synapse-serve" ? table.serve : table.store;
  return step && /^synapse-(view|serve)$/.test(step.method) ? [{ table, step }] : [];
}

const unique = (values: string[]) => [...new Set(values)];
const code = (text: string) => `\`${text}\``;

/** The credential a data source reads with: `<data source>_identity`. */
const credential = (dataSource: string) => `${dataSource}_identity`;
