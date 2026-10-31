# Security

## Report a vulnerability

Email security@ingestron.io. Do not open a public issue. Include the version of
@ingestron/pack-synapse, what you ran, and the smallest definitions that reproduce the problem.
We acknowledge reports within five working days and agree a disclosure date
with you.

## Supported versions

Security fixes go into the latest `1.x` release.

## Design

The pack turns a resolved model into a T-SQL script of views. It makes no
network calls, runs no code from the definitions, and writes no secrets: views
read storage through an external data source whose credential the platform
team creates.

Dependencies are pinned exactly and updated one reviewed change at a time;
`pnpm validate` checks their licences.
