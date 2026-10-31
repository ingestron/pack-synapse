// Every setting the editor offers explains itself with an example.
import { describe, expect, it } from "vitest";
import { synapse } from "../src/index.js";

type Schema = {
  type?: string;
  enum?: unknown[];
  examples?: unknown[];
  properties?: Record<string, Schema>;
};

/** Each free-text setting, as `<method>: <path>`, with no example or allowed values. */
function bare(method: string, schema: Schema, path = ""): string[] {
  const own =
    schema.type === "string" && !schema.enum && !schema.examples ? [`${method}: ${path}`] : [];
  const nested = Object.entries(schema.properties ?? {}).flatMap(([key, child]) =>
    bare(method, child, path ? `${path}.${key}` : key),
  );
  return [...own, ...nested];
}

describe("settings", () => {
  it("give an example of every free-text setting", () => {
    const missing = Object.entries(synapse.methods).flatMap(([id, method]) =>
      bare(id, method.settings as Schema),
    );
    expect(missing).toEqual([]);
  });
});
