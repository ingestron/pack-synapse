# Azure Synapse serverless SQL views

Version: 2 (`synapse@2`). Status: implemented by `@ingestron/pack-synapse`
2.0.0. It follows the
[definitions specification](https://github.com/ingestron/ingestron/blob/main/spec/definitions/model.md),
section 2.1 (building files, and building environments together). Sources for
the T-SQL and sqlcmd behaviour are in [references.md](references.md).

The key words MUST, MUST NOT and MAY are used as in RFC 2119.

## 1. Methods

- `synapse-view` (store; accepts `files`, `query`; produces `table`): for a flow
  table, a view over the files its ingest step records as `output`; for a
  transform, a view over the transform's query.
- `synapse-sql` (transform; accepts `table`; produces `query`): the transform's
  T-SQL. Each `{{ tables.<input> }}` (also written `{{- … -}}`) becomes the
  input's view, `[<schema>].[<view>]`, or `[<database>].[<schema>].[<view>]`
  when the input's view is in another database; nothing else in the code is
  rendered.
- `synapse-serve` (serve; accepts `table`, `files`; `needsOutput`): a view over
  the files the table's store step (else its ingest step) records as `output`.

The pack sets `store` and `transform` defaults (`synapse-view`, `synapse-sql`)
and no serve default.

## 2. Settings

`data_source` and `data_source_location` (platform) name the external data
source; the location is `abfss://<file system>@<account host>[/path]` or
`https://<account host>[/path]`, and the two forms, and any case of the
account host, name the same place. `csv` (standard) sets `header` (default
`true`) and `delimiter` (default `,`); when the Synapse step does not set it,
the landing step's `csv` setting is used, else its reader `options` (`header`,
as `true` or `"true"`, and `sep` or `delimiter`), as ADF's `adf-files` writes them.

## 3. Output

The pack builds environments together: `buildEnvironments(models)` gives one
`views.sql` for every environment and a wrapper per environment, which a tool
writes to one folder (the CLI writes `build/synapse/`):

| Path                             | What it is                                                                 |
| -------------------------------- | -------------------------------------------------------------------------- |
| `views.sql`                      | The views, with a SQLCMD variable `$(<name>)` wherever environments differ |
| `environments/<environment>.sql` | That environment's values (`:setvar`), then `:r views.sql`                 |

A project with no table kept by `synapse-view` or served by `synapse-serve`
gets no files. `build(model)` gives `views.sql` alone, for one environment,
with every value as the model resolves it. It is the fold property's render
(section 9). It takes any model, one resolved with `deployTime` included:
where the files' location is not under `data_source_location`, which the
method check refuses, or is hidden by a value supplied when deploying, which
`buildEnvironments` refuses (section 10), `BULK` holds the output's location
as written, deploy-time text included.

## 4. views.sql

`views.sql` holds a view for each table kept by `synapse-view` or served by
`synapse-serve`, in the model's order, so a transform's view follows its
inputs'. It starts with two comment lines naming the project, and no
environment, and saying not to edit it. `USE [<database>];` and `GO` come
before the first view and whenever a view's database differs from the previous
view's, so the script selects each view's database itself and runs against any
database of the serverless pool. Each view is preceded by a statement that
creates its schema when missing, is written `CREATE OR ALTER VIEW`, and ends
with `GO`, so the script can run again. Views are named in two parts.

A view over files is `SELECT * FROM OPENROWSET(BULK '<path>', DATA_SOURCE =
'<data_source>', FORMAT = …) WITH (<columns>) AS [rows]`, where `<path>` is
the output's location relative to `data_source_location`, wildcards kept.
Parquet uses `FORMAT = 'PARQUET'`; CSV uses `FORMAT = 'CSV'`, `PARSER_VERSION =
'2.0'`, `HEADER_ROW = TRUE` when `header`, and `FIELDTERMINATOR`. A transform's
view is `SELECT <contract columns> FROM (<code>) AS [source]`.

