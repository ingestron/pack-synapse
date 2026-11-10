// What sqlcmd would read in views.sql as something other than T-SQL: `$(`, which
// starts a variable anywhere, in strings too, and a line that is one of its commands
// (spec section 5). Each is a pack check problem, in every environment.
import type { ResolvedModel } from "@ingestron/definitions";
import { codeOf, statementText } from "../output/index.js";
import { hasView, plan, type Statement } from "../plan/index.js";

/**
 * Lines sqlcmd reads as its own commands, with or without white space before them,
 * as sqlcmd (Go) v1.10.0 matches them: every command that starts with `:`, such as
 * `:r`, `:setvar` and `:!!`; `!!`; and `GO`, `QUIT`, `RESET`, `ED`, `EXIT` and
 * `ON ERROR`, which need no colon.
 */
const commands: readonly RegExp[] = [
  /^[\t ]*:/,
  /^[\t ]*!!/,
  /^[\t ]*(?:GO|QUIT|RESET|ED)(?:[\t ].*)?$/i,
  /^[\t ]*EXIT(?:[\t (].*)?$/i,
  /^[\t ]*ON[\t ]+ERROR(?:[\t ].*)?$/i,
];

/** The pack check problems for what sqlcmd would read in views.sql as not T-SQL. */
export function sqlcmdProblems(model: ResolvedModel): string[] {
  if (!model.tables.some(hasView)) return [];
  const { project, statements } = plan(model);
  return [
    ...commandLines([{ text: project, startsLine: false }]).map(
      (line) => `the project id would put the line "${line}" in views.sql; ${commandFix}`,
    ),
    ...statements.flatMap((statement) => statementProblems(statement)),
  ];
}

function statementProblems(statement: Statement): string[] {
  const owner =
    statement.kind === "use"
      ? `the database "${statement.database}"`
      : `the view of table "${statement.table}"`;
  const quality = qualityTexts(statement).map(({ text }) => text);
  return [
    ...([statementText(statement), ...quality].some((text) => text.includes("$("))
      ? [
          `${owner} would hold "$(", which sqlcmd reads as the start of a variable such as $(database), even in a string; leave "$(" out of its names, path, columns and code`,
        ]
      : []),
    ...commandLines(textsOf(statement)).map(
      (line) => `${owner} would hold the line "${line}" in views.sql; ${commandFix}`,
    ),
  ];
}

const commandFix = "sqlcmd reads it as one of its own commands, not as T-SQL, so change that line";

/** A text views.sql holds, and whether it starts a line there. */
interface Text {
  text: string;
  startsLine: boolean;
}

/** The lines of the texts that sqlcmd would read as commands. */
function commandLines(texts: readonly Text[]): string[] {
  return texts.flatMap(({ text, startsLine }) =>
    text
      .split(/\r?\n/)
      .slice(startsLine ? 0 : 1)
      .filter((line) => commands.some((command) => command.test(line))),
  );
}

/**
 * Every text a statement takes from the definitions. Only a transform's code starts
 * a line; any other text can put a line in views.sql only after a line break.
 */
function textsOf(statement: Statement): Text[] {
  const within = (...texts: (string | undefined)[]) =>
    texts.flatMap((text) => (text === undefined ? [] : [{ text, startsLine: false }]));
  if (statement.kind === "use") return within(statement.database);
  const { query } = statement;
  const names = [
    ...within(statement.schema, statement.name, ...Object.values(query.cleansed ?? {})),
    ...within(...(statement.access?.grants.map((grant) => grant.principal) ?? [])),
    ...qualityTexts(statement),
  ];
  if (query.kind === "transform")
    return [...names, ...within(...query.columns), { text: codeOf(query), startsLine: true }];
  const columns = [...query.columns, ...(query.extra ?? [])].flatMap((column) =>
    within(column.name, column.physicalName, column.type),
  );
  return [...names, ...within(query.path, query.dataSource, query.csv?.delimiter), ...columns];
}

/** The texts checks.sql, and a view's drop checks, take from the definitions: names, conditions and queries. */
function qualityTexts(statement: Statement): Text[] {
  if (statement.kind === "use") return [];
  return (statement.quality?.checks ?? []).flatMap((check) => [
    { text: check.name, startsLine: false },
    ...(check.kind === "row" ? [{ text: check.condition, startsLine: false }] : []),
    ...(check.kind === "table" && "query" in check.count
      ? [{ text: check.count.query, startsLine: false }]
      : []),
  ]);
}
