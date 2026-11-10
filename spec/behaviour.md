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
| `checks.sql`                     | The checks, when any table runs one (section "Quality and cleansing")      |
| `checks/<environment>.sql`       | That environment's values (`:setvar`), then `:r checks.sql`                |

A project with no table kept by `synapse-view` or served by `synapse-serve`
gets no files, and a project where no table runs a check gets no `checks.sql`
and no `checks/` wrappers. There is one `checks.sql` per project, as there is
one `views.sql`. `build(model)` gives `views.sql`, and `checks.sql` when a
table runs a check, for one environment, with every value as the model
resolves it. It is the fold property's render
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
  source, the delimiter, columns and their types, and the names, conditions
  and `sql` queries of its checks, which `checks.sql` holds), and in the
  database of a `USE` and the project's id. `$(` is refused in the same texts.
- Whether files are under a `data_source_location`, when either holds a value
  supplied only when deploying (`${envvar:NAME}`), is not known when
  generating, so the method check does not judge it; section 10 says when the
  fold refuses it.

## 6. Contracts

Columns and their types are used. `required`, `unique`, the limits in
`logicalTypeOptions` and the quality rules become checks (definitions
specification, section 6), which a table runs in a layer whose `does` lists
`check` or is `raw` (section "Quality and cleansing"); the primary key is used to
deduplicate. Relationships and tags are not used yet; the other facts are
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
   (section 8.3). When a table runs a check, `checks.sql` is written from the
   same folded plan, with the same variables, and each target gets its checks
   wrapper. What a view cleanses, deduplicates and checks is taken from the
   first target; a target whose own files would differ there is refused by
   step 6.
6. The folded files are checked against each target's own `views.sql` and
   `checks.sql` (section 9).

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

`checks/<environment>.sql`, the checks wrapper, is the same, with three
differences: its comments name `checks.sql` and its own path, it includes
`:r checks.sql`, and a line `GO` follows that, as `checks.sql` has no `GO` of
its own. It sets every variable, as the views wrapper does.

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
  environment variable; and, when there is a `checks.sql`, what sqlcmd sends
  from it in the same way with `-i checks/e.sql`.

The texts are compared as text. `view(files, e)` MUST equal `render(e)` for
every target, and for the models of the first one, two and more targets.

`buildEnvironments` checks this itself before it returns the files: a
`views.sql` whose view differs from the render in any target is
`ENVIRONMENTS_DIFFER` (section 10), so a fold never changes what an environment
gets. The pack's tests check it again with the definitions package's
`checkFold`, against a model of sqlcmd written apart from the pack (section 11).

## 10. Problems

`buildEnvironments` reports only `ENVIRONMENTS_DIFFER` and `DEPLOY_VALUE`, all
errors, and the notices below. With any error, `files` and `deployValues` are
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
case. sqlcmd (Go) looks the environment variable up as written, and Azure
DevOps gives pipeline variables upper-case names, so such a name is found there
only when the step maps it with `env:`:

| Code          | Message                                                                                                                                                                                                                                                                                                   | Located at                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `PACK_NOTICE` | `The deploy-time value ${envvar:<NAME>} is read from the environment variable <NAME>, exactly as written. Azure DevOps gives pipeline variables upper-case names, so <NAME> will not be found there unless the step maps it with env:.`, hint `Write it in upper case, ${envvar:<UPPER>}, to avoid this.` | The value's first use, when it has one |

`<UPPER>` is `NAME` in upper case. A value is reported once, however many
environments hold it.