When the ingest did not rename columns (`renamed` false), a column with a
`physicalName` is read under that name and selected `AS` its contract name.

When the standard lists `synapse@` first, a column's resolved type is used
(the contract's `physicalType`, else the pack's type); otherwise columns are
typed from each column's `logicalType`: `string` as
`VARCHAR(8000) COLLATE Latin1_General_100_BIN2_UTF8`, `integer` `BIGINT`,
`number` `FLOAT`, `boolean` `BIT`, `date` `DATE`, `timestamp` `DATETIME2(7)`,
`time` `TIME`, `object` and `array` `VARCHAR(MAX)` (their JSON text); a
column without a `logicalType` uses its resolved type. Names are in brackets,
with `]` doubled; text literals double `'`.

## 5. Checks

- A method check problem for `synapse-view` over files when the ingest step
  records no `output`, and when it keeps a transform whose method is not
  `synapse-sql`.
- A method check problem for `synapse-sql` code that starts with `WITH`, or
  names `{{ tables.<x> }}` for an `x` not in `inputs`. A trailing `;` is
  dropped from the view.
- A pack check problem when a `synapse-sql` transform's store is not
  `synapse-view`.

- A method check problem when the files are not under `data_source_location`,
  are in a format other than Parquet or CSV, or their path has `**` before its
  end.
- A method check problem for `synapse-serve` on a table `synapse-view` already
  keeps: it would be a second view.
- A pack check problem when one `data_source` name has two locations.
- A pack check problem when a `synapse-sql` transform reads a table with no
  Synapse view (neither kept by `synapse-view` nor served by `synapse-serve`).
- `synapse-serve` after a step that records no output is the core's `HANDOVER`.
- A pack check problem when a view would hold `$(` anywhere, in a string or
  code too: sqlcmd reads it as the start of a variable (section 8.2).
- A pack check problem for each line of `views.sql` that sqlcmd would read as
  one of its commands, as sqlcmd (Go) v1.10.0 matches them, with or without
  white space before them: a line that starts with `:` (such as `:r`,
  `:setvar`, `:connect`, `:on error` and `:!!`) or `!!`, and a line that is
  `GO`, `QUIT`, `RESET` or `ED`, alone or followed by a space or tab and more,
  `EXIT` followed by `(`, a space or a tab, or alone, or `ON ERROR`. Every line
  of a transform's code is checked, and every line after a line break in any
  other text a view takes from the definitions (names, the path, the data
  source, the delimiter, columns and their types), and in the database of a
  `USE` and the project's id.
- Whether files are under a `data_source_location`, when either holds a value
  supplied only when deploying (`${envvar:NAME}`), is not known when
  generating, so the method check does not judge it; section 10 says when the
  fold refuses it.

## 6. Contracts

Columns and their types are used; `required`, quality rules, relationships and
tags are not used yet (views check no rows); the other facts are
documentation.

## 7. Request

Sections for the serverless database; the external data source, with a master
key when the database has none, the managed-identity database scoped credential
`<data_source>_identity`, the workspace's Storage Blob Data Reader access, and a
resource instance rule when the storage account has a firewall; and report
users' SELECT on the schemas, REFERENCES on the credential and ADMINISTER
DATABASE BULK OPERATIONS.

## 8. Building environments together

`buildEnvironments(models)` takes each target's model, resolved with
`deployTime` and `environmentsTogether`, in project.yaml's order.

### 8.1 Folding

1. The models are compared with the definitions package's `compareTargets`.
   Any `structural` problem is returned, and nothing else is checked.
2. A view over files that a location supplied when deploying hides is refused
   next (section 10).
3. Each target's `views.sql` is planned as `build` plans it: the `USE`
   statements and views in order, and each view's names and query. The plans
   MUST have the same statements in the same order; a target whose views
   share databases differently is refused (section 10).
