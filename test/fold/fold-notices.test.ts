// A deploy-time value whose name is not all upper case is written under the case it is
// given, but Azure DevOps upper-cases pipeline variables, so the pack warns with a notice.
import { environmentsDiagnostics } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { erpEnvironments, erpProject, fold, foldFailures, resolveAll } from "../fold-helpers.js";

const environments = ["dev", "test", "prod"];

/** The ERP project with prod's data source supplied when deploying under the name given. */
function withSource(name: string) {
  const project = erpProject(
    ["  dev: {}", "  test: {}", `  prod: { values: { source: '\${envvar:${name}}' } }`],
    "{ source: landing, region: north, minimum: 1 }",
  );
  return resolveAll(erpEnvironments({ "project.yaml": project }), environments);
}

describe("the case of a deploy-time value's name", () => {
  it("is a notice when it is not upper case, with the fix", () => {
    const { files, deployValues, problems } = fold(withSource("synapse_source"));
    expect(problems).toEqual([
      {
        code: "PACK_NOTICE",
        severity: "warning",
        message:
          "The deploy-time value ${envvar:synapse_source} is read from the environment variable synapse_source, exactly as written. Azure DevOps gives pipeline variables upper-case names, so synapse_source will not be found there unless the step maps it with env:.",
        hint: "Write it in upper case, ${envvar:SYNAPSE_SOURCE}, to avoid this.",
        file: "project.yaml",
        line: 6,
      },
    ]);
    expect(deployValues).toEqual([{ name: "synapse_source", suppliedAs: ["synapse_source"] }]);
    expect(files["views.sql"]).toContain("$(synapse_source)");
  });

  it("is a notice for a name in mixed case too", () => {
    const { problems } = fold(withSource("Synapse_Source"));
    expect(problems.map((problem) => problem.code)).toEqual(["PACK_NOTICE"]);
  });

  it("is not given for an upper-case name, or digits and underscores in one", () => {
    expect(fold(withSource("SYNAPSE_SOURCE_2")).problems).toEqual([]);
  });

  it("is a warning only: the files are still written and the fold holds", () => {
    const models = withSource("synapse_source");
    const { files, problems } = fold(models);
    expect(Object.keys(files)).toContain("views.sql");
    const diagnostics = environmentsDiagnostics(problems);
    expect(diagnostics.map((item) => item.severity)).toEqual(["warning"]);
    expect(foldFailures(models)).toEqual([]);
  });

  it("is given once for a value in every environment", () => {
    const project = erpProject(
      ["  dev: {}", "  test: {}", "  prod: {}"],
      "{ source: '${envvar:synapse_source}', region: north, minimum: 1 }",
    );
    const models = resolveAll(erpEnvironments({ "project.yaml": project }), environments);
    expect(fold(models).problems).toHaveLength(1);
  });
});
