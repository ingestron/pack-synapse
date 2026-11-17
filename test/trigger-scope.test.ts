// The ADF pack's checks of a flow's triggers as a whole, on the workspace route: a dependency on a
// tumbling window this pack does not write, and a flow that copies from more than one database.
import { describe, expect, it } from "vitest";
import type { ResolvedModel } from "@ingestron/definitions";
import { synapse } from "../src/index.js";
import { base, errors, flowB, modelOf, operations, resolve, trigger } from "./trigger-project.js";

const window = trigger("tumbling-window", "      backfill: true\n", "hourly");

/** Flow `b`'s model with its tumbling window depending on `target`. */
function dependingOn(target: string): ResolvedModel {
  const model = modelOf({
    "standard.yaml": operations(),
    "flow-b.yaml": flowB(`  triggers:\n${window}`),
  });
  const depend = (table: ResolvedModel["tables"][number]) => ({
    ...table,
    ingest: table.ingest && {
      ...table.ingest,
      triggers: table.ingest.triggers?.map((item) => ({
        ...item,
        depends_on: [{ trigger: target, offset: "-1h" }],
      })),
    },
  });
  return { ...model, tables: model.tables.map(depend) };
}

describe("a flow's triggers on the workspace route", () => {
  it("refuse a dependency on a tumbling window the workspace does not write", () => {
    expect(synapse.check!(dependingOn("factory_flow/hourly"))).toContain(
      '"b/hourly" depends on "factory_flow/hourly", which this pack does not generate; a tumbling window can depend only on another of this factory\'s tumbling windows',
    );
    expect(synapse.check!(dependingOn("b/hourly"))).toEqual([]);
  });

  it("refuse a flow that copies from more than one database", () => {
    const flow = flowB(`  triggers:\n${window}`).replace(
      "tables:\n",
      "tables:\n  orders: {object: sales.dbo.Orders}\n",
    );
    const orders =
      "  - object: sales.dbo.Orders\n    captured: {at: '2026-11-14T00:00:00Z', from: catalog, file: catalogue.csv}\n    columns:\n      - {name: OrderID, sourceType: int, logicalType: integer, required: false}\n";
    const metadata = `${base["metadata.yaml"]!}${orders}`;
    const changes = {
      "standard.yaml": operations(),
      "flow-b.yaml": flow,
      "metadata.yaml": metadata,
    };
    expect(errors(resolve(changes))).toContain(
      'The flow "b" copies tables from more than one database and writes its own triggers; split it into one flow per database.',
    );
  });
});
