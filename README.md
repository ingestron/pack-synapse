# @ingestron/pack-synapse

The Azure Synapse serverless SQL pack: SQL views over the files a pack lands,
transforms written as views, and views over tables another pack stores, so
reporting tools such as Power BI read them as ordinary SQL tables. Name it in
your standard: `packs: [synapse@2]`.

One `views.sql` covers every environment. A value is a SQLCMD variable,
`$(name)`, only where environments differ, such as the database name;
everything the same in every environment is written as it is. Each environment
has a small script, `environments/<environment>.sql`, that sets those values
and runs `views.sql`, so a reviewer reads the views once and sees exactly what
changes between dev and prod.

```sh
npm install @ingestron/pack-synapse   # the ingestron CLI already includes it
```

## Methods

| Method          | Action    | Makes                                                                                           |
| --------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `synapse-view`  | store     | A view over the table's landed files, or over its transform's query. Nothing runs after a load. |
| `synapse-sql`   | transform | The transform's SQL in T-SQL, over other tables' views; `synapse-view` keeps it.                |
| `synapse-serve` | serve     | A view over the files another pack's store keeps, read from where that pack says.               |

Views read Parquet and CSV files through an external data source and type
each column from the contract. `views.sql` is re-runnable: it selects each
view's database with `USE`, and creates or alters each view. Views change only
when contracts, transforms or naming change.

## Views only

With a pack that lands files, such as ADF, Synapse can be the whole store.
List it first, even though ADF runs first: the order in `packs` is precedence,
and the first pack names and types the views, such as the database name
(`{{ project }}_{{ environment }}`) and the column types:

```yaml
packs: [synapse@2, adf@2]
store: { default: synapse-view }
```

To serve tables another pack stores, list Synapse after that pack and choose
`synapse-serve` for the tables to serve.

Name the external data source in `platform.yaml`, for each method you use:

```yaml
settings:
  synapse-view:
    data_source: landing
    data_source_location: abfss://landing@acct.dfs.core.windows.net
```

Every file a view reads must be under `data_source_location`. A view over files
that each load adds (ADF's `increments` layout) returns every load's rows; for
the current data only, land one file per table (`snapshot`).

`ingestron request` lists what the platform team creates: the serverless
database, the external data source with its managed-identity credential, the
workspace's read access to the storage, and report users' permissions.

## Columns and transforms

Each view's columns come from the contract, typed from their `logicalType`.
When Synapse is listed first, a column's `physicalType` is used as written, so
`DECIMAL(18,2)` keeps money exact; otherwise the type follows the
`logicalType`. Strings use the UTF-8 binary collation Microsoft recommends for
Parquet, so comparisons are case-sensitive. Parquet and CSV files with a header
are read by column name: a column the landing pack did not rename is read under
its `physicalName`.

A transform's SQL is one T-SQL query over its inputs' views, written
`{{ tables.<input> }}`. It sits inside the view, so it cannot start with `WITH`
or end with `ORDER BY` (a trailing `;` is dropped), and it names only tables
listed in `inputs`.

Columns the landed files carry beyond the contract, such as ADF's audit
columns, follow the contract's columns. They are read as text, and timestamps
are converted to `DATETIME2(7)`.

## Views or tables

|                             | Views (Synapse)                              | Tables (a store pack, served with `synapse-serve`) |
| --------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Runs after each load        | Nothing                                      | The store pack's job                               |
| Cost                        | Data scanned each time a report reads a view | The job's run time, plus data scanned when read    |
| Upsert, history             | No: the files as they are                    | Yes                                                |
| Heavy joins over large data | Recomputed on every read                     | Computed once per load                             |

## Settings

| Setting                | Where    | Means                                                                                                                                                                            |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data_source`          | platform | The external data source's name in the serverless database; one name, one location.                                                                                              |
| `data_source_location` | platform | Where it points, `abfss://<file system>@<account>.dfs.core.windows.net` or `https://<account>.dfs.core.windows.net/<file system>`; every file a view reads must be under it.     |
| `csv`                  | standard | `header` (default `true`) and `delimiter` (default `,`) for CSV files; when not set here, the landing step's CSV settings or reader options (ADF's `header` and `sep`) are used. |

`ingestron request` lists what the platform team creates: the serverless
database, a master key if it has none, the credential `<data_source>_identity`,
the external data source, the workspace's read access to the storage (with a
resource instance rule when the storage has a firewall), and report users'
permissions.

## One script for every environment

