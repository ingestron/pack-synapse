# @ingestron/pack-synapse

The Azure Synapse serverless SQL pack: SQL views over the files a pack lands,
transforms written as views, and views over tables another pack stores, so
reporting tools such as Power BI read them as ordinary SQL tables.

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

With a pack that lands files, such as ADF, Synapse can be the whole store:

```yaml
packs: [adf@1, synapse@1]
store: { default: synapse-view }
```

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

## Views or tables

|                             | Views (Synapse)                              | Tables (a store pack, served with `synapse-serve`) |
| --------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Runs after each load        | Nothing                                      | The store pack's job                               |
| Cost                        | Data scanned each time a report reads a view | The job's run time, plus data scanned when read    |
| Upsert, history             | No: the files as they are                    | Yes                                                |
| Heavy joins over large data | Recomputed on every read                     | Computed once per load                             |

## Example

```ts
import { loadDefinitions, type Pack } from "@ingestron/definitions";
import { synapse } from "@ingestron/pack-synapse";

// The pack that lands the files, such as @ingestron/pack-adf.
declare const landing: Pack;

const result = loadDefinitions("definitions", { packs: [landing, synapse], environment: "prod" });
if (result.model) console.log(synapse.build(result.model)["views.sql"] ?? "");
```

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
