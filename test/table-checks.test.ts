// Table checks in checks.sql (spec/behaviour.md, "Table checks"), on the small ERP project.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions, type ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../src/index.js";
import { base, generate } from "./project.js";
import { landing, tables } from "./stub-packs.js";

/** The standard with one layer, bronze, that does what `does` lists, and `extra` lines. */
const standard = (does: string, extra: string[] = []) =>
  base["standard.yaml"]!.replace(
    "store:",
    [`layers: [{ name: bronze, does: ${does} }]`, ...extra, "store:"].join("\n"),
  );

const filesRead = [
  "FROM OPENROWSET(",
  "  BULK 'erp/orders/orders.parquet',",
  "  DATA_SOURCE = 'landing',",
  "  FORMAT = 'PARQUET'",
  ") WITH (",
  "  [id] BIGINT,",
  "  [total] FLOAT",
  ") AS [rows]",
];

const run = (changes: Record<string, string>) => {
  const { result, files } = generate(changes);
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return files;
};

describe("table checks in checks.sql", () => {
  const contract = base["orders.yaml"]!.replace("    properties:", () =>
    [
      "    quality:",
      "      - { type: library, metric: rowCount, mustBeGreaterThan: 0 }",
      "      - { type: library, metric: duplicateValues, arguments: { properties: [id, total] }, mustBe: 0 }",
      "      - { type: library, metric: duplicateValues, mustBe: 0 }",
      "      - { type: sql, query: 'SELECT COUNT(*) FROM $${object} WHERE total < 0', mustBe: 0 }",
      "    properties:",
    ].join("\n"),
  )
    .replace("primaryKey: true }", "primaryKey: true, unique: true }")
    .replace(
      "{ name: total, logicalType: number }",
      () =>
        "{ name: total, logicalType: number, quality: [{ type: library, metric: invalidValues, arguments: { pattern: '^[0-9]+$' }, mustBeLessThan: 5 }, { type: library, metric: nullValues, mustBeLessThan: 10, unit: percent }, { type: library, metric: missingValues, arguments: { missingValues: [0] }, mustBeBetween: [0, 3] }] }",
    );
  const rows = ["SELECT *", ...filesRead].join("\n");
  const distinct = (variable: string) =>
    [
      `SELECT ${variable} = @rows_1 - COUNT_BIG(*) FROM (SELECT DISTINCT [id], [total] FROM (`,
      rows,
      ") AS [rows] WHERE [id] IS NOT NULL AND [total] IS NOT NULL) AS [distinct_rows];",
    ].join("\n");
  const result = (name: string, variable: string, passes: string) =>
    `SELECT N'bronze.orders' AS [table], N'${name}' AS [check], N'warn' AS [action], ISNULL(${variable}, 0) AS [failing_rows], CASE WHEN ${passes} THEN 1 ELSE 0 END AS [passed]`;

  it("counts each over the rows, in one read where it can, and compares by its rule", () => {
    const checks = run({ "standard.yaml": standard("[check]"), "orders.yaml": contract })[
      "checks.sql"
    ]!;
    expect(checks).toContain(
      [
        "-- orders",
        `DECLARE @rows_1 BIGINT, ${[1, 2, 3, 4, 5, 6, 7].map((n) => `@check_1_${n} BIGINT`).join(", ")};`,
        "SELECT",
        "  @rows_1 = COUNT_BIG(*),",
        "  @check_1_1 = COUNT_BIG(*),",
        "  @check_1_5 = COUNT_BIG(*) - COUNT_BIG(DISTINCT [id]),",
        "  @check_1_6 = COUNT_BIG(CASE WHEN [total] IS NULL THEN 1 END),",
        "  @check_1_7 = COUNT_BIG(CASE WHEN [total] IS NULL OR [total] IN (0) THEN 1 END)",
        "FROM (",
        rows,
        ") AS [rows];",
        distinct("@check_1_2"),
        distinct("@check_1_3"),
        "SET @check_1_4 = (SELECT COUNT(*) FROM [bronze].[orders] WHERE total < 0);",
      ].join("\n"),
    );
    expect(checks).toContain(result("orders_rowcount", "@check_1_1", "ISNULL(@check_1_1, 0) > 0"));
    expect(checks).toContain(result("id_unique", "@check_1_5", "ISNULL(@check_1_5, 0) = 0"));
    expect(checks).toContain(
      result(
        "total_nullvalues",
        "@check_1_6",
        "CASE WHEN @rows_1 = 0 THEN 0 ELSE ISNULL(@check_1_6, 0) * 100.0 / @rows_1 END < 10",
      ),
    );
    expect(checks).toContain(
      result("total_missingvalues", "@check_1_7", "ISNULL(@check_1_7, 0) BETWEEN 0 AND 3"),
    );
    expect(checks).not.toContain("total_invalidvalues");
  });

  it("raises an error for a fail table check that does not pass", () => {
    const checks = run({
      "standard.yaml": standard("[check]", ["quality: { default: fail }"]),
      "orders.yaml": base["orders.yaml"]!.replace(
        "    properties:",
        () =>
          "    quality:\n      - { type: library, metric: rowCount, mustBeGreaterThan: 0 }\n    properties:",
      ),
    })["checks.sql"]!;
    expect(
      checks.endsWith(
        `IF NOT (ISNULL(@check_1_1, 0) > 0) THROW 50000, N'The table check "orders_rowcount" failed on bronze.orders.', 1;\n`,
      ),
    ).toBe(true);
  });

  it("says a pattern table check is not applied, when building every environment", () => {
    const files = { ...base, "standard.yaml": standard("[check]"), "orders.yaml": contract };
    const model = resolveDefinitions(memoryFiles(files), {
      packs: [landing, synapse, tables],
      environment: "dev",
      deployTime: true,
      environmentsTogether: true,
    }).model as ResolvedModel;
    expect(synapse.buildEnvironments!({ dev: model }).problems).toContainEqual({
      code: "PACK_NOTICE",
      severity: "warning",
      message:
        'The table check "total_invalidvalues" isn\'t applied on Synapse: serverless T-SQL has no regular expressions.',
      hint: "Check the pattern in a layer another engine keeps, or write the check as a sql table check.",
      file: "flow.yaml",
    });
  });
});

