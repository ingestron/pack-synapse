// Synapse serverless SQL types for each contract logicalType.

/** The column type in a view's column list, by the contract's logicalType. */
export const synapseTypes: Record<string, string> = {
  string: "VARCHAR(8000) COLLATE Latin1_General_100_BIN2_UTF8",
  integer: "BIGINT",
  number: "FLOAT",
  boolean: "BIT",
  date: "DATE",
  timestamp: "DATETIME2(7)",
  time: "TIME",
  // Objects and arrays are read as their JSON text.
  object: "VARCHAR(MAX) COLLATE Latin1_General_100_BIN2_UTF8",
  array: "VARCHAR(MAX) COLLATE Latin1_General_100_BIN2_UTF8",
};
