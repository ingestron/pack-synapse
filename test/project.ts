// A small project: files landed for orders, viewed in Synapse.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions, type ResolvedModel } from "@ingestron/definitions";
import { expect } from "vitest";
import { synapse } from "../src/index.js";
import { landing, tables } from "./stub-packs.js";

export const base: Record<string, string> = {
  "project.yaml": "id: erp\nenvironments: { dev: {} }\nimports: ['*.yaml']\n",
  "standard.yaml": [
    "apiVersion: ingestron.io/v1",
    "kind: Standard",
    "id: acme",
    "packs: [landing@1, synapse@1, tables@1]",
    "store: { default: synapse-view }",
    "",
  ].join("\n"),
  "platform.yaml": [
    "apiVersion: ingestron.io/v1",
    "kind: Platform",
    "id: azure",
    "settings:",
    "  synapse-view:",
    "    data_source: landing",
    "    data_source_location: abfss://landing@acct.dfs.core.windows.net",
    "  synapse-serve:",
    "    data_source: landing",
    "    data_source_location: abfss://landing@acct.dfs.core.windows.net",
    "",
  ].join("\n"),
  "erp.yaml":
    "apiVersion: ingestron.io/v1\nkind: Connection\nid: erp\nconnector: files\nconnectivity: public\nsettings: { path: /erp }\n",
  "flow.yaml":
    "apiVersion: ingestron.io/v1\nkind: Flow\nid: erp\nsource: erp\ntables:\n  orders: { object: orders, contract: orders }\n",
  "orders.yaml": [
    "apiVersion: v3.1.0",
    "kind: DataContract",
    "id: orders",
    "version: 1.0.0",
    "status: active",
    "schema:",
    "  - name: orders",
    "    logicalType: object",
    "    properties:",
    "      - { name: id, logicalType: integer, primaryKey: true }",
    "      - { name: total, logicalType: number }",
    "",
  ].join("\n"),
};

/** Resolves the project with `changes`, returning the diagnostics, model and Synapse files. */
export function generate(changes: Record<string, string> = {}) {
  const result = resolveDefinitions(memoryFiles({ ...base, ...changes }), {
    packs: [landing, synapse, tables],
    environment: "dev",
  });
  const model = result.model as ResolvedModel | undefined;
  return { result, model, files: model ? synapse.build(model) : {} };
}

/** The generated views.sql, after checking the project resolved. */
export function views(changes: Record<string, string> = {}): string {
  const { result, files } = generate(changes);
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return files["views.sql"] ?? "";
}

/** Each diagnostic's code and message. */
export const problems = (changes: Record<string, string> = {}) =>
  generate(changes).result.diagnostics.map(({ code, message }) => ({ code, message }));
