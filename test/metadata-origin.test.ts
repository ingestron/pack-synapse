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
  "standard.yaml": base["standard.yaml"]!.replace("landing@1, synapse@2", "synapse@2, landing@1"),
  "flow.yaml": base["flow.yaml"]!.replace(", contract: orders", ""),
  "erp.metadata.yaml": metadata,
};

describe("a table with no contract", () => {
  it("preserves observed money precision without adding quality promises", () => {
    const changed = {
      ...withoutContract,
      "erp.metadata.yaml": metadata.replace("sourceType: decimal", "sourceType: money"),
    };
    const { files, model } = generate(changed);
    expect(model?.standard.packs[0]).toBe("synapse@2");
    expect(model?.tables[0]?.contract.columns[1]?.type).toBe("DECIMAL(19,4)");
    expect(files["views.sql"]).toContain("[total] DECIMAL(19,4)");
    expect(model?.tables[0]?.contract.checks).toEqual([]);
    expect(model?.tables[0]?.contract.columns.every((column) => column.nullable)).toBe(true);
  });
  it("keeps a standard's explicit type ahead of source precision", () => {
    const { files } = generate({
      ...withoutContract,
      "erp.metadata.yaml": metadata.replace("sourceType: decimal", "sourceType: money"),
      "standard.yaml": withoutContract["standard.yaml"] + "types: { number: 'DECIMAL(12,3)' }\n",
    });
    expect(files["views.sql"]).toContain("[total] DECIMAL(12,3)");
  });
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
