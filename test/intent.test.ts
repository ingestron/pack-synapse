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

  it("checks rows only in a layer whose does lists check, except patterns and arrays", () => {
    for (const kind of ["notNull", "in", "notIn", "length", "range", "multipleOf"])
      expect(intentUseOf(synapse, "quality.rules", kind), kind).toMatchObject({
        use: "used",
        onlyWhere: "check",
      });
    expect(intentUseOf(synapse, "quality.rules", "pattern")).toEqual({
      use: "not-applicable",
      reason: "serverless T-SQL has no regular expressions.",
    });
    expect(intentUseOf(synapse, "quality.rules", "items")).toEqual({
      use: "not-applicable",
      reason: "views type no arrays.",
    });
  });

  it("applies warn and drop where it checks, but not fail, which checks.sql raises", () => {
    for (const action of ["warn", "drop"])
      expect(intentUseOf(synapse, "quality.actions", action), action).toMatchObject({
        use: "used",
        onlyWhere: "check",
      });
    expect(intentUseOf(synapse, "quality.actions", "fail")).toEqual({
      use: "not-applicable",
      reason:
        "a view can't stop a load; checks.sql checks this rule and raises an error when it runs.",
    });
    expect(intentUseOf(synapse, "quality.table-checks", "true")).toMatchObject({
      use: "used",
      onlyWhere: "check",
    });
  });

  it("keeps no quarantine and no results, and says checks.sql returns counts instead", () => {
    expect(intentUseOf(synapse, "quality.quarantine", "true")).toEqual({
      use: "not-applicable",
      reason:
        "a view keeps no rows to quarantine; checks.sql returns how many rows each drop check leaves out instead.",
    });
    expect(intentUseOf(synapse, "quality.results", "true")).toEqual({
      use: "not-applicable",
      reason:
        "a view keeps no results; checks.sql returns each check's counts instead when it runs.",
    });
  });

  it("cleanses and deduplicates in any layer the model gives them", () => {
    for (const path of [
      "cleanse.trim",
      "cleanse.empty",
      "cleanse.map",
      "cleanse.case",
      "cleanse.default",
      "cleanse.timezone",
      "deduplicate",
    ]) {
      const use = intentUseOf(synapse, path, "true");
      expect(use, path).toMatchObject({
        use: "used",
        status: { level: "ga", checked: "2026-11-10" },
      });
      expect(use, path).not.toHaveProperty("onlyWhere");
    }
  });
});