4. Each value the plans hold is compared across the targets. A value that is
   the same in every target, and holds no deploy-time value, is written as it
   is (minimality). Any other value becomes a SQLCMD variable (section 8.2),
   where the value is one of:
   - the database of a `USE`, or of an input's view in another database;
   - a view's schema or name, also where a transform names it as an input;
   - a view over files' path under the data source, its data source, and its
     CSV delimiter;
   - a run of a transform's code (below).

   Anything else that differs in a view over files, such as its format, its
   CSV header, its columns or their types, is refused (section 10).

5. Every variable is named, `views.sql` is written from the folded plan with
   `$(<name>)` for each variable, and each target gets its wrapper
   (section 8.3).
6. The folded files are checked against each target's own `views.sql`
   (section 9).

Two places whose values are the same in every target share one variable,
except that a run of a transform's code is shared only within that
transform's code.

A transform's code is compared in tokens: words, runs of white space, and each
other character. The tokens common to every target are found with a longest
common subsequence, taken one target at a time: the first target's tokens
against the second's, what they share against the third's, and so on. Each
stretch of tokens between two common tokens that is not the same in every
target is one variable. A stretch empty in some target takes in one token of
the common stretch before it, else of the one after it, so that every target
sets the variable to a value. So

```sql
WHERE region = '${values.region}'
  AND total > ${values.minimum}
```

with `north-east` and `1` in dev, `north` and `2` in test, is

```sql
WHERE region = '$(value_totals)'
  AND total > $(value_totals_2)
```

A stretch that itself holds a line break, because the values that differ do,
is refused (section 10).

### 8.2 Variables

A variable's value goes into `views.sql` as sqlcmd reads it: as it is,
wherever `$(<name>)` stands, inside strings and brackets too (references.md).
So a value that differs MUST NOT hold a line break, which would end its
`:setvar` line, or `$(`; and a name, path, data source or delimiter MUST NOT
hold `'` or `]`, which `views.sql` would otherwise write doubled. Such a value
is refused (section 10). A transform's code is written as it is in every
target, so a run of it may hold `'`.

| Value                                    | Variable                                              |
| ---------------------------------------- | ----------------------------------------------------- |
| A database, when each target has one     | `database`                                            |
| A database otherwise                     | `database_<layer>`, the layer of the first view in it |
| A schema                                 | `schema_<layer>`                                      |
| A view's name                            | `view_<table>`                                        |
| A view over files' path                  | `path_<table>`                                        |
| A data source, when each target uses one | `data_source`                                         |
| A data source otherwise                  | `data_source_<table>`                                 |
| A CSV delimiter                          | `delimiter_<table>`                                   |
| A run of a transform's code              | `value_<table>`                                       |
| A deploy-time value `${envvar:NAME}`     | `NAME`, as written (section 8.4)                      |

Names are in lower case, with `_` for any character other than a letter, a
digit or `_`. Deploy-time values are named first; a name already taken, in
any case, gets `_2`, `_3` and so on, in the order the values are found.
SQLCMD variable names are the same in any case.

### 8.3 Wrappers

`environments/<environment>.sql` is, line by line:

1. comments naming the project and the environment, saying not to edit it,
   and how to run it:
   `sqlcmd -S <workspace>-ondemand.sql.azuresynapse.net -i environments/<environment>.sql`
   from the folder that holds `views.sql`; and, when the environment leaves
   any variable for the deploying pipeline, which;
2. `:on error exit`, so sqlcmd stops at the first error with a non-zero exit
   code, as a CI step needs;
3. `:setvar <name> "<value>"` for each variable the environment sets, in the
   order the variables are found, with each `"` in the value doubled;
4. for each variable the environment leaves for the deploying pipeline,
   `IF N'$(<name>)' = N'$' + N'(<name>)' THROW 50000, N'<name> is not set: the deploying pipeline supplies it, as an environment variable or with sqlcmd -v.', 1;`,
   then `GO`. sqlcmd (Go) leaves an unknown variable in the text and runs on,
   so this stops the script when the value is missing; the ODBC sqlcmd stops
   at the unknown variable itself;
