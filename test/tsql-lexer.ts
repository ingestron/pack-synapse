// A conservative check that a batch is T-SQL Synapse can parse. No maintained T-SQL
// parser on npm reads Synapse's OPENROWSET(BULK …) WITH (…) (spec/behaviour.md,
// section 11), so this checks what a fold can break: quoting,
// comments, brackets, batch separators and the statements a batch may start with.

/** A token of T-SQL: its kind and text. */
export interface Token {
  kind: "string" | "identifier" | "comment" | "word" | "space" | "symbol";
  text: string;
}

const patterns: [Token["kind"], RegExp][] = [
  ["comment", /^--[^\n]*/],
  ["string", /^N?'(?:[^']|'')*'/],
  ["identifier", /^\[(?:[^\]]|\]\])*\]/],
  ["identifier", /^"(?:[^"]|"")*"/],
  ["word", /^[A-Za-z_@#][A-Za-z0-9_@#$]*/],
  ["word", /^\d+(?:\.\d+)?/],
  ["space", /^\s+/],
  ["symbol", /^(?:<>|<=|>=|!=|[-+*/%=<>(),.;:&|^~!])/],
];

/** The batch's tokens, or the first problem: an unclosed quote, comment or bracket. */
export function tokenise(batch: string): { tokens: Token[]; problem?: string } {
  const tokens: Token[] = [];
  let rest = batch;
  while (rest !== "") {
    if (rest.startsWith("/*")) {
      const end = blockCommentEnd(rest);
      if (end < 0) return { tokens, problem: "an unclosed /* comment" };
      tokens.push({ kind: "comment", text: rest.slice(0, end) });
      rest = rest.slice(end);
      continue;
    }
    const found = patterns.find(([, pattern]) => pattern.test(rest));
    if (!found)
      return { tokens, problem: `an unclosed quote or bracket, or "${rest.slice(0, 12)}"` };
    const text = found[1].exec(rest)![0];
    tokens.push({ kind: found[0], text });
    rest = rest.slice(text.length);
  }
  return { tokens };
}

/** T-SQL block comments nest. */
function blockCommentEnd(text: string): number {
  let depth = 0;
  for (let at = 0; at < text.length - 1; at += 1) {
    const pair = text.slice(at, at + 2);
    if (pair === "/*") depth += 1;
    if (pair === "*/") depth -= 1;
    if (pair === "/*" || pair === "*/") at += 1;
    if (depth === 0) return at + 1;
  }
  return -1;
}

/**
 * Problems with one batch: tokens that do not close, parentheses that do not balance,
 * `GO` or `$(` left in the text, and CREATE VIEW anywhere but first in its batch.
 */
export function batchProblems(batch: string): string[] {
  const { tokens, problem } = tokenise(batch);
  if (problem) return [problem];
  const code = tokens.filter((token) => token.kind !== "space" && token.kind !== "comment");
  const problems = nestingProblems(code);
  if (code.some((token) => token.kind === "word" && /^go$/i.test(token.text)))
    problems.push("GO inside a batch");
  if (code.some((token) => token.text.includes("$("))) problems.push("a sqlcmd variable left");
  const words = code.map((token) => token.text.toUpperCase());
  const view = words.findIndex(
    (word, index) => word === "VIEW" && index > 0 && createsView(words, index),
  );
  if (view >= 0 && !/^CREATE( OR ALTER)? VIEW$/.test(words.slice(0, view + 1).join(" ")))
    problems.push("CREATE VIEW is not the first statement in its batch");
  return problems;
}

/** Parentheses that do not balance. */
function nestingProblems(code: readonly Token[]): string[] {
  const problems: string[] = [];
  let depth = 0;
  for (const token of code) {
    if (token.text === "(") depth += 1;
    if (token.text === ")") depth -= 1;
    if (depth < 0) problems.push("a ) with no (");
  }
  if (depth > 0) problems.push("a ( with no )");
  return problems;
}

/** The VIEW of `CREATE VIEW` or `CREATE OR ALTER VIEW`. */
function createsView(words: string[], index: number): boolean {
  return (
    words[index - 1] === "CREATE" || words.slice(index - 3, index).join(" ") === "CREATE OR ALTER"
  );
}
