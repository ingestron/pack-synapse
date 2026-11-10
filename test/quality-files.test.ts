// Quality and cleansing on views over files, and table checks (spec/behaviour.md, "Quality and
// cleansing"), on the small ERP project.
import { describe, expect, it } from "vitest";
import { base, generate } from "./project.js";
import { viewOf } from "./quality-project.js";

/** The standard with one layer, bronze, that does what `does` lists, and `extra` lines. */
const standard = (does: string, extra: string[] = []) =>
  base["standard.yaml"]!.replace(
    "store:",
    [`layers: [{ name: bronze, does: ${does} }]`, ...extra, "store:"].join("\n"),
  );

/** The flow with `extra` written on the orders table. */
const orders = (extra: string) =>
  base["flow.yaml"]!.replace("contract: orders }", `contract: orders, ${extra} }`);

/** The orders contract with `extra` on the column `name`. */
const column = (name: string, extra: string) =>
  base["orders.yaml"]!.replace(
    new RegExp(`\\{ name: ${name}, logicalType: (\\w+)(, primaryKey: true)? \\}`),
    (_text, type: string, key = "") => `{ name: ${name}, logicalType: ${type}${key}, ${extra} }`,
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

describe("a view over files", () => {
  it("cleanses, orders a key's rows by the file last, and leaves out the rows drop checks fail", () => {
    const files = run({
      "standard.yaml": standard("[cleanse, deduplicate, check]", ["quality: { required: drop }"]),
      "flow.yaml": orders(
        "cleanse: { columns: { total: { default: 0 } }, deduplicate: { order_by: [total] } }",
      ),
      "orders.yaml": column("id", "required: true"),
    });
    expect(viewOf(files["views.sql"]!, "[bronze].[orders]")).toBe(
      [
        "CREATE OR ALTER VIEW [bronze].[orders] AS",
        "SELECT *",
        "FROM (",
        "SELECT [id], [total]",
        "FROM (",
        "SELECT *, ROW_NUMBER() OVER (PARTITION BY [id] ORDER BY [total] DESC, [_ingestron_file] DESC) AS [_ingestron_row]",
        "FROM (",
        "SELECT",
        "  [id],",
        "  COALESCE([total], 0) AS [total],",
        "  [rows].filepath() AS [_ingestron_file]",
        ...filesRead,
        ") AS [cleansed]",
        ") AS [numbered]",
        "WHERE [_ingestron_row] = 1",
        ") AS [checked]",
        "WHERE ([id] IS NOT NULL);",
        "GO",
      ].join("\n"),
    );
  });

  it("keeps the columns the landing step adds after the contract's", () => {
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      "source: erp\ningest: { with: { audit: true } }\n",
    );
    const files = run({
      "standard.yaml": standard("[cleanse, deduplicate]"),
      "flow.yaml": flow.replace(
        "contract: orders }",
        "contract: orders, cleanse: { deduplicate: { order_by: [total] } } }",
      ),
    });
    const view = viewOf(files["views.sql"]!, "[bronze].[orders]");
    expect(view).toContain("SELECT [id], [total], [_loaded_at], [_run_id]\nFROM (");
    expect(view).toContain(
      "  CONVERT(DATETIME2(7), [_loaded_at], 127) AS [_loaded_at],\n  [_run_id],\n  [rows].filepath() AS [_ingestron_file]\n",
    );
    expect(files["checks.sql"]).toBeUndefined();
  });

  it("is the view it was when only warn checks run, and checks.sql reads it", () => {
    const files = run({
      "standard.yaml": standard("[check]"),
      "orders.yaml": column("id", "required: true"),
    });
    expect(viewOf(files["views.sql"]!, "[bronze].[orders]")).toBe(
      [
        "CREATE OR ALTER VIEW [bronze].[orders] AS",
        "SELECT *",
        ...filesRead.slice(0, -1),
        ") AS [rows];",
        "GO",
      ].join("\n"),
    );
    expect(files["checks.sql"]).toContain(
      ["FROM (", "SELECT *", ...filesRead, ") AS [rows];"].join("\n"),
    );
  });

  it("checks nothing in a layer whose does is not written, as before", () => {
    const files = run({ "orders.yaml": column("id", "required: true") });
    expect(Object.keys(files)).toEqual(["views.sql"]);
  });
});

describe("row check conditions", () => {
  const conditions = (contract: string) =>
    run({ "standard.yaml": standard("[check]"), "orders.yaml": contract })["checks.sql"] ?? "";

  it("uses % for an exact number, with null passing", () => {
    expect(conditions(column("id", "logicalTypeOptions: { multipleOf: 5 }"))).toContain(
      "COUNT_BIG(CASE WHEN [id] IS NULL OR [id] % 5 = 0 THEN NULL ELSE 1 END)",
    );
  });

  it("works the remainder out with FLOOR for a FLOAT, which % does not take", () => {
    expect(conditions(column("total", "logicalTypeOptions: { multipleOf: 0.5 }"))).toContain(
      "[total] IS NULL OR [total] - FLOOR([total] / 0.5) * 0.5 = 0",
    );
  });

  it("decides a null value before NOT IN, so the condition is never unknown", () => {
    const missing = (list: string) =>
      column(
        "id",
        `quality: [{ type: library, metric: missingValues, arguments: { missingValues: ${list} }, mustBe: 0 }]`,
      );
    expect(conditions(missing("[0, null]"))).toContain("[id] IS NOT NULL AND [id] NOT IN (0)");
    expect(conditions(missing("[0]"))).toContain("[id] IS NULL OR [id] NOT IN (0)");
  });

  it("writes ranges, exclusive or not", () => {
    expect(
      conditions(column("total", "logicalTypeOptions: { exclusiveMinimum: 0, maximum: 10 }")),
    ).toContain("[total] IS NULL OR [total] > 0");
  });
});

describe("cleansing values", () => {
  it("writes each value for its column's type", () => {
    const contract = base["orders.yaml"]!.replace(
      "{ name: total, logicalType: number }",
      "{ name: total, logicalType: number }\n      - { name: paid, logicalType: boolean }\n      - { name: due, logicalType: date }\n      - { name: at, logicalType: timestamp }\n      - { name: note, logicalType: string }",
    );
    const cleanse =
      "cleanse: { columns: { total: { default: 1.5 }, paid: { default: true }, due: { default: '2026-01-01' }, at: { default: '2026-01-01 00:00:00' }, note: { map: { \"it's\": null } } } }";
    const view = viewOf(
      run({
        "standard.yaml": standard("[cleanse]"),
        "orders.yaml": contract,
        "flow.yaml": orders(cleanse),
      })["views.sql"]!,
      "[bronze].[orders]",
    );
    expect(view).toContain("  COALESCE([total], 1.5) AS [total],");
    expect(view).toContain("  COALESCE([paid], CAST(1 AS BIT)) AS [paid],");
    expect(view).toContain("  COALESCE([due], CAST('2026-01-01' AS DATE)) AS [due],");
    expect(view).toContain(
      "  COALESCE([at], CAST('2026-01-01 00:00:00' AS DATETIME2(7))) AS [at],",
    );
    expect(view).toContain("  CASE [note] WHEN 'it''s' THEN NULL ELSE [note] END AS [note]\n");
  });
});
