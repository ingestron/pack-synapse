// Requests the platform team can act on, views across databases, data source
// locations written either way, CSV options from the landing step, and types.
import type { ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../src/index.js";
import { base, generate, problems, views } from "./project.js";

const platform = (location: string, name = "landing") =>
  base["platform.yaml"]!.replaceAll("data_source: landing", `data_source: "${name}"`).replaceAll(
    "abfss://landing@acct.dfs.core.windows.net",
    location,
  );
const flowWith = (settings: string) =>
  base["flow.yaml"]!.replace("source: erp\n", `source: erp\ningest: { with: ${settings} }\n`);
const contract = (properties: string) =>
  base["orders.yaml"]!.replace(
    "      - { name: total, logicalType: number }\n",
    `      - { name: total, logicalType: number }\n${properties}`,
  );

describe("request", () => {
  it("names the master key, the credential and the storage firewall", () => {
    const lines = synapse.request!(generate().model as ResolvedModel).flatMap(
      (section) => section.lines,
    );
    expect(lines).toContain(
      "In `erp_dev`, create a master key if the database has none (`CREATE MASTER KEY ENCRYPTION BY PASSWORD = '<a strong password>'`), the database scoped credential `landing_identity` with `IDENTITY = 'Managed Identity'`, and the external data source `landing` at `abfss://landing@acct.dfs.core.windows.net` using it.",
    );
    expect(lines).toContain(
      "Give the Synapse workspace's managed identity Storage Blob Data Reader on the storage behind `abfss://landing@acct.dfs.core.windows.net`; if the storage account has a firewall, allow the workspace with a resource instance rule.",
    );
    expect(lines.join("\n")).toContain(
      "REFERENCES on the database scoped credential `landing_identity`",
    );
  });
});

describe("several databases", () => {
  it("switches database before each one's views, and names other databases' views in full", () => {
    const standard = base["standard.yaml"]!.replace(
      "store: { default: synapse-view }",
      'store: { default: synapse-view }\nnaming: { catalog: "erp_{{ layer }}" }',
    );
    const transform =
      "apiVersion: ingestron.io/v1\nkind: Transform\nid: totals\ninputs: [orders]\ncode: SELECT id, total FROM {{ tables.orders }}\ncontract: orders\n";
    const sql = views({ "standard.yaml": standard, "totals.yaml": transform });
    expect(sql).toContain("USE [erp_bronze];\nGO");
    expect(sql).toContain("USE [erp_silver];\nGO");
    expect(sql.indexOf("USE [erp_bronze]")).toBeLessThan(
      sql.indexOf("CREATE OR ALTER VIEW [bronze]"),
    );
    expect(sql).toContain("FROM [erp_bronze].[bronze].[orders]");
  });
});

describe("data source locations", () => {
  it("reads files under an https data source location, whatever the account's case", () => {
    const sql = views({ "platform.yaml": platform("https://ACCT.dfs.core.windows.net/landing") });
    expect(sql).toContain("BULK 'erp/orders/orders.parquet'");
  });

  it("refuses a location that names no storage account", () => {
    expect(problems({ "platform.yaml": platform("abfss://") }).map(({ code }) => code)).toContain(
      "BAD_SETTING",
    );
  });

  it("refuses ** before the end of a path", () => {
    const flow = flowWith(
      '{ location: "abfss://landing@acct.dfs.core.windows.net/erp/**/x.parquet" }',
    );
    expect(
      problems({ "flow.yaml": flow })
        .map(({ message }) => message)
        .join("\n"),
    ).toContain("a path can use ** only at its end");
  });

  it("refuses one data source name at two locations", () => {
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      "source: erp\nstore: { with: { data_source_location: abfss://landing@acct.dfs.core.windows.net/erp } }\n",
    );
    const again =
      "apiVersion: ingestron.io/v1\nkind: Flow\nid: again\nsource: erp\ntables:\n  again: { object: again, contract: orders }\n";
    expect(
      problems({ "flow.yaml": flow, "again.yaml": again })
        .map(({ message }) => message)
        .join("\n"),
    ).toContain("the data source `landing` is at two locations");
  });

  it("quotes a data source name with a quote in it", () => {
    expect(
      views({ "platform.yaml": platform("abfss://landing@acct.dfs.core.windows.net", "land'ing") }),
    ).toContain("DATA_SOURCE = 'land''ing'");
  });
});

describe("CSV from the landing step", () => {
  it("reads CSV files with the landing step's header and delimiter", () => {
    const flow = flowWith(
      '{ format: csv, location: "abfss://landing@acct.dfs.core.windows.net/erp/orders/orders.csv", csv: { header: false, delimiter: ";" } }',
    );
    const sql = views({ "flow.yaml": flow });
    expect(sql).toContain("FIELDTERMINATOR = ';'");
    expect(sql).not.toContain("HEADER_ROW = TRUE");
  });
});

describe("types and references", () => {
  it("types time, object and array columns", () => {
    const sql = views({
      "orders.yaml": contract(
        "      - { name: at, logicalType: time }\n      - { name: meta, logicalType: object }\n      - { name: tags, logicalType: array }\n",
      ),
    });
    expect(sql).toContain("[at] TIME");
    expect(sql).toContain("[meta] VARCHAR(MAX)");
    expect(sql).toContain("[tags] VARCHAR(MAX)");
  });

  it("recognises {{- tables.x -}}", () => {
    const transform =
      "apiVersion: ingestron.io/v1\nkind: Transform\nid: totals\ninputs: [orders]\ncode: SELECT id, total FROM {{- tables.orders -}}\ncontract: orders\n";
    expect(views({ "totals.yaml": transform })).toContain("FROM [bronze].[orders]");
  });

  it("says required is not checked, since views check no rows", () => {
    expect(synapse.contract?.["schema.*.properties.*.required"]).toEqual({
      use: "not-yet",
      reason: "Synapse views check no rows.",
    });
  });

  it("refuses serving a table that is already a Synapse view", () => {
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      "source: erp\nserve: { uses: synapse-serve }\n",
    );
    expect(
      problems({ "flow.yaml": flow })
        .map(({ message }) => message)
        .join("\n"),
    ).toContain(
      "the table is already a Synapse view, so serving it again would make a second view; remove serve",
    );
  });
});
