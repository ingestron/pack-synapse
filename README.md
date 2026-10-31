# @ingestron/pack-synapse

The Azure Synapse serverless SQL pack: SQL views over the files a pack lands,
transforms written as views, and views over tables another pack stores, so
reporting tools such as Power BI read them as ordinary SQL tables.

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