Most people use this through the [`ingestron`](https://www.npmjs.com/package/ingestron)
command, which writes the files to `build/synapse/`:

```text
build/synapse/
  views.sql
  environments/dev.sql
  environments/test.sql
  environments/prod.sql
```

In `views.sql`, the values that differ are variables:

```sql
USE [$(database)];
GO

IF SCHEMA_ID(N'bronze') IS NULL EXEC(N'CREATE SCHEMA [bronze]');
GO
CREATE OR ALTER VIEW [bronze].[orders] AS
SELECT *
FROM OPENROWSET(
  BULK 'erp/orders/orders.parquet',
  DATA_SOURCE = '$(data_source)',
  FORMAT = 'PARQUET'
) WITH (
  [id] BIGINT,
  [total] FLOAT
) AS [rows];
GO
```

Each environment's script sets them, then includes `views.sql`:

```sql
:on error exit
:setvar database "erp_prod"
:setvar data_source "landing"
:r views.sql
```

Variables are named after what they stand for: `database` (or
`database_<layer>` when an environment's views are in several databases),
`schema_<layer>`, `view_<table>`, `path_<table>`, `data_source`,
`delimiter_<table>`, and `value_<table>` for a value in a transform's code.
The rules are in [spec/behaviour.md](spec/behaviour.md).

In code:

```ts
import { loadDefinitions, type Pack, type ResolvedModel } from "@ingestron/definitions";
import { synapse } from "@ingestron/pack-synapse";

// The pack that lands the files, such as @ingestron/pack-adf.
declare const landing: Pack;

const models: Record<string, ResolvedModel> = {};
for (const environment of ["dev", "prod"]) {
  const result = loadDefinitions("definitions", {
    packs: [landing, synapse],
    environment,
    deployTime: true,
    environmentsTogether: true,
  });
  if (result.model) models[environment] = result.model;
}
const { files, problems } = synapse.buildEnvironments!(models);
for (const problem of problems) console.log(problem.code, problem.message);
for (const path of Object.keys(files)) console.log(path);
```

## Deploy

Run each environment's script with `sqlcmd` from the folder that holds
`views.sql`, the same files for every environment. sqlcmd reads the `:r`
path from the folder it starts in, not from the script's own folder:

```sh
cd build/synapse
sqlcmd -S <workspace>-ondemand.sql.azuresynapse.net -i environments/prod.sql
```

Replace `<workspace>` with your Synapse workspace's name, and add your sign-in
options, such as `--authentication-method ActiveDirectoryDefault` for
sqlcmd (Go). The script stops at the first error with a non-zero exit code,
so a CI step fails when a view does.

- **GitHub Actions:** a `run` step with `working-directory: build/synapse`.
  The Ubuntu runner has no sqlcmd, so install it first; the Windows runner has
  it.
- **Azure DevOps:** an `AzureCLI@2` step with
  `workingDirectory: build/synapse` that runs sqlcmd, so it runs signed in.

A value written as `${envvar:NAME}` in the definitions is supplied when
deploying: `views.sql` uses it as `$(NAME)`, and the scripts of the
environments that supply it leave it unset. Set `NAME` as an environment
variable of the deploy step, from a pipeline variable or secret; sqlcmd reads
it as a scripting variable. (`sqlcmd -v NAME=<value>` works too, except with
the ODBC sqlcmd on Linux and macOS, which has no `-v`.) The script stops if
the value is missing. The pack lists these values, with the name to set, in
`deployValues`.

sqlcmd puts the value into `views.sql` as it is, so it cannot hold `'` or `]`.
Only a whole value can be supplied this way: a `${envvar:…}` inside a longer
value, or in a transform's code, is refused. When the files and the data
source share one, such as the storage account in
`abfss://landing@${envvar:ACCOUNT}.dfs.core.windows.net`, `views.sql` needs no
variable for it.

## What changed in 2.0

- One `views.sql` in `build/synapse/`, with `environments/<environment>.sql`
  for each environment, in place of a `views.sql` per environment in
  `build/<environment>/`. Change the standard to `synapse@2`, then delete the
  old folders; `ingestron check` fails until they are gone.
- Deploy with `sqlcmd -i environments/<environment>.sql` from
  `build/synapse/`. `views.sql` with variables does not run on its own, so
  Synapse Studio cannot run it.
- `views.sql` starts with `USE [<database>]`, also when the views are in one
  database, so it no longer matters which database sqlcmd connects to.
- Databases, schemas and view names are as in 1.x, so the first 2.0 run
  alters each existing view in place. As in 1.x, nothing drops a view that is
  no longer generated.
- `${envvar:…}` values are supplied when deploying, not read when generating.
  Set them in the deploy step (see [Deploy](#deploy)).
- Environments may differ only in values: a table built in some environments
  only, files read in another format, or a transform's code that reads other
  inputs is `ENVIRONMENTS_DIFFER`. A value that differs cannot hold `'`, `]`
  or a line break, which sqlcmd would put into `views.sql` as they are. A view
  that would hold `$(` anywhere, in any environment, is refused: sqlcmd reads
  it as a variable.
- The header no longer names the environment.
- Needs `@ingestron/definitions` 1.8 or later.

## Sources

Synapse syntax and permissions follow Microsoft Learn, accessed 2026-11-01;
sqlcmd's commands, variables and variants follow Microsoft Learn and the
sqlcmd (Go) v1.10.0 source, accessed 2026-11-05. The pages are listed in
[spec/references.md](spec/references.md).

## Documentation

User documentation: https://docs.ingestron.io.

## Working on this pack

```sh
pnpm install
pnpm validate   # format, licences, lint, types, tests, README code and API report
```

Requires Node 22.13 or later and pnpm 10. How code is written here:
[CONTRIBUTING.md](CONTRIBUTING.md). Security: [SECURITY.md](SECURITY.md).

## Contact

Questions and feedback: hello@ingestron.io. Security reports: security@ingestron.io
(see [SECURITY.md](SECURITY.md)).

## Licence

Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE). Made by
[IntentLabs](https://intentlabs.dev).
