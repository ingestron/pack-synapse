// The package README says where a view's columns come from, for a table with a contract and for
// one whose columns come from source metadata.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8").replace(/\s+/g, " ");

describe("the package README on a view's columns", () => {
  it("says they are the table's columns, from its contract or its source metadata", () => {
    expect(readme).toContain("type each column from the table's columns");
    expect(readme).toContain(
      "Each view's columns come from the table's columns, which are its contract's, or its source metadata's when it has no contract",
    );
  });

  it("says the landed files' extra columns follow the table's columns", () => {
    expect(readme).toContain(
      "Columns the landed files carry beyond the table's columns, such as ADF's audit columns, follow them.",
    );
  });
});
