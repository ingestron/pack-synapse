// Grants with every environment together (spec/behaviour.md, "Access" and section 8): a
// principal that differs between environments is a SQLCMD variable, the fold property
// holds against the sqlcmd model, and what cannot be folded is refused.
import { describe, expect, it } from "vitest";
import { accessFiles } from "./access-project.js";
import {
  erpProject,
  fold,
  foldFailures,
  resolveAll,
  sqlcmdRun,
  type Models,
} from "./fold-helpers.js";
import { batchProblems } from "./tsql-lexer.js";

const environments = ["dev", "test", "prod"];

/** The access project in dev, test and prod, the marketing group named per environment. */
function governed(principals: string): Record<string, string> {
  const project = erpProject([
    "  dev: { values: { marketing: marketing-dev, auditors: 'ops]dev' } }",
    "  test: { values: { marketing: marketing-test, auditors: 'ops]test' } }",
    "  prod: { values: { marketing: marketing-analysts, auditors: 'ops]admins' } }",
  ]);
  return { ...accessFiles({ grants: "exact", principals }), "project.yaml": project };
}

const perEnvironment = governed(
  "principals: { marketing-analysts: '${values.marketing}', auditors: 'ops]admins' }",
);

describe("grants in every environment together", () => {
  const models = resolveAll(perEnvironment, environments);
  const built = fold(models);

  it("makes a principal that differs a variable, in the grant and in what exact grants keep", () => {
    expect(built.problems).toEqual([]);
    const views = built.files["views.sql"]!;
    expect(views).toContain(
      "GRANT SELECT ON OBJECT::[bronze].[orders] TO [$(principal_marketing_analysts)];\n",
    );
    expect(views).toContain("GRANT SELECT ON OBJECT::[bronze].[orders] TO [ops]]admins];\n");
    expect(views).toContain(
      "[principals].[name] IN (N'$(principal_marketing_analysts)', N'etl-writers', N'ops]admins'));",
    );
    expect(built.files["environments/dev.sql"]).toContain(
      ':setvar principal_marketing_analysts "marketing-dev"\n',
    );
    expect(built.files["environments/prod.sql"]).toContain(
      ':setvar principal_marketing_analysts "marketing-analysts"\n',
    );
  });

  it("keeps the fold property for one, two and three environments", () => {
    expect(foldFailures(models)).toEqual([]);
  });

  it("sends T-SQL batches in every environment", () => {
    for (const target of environments) {
      const run = sqlcmdRun(built.files, target);
      expect(run.errors).toEqual([]);
      expect(run.batches.flatMap(batchProblems)).toEqual([]);
    }
  });
});

describe("grants the fold refuses", () => {
  it("refuses a principal that differs and holds ]", () => {
    const files = governed("principals: { auditors: '${values.auditors}' }");
    const problems = fold(resolveAll(files, environments)).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ code: "ENVIRONMENTS_DIFFER", severity: "error" });
    expect(problems[0]!.message).toMatch(
      /^The principal of the role "auditors" on view \[bronze\]\.\[orders\] \(setting principals\.auditors\) is .* cannot hold \]: /,
    );
  });

  it("refuses grants on in one environment and off in another", () => {
    const on = resolveAll(perEnvironment, ["dev"]);
    const off = resolveAll(
      {
        ...perEnvironment,
        "platform.yaml": perEnvironment["platform.yaml"]!.replace("grants: true", "grants: false"),
      },
      ["prod"],
    );
    const models: Models = { ...on, ...off };
    const problems = fold(models).problems;
    expect(problems.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "ENVIRONMENTS_DIFFER",
        message:
          "The grants on view [bronze].[orders] differ between dev and prod in more than their principals.",
      },
    ]);
    expect(problems[0]!.hint).toBe(
      "Turn synapse.manage.grants on or off in every environment alike, and give the table the same roles and grant mode in each; only the principals may differ.",
    );
  });
});