The pack gives no notice for a table check it cannot apply: the definitions
package judges a table check that counts values against a `pattern` as the
`pattern` rule kind, which the pack declares `not-applicable`, so it is a
`NOT_APPLIED` warning about the table (definitions specification, section
11.7), and the passport says it is not enforced. Nor is a zone Windows has
no name for a notice: the pack lists it in its coverage, and the definitions
package reports it (section "Quality and cleansing").

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
- **Quality and cleansing** (`test/quality.test.ts` and the tests beside it):
  the views and `checks.sql` of the shared quality fixture
  (`test/fixtures/quality`, the Databricks pack's, made Synapse's), whole; the
  bronze views unchanged; each condition, cleansing value, table check and
  coverage entry; `Europe/London` as `GMT Standard Time` and a zone Windows
  has no name for; `checks.sql` folded with the views' variables, against
  the sqlcmd model, and every batch through the T-SQL check. The generator of
  the zone table has its own tests (`scripts/windows-zones.test.mjs`).
- **sqlcmd commands** (`test/sqlcmd-checks.test.ts`): each command line in
  section 5 is refused in a transform's code, indented ones included, and
  lines that only look like commands are not.

## Intent

The pack declares what it does with each intent path and value (section 11 of the
definitions specification) in `intent`, and `intentCoverageGaps` is empty. Synapse
serverless builds views, which keep nothing and run nothing, so the pack applies no
intent about what is kept or run. It applies the quality and cleansing paths in its
views and in `checks.sql` (section "Quality and cleansing"). The entries it uses
record the Microsoft Learn page they rest on, as generally available, checked
2026-11-10.

| Intent                                                                                | Coverage                       | Reason or what it does                                                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `history`, `sequence`, `storage`, `retention.time_travel`, `retention.log`, `rescued` | `not-applicable`               | Views keep nothing; they read files or a query each time.                                                                          |
| `load.deletes`                                                                        | `not-applicable`               | Views keep nothing; they read files or a query each time.                                                                          |
| `load` (the rest), `retention.landed_files`                                           | `elsewhere`                    | Another pack lands the files.                                                                                                      |
| `audit: run_id`, `window_start`, `window_end`, `source_object`, `source_connection`   | `elsewhere`                    | Another pack lands the files.                                                                                                      |
| `audit: loaded_at`, `row_hash`, `source_file`, `source_modified_at`                   | `not-applicable`               | A view adds no columns of its own.                                                                                                 |
| `operations`                                                                          | `not-applicable`               | Synapse serverless runs no jobs.                                                                                                   |
| `quality.rules` (every kind but two)                                                  | `used`, `onlyWhere: check`     | A condition in the view for drop, and a count in checks.sql, written from the rule.                                                |
| `quality.rules: pattern`                                                              | `not-applicable`               | serverless T-SQL has no regular expressions.                                                                                       |
| `quality.rules: items`                                                                | `not-applicable`               | views type no arrays.                                                                                                              |
| `quality.actions: warn`                                                               | `used`, `onlyWhere: check`     | The view keeps the row; checks.sql returns how many rows fail.                                                                     |
| `quality.actions: drop`                                                               | `used`, `onlyWhere: check`     | The view's WHERE leaves the row out; checks.sql counts how many rows fail.                                                         |
| `quality.actions: fail`                                                               | `not-applicable`               | a view can't stop a load; checks.sql checks this rule and raises an error when it runs.                                            |
| `quality.table-checks`                                                                | `used`, `onlyWhere: check`     | Counted in checks.sql over the rows the view keeps: fail raises an error, warn returns the count.                                  |
| `quality.quarantine`                                                                  | `not-applicable`               | a view keeps no rows to quarantine; checks.sql returns how many rows each drop check leaves out instead.                           |
| `quality.results`                                                                     | `not-applicable`               | a view keeps no results; checks.sql returns each check's counts instead when it runs.                                              |
| `cleanse.trim`, `empty`, `map`, `case`, `default`                                     | `used`                         | `TRIM()`, `NULLIF(<column>, '')`, a `CASE` expression, `UPPER()` or `LOWER()`, and `COALESCE()` in the view's `SELECT`.            |
| `cleanse.timezone`                                                                    | `used`, with `zonesNotApplied` | `AT TIME ZONE` with the zones' Windows names in the view's `SELECT`; each zone Windows has no name for is listed, with its reason. |
| `deduplicate`                                                                         | `used`                         | A `ROW_NUMBER()` subquery in the view keeps the last row per primary key.                                                          |

