// What Synapse does not apply, and why (spec/behaviour.md, "Intent"), on the shared fixture.
import { describe, expect, it } from "vitest";
import { crm, messages } from "./quality-project.js";

describe("what Synapse does not apply", () => {
  it("says the fail action, patterns, arrays, quarantine and results are not applied, and why", () => {
    const notApplied = messages("NOT_APPLIED");
    expect(notApplied).toContain(
      "The fail action isn't applied on synapse: a view can't stop a load; checks.sql checks this rule and raises an error when it runs.",
    );
    expect(notApplied).toContain(
      "The pattern rule isn't applied on synapse: serverless T-SQL has no regular expressions.",
    );
    expect(notApplied).toContain("The items rule isn't applied on synapse: views type no arrays.");
    expect(notApplied.join("\n")).toContain(
      "isn't applied on synapse: a view keeps no rows to quarantine; checks.sql returns how many rows each drop check leaves out instead.",
    );
    expect(notApplied.join("\n")).toContain(
      "isn't applied on synapse: a view keeps no results; checks.sql returns each check's counts instead when it runs.",
    );
  });

  it("applies cleansing and deduplicate, so says nothing of them", () => {
    expect(messages("NOT_APPLIED").filter((text) => /Cleansing|Deduplicate/.test(text))).toEqual(
      [],
    );
  });

  it("puts a converted table in the zone it converts to", () => {
    const orders = crm().model!.tables.find((table) => table.name === "orders_clean")!;
    expect(orders.timezone).toBe("UTC");
  });
});

describe("bronze, which keeps its rows raw", () => {
  it("says each rule is not applied there, and how to apply it", () => {
    const { result } = crm();
    const bronze = result.diagnostics.filter(
      (item) =>
        item.code === "NOT_APPLIED" &&
        item.message ===
          "The notNull rule isn't applied on synapse: it is applied only in a layer whose does lists check.",
    );
    expect(bronze.length).toBeGreaterThan(0);
    expect(bronze[0]!.hint).toBe("Add `check` to the layer's `does` to apply it here.");
  });
});
