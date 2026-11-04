// What stops one views.sql covering every environment: environments that differ in
// more than values, and values that sqlcmd cannot put into views.sql as they are.
import { compareTargets } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { firstSettingAt } from "../src/fold-problems.js";
import { erpEnvironments, erpProject, fold, resolveAll, totals } from "./fold-helpers.js";
import { base } from "./project.js";

const twoEnvironments = (values: { dev: string; prod: string }, changes: Record<string, string>) =>
  resolveAll(
    erpEnvironments({
      "project.yaml": erpProject(
        [`  dev: { values: ${values.dev} }`, `  prod: { values: ${values.prod} }`],
        "{ source: landing, region: north, minimum: 1 }",
      ),
      ...changes,
    }),
    ["dev", "prod"],
  );

const messages = (models: ReturnType<typeof twoEnvironments>) =>
  fold(models).problems.map(({ code, message }) => ({ code, message }));

describe("environments that differ in more than values", () => {
  it("are refused when a table uses another method in one environment", () => {
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      "source: erp\nstore: { uses: '${values.store}' }\n",
    );
    const files = erpEnvironments({
      "flow.yaml": flow,
      "project.yaml": erpProject(
        ["  dev: { values: { store: synapse-view } }", "  prod: { values: { store: keep } }"],
        "{ source: landing, region: north, minimum: 1 }",
      ),
    });
    delete files["totals.yaml"];
    expect(messages(resolveAll(files, ["dev", "prod"]))[0]).toEqual({
      code: "ENVIRONMENTS_DIFFER",
      message: 'Table "orders" uses "synapse-view" for store in dev and "keep" in prod.',
    });
  });

  it("are refused when a view reads files in another format", () => {
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      "source: erp\ningest: { with: { format: '${values.format}' } }\n",
    );
    const models = twoEnvironments(
      { dev: "{ format: csv }", prod: "{ format: parquet }" },
      { "flow.yaml": flow },
    );
    expect(fold(models).problems).toEqual([
      {
        code: "ENVIRONMENTS_DIFFER",
        severity: "error",
        message:
          'The view [bronze].[orders] reads its files differently in dev and prod: its format is "csv" in dev and "parquet" in prod.',
        hint: "Make the files' format, header and columns the same in every environment; only names, paths and the data source may differ.",
        file: "flow.yaml",
      },
    ]);
  });

  it("are refused when the views share databases differently", () => {
    const standard = base["standard.yaml"]!.replace(
      "store: { default: synapse-view }",
      'store: { default: synapse-view }\nnaming: { catalog: "erp_{{ environment }}${values.split}" }',
    );
    const models = twoEnvironments(
      { dev: "{ split: '_{{ layer }}' }", prod: "{ split: '' }" },
      { "standard.yaml": standard },
    );
    expect(messages(models)).toEqual([
      {
        code: "ENVIRONMENTS_DIFFER",
        message:
          'In dev and prod, the views are in databases grouped differently, from the view of "totals": views.sql switches database between views, so each view must share its database with the same other views in every environment.',
      },
    ]);
  });

  it("are refused when a transform's code reads other inputs in one environment", () => {
    const code = totals.replace("WHERE region = '${values.region}'", "${values.more}");
    const models = twoEnvironments(
      {
        dev: "{ more: '' }",
        prod: "{ more: 'UNION ALL SELECT id, total FROM {{ tables.orders }}' }",
      },
      { "totals.yaml": code },
    );
    expect(messages(models)).toEqual([
      {
        code: "ENVIRONMENTS_DIFFER",
        message:
          'The code of transform "totals" differs between dev and prod in more than values: it reads other inputs, selects other columns, or reads an input in another database.',
      },
    ]);
  });
});

describe("where a refusal with no fix of its own points", () => {
  it("is the first step setting that differs, where the definitions write it", () => {
    const flow = base["flow.yaml"]!.replace(
      "source: erp\n",
      "source: erp\ningest: { with: { format: '${values.format}' } }\n",
    );
    const models = twoEnvironments(
      { dev: "{ format: csv }", prod: "{ format: parquet }" },
      { "flow.yaml": flow },
    );
    expect(firstSettingAt(models, compareTargets(models).differing)).toEqual({
      file: "flow.yaml",
      line: 5,
    });
  });
});

describe("values sqlcmd cannot put into views.sql as they are", () => {
  it("are refused when a name that differs holds a quote, at the setting it comes from", () => {
    const models = twoEnvironments(
      { dev: "{ source: landing }", prod: `{ source: "land'ing" }` },
      {},
    );
    expect(fold(models).problems).toEqual([
      {
        code: "ENVIRONMENTS_DIFFER",
        severity: "error",
        message:
          'The data source of view [bronze].[orders] (setting data_source) is "landing" in dev and "land\'ing" in prod, and a value that differs between environments cannot hold \': sqlcmd puts a variable\'s value into views.sql as it is.',
        hint: "Make this value the same in every environment, or leave that character out of it.",
        file: "platform.yaml",
        line: 6,
      },
    ]);
  });

  it("are refused when a value in a transform's code that differs spans lines", () => {
    const models = twoEnvironments(
      { dev: "{ region: north, minimum: 1 }", prod: '{ region: "south\\nwest" }' },
      {},
    );
    expect(fold(models).problems).toEqual([
      {
        code: "ENVIRONMENTS_DIFFER",
        severity: "error",
        message:
          'A value in the code of transform "totals" is "north" in dev and "south\\nwest" in prod, and a value that differs between environments cannot hold a line break: sqlcmd puts a variable\'s value into views.sql as it is.',
        hint: "Keep each value that differs between environments within one line of the code.",
        file: "totals.yaml",
      },
    ]);
  });
});
