// What sqlcmd would read in views.sql as something other than T-SQL is refused in
// every environment: a line that is one of its commands, and `$(`.
import { describe, expect, it } from "vitest";
import { accessFiles } from "../access-project.js";
import { erpEnvironments } from "../fold-helpers.js";
import { base, problems } from "../project.js";

const orders = erpEnvironments()["orders.yaml"]!;

/** The project with a transform whose code is `code`, after a first line. */
function withCode(code: string) {
  const transform = [
    "apiVersion: ingestron.io/v1",
    "kind: Transform",
    "id: totals",
    "inputs: [orders]",
    `code: ${JSON.stringify(`SELECT id, total FROM {{ tables.orders }}\n${code}`)}`,
    "contract: orders",
    "",
  ].join("\n");
  return problems({ "totals.yaml": transform, "orders.yaml": orders }).filter(
    (problem) => problem.code === "PACK_CHECK",
  );
}

describe("a line sqlcmd reads as a command", () => {
  it.each([
    "GO",
    "  GO 2",
    "go",
    ":setvar database other",
    "    :r other.sql",
    ":connect other",
    ":on error ignore",
    ":!! whoami",
    "!! whoami",
    "\t!! whoami",
    "EXIT(SELECT 1)",
    "exit",
    "QUIT",
    "RESET",
    "ED",
    "ON ERROR exit",
  ])("is refused in a transform's code: %j", (line) => {
    expect(withCode(line)).toEqual([
      {
        code: "PACK_CHECK",
        message: expect.stringContaining(
          `the view of table "totals" would hold the line "${line}" in views.sql; sqlcmd reads it as one of its own commands, not as T-SQL, so change that line`,
        ),
      },
    ]);
  });

  it.each([
    "GOTO next",
    "  EDITION = 1",
    "WHERE quit_date IS NULL",
    "-- :r in a comment, mid-line",
  ])("is not refused when it only looks like one: %j", (line) => {
    expect(withCode(line)).toEqual([]);
  });

  it("is refused after a line break in any other text, such as a data source", () => {
    const platform = base["platform.yaml"]!.replace(
      "    data_source: landing\n    data_source_location",
      '    data_source: "landing\\n:r other.sql"\n    data_source_location',
    );
    expect(problems({ "platform.yaml": platform })).toContainEqual({
      code: "PACK_CHECK",
      message: expect.stringContaining(
        'the view of table "orders" would hold the line ":r other.sql" in views.sql',
      ),
    });
  });

  it("is not refused for a column named like a command, which never starts a line", () => {
    const named = base["orders.yaml"]!.replace("name: total,", "name: go,");
    expect(problems({ "orders.yaml": named }).filter((item) => item.code === "PACK_CHECK")).toEqual(
      [],
    );
  });
});

describe("$( in a view", () => {
  it("is refused, even in a string", () => {
    expect(withCode("WHERE note = '$(x)'")).toEqual([
      {
        code: "PACK_CHECK",
        message: expect.stringContaining(
          'the view of table "totals" would hold "$(", which sqlcmd reads as the start of a variable such as $(database), even in a string',
        ),
      },
    ]);
  });
});

describe("$( in a principal", () => {
  it("is refused, naming principals among what to leave it out of", () => {
    const files = accessFiles({
      roles: ["  - { role: auditors }"],
      principals: "principals: { auditors: 'ops$(team)' }",
    });
    expect(problems(files).filter((item) => item.code === "PACK_CHECK")).toEqual([
      {
        code: "PACK_CHECK",
        message: expect.stringContaining(
          'the view of table "orders" would hold "$(", which sqlcmd reads as the start of a variable such as $(database), even in a string; leave "$(" out of its names, path, columns, code and principals',
        ),
      },
    ]);
  });
});

describe("sqlcmd commands in checks", () => {
  it("refuses a check whose text would put a command line in checks.sql", () => {
    const transform = [
      "apiVersion: ingestron.io/v1",
      "kind: Transform",
      "id: totals",
      "inputs: [orders]",
      "code: SELECT id, total FROM {{ tables.orders }}",
      "contract: orders",
      'expectations: [{ name: positive, check: "total > 0\\nGO", action: warn }]',
      "",
    ].join("\n");
    const standard = base["standard.yaml"]!.replace(
      "store:",
      "layers: [{ name: bronze, does: [check] }]\nstore:",
    );
    const contract = base["orders.yaml"]!.replace(
      "  - name: orders\n",
      "  - name: totals\n    logicalType: object\n    properties:\n      - { name: id, logicalType: integer }\n      - { name: total, logicalType: number }\n  - name: orders\n",
    );
    expect(
      problems({ "totals.yaml": transform, "standard.yaml": standard, "orders.yaml": contract })
        .map(({ message }) => message)
        .join("\n"),
    ).toContain('would hold the line "GO" in views.sql');
  });
});
