// Expected SQL for the quality fixture, including readable projections and result rows.
const toUtc = (column: string) =>
  `CAST((CAST([${column}] AS DATETIME2(7)) AT TIME ZONE 'GMT Standard Time') AT TIME ZONE 'UTC' AS DATETIME2(7)) AS [${column}]`;

/** customers_clean's columns, cleansed in the model's order. */
const customersColumns = [
  "  [id]",
  "  LOWER(NULLIF(TRIM([email]), '')) AS [email]",
  "  NULLIF([name], '') AS [name]",
  "  UPPER(CASE NULLIF(TRIM([country]), '') WHEN 'United Kingdom' THEN 'GB' WHEN 'UK' THEN 'GB' WHEN '-' THEN NULL ELSE NULLIF(TRIM([country]), '') END) AS [country]",
  "  COALESCE(NULLIF(TRIM([status]), ''), 'active') AS [status]",
  "  NULLIF(TRIM([segment]), '') AS [segment]",
  "  NULLIF(TRIM([phone]), '') AS [phone]",
  "  NULLIF(TRIM([code]), '') AS [code]",
  "  [age]",
  "  CASE [score] WHEN -1 THEN 0 ELSE [score] END AS [score]",
  "  [tags]",
  "  COALESCE([vip], CAST(0 AS BIT)) AS [vip]",
  `  ${toUtc("signed_up")}`,
  "  CAST((CAST([contacted_at] AS DATETIME2(7)) AT TIME ZONE 'UTC') AT TIME ZONE 'GMT Standard Time' AS DATETIME2(7)) AS [contacted_at]",
  `  ${toUtc("last_seen")}`,
  `  ${toUtc("updated_at")}`,
].join(",\n");

const customersOutputs =
  "[id], [email], [name], [country], [status], [segment], [phone], [code], [age], [score], [tags], [vip], [signed_up], [contacted_at], [last_seen], [updated_at]";

/** customers_clean's rows: cleansed, then one per id, the last by updated_at. */
export const customersRows = [
  `SELECT\n${customersOutputs
    .split(", ")
    .map((column) => `  ${column}`)
    .join(",\n")}`,
  "FROM (",
  "SELECT *, ROW_NUMBER() OVER (PARTITION BY [id] ORDER BY [updated_at] DESC) AS [_ingestron_row]",
  "FROM (",
  "SELECT",
  customersColumns,
  "FROM (",
  "SELECT * FROM [bronze].[customers]",
  ") AS [source]",
  ") AS [cleansed]",
  ") AS [numbered]",
  "WHERE [_ingestron_row] = 1",
].join("\n");

/** orders_clean's rows: its code's rows, cleansed, then one per id. */
export const ordersRows = [
  "SELECT",
  "  [id],",
  "  [customer_id],",
  "  [status],",
  "  [total],",
  "  [updated_at]",
  "FROM (",
  "SELECT *, ROW_NUMBER() OVER (PARTITION BY [id] ORDER BY [updated_at] DESC) AS [_ingestron_row]",
  "FROM (",
  "SELECT",
  "  [id],",
  "  [customer_id],",
  "  UPPER(NULLIF(TRIM([status]), '')) AS [status],",
  "  [total],",
  `  ${toUtc("updated_at")}`,
  "FROM (",
  "SELECT * FROM [bronze].[orders] WHERE customer_id > 0",
  ") AS [source]",
  ") AS [cleansed]",
  ") AS [numbered]",
  "WHERE [_ingestron_row] = 1",
].join("\n");

/** Each row check of customers_clean the pack applies, with its action and condition. */
export const customersChecks: [string, string, string][] = [
  ["id_not_null", "drop", "[id] IS NOT NULL"],
  ["email_not_null", "drop", "[email] IS NOT NULL"],
  ["updated_at_not_null", "drop", "[updated_at] IS NOT NULL"],
  ["email_min_length", "warn", "[email] IS NULL OR LEN(REPLACE([email], ' ', '_')) >= 3"],
  ["name_max_length", "warn", "[name] IS NULL OR LEN(REPLACE([name], ' ', '_')) <= 100"],
  ["country_invalidvalues", "warn", "[country] IS NULL OR [country] IN ('GB', 'IE', 'FR')"],
  ["status_missingvalues", "warn", "[status] IS NOT NULL AND [status] NOT IN ('n/a')"],
  ["segment_missingvalues", "warn", "[segment] IS NULL OR [segment] NOT IN ('unknown')"],
  ["phone_nullvalues", "warn", "[phone] IS NOT NULL"],
  ["age_minimum", "warn", "[age] IS NULL OR [age] >= 0"],
  ["age_exclusive_maximum", "warn", "[age] IS NULL OR [age] < 150"],
  ["score_multiple_of", "warn", "[score] IS NULL OR [score] - FLOOR([score] / 5) * 5 = 0"],
  ["recent", "fail", "[updated_at] >= '2000-01-01'"],
];

export const ordersChecks: [string, string, string][] = [
  ["id_not_null", "drop", "[id] IS NOT NULL"],
  ["customer_id_not_null", "drop", "[customer_id] IS NOT NULL"],
  ["updated_at_not_null", "drop", "[updated_at] IS NOT NULL"],
];

/** A table's block of checks.sql: its variables, set by one read of its rows. */
export function block(t: number, table: string, rows: string, checks: [string, string, string][]) {
  const variables = checks.map((_, index) => `@check_${t}_${index + 1} BIGINT`);
  return [
    `-- ${table}`,
    `DECLARE @rows_${t} BIGINT, ${variables.join(", ")};`,
    "SELECT",
    [
      `  @rows_${t} = COUNT_BIG(*)`,
      ...checks.map(
        ([, , condition], index) =>
          `  @check_${t}_${index + 1} = COUNT_BIG(CASE WHEN ${condition} THEN NULL ELSE 1 END)`,
      ),
    ].join(",\n"),
    "FROM (",
    rows,
    ") AS [rows];",
  ].join("\n");
}

/** The result's line for each check of a table. */
export function results(t: number, view: string, checks: [string, string, string][]) {
  return checks.map(([name, action], index) => {
    const variable = `@check_${t}_${index + 1}`;
    return [
      "SELECT",
      `  N'${view}' AS [table],`,
      `  N'${name}' AS [check],`,
      `  N'${action}' AS [action],`,
      `  ${variable} AS [failing_rows],`,
      `  CASE WHEN ${variable} = 0 THEN 1 ELSE 0 END AS [passed]`,
    ].join("\n");
  });
}
