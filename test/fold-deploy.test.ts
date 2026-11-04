// Values supplied when deploying: a whole value is a SQLCMD variable the wrapper leaves
// for the deploying pipeline, named as the environment variable; part of a value, or a
// value in a transform's code, is refused.
import { describe, expect, it } from "vitest";
import { erpEnvironments, erpProject, fold, foldFailures, resolveAll } from "./fold-helpers.js";
import { base } from "./project.js";

const environments = ["dev", "test", "prod"];

/** The ERP project with prod's values as given. */
function withProd(prod: string, defaults = "{ source: landing, region: north }") {
  const project = erpProject(["  dev: {}", "  test: {}", `  prod: { values: ${prod} }`], defaults);
  return resolveAll(erpEnvironments({ "project.yaml": project }), environments);
}

describe("a value supplied when deploying", () => {
  it("is a variable named as the environment variable, which prod leaves for the pipeline", () => {
    const models = withProd("{ source: '${envvar:SYNAPSE_SOURCE}' }");
    const { files, deployValues, problems } = fold(models);
    expect(problems).toEqual([]);
    expect(files["views.sql"]).toContain("  DATA_SOURCE = '$(SYNAPSE_SOURCE)',");
    expect(files["environments/dev.sql"]).toContain(':setvar SYNAPSE_SOURCE "landing"');
    const prod = files["environments/prod.sql"]!;
    expect(prod).not.toContain(":setvar SYNAPSE_SOURCE");
    expect(prod).toContain(
      "-- The deploying pipeline supplies SYNAPSE_SOURCE, as environment variables of the same name.",
    );
    expect(prod).toContain(
      "IF N'$(SYNAPSE_SOURCE)' = N'$' + N'(SYNAPSE_SOURCE)' THROW 50000, N'SYNAPSE_SOURCE is not set: the deploying pipeline supplies it, as an environment variable or with sqlcmd -v.', 1;\nGO\n:r views.sql\n",
    );
    expect(deployValues).toEqual([{ name: "SYNAPSE_SOURCE", suppliedAs: ["SYNAPSE_SOURCE"] }]);
    expect(foldFailures(models)).toEqual([]);
  });

  it("is left for the pipeline in every environment that supplies it", () => {
    const models = withProd("{}", "{ source: '${envvar:SYNAPSE_SOURCE}', region: north }");
    const { files, deployValues } = fold(models);
    for (const target of environments)
      expect(files[`environments/${target}.sql`]).not.toContain(":setvar SYNAPSE_SOURCE");
    expect(deployValues).toEqual([{ name: "SYNAPSE_SOURCE", suppliedAs: ["SYNAPSE_SOURCE"] }]);
    expect(foldFailures(models)).toEqual([]);
  });

  it("is refused as part of a longer value", () => {
    const { problems, files } = fold(withProd("{ source: 'landing_${envvar:SUFFIX}' }"));
    expect(files).toEqual({});
    expect(problems).toEqual([
      {
        code: "DEPLOY_VALUE",
        severity: "error",
        message:
          '"${envvar:SUFFIX}" is supplied only when deploying, but in prod it is part of a longer value, "landing_${envvar:SUFFIX}", in the data source of view [bronze].[orders]; a SQLCMD variable in views.sql stands for a whole value.',
        hint: "Make the variable hold the whole value, or write the value in project.yaml for each environment.",
        file: "project.yaml",
        line: 6,
      },
    ]);
  });

  it("is refused in a transform's code", () => {
    const { problems } = fold(withProd("{ region: '${envvar:REGION}' }"));
    expect(problems.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "DEPLOY_VALUE",
        message:
          'The code of transform "totals" holds ${envvar:REGION} in prod, which is supplied only when deploying; views.sql holds a transform\'s code as it is written, so every value in it must be known when generating.',
      },
    ]);
  });

  it("is refused under a name sqlcmd keeps for itself", () => {
    const { problems } = fold(withProd("{ source: '${envvar:SQLCMDSERVER}' }"));
    expect(problems.map((problem) => problem.message)).toEqual([
      "${envvar:SQLCMDSERVER} would be the SQLCMD variable SQLCMDSERVER, but sqlcmd keeps names that start with SQLCMD for its own settings.",
    ]);
  });
});

describe("a storage location supplied when deploying", () => {
  const lake = "abfss://landing@${values.account}.dfs.core.windows.net";
  /** Files landed in the account, read through a data source at `location`. */
  const project = (location: string, values: string, prod: string) => {
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      `source: erp\ningest: { with: { location: '${lake}/erp/orders/orders.parquet' } }\n`,
    );
    const platform = base["platform.yaml"]!.replace(
      "data_source_location: abfss://landing@acct.dfs.core.windows.net\n  synapse-serve:",
      `data_source_location: '${location}'\n  synapse-serve:`,
    );
    const yaml = erpProject(["  dev: {}", `  prod: { values: ${prod} }`], values);
    const files = { ...base, "flow.yaml": flow, "platform.yaml": platform, "project.yaml": yaml };
    return resolveAll(files, ["dev", "prod"]);
  };

  it("needs no variable when the files and the data source share it", () => {
    const models = project(lake, "{ account: erplakedev }", "{ account: '${envvar:ACCOUNT}' }");
    const { files, deployValues, problems } = fold(models);
    expect(problems).toEqual([]);
    expect(files["views.sql"]).toContain("  BULK 'erp/orders/orders.parquet',");
    expect(deployValues).toEqual([]);
    expect(foldFailures(models)).toEqual([]);
  });

  it("is refused when it hides the files' path under the data source", () => {
    const models = project(
      "${values.location}",
      `{ account: erplakedev, location: 'abfss://landing@erplakedev.dfs.core.windows.net' }`,
      "{ location: '${envvar:LANDING_LOCATION}' }",
    );
    const { problems } = fold(models);
    expect(problems.map((problem) => problem.message)).toEqual([
      'The view of table "orders" reads abfss://landing@erplakedev.dfs.core.windows.net/erp/orders/orders.parquet by its path under data_source_location, ${envvar:LANDING_LOCATION}, in prod; with ${envvar:LANDING_LOCATION} supplied only when deploying, that path is not known when generating.',
    ]);
  });
});
