// What the Synapse pack does with each ODCS contract field: views type their
// columns from the contract and check no rows; the other facts describe the
// data and are kept as documentation.
import { contractCommon, type ContractUse } from "@ingestron/definitions";

const used = (does: string): ContractUse => ({ use: "used", does });
const notYet = (reason: string): ContractUse => ({ use: "not-yet", reason });
const noRows = notYet("Synapse views check no rows.");
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
  [`${object}.quality`]: noRows,
  [`${object}.tags`]: notYet("Synapse views carry no tags."),
  [`${column}.name`]: used("The column's name in the view and in the files."),
  [`${column}.physicalName`]: {
    use: "elsewhere",
    reason: "Files hold columns under their contract names; the pack that lands them renames.",
  },
  [`${column}.logicalType`]: used("Types the column in the view."),
  [`${column}.physicalType`]: used("Types a column that has no logicalType."),
  [`${column}.quality`]: noRows,
  [`${column}.description`]: { use: "documentation" },
  // Nothing enforces not-null in a view over files.
  [`${column}.required`]: notYet("Synapse views check no rows."),
  ...Object.fromEntries(
    [
      "primaryKey",
      "primaryKeyPosition",
      "logicalTypeOptions",
      "unique",
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
