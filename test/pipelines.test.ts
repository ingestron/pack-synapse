// Resolve a synthetic Azure SQL source through the Synapse pack's public interface.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions, type ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../src/index.js";

const files = {
  "project.yaml": "id: erp\nenvironments: {dev: {}, review: {}}\nimports: ['*.yaml']\n",
  "standard.yaml":
    "apiVersion: ingestron.io/v1\nkind: Standard\nid: erp\npacks: [synapse@2]\nstore: {default: synapse-view}\n",
  "platform.yaml":
    "apiVersion: ingestron.io/v1\nkind: Platform\nid: erp\nsettings:\n  synapse-copy:\n    landing: abfss://landing@acct.dfs.core.windows.net/erp\n    key_vault: https://vault.vault.azure.net\n    integration_runtime: AutoResolveIntegrationRuntime\n    start: '2026-11-14T00:00:00Z'\n  synapse-view:\n    data_source: landing\n    data_source_location: abfss://landing@acct.dfs.core.windows.net\n",
  "connection.yaml":
    "apiVersion: ingestron.io/v1\nkind: Connection\nid: sql\nconnector: azure-sql-database\nconnectivity: public\nsettings: {server: example.database.windows.net, user: reader, password: '${secret:source-password}'}\n",
  "flow.yaml":
    "apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: sql\ningest: {uses: synapse-copy}\ntables:\n  order_details: {object: northwind.dbo.Order Details}\n",
  "metadata.yaml":
    "apiVersion: ingestron.io/v1\nkind: SourceMetadata\nid: sql\nconnection: sql\ntables:\n  - object: northwind.dbo.Order Details\n    captured: {at: '2026-11-14T00:00:00Z', from: catalog, file: catalogue.csv}\n    columns:\n      - {name: OrderID, sourceType: int, logicalType: integer, required: false}\n      - {name: UnitPrice, sourceType: money, logicalType: number, required: false}\n",
};

function resolve(environment = "dev", changes: Partial<typeof files> = {}) {
  return resolveDefinitions(memoryFiles({ ...files, ...changes }), {
    packs: [synapse],
    environment,
    environmentsTogether: true,
  });
}

function model(environment = "dev"): ResolvedModel {
  const result = resolve(environment);
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return result.model!;
}

describe("Synapse workspace pipelines", () => {
  it("emits native workspace copies and a stopped schedule without factory or runtime definitions", () => {
    const output = synapse.build(model());
    const paths = Object.keys(output);
    expect(paths.some((path) => path.includes("/pipeline/"))).toBe(true);
    expect(paths.some((path) => /factory|integrationRuntime|arm-template/.test(path))).toBe(false);
    const pipeline = JSON.parse(output[paths.find((path) => path.includes("/pipeline/"))!]!);
    expect(pipeline.properties.parameters).toBeUndefined();
    expect(pipeline.properties.activities[0].typeProperties.source.sqlReaderQuery).toBe(
      "SELECT\n  [OrderID],\n  [UnitPrice]\nFROM [dbo].[Order Details]",
    );
    const trigger = JSON.parse(output[paths.find((path) => path.includes("/trigger/"))!]!);
    expect(trigger.properties).toMatchObject({
      type: "ScheduleTrigger",
      runtimeState: "Stopped",
      pipelines: [{ parameters: {} }],
    });
    expect(JSON.stringify(trigger)).not.toContain("windowStart");
    expect(Object.values(output).join("\n")).toContain("AzureKeyVaultSecret");
    expect(output["views.sql"]).toContain("[UnitPrice] DECIMAL(19,4)");
    const query = Object.entries(output).find(([path]) => path.startsWith("queries/"));
    expect(query?.[1]).toContain(
      "SELECT\n  [OrderID],\n  [UnitPrice]\nFROM [dbo].[Order Details];\n",
    );
  });

  it("separates workspace artifacts by environment and preserves each environment's render", () => {
    const models = { dev: model(), review: model("review") };
    const folded = synapse.buildEnvironments!(models);
    expect(folded.problems.filter((item) => item.severity === "error")).toEqual([]);
    for (const [name, resolved] of Object.entries(models)) {
      const native = Object.fromEntries(
        Object.entries(folded.files).filter(
          ([path]) => path.startsWith(`workspace/${name}/`) || path.startsWith(`queries/${name}/`),
        ),
      );
      const alone = Object.fromEntries(
        Object.entries(synapse.build(resolved)).filter(
          ([path]) => path.startsWith("workspace/") || path.startsWith("queries/"),
        ),
      );
      expect(native).toEqual(alone);
    }
  });

  it("rejects incremental modes and private sources rather than approximating their behaviour", () => {
    for (const flow of [
      files["flow.yaml"].replace(
        "uses: synapse-copy",
        "uses: synapse-copy, with: {mode: incremental}",
      ),
    ])
      expect(
        resolve("dev", { "flow.yaml": flow }).diagnostics.some((item) => item.severity === "error"),
      ).toBe(true);
    expect(
      resolve("dev", {
        "connection.yaml": files["connection.yaml"].replace(
          "connectivity: public",
          "connectivity: private",
        ),
      }).diagnostics.some((item) => item.severity === "error"),
    ).toBe(true);
  });

  it("rejects authentication modes that need unsupported workspace credential artifacts", () => {
    const connection = files["connection.yaml"].replace(
      "settings: {",
      "settings: {authentication: managed-identity, ",
    );
    expect(
      resolve("dev", { "connection.yaml": connection }).diagnostics.some(
        (item) => item.severity === "error",
      ),
    ).toBe(true);
  });

  it("describes workspace identity and runtime prerequisites without an ADF deployment instruction", () => {
    const request = synapse.request!(model());
    const text = request.map((section) => section.lines.join("\n")).join("\n");
    expect(text).toContain("existing workspace Azure integration runtime");
    expect(text).toContain("Synapse schedule trigger");
    expect(text).not.toContain("az deployment group");
  });
});
