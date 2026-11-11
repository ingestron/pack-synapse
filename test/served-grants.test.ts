// Access on a view synapse-serve serves (spec/behaviour.md, "Access"): the definitions package
// judges the served table a second time by its serve step, and views.sql grants from that.
import { describe, expect, it } from "vitest";
import { accessFiles, accessPlatform } from "./access-project.js";
import { diagnostics, header, maskNotApplied, revokes } from "./access-sql.js";
import { base, generate, views } from "./project.js";

describe("a view synapse-serve serves over a table another pack stores", () => {
  const served = {
    ...accessFiles({ grants: "exact", roles: ["  - { role: marketing-analysts, access: read }"] }),
    "flow.yaml": base["flow.yaml"]!.replace(
      "source: erp\n",
      "source: erp\nstore: { uses: keep }\nserve: { uses: synapse-serve }\n",
    ),
  };
  const servedView = [
    "IF SCHEMA_ID(N'bronze') IS NULL EXEC(N'CREATE SCHEMA [bronze]');",
    "GO",
    "CREATE OR ALTER VIEW [bronze].[orders] AS",
    "SELECT *",
    "FROM OPENROWSET(",
    "  BULK 'published/orders/*.parquet',",
    "  DATA_SOURCE = 'landing',",
    "  FORMAT = 'PARQUET'",
    ") WITH (",
    "  [id] BIGINT,",
    "  [total] FLOAT,",
    "  [email] VARCHAR(8000) COLLATE Latin1_General_100_BIN2_UTF8",
    ") AS [rows];",
    "GO",
    "",
  ].join("\n");

  it("grants the served view, and revokes with exact grants, from the serve step's judgement", () => {
    const grant = "GRANT SELECT ON OBJECT::[bronze].[orders] TO [marketing-analysts-dev];\nGO\n";
    expect(views(served)).toBe(
      `${header}${servedView}\n${grant}\n${revokes("N'marketing-analysts-dev'")}`,
    );
  });

  it("reports the mask it cannot apply for the served view, on synapse", () => {
    expect(diagnostics(served)).toEqual([{ code: "NOT_APPLIED", message: maskNotApplied }]);
    const table = generate(served).model!.tables[0]!;
    expect(table.notApplied).toBeUndefined();
    expect(table.serve?.notApplied).toEqual([
      {
        feature: "masks",
        reason:
          "Synapse serverless has no data masking, and readers of views over files can read the files directly.",
        column: "email",
      },
    ]);
  });

  it("builds what it built before when the switch is off", () => {
    const off = { ...served, "platform.yaml": accessPlatform({ manage: false }) };
    expect(views(off)).toBe(`${header}${servedView}`);
  });
});
