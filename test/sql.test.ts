// The T-SQL of a view: quoted names, typed column lists, OPENROWSET and the view itself.
import type { Column } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { columnList, filesQuery, quote, viewStatement } from "../src/sql.js";

const columns: Column[] = [
  { name: "id", logicalType: "integer", nullable: false },
  { name: "name", logicalType: "string", nullable: true },
  { name: "at", logicalType: "timestamp", nullable: true },
];

describe("quote", () => {
  it("brackets a name and doubles a closing bracket", () => {
    expect(quote("a]b")).toBe("[a]]b]");
  });

  it("brackets reserved words and spaces", () => {
    expect(quote("order")).toBe("[order]");
    expect(quote("my table")).toBe("[my table]");
  });
});

describe("columnList", () => {
  it("types each column from its logicalType, with UTF-8 text", () => {
    expect(columnList(columns)).toBe(
      [
        "  [id] BIGINT",
        "  [name] VARCHAR(8000) COLLATE Latin1_General_100_BIN2_UTF8",
        "  [at] DATETIME2(7)",
      ].join(",\n"),
    );
  });

  it("uses a type written for a column without a logicalType as it is", () => {
    expect(columnList([{ name: "amount", type: "DECIMAL(18,2)", nullable: true }])).toBe(
      "  [amount] DECIMAL(18,2)",
    );
  });
});

describe("filesQuery", () => {
  it("reads Parquet files under the data source", () => {
    expect(
      filesQuery({
        path: "erp/orders/*.parquet",
        dataSource: "landing",
        format: "parquet",
        columns,
      }),
    ).toBe(
      [
        "SELECT *",
        "FROM OPENROWSET(",
        "  BULK 'erp/orders/*.parquet',",
        "  DATA_SOURCE = 'landing',",
        "  FORMAT = 'PARQUET'",
        ") WITH (",
        columnList(columns),
        ") AS [rows]",
      ].join("\n"),
    );
  });

  it("reads CSV files with a header row, binding columns by name", () => {
    expect(
      filesQuery({
        path: "files/o'neil.csv",
        dataSource: "landing",
        format: "csv",
        columns,
        csv: { header: true, delimiter: ";" },
      }),
    ).toBe(
      [
        "SELECT *",
        "FROM OPENROWSET(",
        "  BULK 'files/o''neil.csv',",
        "  DATA_SOURCE = 'landing',",
        "  FORMAT = 'CSV',",
        "  PARSER_VERSION = '2.0',",
        "  HEADER_ROW = TRUE,",
        "  FIELDTERMINATOR = ';'",
        ") WITH (",
        columnList(columns),
        ") AS [rows]",
      ].join("\n"),
    );
  });
});

describe("viewStatement", () => {
  it("creates the schema when missing, then creates or alters the view", () => {
    expect(viewStatement({ schema: "bronze", table: "my table" }, "SELECT 1 AS [one]")).toBe(
      [
        "IF SCHEMA_ID(N'bronze') IS NULL EXEC(N'CREATE SCHEMA [bronze]');",
        "GO",
        "CREATE OR ALTER VIEW [bronze].[my table] AS",
        "SELECT 1 AS [one];",
        "GO",
      ].join("\n"),
    );
  });

  it("escapes a schema name inside the dynamic statement", () => {
    expect(viewStatement({ schema: "o'k]", table: "t" }, "SELECT 1")).toContain(
      "IF SCHEMA_ID(N'o''k]') IS NULL EXEC(N'CREATE SCHEMA [o''k]]]');",
    );
  });
});
