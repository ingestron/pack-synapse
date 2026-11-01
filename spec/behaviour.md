# Azure Synapse serverless SQL views

## Methods

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

## Settings

`data_source` and `data_source_location` (platform) name the external data
source; the location is `abfss://<file system>@<account host>[/path]` or
`https://<account host>[/path]`, and the two forms, and any case of the
account host, name the same place. `csv` (standard) sets `header` (default
`true`) and `delimiter` (default `,`); when the Synapse step does not set it,
the landing step's own `csv` settings are used.

## views.sql

One script per environment, `views.sql`, holds a view for each table kept by
`synapse-view` or served by `synapse-serve`, in the model's order, so a
transform's view follows its inputs'. Each view is preceded by a statement that
creates its schema when missing, is written `CREATE OR ALTER VIEW`, and ends
with `GO`, so the script can run again. When the views are in more than one
database, each database's views follow `USE [<database>];` and `GO`. A project
with no such table gets no script.

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

## Checks

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

## Contracts

Columns and their types are used; `required`, quality rules, relationships and
tags are not used yet (views check no rows); the other facts are
documentation.

## Request

Sections for the serverless database; the external data source, with a master
key when the database has none, the managed-identity database scoped credential
`<data_source>_identity`, the workspace's Storage Blob Data Reader access, and a
resource instance rule when the storage account has a firewall; and report
users' SELECT on the schemas, REFERENCES on the credential and ADMINISTER
DATABASE BULK OPERATIONS.
