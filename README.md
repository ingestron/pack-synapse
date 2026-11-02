# @ingestron/pack-synapse

The Azure Synapse serverless SQL pack: SQL views over the files a pack lands,
transforms written as views, and views over tables another pack stores, so
reporting tools such as Power BI read them as ordinary SQL tables.

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
each column from the contract. The pack writes one re-runnable script per
environment, `views.sql`; run it at deploy time, with Synapse Studio, `sqlcmd`
or a CI step, against the serverless database that holds the views. Views
change only when contracts, transforms or naming change.

## Views only

With a pack that lands files, such as ADF, Synapse can be the whole store.
List it first, even though ADF runs first: the order in `packs` is precedence,
and the first pack names and types the views, such as the database name
(`{{ project }}_{{ environment }}`) and the column types:

```yaml
packs: [synapse@1, adf@1]
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

## Example

```ts
import { loadDefinitions, type Pack } from "@ingestron/definitions";
import { synapse } from "@ingestron/pack-synapse";

// The pack that lands the files, such as @ingestron/pack-adf.
declare const landing: Pack;

const result = loadDefinitions("definitions", { packs: [landing, synapse], environment: "prod" });
if (result.model) console.log(synapse.build(result.model)["views.sql"] ?? "");
```

## Sources

Synapse syntax and permissions follow Microsoft Learn, accessed 2026-11-01;
the pages are listed in [spec/references.md](spec/references.md).

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
