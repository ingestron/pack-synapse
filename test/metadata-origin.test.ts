// A table with no contract, whose columns and key come from source metadata, builds as a
// table with a contract does (specification section 12.4).
import { describe, expect, it } from "vitest";
import { base, generate } from "./project.js";

const metadata = [
  "apiVersion: ingestron.io/v1",
  "kind: SourceMetadata",
  "id: erp",
  "connection: erp",
  "tables:",
  "  - object: orders",
  "    captured: { at: 2026-11-12T09:30:00Z, from: catalog, file: erp.csv }",
  "    columns:",
  "      - { name: id, sourceType: int, logicalType: integer, primaryKeyPosition: 1, required: true }",
  "      - { name: total, sourceType: decimal, logicalType: number, required: false }",
  "",
].join("\n");

/** The project's flow with its table naming no contract, and the table's metadata. */
const withoutContract = {
  "flow.yaml": base["flow.yaml"]!.replace(", contract: orders", ""),
  "erp.metadata.yaml": metadata,
};

describe("a table with no contract", () => {
  it("views its files typed by the metadata's columns", () => {
    const { result, model, files } = generate(withoutContract);
    expect(result.diagnostics).toEqual([]);
    expect(model?.tables[0]?.contract).toMatchObject({
      id: "erp:orders",
      origin: "metadata",
      primaryKey: ["id"],
    });
    expect(files["views.sql"]).toContain(") WITH (\n  [id] BIGINT,\n  [total] FLOAT\n) AS [rows];");
  });
});
