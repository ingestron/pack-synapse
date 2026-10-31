// The pack as the core sees it: its id, version and default choices.
import type { ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../src/index.js";

describe("synapse", () => {
  it("is the synapse pack, version 1, with no serve default", () => {
    expect(synapse.id).toBe("synapse");
    expect(synapse.version).toBe(1);
    expect(synapse.rules.serve?.default).toBeUndefined();
    expect(synapse.rules.store?.default).toBe("synapse-view");
    expect(synapse.rules.transform?.default).toBe("synapse-sql");
  });

  it("builds nothing for a project without its methods", () => {
    const model = { tables: [] } as unknown as ResolvedModel;
    expect(synapse.build(model)).toEqual({});
  });
});
