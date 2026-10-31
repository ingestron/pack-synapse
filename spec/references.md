# References

Synapse syntax used by this pack, accessed 2026-11-01:

- [Query Parquet files using serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/query-parquet-files):
  `OPENROWSET(BULK …, DATA_SOURCE = …, FORMAT = 'PARQUET') WITH (…)`; Parquet
  strings are UTF-8, so string columns use `COLLATE Latin1_General_100_BIN2_UTF8`;
  explicit column types instead of the inferred `VARCHAR(8000)`.
- [Reading UTF-8 text from CSV or Parquet files](https://learn.microsoft.com/en-us/azure/synapse-analytics/troubleshoot/reading-utf8-text):
  why a UTF-8 collation is needed, and that `Latin1_General_100_CI_AS_SC_UTF8`
  avoids an "Unclosed quotation mark" error some data meets with the BIN2 collation.
- [How to use OPENROWSET in serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/develop-openrowset):
  CSV with `PARSER_VERSION = '2.0'`, `HEADER_ROW = TRUE` (columns in `WITH` then
  bind by name) and `FIELDTERMINATOR`; wildcards in `BULK` paths.
- [Query CSV files](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/query-single-csv-file):
  `HEADER_ROW = TRUE` with parser 2.0.
- [Create and use views in serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/create-use-views):
  views over `OPENROWSET` with a typed `WITH` clause; `CREATE OR ALTER VIEW`.
- [Access files on storage in serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/develop-storage-files-overview):
  external data sources and the paths relative to them.
- [Control storage account access for serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/develop-storage-files-storage-access-control):
  a database scoped credential `WITH IDENTITY = 'Managed Identity'`; querying
  through a data source with a credential needs REFERENCES on the credential and
  ADMINISTER DATABASE BULK OPERATIONS.
- [Build a logical data warehouse with serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/tutorial-logical-data-warehouse):
  granting REFERENCES on the credential when users read through views.
