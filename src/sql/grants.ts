// The T-SQL of a view's access (spec/behaviour.md, "Access"): GRANT SELECT to each principal,
// and, for exact grants, one batch that revokes every other plain grant made on the view
// itself, found in sys.database_permissions and run as dynamic T-SQL.
import { literal, quote } from "./sql.js";

/** A view, by its two-part name. */
export interface ViewName {
  schema: string;
  name: string;
}

const objectOf = (view: ViewName) => `OBJECT::${quote(view.schema)}.${quote(view.name)}`;

/**
 * `GRANT SELECT` on the view to each principal, one a line, then `GO`.
 * @example grantStatements({ schema: "bronze", name: "orders" }, ["ops]admins"])
 */
export function grantStatements(view: ViewName, principals: readonly string[]): string {
  const grants = principals.map(
    (principal) => `GRANT SELECT ON ${objectOf(view)} TO ${quote(principal)};`,
  );
  return [...grants, "GO"].join("\n");
}

/**
 * The batch that revokes each permission granted directly on the view, other than SELECT to
 * `kept`. Only plain grants on the object itself are revoked: never a DENY, a permission given
 * WITH GRANT OPTION, one on a column, schema or database, ownership, which is not a row, or
 * one granted to the user that runs the script.
 * @example revokeStatement({ schema: "bronze", name: "orders" }, ["marketing-analysts"])
 */
export function revokeStatement(view: ViewName, kept: readonly string[]): string {
  const revoke = `N${literal(` ON ${objectOf(view)} FROM `)}`;
  const conditions = [
    "WHERE [permissions].[class] = 1",
    "  AND [permissions].[minor_id] = 0",
    "  AND [permissions].[state] = 'G'",
    `  AND [schemas].[name] = N${literal(view.schema)}`,
    `  AND [objects].[name] = N${literal(view.name)}`,
    // Only names of plain words reach the statement.
    "  AND [permissions].[permission_name] NOT LIKE N'%[^A-Z ]%'",
    // The user that runs the script: SQL Server refuses to revoke from yourself.
    "  AND [principals].[name] <> USER_NAME()",
    ...(kept.length > 0
      ? [
          `  AND NOT ([permissions].[permission_name] = N'SELECT' AND [principals].[name] IN (${kept.map((principal) => `N${literal(principal)}`).join(", ")}))`,
        ]
      : []),
  ];
  // The catalog views' names have collations of their own; joined, they would conflict.
  return [
    "DECLARE @revoke NVARCHAR(MAX);",
    `SELECT @revoke = STRING_AGG(CONVERT(NVARCHAR(MAX), N'REVOKE ' + [permissions].[permission_name] COLLATE DATABASE_DEFAULT + ${revoke} + QUOTENAME([principals].[name]) COLLATE DATABASE_DEFAULT + N';'), N' ')`,
    "FROM sys.database_permissions AS [permissions]",
    "JOIN sys.database_principals AS [principals] ON [principals].[principal_id] = [permissions].[grantee_principal_id]",
    "JOIN sys.objects AS [objects] ON [objects].[object_id] = [permissions].[major_id]",
    "JOIN sys.schemas AS [schemas] ON [schemas].[schema_id] = [objects].[schema_id]",
    `${conditions.join("\n")};`,
    "IF @revoke IS NOT NULL EXEC (@revoke);",
    "GO",
  ].join("\n");
}