5. `:r views.sql`. sqlcmd reads a `:r` path relative to the folder it starts
   in, not to the script that names it, so the wrapper is run from the folder
   that holds `views.sql` (the CLI's `build/synapse/`), and
   `:r ../views.sql` would be wrong.

A wrapper sets every variable its environment does not leave for the
deploying pipeline, the first environment's included, so no environment
depends on another's values. `:setvar` takes precedence over `-v` and over
environment variables, so a value a wrapper sets cannot be changed by the
host.

### 8.4 Deploy-time values

A deploy-time value `${envvar:NAME}` (definitions specification, section 1.1)
that is a whole value is the SQLCMD variable `NAME`, as written. A target in
which the value is supplied leaves it unset, and the deploying pipeline
supplies it as the environment variable `NAME`, which sqlcmd reads as a
scripting variable; `sqlcmd -v NAME=<value>` works too. sqlcmd (Go) looks the
environment variable up under the name as written, so on Linux it is set in
the same case. The files never hold the text `${envvar:NAME}`.

- **Literal in some targets.** A value literal in some targets and supplied
  in others is one variable: the literal targets set it, the others leave it.
- **One value per target.** A target sets a deploy-time value's variable to
  one value, or leaves it, never both.
- **A whole value only.** A deploy-time value inside a longer value is
  refused: the SQLCMD variable stands for the whole value, as an ARM
  parameter does in the ADF pack (definitions specification, section 2.1).
  So is one in a transform's code, which is written as it is.
- **Locations.** A view reads files by their path under
  `data_source_location`. When the files' location and the data source's
  location share the same deploy-time value, such as the storage account in
  `abfss://landing@${envvar:ACCOUNT}.dfs.core.windows.net`, the path under it
  is known and `views.sql` holds no variable for it. When a deploy-time value
  hides that path, the view is refused.
- **What the pipeline supplies** goes into `views.sql` as it is, as any
  variable's value does (section 8.2). A deploy-time value can stand only in a
  string, as a data source or a CSV delimiter, since names cannot be supplied
  when deploying (definitions specification, section 1.1). So a `]` in it is
  harmless, and a `'` makes the wrapper's check of it a syntax error, which
  stops the script before any view. The pack cannot check a value it never
  sees.
- **Reserved names.** sqlcmd's own variables start with `SQLCMD`, so a NAME
  that does, in any case, is refused, and so are two NAMEs that differ only
  in case.

`deployValues` lists each deploy-time value the files take, in the order the
models first hold it, taken in target order, with `suppliedAs: [NAME]`.

## 9. The fold property

For a target `e`:

- `render(e)` is `build(models[e])`;
- `view(files, e)` is what sqlcmd sends from `views.sql` when it starts in the
  pack's output folder with `-i environments/e.sql`: each line `views.sql`
  contributes, with each `$(<name>)` replaced by the value `e`'s wrapper sets,
  else by the text of the deploy-time value supplied for it, as an
  environment variable.

The texts are compared as text. `view(files, e)` MUST equal `render(e)` for
every target, and for the models of the first one, two and more targets.

`buildEnvironments` checks this itself before it returns the files: a
`views.sql` whose view differs from the render in any target is
`ENVIRONMENTS_DIFFER` (section 10), so a fold never changes what an environment
gets. The pack's tests check it again with the definitions package's
`checkFold`, against a model of sqlcmd written apart from the pack (section 11).

## 10. Problems

`buildEnvironments` reports only `ENVIRONMENTS_DIFFER` and `DEPLOY_VALUE`, all
errors, and the notice below. With any error, `files` and `deployValues` are
empty. Besides the
`structural` problems of `compareTargets`:

| Code                  | Message                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Location                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ENVIRONMENTS_DIFFER` | `In <target> and <target>, the views are in databases grouped differently, from the view of "<table>": views.sql switches database between views, so each view must share its database with the same other views in every environment.`, hint `Name the databases so that the same tables share a database in every environment, such as one database per environment or per layer.`                                                                                                                                                                                                                                               | The table's file                                                                   |
| `ENVIRONMENTS_DIFFER` | `The view [<schema>].[<view>] reads its files differently in <targets>: its <format, CSV header, columns, extra columns the landing step adds, column naming or column typing> is <value> in <targets> and <value> in <targets>.`, hint `Make the files' format, header and columns the same in every environment; only names, paths and the data source may differ.`                                                                                                                                                                                                                                                              | The table's file                                                                   |
| `ENVIRONMENTS_DIFFER` | `The code of transform "<table>" differs between <targets> in more than values: it reads other inputs, selects other columns, or reads an input in another database.`, hint `Make the transform's inputs, columns and databases the same in every environment; only values in its code, such as ${values.<name>}, may differ.`                                                                                                                                                                                                                                                                                                     | The table's file                                                                   |
| `ENVIRONMENTS_DIFFER` | `<The place> (setting <setting>) is <value> in <targets> and <value> in <targets>, and a value that differs between environments cannot hold <' or ] or "$(" or a line break>: sqlcmd puts a variable's value into views.sql as it is.`, hint `Make this value the same in every environment, or leave that character out of it.`, or, for a line break in a transform's code, `Keep each value that differs between environments within one line of the code.` The setting is `naming.catalog`, `naming.schema`, `naming.table`, `the landing location`, `data_source` or `csv.delimiter`, and is left out for a transform's code | Where the setting is written; a transform's file for its code; else `project.yaml` |
| `ENVIRONMENTS_DIFFER` | `views.sql cannot be generated once for every environment: in <targets> it would not be what that environment gets on its own, because the environments differ there in more than values.`, followed by ` Settings that differ: <setting> (<value> in <targets> and <value> in <targets>).` naming up to three step settings that differ                                                                                                                                                                                                                                                                                           | Where the first step setting that differs is written, else `project.yaml`          |
| `DEPLOY_VALUE`        | `"${envvar:<NAME>}" is supplied only when deploying, but in <target> it is part of a longer value, "<text>", in <the place>; a SQLCMD variable in views.sql stands for a whole value.`, hint `Make the variable hold the whole value, or write the value in project.yaml for each environment.`                                                                                                                                                                                                                                                                                                                                    | The value's first use                                                              |
| `DEPLOY_VALUE`        | `In <the place>, this value is ${envvar:<NAME>} in <target> and ${envvar:<NAME>} in <target>.`, hint `Use one variable name and give it a different value in each pipeline stage.`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The second value's first use                                                       |
| `DEPLOY_VALUE`        | `${envvar:<NAME>} stands for one value in each environment, but <target> writes it as "<text>" and "<text>", the second in <the place>.`, hint `Write the value the same way in every place of that environment.`                                                                                                                                                                                                                                                                                                                                                                                                                  | The value's first use                                                              |
| `DEPLOY_VALUE`        | `The code of transform "<table>" holds ${envvar:<NAME>} in <target>, which is supplied only when deploying; views.sql holds a transform's code as it is written, so every value in it must be known when generating.`, hint `Write the value in project.yaml for each environment, and use it in the code as ${values.<name>}.`                                                                                                                                                                                                                                                                                                    | The value's first use                                                              |
| `DEPLOY_VALUE`        | `The view of table "<table>" reads <location> by its path under data_source_location, <location>, in <target>; with ${envvar:<NAME>} supplied only when deploying, that path is not known when generating.`, hint `Write data_source_location and the landing location in project.yaml for each environment, or supply only the part that both share, such as the storage account.`                                                                                                                                                                                                                                                | The value's first use                                                              |
| `DEPLOY_VALUE`        | `${envvar:<NAME>} would be the SQLCMD variable <NAME>, but sqlcmd keeps names that start with SQLCMD for its own settings.`, hint `Rename the environment variable so that its name does not start with SQLCMD.`                                                                                                                                                                                                                                                                                                                                                                                                                   | The value's first use                                                              |
| `DEPLOY_VALUE`        | `${envvar:<NAME>} differs from another value supplied when deploying only in the case of its name, but SQLCMD variable names are the same in any case.`, hint `Give the environment variables names that differ in more than their case.`                                                                                                                                                                                                                                                                                                                                                                                          | The value's first use                                                              |
| `DEPLOY_VALUE`        | `views.sql would hold ${envvar:<NAME>}, which is supplied only when deploying, where the pack cannot make it a SQLCMD variable; only a database, schema or view name, a file path, a data source and a CSV delimiter can be.`                                                                                                                                                                                                                                                                                                                                                                                                      | The value's first use                                                              |

A `PACK_NOTICE` is a warning, so the files are still written. The pack gives
one, for each deploy-time value in `deployValues` whose `NAME` is not all upper
case, since Azure DevOps upper-cases the names of pipeline variables and
sqlcmd (Go) looks the environment variable up as written:

| Code          | Message                                                                                                                                                                                                                                                                                                                                | Located at                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `PACK_NOTICE` | `The deploy-time value ${envvar:<NAME>} is read from the environment variable <NAME>, in that case. Azure DevOps gives pipeline variables upper-case names, so on a Linux agent the deploy step sees <UPPER> and sqlcmd does not find <NAME>.`, hint `Write the name in upper case, ${envvar:<UPPER>}, and supply it under that name.` | The value's first use, when it has one |

`<UPPER>` is `NAME` in upper case. A value is reported once, however many
environments hold it.

`<the place>` names the value: `the database of the views in layer <layer>`,
`the schema of view [<schema>].[<view>]`, `the name of view …`,
`the file path of view …`, `the data source of view …`,
`the CSV delimiter of view …`, `the database of the view of input "<table>"`
(or its schema or name), or `a value in the code of transform "<table>"`. A
view is named by the first target's names. Target lists are joined with `, `,
the last two with `and`. A problem the same as one already given is given
once. The hint, where none is given, is the code's (definitions
specification, section 2.1).