`onlyWhere: check` is met in a layer whose `does` is `raw` too (definitions
specification, section 5): there every action is `warn`, so the view keeps
every row and `checks.sql` counts the rows that fail.

The reasons of the quality entries follow the definitions package's message,
`<What> isn't applied on <pack>: <reason>.`, so they start in lower case.

The core judges `history`, `sequence`, `storage.*`, `retention.time_travel`,
`retention.log`, `rescued` and the quality and cleansing paths at the store step, which is
`synapse-view` here, so a table kept by it that asks for one gets a `NOT_APPLIED`
diagnostic with the reason above. The view is the step that writes the table and the
step that reads the files, so it is also where `loaded_at`, `row_hash`,
`source_file` and `source_modified_at` are judged; none of them is added. The ingest
step's audit values are the landing pack's to judge, and an entry that is missing or
`elsewhere` gives no diagnostic. `operations` is judged by the first pack in the
standard that declares an `operations` path used; Synapse never is.

The Platform's `synapse` section is empty: `platformSection` has no properties.

## Quality and cleansing

The model says what each table checks, cleanses and deduplicates (definitions
specification, sections 6 and 11.7). The pack writes it into the view of each
table `synapse-view` keeps, and counts the checks in `checks.sql`, as plain
T-SQL for serverless SQL pools. A table that `synapse-serve` serves is kept,
cleansed and checked by the pack that stores it, so its view has none of this.
The sources are in [references.md](references.md), under "Quality and
cleansing".

The order is the design's: each column is typed by the view (its `WITH`
clause, for a view over files; a transform's query types its own), then
cleansed; then the rows are deduplicated; then the row checks read them, so
checks see cleansed values. A table with no cleansing, no deduplicate and no
`drop` check has the view it had before checks existed.

### The view

`<base>` is the query a view had before, with each cleansed column selected
as its expression, `<expression> AS [<name>]`, in its place. With any cleansed
column, or the file column below, the select list has one column a line,
each indented two spaces:

- over files, `SELECT <columns> FROM OPENROWSET(…) WITH (…) AS [rows]`
  (section 4); with deduplicate, the select list ends with
  `[rows].filepath() AS [_ingestron_file]`, the file each row came from;
- over a transform, `SELECT <columns> FROM (<code>) AS [source]`.

With deduplicate, the rows are `<base>` numbered and the first of each key
kept, with `<outputs>` the contract's columns and then the columns the landing
step adds:

```sql
SELECT <outputs>
FROM (
SELECT *, ROW_NUMBER() OVER (PARTITION BY [<key>], … ORDER BY [<order_by>] DESC, …, [_ingestron_file] DESC) AS [_ingestron_row]
FROM (
<base>
) AS [cleansed]
) AS [numbered]
WHERE [_ingestron_row] = 1
```

Otherwise the rows are `<base>`. `<key>` is each primary key column, in the
contract's order, and `<order_by>` each `order_by` column, as written; a view
over files then orders by the file, last first, so the same row is kept each
time it is read; a transform has no file. T-SQL sorts null below every value,
so `DESC` puts nulls last, as Spark and DuckDB do.

With at least one `drop` check, the view keeps only the rows that pass every
`drop` check:

```sql
SELECT *
FROM (
<rows>
) AS [checked]
WHERE (<condition>)
  AND (<condition>)
```

A row whose condition is unknown (null) is left out: a row passes only when
its check is true. Otherwise the view is the rows. `warn` and `fail` checks
leave the view as it is: it keeps their rows.

### Cleansing

Each column in `cleanse.columns` is selected as an expression, each operation
applied to the result of the one before, in the model's order. `<x>` starts as
the column as `<base>` reads it, `[<name>]` (the file's name for it when the
ingest did not rename it):

