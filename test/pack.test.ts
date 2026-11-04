// The pack as the core sees it: its id, version and default choices.
import type { ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../src/index.js";
import { base, problems } from "./project.js";

describe("synapse", () => {
  it("is the synapse pack, version 2, which builds every environment together", () => {
    expect(synapse.id).toBe("synapse");
    expect(synapse.version).toBe(2);
    expect(synapse.buildEnvironments).toBeTypeOf("function");
    expect(synapse.rules.serve?.default).toBeUndefined();
    expect(synapse.rules.store?.default).toBe("synapse-view");
    expect(synapse.rules.transform?.default).toBe("synapse-sql");
  });

  it("builds nothing for a project without its methods", () => {
    const model = { tables: [] } as unknown as ResolvedModel;
    expect(synapse.build(model)).toEqual({});
  });

  it("offers synapse@2 to a standard that names synapse@1", () => {
    const standard = base["standard.yaml"]!.replace("synapse@2", "synapse@1");
    expect(problems({ "standard.yaml": standard })).toContainEqual({
      code: "PACK_VERSION",
      message:
        'This standard is for "synapse@1", but the pack is synapse@2, which builds every environment into one output folder.',
    });
  });
});
