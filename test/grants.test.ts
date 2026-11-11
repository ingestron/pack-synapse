// Access (spec/behaviour.md, "Access"): views.sql grants SELECT on each view kept by
// synapse-view to its roles' principals, and with exact grants revokes what they do not give.
import { describe, expect, it } from "vitest";
import { accessContract, accessFiles, accessPlatform, accessStandard } from "./access-project.js";
import { diagnostics, grants, header, maskNotApplied, ordersView, revokes } from "./access-sql.js";
import { base, generate, views } from "./project.js";

describe("grants in views.sql", () => {
  it("grants SELECT on the view to each role's principal, after the view, quoting each name", () => {
    expect(views(accessFiles())).toBe(`${header}${ordersView}\n${grants}`);
  });

  it("revokes, with exact grants, what the roles do not give, keeping SELECT for each principal", () => {
    const kept = "N'marketing-analysts-dev', N'etl-writers', N'ops]admins'";
    expect(views(accessFiles({ grants: "exact" }))).toBe(
      `${header}${ordersView}\n${grants}\n${revokes(kept)}`,
    );
  });

  it("revokes every direct permission on a view with exact grants and no role", () => {
    expect(views(accessFiles({ grants: "exact", roles: [] }))).toBe(
      `${header}${ordersView}\n${revokes()}`,
    );
  });

  it("writes a quote in a principal doubled in the list exact grants keep", () => {
    const files = accessFiles({
      grants: "exact",
      roles: ["  - { role: auditors }"],
      principals: `principals: { auditors: "team's analysts" }`,
    });
    const sql = views(files);
    expect(sql).toContain("GRANT SELECT ON OBJECT::[bronze].[orders] TO [team's analysts];");
    expect(sql).toContain("[principals].[name] IN (N'team''s analysts'));");
  });

  it("grants a role that the contract and the layer both name once", () => {
    const standard = accessStandard().replace(
      "governance:",
      "layers:\n  - name: bronze\n    access: { roles: [{ role: auditors }] }\n  - silver\n  - gold\ngovernance:",
    );
    const sql = views({ ...accessFiles(), "standard.yaml": standard });
    expect(sql.match(/TO \[ops\]\]admins\];/g)).toHaveLength(1);
  });

  it("builds the files a project without roles builds when the switch is off", () => {
    const without = {
      ...base,
      "standard.yaml": accessStandard(),
      "platform.yaml": base["platform.yaml"]!,
      "orders.yaml": accessContract([]),
    };
    expect(views(accessFiles({ manage: false, grants: "exact" }))).toBe(views(without));
    expect(views(without)).toBe(`${header}${ordersView}`);
  });

  it("warns once per role while the switch is off, with a fix that turns it on", () => {
    const off = generate(accessFiles({ manage: false })).result.diagnostics.filter(
      (item) => item.code === "CAPABILITY_OFF",
    );
    expect(off.map((item) => item.message)).toEqual([
      'Access for the role "marketing-analysts" in table "orders" is not applied: the platform has Grants off.',
      'Access for the role "etl-writers" in table "orders" is not applied: the platform has Grants off.',
      'Access for the role "auditors" in table "orders" is not applied: the platform has Grants off.',
    ]);
    expect(off[0]!.fixes?.[0]).toMatchObject({
      title: "Turn on manage.grants",
      edits: [{ file: "platform.yaml", pointer: "/synapse/manage/grants", set: true }],
    });
  });

  it("says write access and the mask are not applied on a view", () => {
    expect(diagnostics(accessFiles())).toEqual([
      {
        code: "NOT_APPLIED",
        message:
          'Write access for the role "etl-writers" in table "orders" isn\'t applied on synapse: views are read-only.',
      },
      { code: "NOT_APPLIED", message: maskNotApplied },
    ]);
  });
});

describe("one contract on a view and on a table another pack keeps", () => {
  // The Synapse half of the definitions package's case contract-two-engines.
  const files = {
    ...accessFiles({ roles: ["  - { role: marketing-analysts, access: read }"] }),
    "lake.yaml": [
      "apiVersion: ingestron.io/v1",
      "kind: Flow",
      "id: lake",
      "source: erp",
      "store: { uses: keep }",
      "tables:",
      "  orders_lake: { object: orders, contract: orders }",
      "",
    ].join("\n"),
  };

  it("grants the view, and reports the mask once, naming only the view", () => {
    const sql = views(files);
    expect(sql).toContain(
      "GO\n\nGRANT SELECT ON OBJECT::[bronze].[orders] TO [marketing-analysts-dev];\nGO\n",
    );
    expect(sql.match(/GRANT/g)).toHaveLength(1);
    expect(diagnostics(files)).toEqual([{ code: "NOT_APPLIED", message: maskNotApplied }]);
  });
});

describe("the Platform's synapse section", () => {
  it("is checked: manage.grants is a boolean, and nothing else is managed", () => {
    for (const manage of ["grants: yes please", "grants: true, masks: true"]) {
      const platform = accessPlatform().replace("grants: true", manage);
      const files = { ...accessFiles(), "platform.yaml": platform };
      expect(
        diagnostics(files).map((item) => item.code),
        manage,
      ).toContain("BAD_SETTING");
    }
  });
});
