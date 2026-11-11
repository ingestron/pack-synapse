// Access on a view synapse-serve serves (spec/behaviour.md, "Access"): the definitions package
// judges the served table a second time by its serve step, and views.sql grants from that.
import { describe, expect, it } from "vitest";
import { accessFiles, accessPlatform } from "./access-project.js";
import { diagnostics, grants, header, maskNotApplied, ordersView, revokes } from "./access-sql.js";
import { synapse } from "../src/index.js";
import { base, generate, views } from "./project.js";
import type { ResolvedModel } from "@ingestron/definitions";

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

describe("a view synapse-serve serves from the landed files", () => {
  // No step keeps the table, so its serve step alone is judged (ruling R26).
  const landed = {
    ...accessFiles(),
    "flow.yaml": base["flow.yaml"]!.replace(
      "source: erp\n",
      "source: erp\nstore: { uses: none }\nserve: { uses: synapse-serve }\n",
    ),
  };

  it("grants the view from the serve step's judgement", () => {
    expect(views(landed)).toBe(`${header}${ordersView}\n${grants}`);
  });

  it("reports write access and the mask it cannot apply, in the serve step's notApplied", () => {
    expect(diagnostics(landed)).toEqual([
      {
        code: "NOT_APPLIED",
        message:
          'Write access for the role "etl-writers" in table "orders" isn\'t applied on synapse: views are read-only.',
      },
      { code: "NOT_APPLIED", message: maskNotApplied },
    ]);
    const table = generate(landed).model!.tables[0]!;
    expect(table.notApplied).toBeUndefined();
    expect(table.serve?.notApplied?.map((item) => item.feature)).toEqual(["write", "masks"]);
  });

  it("names each principal of the served view in the request", () => {
    const sections = synapse.request!(generate(landed).model as ResolvedModel);
    const users = sections.find((section) => section.title === "Report users")!.lines;
    expect(users.map((line) => line.slice(0, line.indexOf(":")))).toEqual([
      "`marketing-analysts-dev`",
      "`etl-writers`",
      "`ops]admins`",
    ]);
    expect(users[0]).toContain("in `erp_dev`, create it as a database user");
  });
});
