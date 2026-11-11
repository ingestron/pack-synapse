// Quality and cleansing on the shared fixture (spec/behaviour.md, "Quality and cleansing"):
// silver's views cleanse, deduplicate and leave out the rows drop checks fail; checks.sql
// counts every check; bronze, which keeps its rows raw, has the views it had before, and
// checks.sql counts its checks, each as warn.
import { describe, expect, it } from "vitest";
import { crm, viewOf } from "./quality-project.js";

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
const customersRows = [
  `SELECT ${customersOutputs}`,
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
const ordersRows = [
  "SELECT [id], [customer_id], [status], [total], [updated_at]",
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
const customersChecks: [string, string, string][] = [
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

const ordersChecks: [string, string, string][] = [
  ["id_not_null", "drop", "[id] IS NOT NULL"],
  ["customer_id_not_null", "drop", "[customer_id] IS NOT NULL"],
  ["updated_at_not_null", "drop", "[updated_at] IS NOT NULL"],
];

/** A table's block of checks.sql: its variables, set by one read of its rows. */
function block(t: number, table: string, rows: string, checks: [string, string, string][]) {
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
function results(t: number, view: string, checks: [string, string, string][]) {
  return checks.map(([name, action], index) => {
    const variable = `@check_${t}_${index + 1}`;
    return `SELECT N'${view}' AS [table], N'${name}' AS [check], N'${action}' AS [action], ${variable} AS [failing_rows], CASE WHEN ${variable} = 0 THEN 1 ELSE 0 END AS [passed]`;
  });
}

describe("silver's views", () => {
  it("cleanse, keep one row per key and leave out the rows drop checks fail", () => {
    const views = crm().files["views.sql"]!;
    expect(viewOf(views, "[silver].[orders_clean]")).toBe(
      [
        "CREATE OR ALTER VIEW [silver].[orders_clean] AS",
        "SELECT *",
        "FROM (",
        ordersRows,
        ") AS [checked]",
        "WHERE ([id] IS NOT NULL)",
        "  AND ([customer_id] IS NOT NULL)",
        "  AND ([updated_at] IS NOT NULL);",
        "GO",
      ].join("\n"),
    );
    expect(viewOf(views, "[silver].[customers_clean]")).toBe(
      [
        "CREATE OR ALTER VIEW [silver].[customers_clean] AS",
        "SELECT *",
        "FROM (",
        customersRows,
        ") AS [checked]",
        "WHERE ([id] IS NOT NULL)",
        "  AND ([email] IS NOT NULL)",
        "  AND ([updated_at] IS NOT NULL);",
        "GO",
      ].join("\n"),
    );
  });

  it("keep the rows warn and fail checks fail", () => {
    const view = viewOf(crm().files["views.sql"]!, "[silver].[customers_clean]");
    expect(view).not.toContain("2000-01-01");
    expect(view).not.toContain("LEN(");
  });
});

describe("checks.sql", () => {
  it("counts every check the pack applies over the rows before drop, then stops at a fail check", () => {
    const sql = crm().files["checks.sql"]!;
    expect(sql.split("\n")[0]).toBe(
      "-- Generated by Ingestron for crm: the checks of the Synapse serverless SQL views. Do not edit.",
    );
    expect(sql).toContain(
      "-- It counts each row check's failing rows in the files the views read, the rows drop checks leave out included,\n-- and each table check over the rows the view keeps. It returns one row per check,\n",
    );
    // Bronze is raw: its checks come first, each counted as warn over the files.
    expect(sql).toContain("USE [crm_dev];\n\n-- customers\nDECLARE @rows_1 BIGINT,");
    expect(sql).toContain("\n\n-- orders\nDECLARE @rows_2 BIGINT,");
    expect(sql).toContain(block(3, "customers_clean", customersRows, customersChecks));
    expect(sql).toContain(block(4, "orders_clean", ordersRows, ordersChecks));
    const warned = (checks: [string, string, string][]) =>
      checks
        .filter(([name]) => name !== "recent")
        .map(([name, , condition]): [string, string, string] => [name, "warn", condition]);
    expect(
      sql.endsWith(
        [
          [
            ...results(1, "bronze.customers", warned(customersChecks)),
            ...results(2, "bronze.orders", warned(ordersChecks)),
            ...results(3, "silver.customers_clean", customersChecks),
            ...results(4, "silver.orders_clean", ordersChecks),
          ].join("\nUNION ALL\n") + ";",
          `IF @check_3_13 > 0 THROW 50000, N'The check "recent" failed on silver.customers_clean.', 1;`,
        ].join("\n") + "\n",
      ),
    ).toBe(true);
  });

  it("is not written when no table runs a check", () => {
    const files = crm({
      "standard.yaml": [
        "apiVersion: ingestron.io/v1",
        "kind: Standard",
        "id: medallion",
        "packs: [synapse@2, landing@1]",
        "layers: [bronze, silver, gold]",
        "",
      ].join("\n"),
    }).files;
    expect(Object.keys(files)).toEqual(["views.sql"]);
  });
});

describe("bronze, which keeps its rows raw", () => {
  it("has the views it had before checks and cleansing", () => {
    const plain = crm({
      "standard.yaml": [
        "apiVersion: ingestron.io/v1",
        "kind: Standard",
        "id: medallion",
        "packs: [synapse@2, landing@1]",
        "layers: [bronze, silver, gold]",
        "",
      ].join("\n"),
    }).files["views.sql"]!;
    const views = crm().files["views.sql"]!;
    for (const name of ["[bronze].[customers]", "[bronze].[orders]"]) {
      expect(viewOf(views, name), name).not.toBe("");
      expect(viewOf(views, name), name).toBe(viewOf(plain, name));
    }
  });
});
