// Views that would crash, read the wrong columns, or hand SQL to the wrong engine.
import { describe, expect, it } from "vitest";
import { base, problems, views } from "./project.js";

const flowWith = (settings: string) =>
  base["flow.yaml"]!.replace("source: erp\n", `source: erp\ningest: { with: { ${settings} } }\n`);
const transform = (code: string, extra = "") =>
  [
    "apiVersion: ingestron.io/v1",
    "kind: Transform",
    "id: daily",
    "inputs: [orders]",
    `code: "${code}"`,
    "contract: orders",
    extra,
  ].join("\n");
const withDaily = (orders: string) =>
  orders.replace(
    "  - name: orders\n",
    "  - name: daily\n    logicalType: object\n    properties:\n      - { name: id, logicalType: integer }\n  - name: orders\n",
  );
const prefix = '"synapse-view" for table "orders": ';

describe("files a view cannot find", () => {
  it("refuses a view over files whose ingest does not say where they land", () => {
    expect(problems({ "flow.yaml": flowWith('location: "none"') })).toEqual([
      {
        code: "METHOD_CHECK",
        message: `${prefix}"land" does not say where its files land, so no view can read them.`,
      },
    ]);
  });
});

describe("columns", () => {
  it("reads a column under its name in the files when the ingest did not rename it", () => {
    const contract = base["orders.yaml"]!.replace(
      "{ name: total, logicalType: number }",
      '{ name: total, logicalType: number, physicalName: "Total Amount" }',
    );
    const sql = views({ "orders.yaml": contract });
    expect(sql).toContain("SELECT [id], [Total Amount] AS [total]\nFROM OPENROWSET(");
    expect(sql).toContain(") WITH (\n  [id] BIGINT,\n  [Total Amount] FLOAT\n) AS [rows]");
  });

  it("uses the type written for a column when Synapse provides the defaults", () => {
    const standard = base["standard.yaml"]!.replace(
      "packs: [landing@1, synapse@1, tables@1]",
      "packs: [synapse@1, landing@1, tables@1]",
    );
    const contract = base["orders.yaml"]!.replace(
      "{ name: total, logicalType: number }",
      '{ name: total, logicalType: number, physicalType: "DECIMAL(18,2)" }',
    );
    expect(views({ "standard.yaml": standard, "orders.yaml": contract })).toContain(
      "  [total] DECIMAL(18,2)",
    );
  });
});

describe("transform SQL", () => {
  const changes = (code: string, extra = "") => ({
    "daily.yaml": transform(code, extra),
    "orders.yaml": withDaily(base["orders.yaml"]!),
  });
  const daily = '"synapse-sql" for table "daily": ';

  it("drops a trailing semicolon, which a view's subquery cannot hold", () => {
    expect(views(changes("SELECT id FROM {{ tables.orders }};"))).toContain(
      "FROM (\nSELECT id FROM [bronze].[orders]\n) AS [source];",
    );
  });

  it("refuses SQL that starts with WITH, which a view's subquery cannot hold", () => {
    expect(
      problems(changes("WITH x AS (SELECT id FROM {{ tables.orders }}) SELECT id FROM x")),
    ).toEqual([
      {
        code: "METHOD_CHECK",
        message: `${daily}a view's SQL cannot start with WITH; write the common table expression as a subquery.`,
      },
    ]);
  });

  it("refuses a table the transform does not list in inputs", () => {
    expect(problems(changes("SELECT id FROM {{ tables.ordrs }}"))).toEqual([
      {
        code: "METHOD_CHECK",
        message: `${daily}the SQL names {{ tables.ordrs }}, which is not in inputs.`,
      },
    ]);
  });
});

describe("pairs of methods", () => {
  it("refuses to keep another engine's transform as a Synapse view", () => {
    expect(
      problems({
        "daily.yaml": transform(
          "SELECT id FROM {{ tables.orders }}",
          "transform: { uses: spark }\n",
        ),
        "orders.yaml": withDaily(base["orders.yaml"]!),
      }),
    ).toEqual([
      {
        code: "METHOD_CHECK",
        message:
          '"synapse-view" for table "daily": it keeps synapse-sql transforms only, not "spark".',
      },
    ]);
  });

  it("refuses T-SQL kept by another engine's store", () => {
    expect(
      problems({
        "daily.yaml": transform(
          "SELECT id FROM {{ tables.orders }}",
          "store: { uses: keep-query }\n",
        ),
        "orders.yaml": withDaily(base["orders.yaml"]!),
      }),
    ).toEqual([
      {
        code: "PACK_CHECK",
        message:
          'transform "daily" is T-SQL (synapse-sql), so only synapse-view can keep it, not "keep-query".',
      },
    ]);
  });
});
