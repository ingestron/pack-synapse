// The fold property, against the sqlcmd model: for each environment, what sqlcmd runs
// from views.sql is that environment's own views.sql. Each deliberately wrong fold
// below fails it.
import type { Pack } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../src/index.js";
import { erpEnvironments, erpProject, foldFailures, resolveAll } from "./fold-helpers.js";

const models = resolveAll(erpEnvironments(), ["dev", "test", "prod"]);

/** The pack, with one folded file changed by `change`. */
function wrong(path: string, change: (text: string) => string): Pack {
  return {
    ...synapse,
    buildEnvironments(targets) {
      const built = synapse.buildEnvironments!(targets);
      const text = built.files[path];
      return text === undefined
        ? built
        : { ...built, files: { ...built.files, [path]: change(text) } };
    },
  };
}

describe("the fold property", () => {
  it("holds for one, two and three environments, with a value the same in test and prod", () => {
    expect(foldFailures(models)).toEqual([]);
  });

  it("holds when prod supplies the data source when deploying", () => {
    const files = erpEnvironments({
      "project.yaml": erpProject(
        ["  dev: {}", "  test: {}", "  prod: { values: { source: '${envvar:SYNAPSE_SOURCE}' } }"],
        "{ source: landing, region: north, minimum: 1 }",
      ),
    });
    expect(foldFailures(resolveAll(files, ["dev", "test", "prod"]))).toEqual([]);
  });

  it("fails when an environment's wrapper sets another environment's value", () => {
    const pack = wrong("environments/prod.sql", (text) =>
      text.replace(':setvar database "erp_prod"', ':setvar database "erp_dev"'),
    );
    expect(foldFailures(models, pack)).toContain(
      "With dev, test, prod, for prod: views.sql differs from the render.",
    );
  });

  it("fails when views.sql keeps the first environment's value where it should have a variable", () => {
    const pack = wrong("views.sql", (text) => text.replace("$(data_source)", "landing_dev"));
    expect(foldFailures(models, pack)).toContain(
      "With dev, test, prod, for test: views.sql differs from the render.",
    );
  });

  it("fails when a wrapper leaves out a value it should set", () => {
    const pack = wrong("environments/test.sql", (text) =>
      text.replace(':setvar value_totals "north"\n', ""),
    );
    expect(foldFailures(models, pack)).toContain(
      "With dev, test, prod, for test: sqlcmd errors is in the view but not in the render.",
    );
  });

  it("fails when a wrapper names views.sql from its own folder, as sqlcmd does not read it", () => {
    const pack = wrong("environments/dev.sql", (text) =>
      text.replace(":r views.sql", ":r ../views.sql"),
    );
    expect(foldFailures(models, pack)).toContain(
      "With dev, for dev: views.sql is in the render but not in the view.",
    );
  });
});
