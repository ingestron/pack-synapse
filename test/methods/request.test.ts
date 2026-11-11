// What the pack does with contracts, and what it asks of the platform team.
import type { ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../../src/index.js";
import { accessFiles } from "../access-project.js";
import { base, generate } from "../project.js";

describe("contract", () => {
  it("types the view's columns from the contract and makes checks of its rules", () => {
    expect(synapse.contract?.["schema.*.properties"]).toMatchObject({ use: "used" });
    expect(synapse.contract?.["schema.*.properties.*.logicalType"]).toMatchObject({ use: "used" });
    for (const path of [
      "schema.*.quality",
      "schema.*.properties.*.quality",
      "schema.*.properties.*.logicalTypeOptions",
    ])
      expect(synapse.contract?.[path], path).toMatchObject({ use: "used", whole: true });
    expect(synapse.contract?.["schema.*.properties.*.unique"]).toMatchObject({ use: "used" });
    expect(synapse.contract?.["schema.*.properties.*.primaryKey"]).toMatchObject({ use: "used" });
  });
});

describe("request", () => {
  const sections = () => synapse.request!(generate().model as ResolvedModel);

  it("asks for the database, the data source and the access the views need", () => {
    expect(sections()).toEqual([
      {
        title: "Synapse serverless database",
        lines: ["Create the serverless SQL database `erp_dev`; the views live in it."],
      },
      {
        title: "External data source",
        lines: [
          "In `erp_dev`, create a master key if the database has none (`CREATE MASTER KEY ENCRYPTION BY PASSWORD = '<a strong password>'`), the database scoped credential `landing_identity` with `IDENTITY = 'Managed Identity'`, and the external data source `landing` at `abfss://landing@acct.dfs.core.windows.net` using it.",
          "Give the Synapse workspace's managed identity Storage Blob Data Reader on the storage behind `abfss://landing@acct.dfs.core.windows.net`; if the storage account has a firewall, allow the workspace with a resource instance rule.",
        ],
      },
      {
        title: "Report users",
        lines: [
          "In `erp_dev`, give each report user SELECT on the schema `bronze`, REFERENCES on the database scoped credential `landing_identity`, and ADMINISTER DATABASE BULK OPERATIONS, which views over files need.",
        ],
      },
    ]);
  });

  it("asks for nothing when no table uses a Synapse method", () => {
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      "source: erp\nstore: { uses: keep }\n",
    );
    expect(synapse.request!(generate({ "flow.yaml": flow }).model as ResolvedModel)).toEqual([]);
  });
});

/** A customers contract with no roles, and the flow that views it beside orders. */
const customersContract = [
  "apiVersion: v3.1.0",
  "kind: DataContract",
  "id: customers",
  "version: 1.0.0",
  "status: active",
  "schema:",
  "  - name: customers",
  "    logicalType: object",
  "    properties:",
  "      - { name: id, logicalType: integer, primaryKey: true }",
  "",
].join("\n");
const withCustomers = `${base["flow.yaml"]!.trimEnd()}\n  customers: { object: customers, contract: customers }\n`;

describe("request with grants", () => {
  const sections = (files: Record<string, string>) =>
    synapse.request!(generate(files).model as ResolvedModel);
  const user = (principal: string, create: string) =>
    `${principal}: in \`erp_dev\`, create it as a database user from the external provider (${create}), then give it REFERENCES on the database scoped credential \`landing_identity\` and ADMINISTER DATABASE BULK OPERATIONS, which views over files need. views.sql grants it SELECT on its views. These rights also let it read every file under \`abfss://landing@acct.dfs.core.windows.net\` directly, not only through the views.`;

  it("names each principal the views are granted to, in place of the report users line", () => {
    expect(sections(accessFiles()).find((section) => section.title === "Report users")).toEqual({
      title: "Report users",
      lines: [
        user(
          "`marketing-analysts-dev`",
          "`CREATE USER [marketing-analysts-dev] FROM EXTERNAL PROVIDER`",
        ),
        user("`etl-writers`", "`CREATE USER [etl-writers] FROM EXTERNAL PROVIDER`"),
        user("`ops]admins`", "`CREATE USER [ops]]admins] FROM EXTERNAL PROVIDER`"),
      ],
    });
  });

  it("writes a principal holding a backtick as a code span of two backticks", () => {
    const files = accessFiles({
      roles: ["  - { role: auditors }"],
      principals: "principals: { auditors: 'team`s analysts' }",
    });
    expect(sections(files).at(-1)!.lines).toEqual([
      user("`` team`s analysts ``", "`` CREATE USER [team`s analysts] FROM EXTERNAL PROVIDER ``"),
    ]);
  });

  it("lists the views exact grants reach, saying what they remove and keep", () => {
    expect(sections(accessFiles({ grants: "exact" })).at(-1)).toEqual({
      title: "Exact grants",
      intro:
        "Exact grants are on. Each time views.sql runs, it removes every permission granted directly on these views to anyone their contracts and layers don't name, and every permission other than SELECT to those they do. It keeps ownership, permissions on schemas and databases, denials, permissions given WITH GRANT OPTION, and those of the database user that runs views.sql, but not those of a group that user belongs to. Before turning this on, move any access given by hand into the contracts.",
      lines: ["`[bronze].[orders]` in `erp_dev`"],
    });
  });

  it("keeps the report users line for the views granted to no principal, naming them", () => {
    const files = {
      ...accessFiles({ roles: ["  - { role: marketing-analysts, access: read }"] }),
      "customers.yaml": customersContract,
      "flow.yaml": withCustomers,
    };
    expect(sections(files).find((section) => section.title === "Report users")!.lines).toEqual([
      "In `erp_dev`, give each report user SELECT on the view `[bronze].[customers]`, REFERENCES on the database scoped credential `landing_identity`, and ADMINISTER DATABASE BULK OPERATIONS, which views over files need.",
      user(
        "`marketing-analysts-dev`",
        "`CREATE USER [marketing-analysts-dev] FROM EXTERNAL PROVIDER`",
      ),
    ]);
  });

  it("names no view with exact grants and no role for report users, and says who can read it", () => {
    const files = {
      ...accessFiles({
        grants: "exact",
        roles: ["  - { role: marketing-analysts, access: read }"],
      }),
      "customers.yaml": customersContract,
      "flow.yaml": withCustomers,
    };
    const all = sections(files);
    expect(all.find((section) => section.title === "Report users")!.lines).toEqual([
      user(
        "`marketing-analysts-dev`",
        "`CREATE USER [marketing-analysts-dev] FROM EXTERNAL PROVIDER`",
      ),
    ]);
    expect(all.at(-1)!.lines).toEqual([
      "`[bronze].[orders]` in `erp_dev`",
      "`[bronze].[customers]` in `erp_dev`: no contract or layer names a role for it, so no one can read it except its owners and those given access on its schema or database.",
    ]);
  });

  it("asks for what it asked before when the switch is off", () => {
    const off = sections(accessFiles({ manage: false, grants: "exact" }));
    expect(off.map((section) => section.title)).toEqual([
      "Synapse serverless database",
      "External data source",
      "Report users",
    ]);
    expect(off[2]!.lines[0]).toMatch(/^In `erp_dev`, give each report user SELECT on the schema/);
  });
});
