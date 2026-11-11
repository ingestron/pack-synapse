// The shared quality fixture (test/fixtures/quality, copied from the Databricks pack and made
// Synapse's): bronze keeps the files raw; silver cleanses, deduplicates and checks.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions, type ResolvedModel } from "@ingestron/definitions";
import { synapse } from "../src/index.js";
import { landing, tables } from "./stub-packs.js";

const root = join(import.meta.dirname, "fixtures/quality");

function walk(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The fixture's files by path, with `changes` over them. */
export function crmFiles(changes: Record<string, string> = {}): Record<string, string> {
  const files = Object.fromEntries(
    walk(root).map((path) => [
      relative(root, path).split("\\").join("/"),
      readFileSync(path, "utf8"),
    ]),
  );
  return { ...files, ...changes };
}

/** The fixture resolved for one environment, with its diagnostics and Synapse files. */
export function crm(changes: Record<string, string> = {}, environment = "dev") {
  const result = resolveDefinitions(memoryFiles(crmFiles(changes)), {
    packs: [landing, synapse, tables],
    environment,
  });
  const model = result.model as ResolvedModel | undefined;
  return { result, model, files: model ? synapse.build(model) : {} };
}

/** Each diagnostic of a code, as its message. */
export const messages = (code: string, changes: Record<string, string> = {}) =>
  crm(changes)
    .result.diagnostics.filter((item) => item.code === code)
    .map((item) => item.message);

/** One view's statement in views.sql, from CREATE OR ALTER VIEW to its GO. */
export function viewOf(views: string, name: string): string {
  const start = views.indexOf(`CREATE OR ALTER VIEW ${name} AS`);
  if (start < 0) return "";
  return views.slice(start, views.indexOf("\nGO", start) + 3);
}