| Operation  | Expression                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `timezone` | `CAST((CAST(<x> AS DATETIME2(7)) AT TIME ZONE '<from>') AT TIME ZONE '<to>' AS DATETIME2(7))`, with the zones' Windows names |
| `trim`     | `TRIM(<x>)`                                                                                                                  |
| `empty`    | `NULLIF(<x>, '')`                                                                                                            |
| `map`      | `CASE <x> WHEN <key> THEN <value> … ELSE <x> END`, the keys in the order written; a null value is `NULL`                     |
| `case`     | `UPPER(<x>)` or `LOWER(<x>)`                                                                                                 |
| `default`  | `COALESCE(<x>, <value>)`                                                                                                     |

A value is written for the column's `logicalType`: a number as it is for
`integer` and `number` (a `map` key, which is text, too, when it reads as a
number); `CAST(1 AS BIT)` or `CAST(0 AS BIT)` for `true` or `false` of a
`boolean`; `CAST('<text>' AS DATE)` for `date`; `CAST('<text>' AS DATETIME2(7))`
for `timestamp`; `NULL` for null; any other value as T-SQL text, `'<text>'`
with `'` doubled. A `boolean` is written as a cast, as the column is `BIT`
and an `int` would make the result `int`.

T-SQL compares text without the spaces at its end: `'GB '` equals `'GB'`.
So `NULLIF(<x>, '')` also turns a value of spaces into null, and a `map` key
or an `in` or `notIn` value matches a value with spaces after it. With `trim`
before them, as the standard's text cleansing has it, this makes no
difference; without it, Synapse can match where Databricks does not. Text
values take the database's code page, as `views.sql`'s other text does; a
database with a UTF-8 collation keeps every character.

**Time zones.** The column is cast to `DATETIME2(7)` first: a view over files
already types it so, and a transform's column may come out as text.
`<x> AT TIME ZONE '<from>'` then reads the column's wall-clock time in the zone
it was written in and gives a `datetimeoffset`;
`AT TIME ZONE '<to>'` converts it to the target zone, and the cast gives the
wall-clock time there as `DATETIME2(7)` again. T-SQL names zones by their
Windows names (`sys.time_zone_info`), so the pack maps each IANA name the
model gives to its Windows name with `src/zones/windows.json`:

- The table is generated by `pnpm zones` (`scripts/windows-zones.mjs`) from
  two files of the Unicode CLDR release named in it:
  `common/supplemental/windowsZones.xml` and `common/bcp47/timezone.xml`. It
  records the release, both files' addresses and the day they were read.
- Each `mapZone` of `windowsZones.xml` maps the IANA names in its `type` to
  the Windows zone in `other`. The `001` territory gives each Windows zone's
  main IANA name, and is read first; the other territories' lists add the
  IANA names of the places that share that Windows zone, such as
  `Europe/Dublin`. A name keeps the first Windows zone found for it.
- CLDR's `windowsZones.xml` uses one name for each zone, often the older one
  (`Asia/Calcutta`, `Europe/Kiev`). Each `type` of `timezone.xml` lists the
  names that are one zone in its `alias`, so every name in a group that has a
  Windows zone gets that zone: `Asia/Kolkata` and `Asia/Calcutta` are both
  `India Standard Time`, `Europe/Kyiv` and `Europe/Kiev` both
  `FLE Standard Time`, and `UTC` is `UTC`.
- `Europe/London` is `GMT Standard Time`.

A zone the table does not name has no Windows zone. Against the zones the
definitions package accepts, these are `Antarctica/Troll`, `CST6CDT`,
`EST5EDT`, `MST7MDT` and `PST8PDT`. The pack lists them in its
`cleanse.timezone` coverage entry, as `zonesNotApplied`, each with the reason
`Windows has no zone for <zone>.` (definitions specification, sections 6.3 and
11.5). So the definitions package reports a conversion from or to one of them
`NOT_APPLIED` at the column, `Time zone conversion isn't applied on synapse:
Windows has no zone for <zone>.`, and the column stays in its `from` zone: the
table keeps the zone it was in, and a later table converts it. The pack writes
no conversion for such a column; its expression starts from `<x>` itself. A
test checks that every listed zone is missing from the table.

