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
  two variants, sqlcmd (Go) and the ODBC sqlcmd; the page says `-v` is
  Windows-only for the ODBC sqlcmd ("Linux and macOS aren't supported"), though
  `mssql-tools18` 18.7 on Linux takes it (checked below); `-b`; `-x` stops
  variables being replaced, and `-X` stops environment variables being read.
- [Authenticate with Microsoft Entra ID in sqlcmd](https://learn.microsoft.com/en-us/sql/tools/sqlcmd/sqlcmd-authentication)
  (ms.date 2025-07-02, commit `d39a258806d66d8fa5dac445820be065e582ce6f`):
  sqlcmd (Go)'s `--authentication-method ActiveDirectoryDefault` uses the Azure
  SDK's `DefaultAzureCredential`; the ODBC sqlcmd's `-G` signs in with a user
  name and password, Microsoft Entra integrated authentication, or an
  interactive prompt (not on Linux or macOS), and has no method that takes the
  Azure CLI's sign-in.
- Azure SDK for Go, `azidentity` at
  [v1.13.1](https://github.com/Azure/azure-sdk-for-go/blob/sdk/azidentity/v1.13.1/sdk/azidentity/default_azure_credential.go),
  the version sqlcmd (Go) v1.10.0's `go.mod` names: `DefaultAzureCredential`
  tries the environment, workload identity, managed identity, then the Azure
  CLI, the Azure Developer CLI and Azure PowerShell. So after `azure/login`, or
  inside `AzureCLI@2`, sqlcmd (Go) signs in as the pipeline.
- [Download and install the sqlcmd utility](https://learn.microsoft.com/en-us/sql/tools/sqlcmd/sqlcmd-download-install)
  (ms.date 2026-06-30, commit `d39a258806d66d8fa5dac445820be065e582ce6f`):
  `winget install sqlcmd`, `choco install sqlcmd`, `brew install sqlcmd`, and
  the release downloads; "Versions newer than 1.6 might not be available in all
  package managers", which is why CI downloads a pinned release.
- sqlcmd (Go)
  [v1.10.0 release](https://github.com/microsoft/go-sqlcmd/releases/tag/v1.10.0):
  `sqlcmd-linux-amd64.tar.bz2`, SHA-256
  `92516d98c63d99b0994de5b61350c91f6915f9b76f139a59039fbcb225c2e987`, and
  `sqlcmd-windows-amd64.zip`, SHA-256
  `a4c28332fcc6e497d655e53ac8f4939f4ab170f9cfd32d0fa5081b60f4d9d691`, as GitHub
  lists them and as the downloaded files hash.
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
- GitHub-hosted runner images:
  [Ubuntu 24.04](https://github.com/actions/runner-images/blob/799bcd0daf03c14c460e2662bcc9ca94a4a8aaa8/images/ubuntu/Ubuntu2404-Readme.md)
  (2026-10-28) lists no sqlcmd, but lists `bzip2`, `curl` and Azure CLI 2.91.0;
  [Windows Server 2025](https://github.com/actions/runner-images/blob/a2d4955654f519bd5b559bffaea60d9f90156630/images/windows/Windows2025-Readme.md)
  (2026-11-03) has sqlcmd only as the Visual Studio component
  `Microsoft.VisualStudio.Component.MSSQL.CMDLnUtils`, the ODBC sqlcmd. So
  every job installs sqlcmd (Go).
- [Microsoft-hosted agents for Azure Pipelines](https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted)
  (ms.date 2026-10-06, commit `3fc18de83c91dbccff78dbc06c3844be8115472d`): the
  agents' software is the runner images' (`ubuntu-latest` is Ubuntu 24.04,
  `windows-latest` Windows Server 2025).
- [AzureCLI@2](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/azure-cli-v2)
  (ms.date 2026-09-23, commit `34563609fbc5e6a84eb754a34872fce30209548a`): the
  script runs signed in with the service connection, in `workingDirectory`.
- [Logging commands](https://learn.microsoft.com/en-us/azure/devops/pipelines/scripts/logging-commands)
  (ms.date 2026-03-05, commit `1481c0d18812667ac57f38b2b70c34d924608ccc`):
  `##vso[task.prependpath]`; secret variables reach a script only when mapped
  in its `env`.
- GitHub,
  [workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands):
  a folder written to `GITHUB_PATH` comes before the rest of `PATH` in later
  steps.

Checked again on 2026-11-05 with the current ODBC sqlcmd, 18.7.0001.1
(`mssql-tools18` 18.7.1.1 on Ubuntu 22.04): it reads `:r views.sql` from the
folder it starts in and fails when started in `environments/`; it reads a value
from an environment variable; it stops at an unknown variable with exit code
1; and, unlike 13.1, it takes `-v` on Linux. The install commands in the
README were run as written: the Linux one on Ubuntu 24.04, giving sqlcmd (Go)
v1.10.0, and the Windows one in PowerShell 7.4.22 (on Linux, as no Windows
host was available), each checking the release's SHA-256.

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

## Quality and cleansing

Accessed 2026-11-10. Each Microsoft Learn page is pinned by its `ms.date` and
the source commit its metadata reports (`git_commit_id`). Every T-SQL page
below lists Azure Synapse Analytics under "Applies to", except `USE`, which
the feature page below covers for serverless SQL pools. The pack cannot run
T-SQL in its tests (no Synapse workspace, no cloud), so each form is checked
against these pages, and the tests check the text the pack writes.

- [T-SQL feature differences in Synapse SQL](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/overview-features)
  (ms.date 2026-10-05, commit `14120b58fa737dafeda3680f8cdd66a48ac9becc`):
  serverless SQL pools support every T-SQL date and time, mathematical,
  logical, conversion and string function, every built-in aggregate, every
  operator, every control-of-flow statement, and `USE`; they do not support
  table variables, and a temporary table cannot take rows from external
  data. So `checks.sql` keeps its counts in scalar variables.
- [AT TIME ZONE](https://learn.microsoft.com/en-us/sql/t-sql/queries/at-time-zone-transact-sql)
  (ms.date 2026-09-20, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  a `datetime2` without an offset is taken to be in the named zone and gives
  a `datetimeoffset`; a `datetimeoffset` is converted to the named zone; zone
  names are Windows names, listed in `sys.time_zone_info`; in the skipped
  hour a time is moved forward and given the offset after the change, and in
  the repeated hour it is given the offset before the change.
- [sys.time_zone_info](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-time-zone-info-transact-sql)
  (ms.date 2024-11-25, commit `6c26474bf9bd778405f06d4962f8253dbc340a90`):
  the zones `AT TIME ZONE` takes, by their Windows names.
- [CAST and CONVERT](https://learn.microsoft.com/en-us/sql/t-sql/functions/cast-and-convert-transact-sql)
  (ms.date 2026-10-13, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  `CAST(<datetimeoffset> AS DATETIME2(7))` keeps the date and time and drops
  the offset; `CAST(<x> AS DATETIME2(7))` reads text in an ISO 8601 form as a
  date and time, so a transform's column that comes out as text converts;
  `CAST('<text>' AS DATE)`, `CAST('<text>' AS DATETIME2(7))` and
  `CAST(1 AS BIT)`.
- [Data type precedence](https://learn.microsoft.com/en-us/sql/t-sql/data-types/data-type-precedence-transact-sql)
  (ms.date 2026-10-13, commit `4e3c79e97cd8a72ca8d7162583f5f9163fd81891`) and
  [bit](https://learn.microsoft.com/en-us/sql/t-sql/data-types/bit-transact-sql)
  (ms.date 2024-09-24, commit `4e3c79e97cd8a72ca8d7162583f5f9163fd81891`):
  `int` ranks above `bit`, so a `boolean` value is written as a cast to `BIT`.
- [TRIM](https://learn.microsoft.com/en-us/sql/t-sql/functions/trim-transact-sql)
  (ms.date 2025-08-26, commit `5f220f578385645cd005eed84f5b6881817b1c81`):
  removes the space character from both ends by default.
- [NULLIF](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/nullif-transact-sql)
  (ms.date 2017-09-08, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`),
  [CASE](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/case-transact-sql)
  (ms.date 2025-09-18, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`),
  [UPPER](https://learn.microsoft.com/en-us/sql/t-sql/functions/upper-transact-sql)
  and [LOWER](https://learn.microsoft.com/en-us/sql/t-sql/functions/lower-transact-sql)
  (both ms.date 2017-03-13, commit `5f220f578385645cd005eed84f5b6881817b1c81`),
  [COALESCE](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/coalesce-transact-sql)
  (ms.date 2025-01-28, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`) and
  [ISNULL](https://learn.microsoft.com/en-us/sql/t-sql/functions/isnull-transact-sql)
  (ms.date 2024-08-02, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  the cleansing expressions, and a count that may be null read as 0.
- [= (String comparison or assignment)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/string-comparison-assignment)
  (ms.date 2023-06-07, commit `5f220f578385645cd005eed84f5b6881817b1c81`):
  T-SQL pads strings to the same length before comparing them, so `'abc'`
  and `'abc '` are equal; only `LIKE` differs.
- [LEN](https://learn.microsoft.com/en-us/sql/t-sql/functions/len-transact-sql)
  (ms.date 2025-10-20, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  counts characters, leaving out spaces at the end; and
  [REPLACE](https://learn.microsoft.com/en-us/sql/t-sql/functions/replace-transact-sql)
  (ms.date 2017-08-23, commit `5f220f578385645cd005eed84f5b6881817b1c81`), so
  `LEN(REPLACE(<c>, ' ', '_'))` counts them too.
- [% (Modulus)](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/modulo-transact-sql)
  (ms.date 2024-03-19, commit `5f220f578385645cd005eed84f5b6881817b1c81`):
  the dividend and the divisor must be of the integer or monetary types, or
  `numeric`; and
  [FLOOR](https://learn.microsoft.com/en-us/sql/t-sql/functions/floor-transact-sql)
  (ms.date 2025-11-21, commit `4e3c79e97cd8a72ca8d7162583f5f9163fd81891`),
  which takes approximate numbers too.
- [IN](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/in-transact-sql)
  (ms.date 2016-08-29, commit `5f220f578385645cd005eed84f5b6881817b1c81`):
  a null compared with `IN` or `NOT IN` gives UNKNOWN; and
  [NULL and UNKNOWN](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/null-and-unknown-transact-sql)
  (ms.date 2024-09-12, commit `5f220f578385645cd005eed84f5b6881817b1c81`):
  how `AND`, `OR` and `NOT` treat UNKNOWN.
- [BETWEEN](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/between-transact-sql)
  (ms.date 2025-01-27, commit `5f220f578385645cd005eed84f5b6881817b1c81`).
- [ROW_NUMBER](https://learn.microsoft.com/en-us/sql/t-sql/functions/row-number-transact-sql)
  (ms.date 2026-06-15, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`) and
  the [OVER clause](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql)
  (ms.date 2026-06-12, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  `ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)`; the order decides which
  row is first only when it is unique within the key.
- [ORDER BY clause](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql)
  (ms.date 2026-09-16, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  null is the lowest value, so `DESC` puts it last.
- [Use file metadata in queries](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/query-specific-files)
  (ms.date 2025-01-17, commit `6a58509277011b7b5cfe0ee0ed75f162d88af843`):
  `<alias>.filepath()` gives the path of the file each row of `OPENROWSET`
  came from.
- [COUNT_BIG](https://learn.microsoft.com/en-us/sql/t-sql/functions/count-big-transact-sql)
  (ms.date 2026-01-19, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  `COUNT_BIG(*)` counts every row; `COUNT_BIG(<expression>)` the non-null
  values; `DISTINCT` takes one expression and leaves nulls out.
- [DECLARE @local_variable](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/declare-local-variable-transact-sql)
  (ms.date 2025-08-14, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`),
  [SELECT @local_variable](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/select-local-variable-transact-sql)
  (ms.date 2026-05-07, commit `5f220f578385645cd005eed84f5b6881817b1c81`):
  one `SELECT` sets several variables; and
  [SET @local_variable](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/set-local-variable-transact-sql)
  (ms.date 2026-05-07, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`).
  A variable lasts for the batch, so `checks.sql` is one batch.
- [USE](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/use-transact-sql)
  (ms.date 2026-10-28, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  `USE` takes effect at once, so the statements after it in the same batch
  run in that database.
- [IF...ELSE](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/if-else-transact-sql)
  (ms.date 2024-05-17, commit `5f220f578385645cd005eed84f5b6881817b1c81`),
  [THROW](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/throw-transact-sql)
  (ms.date 2024-07-26, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`;
  without `TRY…CATCH`, `THROW` ends the batch) and
  [UNION](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-union-transact-sql)
  (ms.date 2017-08-07, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`).
- [Script activity](https://learn.microsoft.com/en-us/azure/data-factory/transform-data-using-script)
  (ms.date 2025-08-01, commit `23a90c50b71cd0196cd4fad079078ffe32235e6a`):
  runs one or more SQL statements against Azure Synapse Analytics in a
  Data Factory or Synapse pipeline, and returns their result sets.

Checked locally on 2026-11-10, with synthetic rows and no cloud access, on a
local SQL Server engine (Azure SQL Edge 15.0.2000.1574), with `OPENROWSET`
replaced by an inline `VALUES` table, which that engine has instead: the
`checks.sql` of a table with a required key under `drop`, `unique: true` and
`rowCount > 0` counts one failing row for the not-null check, `0` duplicates
for `unique` with one null-id row among the files, and `rowCount` `0`, not
passed, when every row has a null id. That engine has no `AT TIME ZONE` (it
needs the CLR, which Azure SQL Edge does not enable), so the time zone forms
rest on the pages above.

Windows zone names come from the Unicode CLDR, release 49 (published
2026-10-21), read on 2026-11-10 by `scripts/windows-zones.mjs`:

- [`common/supplemental/windowsZones.xml`](https://raw.githubusercontent.com/unicode-org/cldr/release-49/common/supplemental/windowsZones.xml):
  each `mapZone` maps a Windows zone (`other`) to the IANA names of a
  territory (`type`, space-separated); territory `001` gives the Windows
  zone's main IANA name.
- [`common/bcp47/timezone.xml`](https://raw.githubusercontent.com/unicode-org/cldr/release-49/common/bcp47/timezone.xml):
  each `type` lists in `alias` the IANA names that are one zone, such as
  `Asia/Calcutta Asia/Kolkata`.
- The CLDR [release 49 tag](https://github.com/unicode-org/cldr/releases/tag/release-49),
  the latest release on 2026-11-10.

## Access

Accessed 2026-11-11. Each Microsoft Learn page is pinned by its `ms.date` and
the source commit its metadata reports (`git_commit_id`). The pack cannot run
T-SQL against Synapse in its tests (no workspace, no cloud), so each form is
checked against these pages, and the tests check the text the pack writes.

- [T-SQL feature differences in Synapse SQL](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/overview-features)
  (ms.date 2026-10-05, commit `14120b58fa737dafeda3680f8cdd66a48ac9becc`):
  serverless SQL pools support database users, and GRANT, DENY and REVOKE on
  schemas and objects; they have no row-level security and no data masking,
  for which the page suggests wrapper views; they support every string
  function, every built-in aggregate and every control-of-flow statement; the
  cursor type and table variables are not supported. So `access.masks` and
  `access.filters` are `not-applicable`, and exact grants use no cursor.
- [System views supported in Synapse SQL](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/reference-tsql-system-views)
  (ms.date 2020-04-15, updated 2026-05-03, commit
  `6a58509277011b7b5cfe0ee0ed75f162d88af843`): "Synapse serverless SQL pool
  supports SQL Server catalog views only", and the list of those views
  includes `sys.database_permissions`, `sys.database_principals`,
  `sys.objects` and `sys.schemas`.
- [sys.database_permissions](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-database-permissions-transact-sql)
  (ms.date 2026-05-26, commit `cf9e6fbc58f7b72c5f278a42796b74394ad059e4`;
  applies to Azure Synapse Analytics): one row per permission; `class` 1 is an
  object or column, `major_id` the object's id, `minor_id` 0 the object itself
  and otherwise a column; `state` `D` deny, `R` revoke, `G` grant, `W` grant
  with grant option; `permission_name`; `grantee_principal_id` joins
  `sys.database_principals`; example C finds the permissions on one object by
  joining `sys.objects` and `sys.schemas` by name. The permissions of fixed
  database roles are not rows, and neither is ownership.
- [GRANT Object Permissions](https://learn.microsoft.com/en-us/sql/t-sql/statements/grant-object-permissions-transact-sql)
  (ms.date 2025-04-09, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`;
  applies to Azure Synapse Analytics): `GRANT SELECT ON OBJECT::schema.view TO
principal`, for views too; the grantor needs the permission with GRANT
  OPTION or one that implies it, such as CONTROL.
- [REVOKE](https://learn.microsoft.com/en-us/sql/t-sql/statements/revoke-transact-sql)
  (ms.date 2017-07-26, commit `cf9e6fbc58f7b72c5f278a42796b74394ad059e4`;
  applies to Azure Synapse Analytics): the syntax for Azure Synapse Analytics
  is `REVOKE <permission> ON [OBJECT ::] securable FROM principal [CASCADE]`;
  revoking a permission granted WITH GRANT OPTION fails without CASCADE, so
  exact grants keep those; principals with CONTROL on a securable, and object
  owners, can revoke on it. The page on
  [REVOKE Object Permissions](https://learn.microsoft.com/en-us/sql/t-sql/statements/revoke-object-permissions-transact-sql)
  (ms.date 2017-08-10, commit `3788e363569c9a5af042c9b4f688384852d2d144`)
  lists only SQL Server and Azure SQL Managed Instance under "Applies to", so
  the pack writes only the form the general page gives for Azure Synapse
  Analytics.
- [EXECUTE](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/execute-transact-sql)
  (ms.date 2025-08-28, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`):
  the syntax for Azure Synapse Analytics includes `EXEC ( @string_variable )`.
- [STRING_AGG](https://learn.microsoft.com/en-us/sql/t-sql/functions/string-agg-transact-sql)
  (ms.date 2025-07-16, commit `a52ca41720ddecda8407b735a031a8559e75bf8c`;
  applies to Azure Synapse Analytics): an `NVARCHAR(MAX)` input gives
  `NVARCHAR(MAX)`; null values are left out.
- [COLLATE](https://learn.microsoft.com/en-us/sql/t-sql/statements/collations)
  (ms.date 2025-03-03, commit `739c7b1c14a03b2bf4a07d463e6ff31433962f43`;
  applies to Azure Synapse Analytics): `COLLATE database_default` casts an
  expression to the current database's collation.
- [QUOTENAME](https://learn.microsoft.com/en-us/sql/t-sql/functions/quotename-transact-sql)
  (ms.date 2026-04-08, commit `5f220f578385645cd005eed84f5b6881817b1c81`;
  applies to Azure Synapse Analytics): brackets by default, with `]` doubled;
  the input is `sysname`, which a principal's name is.
- [SQL authentication in Azure Synapse Analytics](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/sql-authentication)
  (ms.date 2024-11-07, commit `6a58509277011b7b5cfe0ee0ed75f162d88af843`):
  in a serverless database, `CREATE USER [mike@contoso.com] FROM EXTERNAL
PROVIDER`; `CREATE USER` is not supported when the workspace has Microsoft
  Entra-only authentication.
- [Control storage account access for serverless SQL pool](https://learn.microsoft.com/en-us/azure/synapse-analytics/sql/develop-storage-files-storage-access-control)
  (ms.date 2025-01-22, commit `6a58509277011b7b5cfe0ee0ed75f162d88af843`):
  a database user who accesses storage needs REFERENCES on the credential,
  and "can read the content of the files from the data source using external
  table or OPENROWSET function that references the data source". So the
  request says plainly that the rights a view over files needs reach the
  files too.

Checked locally on 2026-11-11, with synthetic users and no cloud access, on a
local SQL Server engine (Azure SQL Edge 15.0.2000.1574), with the view over a
`VALUES` table in place of `OPENROWSET`. The first form of the exact grants
batch failed there with "Cannot resolve collation conflict for string_agg
operation": `permission_name` is `Latin1_General_CI_AS_KS_WS` and a
principal's `name` the database's collation, so both are now put in the
database's collation. With grants to the view's own principals, `ALTER` to
one of them, `SELECT` and `VIEW DEFINITION` to another user, `SELECT` on the
schema, `SELECT` with grant option, a `DENY`, a column `SELECT` and a
`SELECT` to a role, the batch revoked exactly the `ALTER`, the other user's
two permissions and the role's `SELECT`; a second run revoked nothing.
