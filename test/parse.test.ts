// What sqlcmd sends for each environment is T-SQL: every batch, once each wrapper's
// :setvar values are in views.sql, passes the conservative check of tsql-lexer.ts,
// and that check fails on the faults a fold could bring in.
import { memoryFiles } from "@ingestron/config";
import { resolveDefinitions, type ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../src/index.js";
import {
  erpEnvironments,
  erpProject,
  fold,
  resolveAll,
  sqlcmdRun,
  suppliedTexts,
} from "./fold-helpers.js";
import { crmFiles } from "./quality-project.js";
import { runSqlcmd } from "./sqlcmd-model.js";
import { landing, tables } from "./stub-packs.js";
import { batchProblems } from "./tsql-lexer.js";

const environments = ["dev", "test", "prod"];

function sentBatches(files: Record<string, string>) {
  const models = resolveAll(files, environments);
  const built = fold(models);
  expect(built.problems).toEqual([]);
  return environments.map((target) => {
    const run = sqlcmdRun(built.files, target, suppliedTexts(models));
    expect(run.errors).toEqual([]);
    expect(run.exitsOnError).toBe(true);
    return run.batches;
  });
}

describe("views.sql with each environment's values", () => {
  it("is T-SQL batches in every environment", () => {
    for (const batches of sentBatches(erpEnvironments())) {
      expect(batches.length).toBeGreaterThan(4);
      expect(batches.flatMap(batchProblems)).toEqual([]);
    }
  });

  it("is T-SQL when the deploying pipeline supplies a value, the check that it is set included", () => {
    const project = erpProject(
      ["  dev: {}", "  test: {}", "  prod: { values: { source: '${envvar:SYNAPSE_SOURCE}' } }"],
      "{ source: landing, region: north, minimum: 1 }",
    );
    const [, , prod] = sentBatches(erpEnvironments({ "project.yaml": project }));
    expect(prod![0]).toContain("IF N'${envvar:SYNAPSE_SOURCE}' = N'$' + N'(SYNAPSE_SOURCE)' THROW");
    expect(prod!.flatMap(batchProblems)).toEqual([]);
  });
});

describe("the T-SQL check", () => {
  it("finds an unclosed string, such as a value whose quote a variable broke", () => {
    expect(batchProblems("SELECT * FROM t WHERE a = 'it's'")).toEqual([
      'an unclosed quote or bracket, or "\'"',
    ]);
  });

  it("finds an unclosed bracket and unbalanced parentheses", () => {
    expect(batchProblems("CREATE OR ALTER VIEW [a.[b AS SELECT 1")).toEqual([
      'an unclosed quote or bracket, or "[a.[b AS SEL"',
    ]);
    expect(batchProblems("SELECT (1")).toEqual(["a ( with no )"]);
  });

  it("finds a view that is not first in its batch, and a GO that is not on its own line", () => {
    expect(batchProblems("USE [x];\nCREATE OR ALTER VIEW [a].[b] AS SELECT 1;")).toEqual([
      "CREATE VIEW is not the first statement in its batch",
    ]);
    expect(batchProblems("SELECT 1; GO")).toEqual(["GO inside a batch"]);
  });

  it("finds a sqlcmd variable that no value replaced", () => {
    expect(batchProblems("SELECT '$(missing)'")).toEqual(["a sqlcmd variable left"]);
  });
});

describe("views.sql and checks.sql with checks and cleansing", () => {
  it("are T-SQL batches in every environment", () => {
    const models = Object.fromEntries(
      ["dev", "prod"].map((environment) => [
        environment,
        resolveDefinitions(memoryFiles(crmFiles()), {
          packs: [landing, synapse, tables],
          environment,
          deployTime: true,
          environmentsTogether: true,
        }).model as ResolvedModel,
      ]),
    );
    const built = fold(models);
    for (const target of ["dev", "prod"]) {
      const views = sqlcmdRun(built.files, target);
      const checks = runSqlcmd({ files: built.files, input: `checks/${target}.sql` });
      expect([...views.errors, ...checks.errors]).toEqual([]);
      expect(checks.exitsOnError).toBe(true);
      expect(checks.batches).toHaveLength(1);
      expect([...views.batches, ...checks.batches].flatMap(batchProblems)).toEqual([]);
    }
  });
});
