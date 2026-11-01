// What the pack does with contracts, and what it asks of the platform team.
import type { ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../src/index.js";
import { base, generate } from "./project.js";

describe("contract", () => {
  it("types the view's columns from the contract and checks no rows", () => {
    expect(synapse.contract?.["schema.*.properties"]).toMatchObject({ use: "used" });
    expect(synapse.contract?.["schema.*.properties.*.logicalType"]).toMatchObject({ use: "used" });
    expect(synapse.contract?.["schema.*.quality"]).toEqual({
      use: "not-yet",
      reason: "Synapse views check no rows.",
    });
    expect(synapse.contract?.["schema.*.properties.*.quality"]).toEqual({
      use: "not-yet",
      reason: "Synapse views check no rows.",
    });
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
