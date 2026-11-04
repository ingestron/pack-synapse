// A model of how sqlcmd reads a script, written from Microsoft's documentation and
// sqlcmd (Go) v1.10.0's source, apart from the pack's own code, so the fold property
// compares the pack's files with what sqlcmd would run (spec/references.md):
// - commands start a line (`:setvar`, `:r`, `:on error`), case-insensitive, and `GO`
//   alone on a line ends a batch;
// - `:r <file>` reads the file relative to the folder sqlcmd starts in, not to the
//   script that includes it;
// - a variable is `$(name)`, case-insensitive, replaced everywhere in the text, inside
//   strings and `:setvar` lines too, and the value is not read again; `:setvar` wins over `-v`, which wins
//   over an environment variable;
// - an unknown variable is an error (the ODBC sqlcmd stops there), and `$(` that does
//   not start a variable is a syntax error (sqlcmd (Go)).

/** What sqlcmd starts with. */
export interface Start {
  /** The files in the folder sqlcmd starts in, by path relative to it. */
  files: Readonly<Record<string, string>>;
  /** The script given with `-i`. */
  input: string;
  /** Variables given with `-v`. */
  options?: Readonly<Record<string, string>>;
  /** The environment variables of the process. */
  environment?: Readonly<Record<string, string>>;
}

/** A line sqlcmd sends to the server, or `GO`, and the file it comes from. */
export interface Line {
  file: string;
  text: string;
}

/** What sqlcmd reads: the lines it sends, its batches, and its errors. */
export interface Run {
  lines: Line[];
  batches: string[];
  errors: string[];
  /** True when `:on error exit` was read before the first batch ran. */
  exitsOnError: boolean;
}

interface State extends Start {
  set: Map<string, string>;
  run: Run;
  depth: number;
}

/** Reads the script as sqlcmd does. */
export function runSqlcmd(start: Start): Run {
  const run: Run = { lines: [], batches: [], errors: [], exitsOnError: false };
  read({ ...start, set: new Map(), run, depth: 0 }, start.input);
  run.batches = batchesOf(run.lines);
  return run;
}

function read(state: State, file: string): void {
  const text = state.files[file];
  if (text === undefined) return void state.run.errors.push(`${file}: no such file`);
  if (state.depth > 10) return void state.run.errors.push(`${file}: :r nested too deeply`);
  for (const line of text.replace(/\n$/, "").split("\n")) {
    const command = /^:(\w+)\s*(.*)$/.exec(line);
    if (command) runCommand(state, file, command[1]!.toLowerCase(), command[2]!.trim());
    else state.run.lines.push({ file, text: substitute(state, line) });
  }
}

function runCommand(state: State, file: string, command: string, argument: string): void {
  if (command === "setvar") return setVariable(state, substitute(state, argument));
  if (command === "on") {
    const ran = state.run.lines.some((line) => /^\s*go\s*$/i.test(line.text));
    if (/^error\s+exit$/i.test(argument) && !ran) state.run.exitsOnError = true;
    return;
  }
  if (command === "r") {
    const path = argument.replace(/^"(.*)"$/, "$1");
    // Relative to the folder sqlcmd starts in: the including script's folder plays no part.
    return read({ ...state, depth: state.depth + 1 }, substitute(state, path));
  }
  state.run.errors.push(`${file}: :${command} is not modelled`);
}

const variableName = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function setVariable(state: State, argument: string): void {
  const match = /^(\S+)(?:\s+(.*))?$/.exec(argument);
  const name = match?.[1] ?? "";
  if (!variableName.test(name)) return void state.run.errors.push(`:setvar ${name}: bad name`);
  const raw = match?.[2];
  if (raw === undefined) return void state.set.delete(name.toLowerCase());
  const value = valueOf(raw);
  if (value === undefined) return void state.run.errors.push(`:setvar ${name}: bad value ${raw}`);
  state.set.set(name.toLowerCase(), value);
}

/** A bare value without spaces, or a quoted one with each `"` inside doubled. */
function valueOf(raw: string): string | undefined {
  if (!raw.startsWith('"')) return /\s/.test(raw) ? undefined : raw;
  const quoted = /^"((?:[^"]|"")*)"$/.exec(raw);
  return quoted ? quoted[1]!.replaceAll('""', '"') : undefined;
}

function substitute(state: State, line: string): string {
  let text = "";
  let rest = line;
  for (let at = rest.indexOf("$("); at >= 0; at = rest.indexOf("$(")) {
    const reference = /^\$\(([A-Za-z0-9_-]*)\)/.exec(rest.slice(at));
    if (!reference) {
      state.run.errors.push(`syntax error at "${rest.slice(at, at + 20)}"`);
      return text + rest;
    }
    const value = lookUp(state, reference[1]!);
    if (value === undefined)
      state.run.errors.push(`'${reference[1]}' scripting variable not defined.`);
    text += rest.slice(0, at) + (value ?? reference[0]);
    rest = rest.slice(at + reference[0].length);
  }
  return text + rest;
}

function lookUp(state: State, name: string): string | undefined {
  const option = Object.entries(state.options ?? {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return state.set.get(name.toLowerCase()) ?? option?.[1] ?? state.environment?.[name];
}

/** The text of each batch, split at lines that are `GO` alone; empty batches are not sent. */
function batchesOf(lines: readonly Line[]): string[] {
  const batches: string[] = [];
  let current: string[] = [];
  for (const { text } of lines) {
    if (/^\s*go\s*$/i.test(text)) {
      if (current.some((line) => line.trim() !== "")) batches.push(current.join("\n"));
      current = [];
    } else current.push(text);
  }
  if (current.some((line) => line.trim() !== "")) batches.push(current.join("\n"));
  return batches;
}
