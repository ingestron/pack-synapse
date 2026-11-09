// Intent (spec/behaviour.md, section "Intent"): what the pack declares it applies.
import { intentCoverageGaps, intentUseOf } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../src/index.js";
import { base, generate } from "./project.js";

/** The flow with `extra` written on the orders table. */
const withOrders = (extra: string) => ({
  "flow.yaml": base["flow.yaml"]!.replace("contract: orders }", `contract: orders, ${extra} }`),
});

/** The messages of the NOT_APPLIED diagnostics for a project. */
const notApplied = (changes: Record<string, string>) =>
  generate(changes)
    .result.diagnostics.filter((item) => item.code === "NOT_APPLIED")
    .map((item) => item.message);

describe("the pack's intent coverage", () => {
  it("covers every intent path and value", () => {
    expect(intentCoverageGaps(synapse)).toEqual([]);
  });

  it("has an empty Platform section", () => {
    expect(synapse.platformSection).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {},
    });
  });

  it("says a view keeps nothing, so history is not applied", () => {
    expect(notApplied(withOrders("history: full"))).toEqual([
      "history: full isn't applied on synapse: Views keep nothing; they read files or a query each time.",
    ]);
  });

  it("says a view keeps nothing for everything a store or the load would keep", () => {
    for (const [path, value] of [
      ["history", "latest"],
      ["sequence", undefined],
      ["storage.clustering", "auto"],
      ["storage.features", "change_feed"],
      ["retention.time_travel", undefined],
      ["retention.log", undefined],
      ["rescued", "true"],
      ["quality.results", "true"],
      ["load.deletes.mode", "soft"],
      ["load.deletes.when", undefined],
    ] as const)
      expect(intentUseOf(synapse, path, value), path).toEqual({
        use: "not-applicable",
        reason: "Views keep nothing; they read files or a query each time.",
      });
  });

  it("says a view adds no columns of its own for the audit values it would write", () => {
    expect(notApplied(withOrders("audit: [loaded_at]"))).toEqual([
      "audit: loaded_at isn't applied on synapse: A view adds no columns of its own.",
    ]);
    for (const value of ["row_hash", "source_file", "source_modified_at"])
      expect(notApplied(withOrders(`audit: [${value}]`)), value).toEqual([
        `audit: ${value} isn't applied on synapse: A view adds no columns of its own.`,
      ]);
  });

  it("leaves the audit values the ingest step adds, and what it lands, to that step", () => {
    for (const [path, value] of [
      ["audit", "run_id"],
      ["audit", "window_start"],
      ["audit", "window_end"],
      ["audit", "source_object"],
      ["audit", "source_connection"],
      ["load.mode", "files"],
      ["load.cursor", undefined],
      ["retention.landed_files", undefined],
    ] as const)
      expect(intentUseOf(synapse, path, value), `${path}=${value}`).toEqual({
        use: "elsewhere",
        reason: "Another pack lands the files.",
      });
    expect(notApplied(withOrders("audit: [run_id]"))).toEqual([]);
  });

  it("applies nothing from operations, with the reason Synapse runs no jobs", () => {
    for (const [path, value] of [
      ["operations.retries", undefined],
      ["operations.alerts", "slow"],
      ["operations.trigger", "schedule"],
      ["operations.schedule", "flow"],
    ] as const)
      expect(intentUseOf(synapse, path, value), path).toEqual({
        use: "not-applicable",
        reason: "Synapse serverless runs no jobs.",
      });
  });
});