## 11. Tests

- **The fold property** (`test/fold-property.test.ts`) runs `checkFold` with a
  view from `test/sqlcmd-model.ts`, a model of how sqlcmd reads a script
  written from Microsoft's documentation and sqlcmd (Go)'s source, apart from
  the pack's code: commands at the start of a line, `:r` relative to the
  folder sqlcmd starts in, variables replaced everywhere and not read again,
  `:setvar` over `-v` over environment variables, an unknown variable an
  error. The fixture has three environments, with the data source the same in
  test and prod and different in dev; `checkFold` takes the first one, two and
  three. Each deliberately wrong fold (a wrapper with another environment's
  value, a missing `:setvar`, `:r ../views.sql`, a literal in place of a
  variable) fails it.
- **T-SQL** (`test/parse.test.ts`): every batch sqlcmd sends for each
  environment, the wrappers' checks included, passes the conservative check
  in `test/tsql-lexer.ts`: strings, bracketed names and comments close,
  parentheses balance, `GO` is alone on its line, no `$(` is left, and
  `CREATE VIEW` starts its batch. No maintained T-SQL parser on npm reads
  Synapse's `OPENROWSET(BULK …) WITH (…)` (checked 2026-11-05:
  `node-sql-parser` 5.4.0 fails on `CREATE VIEW` with bracketed names and on
  `OPENROWSET(BULK …)`; `@saralsql/tsql-parser` 0.4.7, 0.x with one
  maintainer, fails on `OPENROWSET(BULK …)`), so the check is a tokeniser, and
  each fault it looks for has a test that it is found.
- **Minimality** (`test/fold.test.ts`): `views.sql` holds a variable exactly
  where the fixture's values differ, and each name in section 8.2 is checked.
  The fixture's transform holds two values on separate lines, one with more
  tokens in dev than in test, and `test/token-diff.test.ts` checks the token
  diff on its own.
- **sqlcmd commands** (`test/sqlcmd-checks.test.ts`): each command line in
  section 5 is refused in a transform's code, indented ones included, and
  lines that only look like commands are not.