Around a clock change, T-SQL moves a wall time in the hour that is skipped in
spring forward by the length of the gap and gives it the offset after the
change, and gives a wall time in the hour that happens twice in autumn the
offset before the change (summer time), as Microsoft's page documents. For `Europe/London` (`GMT Standard Time`) to
`UTC` in 2026:

| Wall time in London   | UTC                   |
| --------------------- | --------------------- |
| `2026-03-29 00:30:00` | `2026-03-29 00:30:00` |
| `2026-03-29 01:30:00` | `2026-03-29 01:30:00` |
| `2026-03-29 02:30:00` | `2026-03-29 01:30:00` |
| `2026-10-25 00:30:00` | `2026-10-24 23:30:00` |
| `2026-10-25 01:30:00` | `2026-10-25 00:30:00` |
| `2026-10-25 02:30:00` | `2026-10-25 02:30:00` |

DuckDB reads the repeated hour as the later one (`01:30` is `01:30` UTC), so
the engines differ in that hour; they agree everywhere else. Windows keeps
less of each zone's history than the IANA database does: where a zone's
rules changed in the past, Windows may not have the older rules, so times
from before such a change can convert differently on Synapse than on
Databricks and DuckDB. The pack cannot run T-SQL in its tests, so the table
above is the documented behaviour, not one the tests ran.

### Deduplicate

A table kept by `synapse-view` with `deduplicate` in the model keeps one row
per primary key, as "The view" above writes it. A view keeps nothing, so
there is no `upsert` or `append` for the definitions package to judge
redundant: deduplicate is the only way a view gives one row per key.

### Row checks

A table in a layer whose `does` lists `check` runs its expectations whose
rule the pack applies. So does a table in a layer whose `does` is `raw`:
every action there is `warn`, so its view keeps every row, as it was before
checks existed, and `checks.sql` counts the rows that fail each check. A
table in any other layer, including one that gives no `does`, runs none: its
view is what it was before checks existed, and the definitions package
reports each rule `NOT_APPLIED` with the hint to add `check` to the layer's
`does`. With
`<c>` the column in brackets and `<v>` a value (a number as it is, any other
value as T-SQL text), the condition a row passes is written from the
expectation's `rule`:

| `kind`       | Condition                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `notNull`    | `<c> IS NOT NULL`                                                                                                           |
| `in`         | `<c> IS NULL OR <c> IN (<v>, …)`; `<c> IS NOT NULL AND <c> IN (<v>, …)` without `allowNull`                                 |
| `notIn`      | as `in`, with `NOT IN`                                                                                                      |
| `length`     | `<c> IS NULL OR LEN(REPLACE(<c>, ' ', '_')) >= <min>`, and `<= <max>`                                                       |
| `range`      | `<c> IS NULL OR <c> >= <min>`, and `<c> <= <max>`; `>` and `<` when `exclusive`                                             |
| `multipleOf` | `<c> IS NULL OR <c> % <value> = 0` for an exact number; otherwise `<c> IS NULL OR <c> - FLOOR(<c> / <value>) * <value> = 0` |
| `pattern`    | not applied: serverless T-SQL has no regular expressions                                                                    |
| `items`      | not applied: views type no arrays                                                                                           |

