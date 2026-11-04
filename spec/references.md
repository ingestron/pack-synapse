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
- [Create a master key](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-master-key-transact-sql)
  a database scoped credential needs the database's
  master key.
- [Configure Azure Storage firewalls](https://learn.microsoft.com/en-us/azure/storage/common/storage-network-security)
  resource instance rules let a Synapse workspace through
  the storage firewall.
- [Query folders and multiple files](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/query-folders-multiple-csv-files)
  `**` reads a folder's subfolders only at the end of
  the path.
- [T-SQL feature differences in Synapse SQL](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/overview-features):
  serverless SQL supports cross-database queries with three-part names, and `USE`.

## sqlcmd and deploying with it

Accessed 2026-11-05. Each Microsoft Learn page is pinned by its `ms.date` and
the source commit the page reports in its metadata (`git_commit_id`).

- [Commands in the sqlcmd utility](https://learn.microsoft.com/en-us/sql/tools/sqlcmd/sqlcmd-commands)
  (ms.date 2026-04-22, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  commands start a line and are case-insensitive; "sqlcmd reads _filename_
  relative to the startup directory" for `:r`, so a wrapper is run from the
  folder that holds `views.sql`; a file whose statements do not end with `GO`
  needs a `GO` after `:r`; `:On Error exit` makes sqlcmd exit with an error
  value; `:Setvar` values with spaces are quoted.
- [Use sqlcmd with scripting variables](https://learn.microsoft.com/en-us/sql/tools/sqlcmd/sqlcmd-use-scripting-variables)
  (ms.date 2025-07-02, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  `$(name)`; the precedence, low to high, of environment variables,
  `sqlcmd -v` and `:setvar`; names have no white space or quotation marks and
  are case-insensitive; a quotation mark in a value is doubled; a variable is
  replaced inside a string (example F); a variable that is not set is an
  error.
- [sqlcmd utility](https://learn.microsoft.com/en-us/sql/tools/sqlcmd/sqlcmd-utility)
  (ms.date 2026-10-10, commit `55c5c399c027f95352041bfd268df8b4de04d716`): the
  two variants, sqlcmd (Go) and the ODBC sqlcmd; `-v` is Windows-only for the
  ODBC sqlcmd ("Linux and macOS aren't supported"), which is why the deploying
  pipeline supplies a value as an environment variable; `-b`; `-x`.
- sqlcmd (Go) source at tag
  [v1.10.0](https://github.com/microsoft/go-sqlcmd/tree/v1.10.0) (commit
  `affbc17e1e0e97b0bb625ef8185afea3d746067f`, released 2026-03-03, the latest
  on 2026-11-05): `pkg/sqlcmd/variables.go` (`ValidIdentifier`: a letter or
  `_`, then letters, digits, `_` and `-`; `ParseValue`: a quoted value with
  `""` for `"`), `pkg/sqlcmd/batch.go` (variables are replaced inside `'…'`,
  `"…"` and `[…]`, not in comments; a `$(` that starts no variable is a syntax
  error), `pkg/sqlcmd/commands.go` and `pkg/sqlcmd/sqlcmd.go` (`:r` opens its
  path from the process's working folder; an environment variable is looked
  up under the name as written; an unknown variable is left in the text with a
  message, and the batch still runs, which is why a wrapper checks a value the
  pipeline supplies).
- [THROW](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/throw-transact-sql)
  (ms.date 2024-07-26, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  applies to Azure Synapse Analytics; error numbers from 50000; severity 16;
  the statement before it ends with `;`.
- [T-SQL feature differences in Synapse SQL](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/overview-features)
  (ms.date 2026-10-05, commit `14120b58fa737dafeda3680f8cdd66a48ac9becc`):
  serverless SQL pools support `USE`, three-part names and every
  control-of-flow statement.
- GitHub-hosted runner images,
  [Ubuntu 24.04](https://github.com/actions/runner-images/blob/799bcd0daf03c14c460e2662bcc9ca94a4a8aaa8/images/ubuntu/Ubuntu2404-Readme.md)
  (2026-10-28) lists no sqlcmd, and
  [Windows Server 2025](https://github.com/actions/runner-images/blob/a2d4955654f519bd5b559bffaea60d9f90156630/images/windows/Windows2025-Readme.md)
  (2026-11-03) lists the SQL Server command-line utilities, so a Linux job
  installs sqlcmd first.

Checked locally on 2026-11-05, with synthetic fixtures and no cloud access:
sqlcmd (Go) 1.10.0 and the ODBC sqlcmd 13.1 (`mssql-tools` 14.0.6.0) both read
`:r views.sql` from the folder they start in and fail to find it when started
in `environments/`; both read a value from an environment variable; the ODBC
sqlcmd on Linux refuses `-v`; sqlcmd (Go) runs on past an unknown variable
with exit code 0, even with `-b` and `:on error exit`, and the wrapper's check
stops it with exit code 1. Run against a local SQL Server engine (Azure SQL
Edge 15.0.2000.1574), the wrappers of the test fixture set each environment's
values and create its views; that engine has no Synapse `OPENROWSET`
options, so those were replaced for the run.
