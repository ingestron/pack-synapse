// The model of sqlcmd the fold property uses, held to what Microsoft documents and
// what sqlcmd does, so a wrong model cannot make a wrong fold pass.
import { describe, expect, it } from "vitest";
import { runSqlcmd } from "./sqlcmd-model.js";

const files = {
  "views.sql": "SELECT '$(database)' AS [name];\nGO\n",
  "environments/dev.sql": ':on error exit\n:setvar database "erp_dev"\n:r views.sql\n',
};

describe("the sqlcmd model", () => {
  it("reads :r paths from the folder sqlcmd starts in, not from the including script", () => {
    const run = runSqlcmd({ files, input: "environments/dev.sql" });
    expect(run.errors).toEqual([]);
    expect(run.lines).toEqual([
      { file: "views.sql", text: "SELECT 'erp_dev' AS [name];" },
      { file: "views.sql", text: "GO" },
    ]);
    const nested = { ...files, "environments/dev.sql": ":r ../views.sql\n" };
    expect(runSqlcmd({ files: nested, input: "environments/dev.sql" }).errors).toEqual([
      "../views.sql: no such file",
    ]);
  });

  it("replaces variables inside strings, in any case, without reading the value again", () => {
    const run = runSqlcmd({
      files: { "a.sql": "SELECT N'$(NAME)';\n" },
      input: "a.sql",
      options: { name: "$(x)" },
    });
    expect(run.errors).toEqual([]);
    expect(run.lines[0]!.text).toBe("SELECT N'$(x)';");
  });

  it("takes :setvar over -v over an environment variable", () => {
    const script = { "a.sql": "SELECT '$(x)', '$(y)', '$(z)';\n" };
    const run = runSqlcmd({
      files: { "b.sql": ":setvar x set\n:r a.sql\n", ...script },
      input: "b.sql",
      options: { x: "option", y: "option" },
      environment: { x: "environment", y: "environment", z: "environment" },
    });
    expect(run.lines[0]!.text).toBe("SELECT 'set', 'option', 'environment';");
  });

  it("reads a quoted value with doubled quotes, and refuses a bare value with a space", () => {
    const quoted = runSqlcmd({
      files: { "a.sql": ':setvar x "a ""b"" c"\n$(x)\n' },
      input: "a.sql",
    });
    expect(quoted.lines[0]!.text).toBe('a "b" c');
    const bare = runSqlcmd({ files: { "a.sql": ":setvar x a b\n" }, input: "a.sql" });
    expect(bare.errors).toEqual([":setvar x: bad value a b"]);
  });

  it("reports an unknown variable and a $( that starts none", () => {
    const run = runSqlcmd({
      files: { "a.sql": "SELECT '$(missing)', '$(a b)';\n" },
      input: "a.sql",
    });
    expect(run.errors).toEqual([
      "'missing' scripting variable not defined.",
      'syntax error at "$(a b)\';"',
    ]);
  });

  it("splits batches at GO alone on a line, sending no empty batch", () => {
    const run = runSqlcmd({ files: { "a.sql": "USE [x];\nGO\n\nGO\nSELECT 1\n" }, input: "a.sql" });
    expect(run.batches).toEqual(["USE [x];", "SELECT 1"]);
  });
});
