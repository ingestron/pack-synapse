// A synthetic Synapse project for the workspace route's triggers: the default project, and flow
// `b`, which writes the triggers it is given.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions, type ResolvedModel } from "@ingestron/definitions";
import { expect } from "vitest";
import { synapse } from "../src/index.js";

const standard =
  "apiVersion: ingestron.io/v1\nkind: Standard\nid: erp\npacks: [synapse@2]\nstore: {default: synapse-view}\n";
const catalogue = (object: string, column: string) =>
  `  - object: northwind.dbo.${object}\n    captured: {at: '2026-11-14T00:00:00Z', from: catalog, file: catalogue.csv}\n    columns:\n      - {name: ${column}, sourceType: int, logicalType: integer, required: false}\n`;

/** The default project: one flow, no triggers, and the standard's `operations` lines. */
export const base: Record<string, string> = {
  "project.yaml": "id: erp\nenvironments: {dev: {}}\nimports: ['*.yaml']\n",
  "standard.yaml": standard,
  "platform.yaml":
    "apiVersion: ingestron.io/v1\nkind: Platform\nid: erp\nsettings:\n  synapse-copy:\n    landing: abfss://landing@acct.dfs.core.windows.net/erp\n    key_vault: https://vault.vault.azure.net\n    integration_runtime: AutoResolveIntegrationRuntime\n    start: '2026-11-14T00:00:00Z'\n  synapse-view:\n    data_source: landing\n    data_source_location: abfss://landing@acct.dfs.core.windows.net\n",
  "connection.yaml":
    "apiVersion: ingestron.io/v1\nkind: Connection\nid: sql\nconnector: azure-sql-database\nconnectivity: public\nsettings: {server: example.database.windows.net, user: reader, password: '${secret:source-password}'}\n",
  "flow.yaml":
    "apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: sql\ningest: {uses: synapse-copy}\ntables:\n  order_details: {object: northwind.dbo.Order Details}\n",
  "metadata.yaml": `apiVersion: ingestron.io/v1\nkind: SourceMetadata\nid: sql\nconnection: sql\ntables:\n${catalogue("Order Details", "OrderID")}${catalogue("Customers", "CustomerID")}`,
};

/** A standard that lets flows write triggers, with these `operations` lines after it. */
export const operations = (lines = "") =>
  `${standard}operations:\n  schedule: { per: flow }\n${lines}`;

/** Flow `b`, whose `ingest` writes these lines, and whose customers table has `table` after it. */
export const flowB = (ingest: string, table = "") =>
  `apiVersion: ingestron.io/v1\nkind: Flow\nid: b\nsource: sql\ningest:\n  uses: synapse-copy\n${ingest}tables:\n  customers: {object: northwind.dbo.Customers${table}}\n`;

/** The lines of one trigger of a flow's `ingest.triggers`. */
export const trigger = (type: string, extra = "", name = "t") =>
  `    - name: ${name}\n      type: ${type}\n      every: { frequency: Hour, interval: 1 }\n      start: "2026-12-01T00:00:00Z"\n${extra}`;

export const resolve = (changes: Record<string, string> = {}) =>
  resolveDefinitions(memoryFiles({ ...base, ...changes }), {
    packs: [synapse],
    environment: "dev",
    environmentsTogether: true,
  });

export const errors = (result: { diagnostics: { severity: string; message: string }[] }) =>
  result.diagnostics.filter((item) => item.severity === "error").map((item) => item.message);

/** The model of a project that resolved without an error. */
export function modelOf(changes: Record<string, string> = {}): ResolvedModel {
  const result = resolve(changes);
  expect(errors(result)).toEqual([]);
  return result.model!;
}

/** The generated file of `model` whose path holds `part`, parsed (loosely typed, for assertions). */
export function file(model: ResolvedModel, part: string) {
  const output = synapse.build(model);
  return JSON.parse(output[Object.keys(output).find((path) => path.includes(part))!]!);
}
