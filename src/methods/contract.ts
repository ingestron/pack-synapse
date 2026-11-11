// What the Synapse pack does with each ODCS contract field: views type their
// columns from the contract, and check rows by its rules in a layer whose does
// lists check; the other facts describe the data and are kept as documentation.
import { contractCommon, type ContractUse } from "@ingestron/definitions";

const used = (does: string): ContractUse => ({ use: "used", does });
const notYet = (reason: string): ContractUse => ({ use: "not-yet", reason });
/** Used as a whole: the definitions package makes checks of every field under it. */
const checks = (does: string): ContractUse => ({ use: "used", whole: true, does });
const where = "in a layer whose does lists check, or is raw (each check counted as warn)";
const object = "schema.*";
const column = "schema.*.properties.*";

/** The Synapse pack's use of every contract field, by path. */
export const contract: Record<string, ContractUse> = {
  ...contractCommon,
  schema: used("One object per table; each table uses the object named like it."),
  [`${object}.name`]: used("Matched to the table by its name."),
  [`${object}.logicalType`]: { use: "documentation" },
  [`${object}.physicalName`]: {
    use: "elsewhere",
    reason: "The view is named by the standard's naming.",
  },
  [`${object}.physicalType`]: { use: "documentation" },
  [`${object}.description`]: { use: "documentation" },
  [`${object}.properties`]: used("Each property is a column of the view."),
  [`${object}.relationships`]: notYet("Synapse views declare no relationships."),
  [`${object}.quality`]: checks(
    `Rules with a comparison are counted over all rows in checks.sql, ${where}.`,
  ),
  [`${object}.tags`]: notYet("Synapse views carry no tags."),
  [`${column}.name`]: used("The column's name in the view and in the files."),
  [`${column}.physicalName`]: {
    use: "elsewhere",
    reason: "Files hold columns under their contract names; the pack that lands them renames.",
  },
  [`${column}.logicalType`]: used("Types the column in the view."),
  [`${column}.physicalType`]: used("Types a column that has no logicalType."),
  [`${column}.quality`]: checks(
    `Rules that allow no failing row become row checks in the view and checks.sql, the others table checks in checks.sql, ${where}. Patterns are not applied.`,
  ),
  [`${column}.required`]: used(
    `A not-null check with the standard's quality.required action, ${where}.`,
  ),
  [`${column}.logicalTypeOptions`]: checks(
    `Limits become row checks with quality.default's action, ${where}: length, minimum and maximum, and multipleOf. pattern and list items are not applied; format is documentation.`,
  ),
  [`${column}.unique`]: used(`A table check in checks.sql that no value repeats, ${where}.`),
  [`${column}.primaryKey`]: used("Deduplicate keeps one row per key."),
  [`${column}.primaryKeyPosition`]: used("Orders the key's columns."),
  [`${column}.description`]: { use: "documentation" },
  ...Object.fromEntries(
    [
      "partitioned",
      "partitionKeyPosition",
      "classification",
      "encryptedName",
      "relationships",
      "tags",
      "properties",
      "items",
    ].map((key) => [`${column}.${key}`, { use: "documentation" } as ContractUse]),
  ),
};