describe("table checks where drop checks leave rows out", () => {
  const files = () =>
    run({
      "standard.yaml": standard("[check]", ["quality: { required: drop }"]),
      "orders.yaml": base["orders.yaml"]!.replace(
        "    properties:",
        () =>
          "    quality:\n      - { type: library, metric: rowCount, mustBeGreaterThan: 0 }\n    properties:",
      ).replace("primaryKey: true }", "primaryKey: true, required: true, unique: true }"),
    });
  const rows = ["SELECT *", ...filesRead].join("\n");
  const kept = ["SELECT *", "FROM (", rows, ") AS [checked]", "WHERE ([id] IS NOT NULL)"].join(
    "\n",
  );

  it("count the row checks over the files, and the table checks over the rows the view keeps", () => {
    expect(files()["checks.sql"]).toContain(
      [
        "-- orders",
        "DECLARE @rows_1 BIGINT, @kept_1 BIGINT, @check_1_1 BIGINT, @check_1_2 BIGINT, @check_1_3 BIGINT;",
        "SELECT",
        "  @rows_1 = COUNT_BIG(*),",
        "  @check_1_1 = COUNT_BIG(CASE WHEN [id] IS NOT NULL THEN NULL ELSE 1 END)",
        "FROM (",
        rows,
        ") AS [rows];",
        "SELECT",
        "  @kept_1 = COUNT_BIG(*),",
        "  @check_1_2 = COUNT_BIG(*),",
        "  @check_1_3 = COUNT_BIG(*) - COUNT_BIG(DISTINCT [id])",
        "FROM (",
        kept,
        ") AS [rows];",
      ].join("\n"),
    );
  });

  it("so a file's null-id row, which drop leaves out, is not a duplicate, and an empty view has no rows", () => {
    const checks = files()["checks.sql"]!;
    const beforeDrop = checks.slice(
      checks.indexOf("@rows_1 = COUNT_BIG(*)"),
      checks.indexOf(") AS [rows];"),
    );
    // Neither table check reads the rows before drop, where the null-id row still is.
    expect(beforeDrop).not.toContain("@check_1_2");
    expect(beforeDrop).not.toContain("@check_1_3");
    // rowCount compares the rows the view keeps: when drop leaves out every row, it is 0 and fails.
    expect(checks).toContain(
      "N'orders_rowcount' AS [check], N'warn' AS [action], ISNULL(@check_1_2, 0) AS [failing_rows], CASE WHEN ISNULL(@check_1_2, 0) > 0 THEN 1 ELSE 0 END AS [passed]",
    );
  });
});