A rule with more than one limit joins them with `AND` after `<c> IS NULL OR`.
These are the Databricks pack's conditions in T-SQL: null fails `notNull`,
passes `in` and `notIn` only with `allowNull`, and passes every other kind,
so no condition written from a rule is ever unknown. `NOT IN` is unknown when
the value or anything in the list is null; the definitions package never puts
null in the list (a listed null becomes `allowNull`), and the
`IS NULL OR` or `IS NOT NULL AND` before it decides a null value, so the
condition stays true or false. `LEN` leaves out the spaces at the end of a
text; each space is counted as `_`, so the length is every character's, as
Spark's `length` is. T-SQL's `%` takes only exact numbers (integers,
`decimal`, `numeric` and `money` types), so it is used when the view types the
column as one of those and the value is written without an exponent;
otherwise, as for `FLOAT` and for a transform's column, whose type the pack
does not know, the remainder is worked out with `FLOOR`. An expectation with
no `rule` (one a flow or transform writes) uses its `check` text, which is
T-SQL there.

`warn` keeps the row in the view and `checks.sql` counts it. `drop` leaves
the row out of the view, and `checks.sql` counts it. `fail` cannot be
applied: a view can't stop a load. The definitions package reports it
`NOT_APPLIED` with the reason "a view can't stop a load; checks.sql checks
this rule and raises an error when it runs.", the view keeps the row, and
`checks.sql` raises an error when any row fails it.

### Table checks

A table in a layer whose `does` lists `check` or is `raw` runs its contract's
table checks in `checks.sql` (in a `raw` layer, each as `warn`). The pack declares no `checks` capability, so the definitions
package gives a Synapse table its table checks (and `unique`) whatever the
Platform's `manage.checks` says (definitions specification, section 7.1).
Databricks and DuckDB count table checks over the table they store, after the
rows `drop` leaves out; so does this pack, over the rows the view keeps
(`<kept>`, under "checks.sql"). Each is counted with the metric Databricks
uses, in T-SQL:

| `metric`                       | Count                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `rowCount`                     | `COUNT_BIG(*)`                                                                                                  |
| `duplicateValues`, one column  | `COUNT_BIG(*) - COUNT_BIG(DISTINCT <c>)`                                                                        |
| `duplicateValues`, several     | `<kept count> - COUNT_BIG(*)` over `SELECT DISTINCT <c>, … FROM (<kept>) AS [rows] WHERE <c> IS NOT NULL AND …` |
| `duplicateValues`, whole row   | as several, over the contract's columns                                                                         |
| `nullValues`                   | `COUNT_BIG(CASE WHEN <c> IS NULL THEN 1 END)`                                                                   |
| `missingValues`                | `COUNT_BIG(CASE WHEN <c> IS NULL OR <c> IN (<v>, …) THEN 1 END)`; without a list, as `nullValues`               |
| `invalidValues`, `validValues` | `COUNT_BIG(CASE WHEN <c> IS NOT NULL AND NOT (<c> IN (<v>, …)) THEN 1 END)`                                     |
| `invalidValues`, `pattern`     | not applied: serverless T-SQL has no regular expressions (`NOT_APPLIED` for `pattern`)                          |
| `sql`                          | the rule's query, with `${object}` replaced by the view's name, `[<schema>].[<view>]`                           |

`COUNT_BIG(DISTINCT …)` leaves nulls out. Spark's `count(DISTINCT a, b)`
leaves out a row with a null part, so several columns, and the whole row,
count the distinct rows that have no null part, and every other row counts
as a duplicate, as on Databricks. A `sql` check reads the view, which gives the
same rows.

The rule compares the count, `ISNULL(<count>, 0)`, or with `unit: percent`
`CASE WHEN <kept count> = 0 THEN 0 ELSE ISNULL(<count>, 0) * 100.0 / <kept count> END`,
by its operator: `=`, `<>`, `>`, `>=`, `<`, `<=`, `BETWEEN <low> AND <high>`
and `NOT BETWEEN`. A table check's `fail` is applied: `checks.sql` raises an
error when it does not pass, and its `warn` returns the count.

### checks.sql

`checks.sql` is one batch, with no `GO`, so it runs as it is in sqlcmd, in an
Azure Data Factory or Synapse pipeline's Script activity, or in any tool
that sends T-SQL. It reads the files through `OPENROWSET` with the view's
columns and cleansing, not through the view, so its row checks also count the
rows a `drop` check leaves out of the view; its table checks count the rows the
view keeps. It is, line by line:

1. comments naming the project, and no environment, saying not to edit it,
   that it counts each row check's failing rows in the files the views read,
   the rows `drop` checks leave out included, and each table check over the
   rows the view keeps, returns one row per check, then raises an error for
   the first `fail` check that fails, and that it stops nothing unless it runs
   after each landing;
2. for each table that runs at least one check, in the model's order, `t`
   counting from 1:
   - `USE [<database>];` when the table's database is not the one before;
   - `-- <table>`, the table's name in the definitions;
   - `DECLARE @rows_<t> BIGINT, [@kept_<t> BIGINT, ]@check_<t>_1 BIGINT, …;`,
     a variable per check, its row checks first, then its table checks, `c`
     counting from 1. `@kept_<t>` is declared when the view has `drop` checks
     and table checks; `<kept count>` is then `@kept_<t>`, else `@rows_<t>`;
   - one `SELECT` that reads `<rows>` once and sets `@rows_<t>` to
     `COUNT_BIG(*)`, each row check's variable to
     `COUNT_BIG(CASE WHEN <condition> THEN NULL ELSE 1 END)`, the rows that
     fail it (a condition that is unknown fails), and, without `drop` checks,
     each table check's that is an aggregate to its count:
     ```sql
     SELECT
       @rows_<t> = COUNT_BIG(*),
       @check_<t>_<c> = <count>,
       …
     FROM (
     <rows>
     ) AS [rows];
     ```
   - with `drop` checks and table checks, a second `SELECT` of the same form
     over `<kept>`, which sets `@kept_<t>` to `COUNT_BIG(*)` and each table
     check's that is an aggregate to its count;
   - then, for each table check that is not an aggregate, a statement of its
     own: `SELECT @check_<t>_<c> = <kept count> - COUNT_BIG(*) FROM (SELECT DISTINCT … FROM (<kept>) …) AS [distinct_rows];`,
     or `SET @check_<t>_<c> = (<query>);` for a `sql` check;
3. one result, a `SELECT` per check joined by `UNION ALL`:
   `SELECT N'<schema>.<view>' AS [table], N'<name>' AS [check], N'<action>' AS [action], <failing> AS [failing_rows], CASE WHEN <passes> THEN 1 ELSE 0 END AS [passed]`,
   where for a row check `<failing>` is its variable and `<passes>` is
   `<failing> = 0`, and for a table check `<failing>` is
   `ISNULL(@check_<t>_<c>, 0)`, the number its rule compares (for `rowCount`,
   every row), and `<passes>` is its comparison;
4. for each `fail` check, in the same order,
   `IF <failing> > 0 THROW 50000, N'The check "<name>" failed on <schema>.<view>.', 1;`,
   or for a table check
   `IF NOT (<comparison>) THROW 50000, N'The table check "<name>" failed on <schema>.<view>.', 1;`.
   The first that fails ends the batch with that error; every count was
   returned before it.

`<rows>` is the view's rows before its `drop` checks: `<base>`, deduplicated
when the table deduplicates. `<kept>` is the view's query, the rows it keeps;
without `drop` checks, it is `<rows>`. Row checks count `<rows>`, so they also
count the rows a `drop` check leaves out; table checks count `<kept>`, as the
other packs count the table they store. Names and text in it, and the database, are
those of `views.sql`, with the same SQLCMD variables where environments
differ. A table that runs no check is not in `checks.sql`.

### Running checks.sql

The package README says how to run `checks.sql`: with sqlcmd and the
environment's checks wrapper, `sqlcmd -S <workspace>-ondemand.sql.azuresynapse.net -i checks/<environment>.sql`,
from the output folder; in a pipeline's Script activity, with each `$(…)`
replaced by the environment's value; or as a CI step. It stops nothing unless
it runs after each landing: a view reads the files each time it is queried,
and nothing runs `checks.sql` by itself.
