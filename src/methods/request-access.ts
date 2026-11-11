// What the platform team does for the views' grants (spec/behaviour.md, "Access"): each
// principal as a database user with the rights views over files need, said plainly to reach
// the files too, and the views exact grants reach.
import type { RequestSection, ResolvedModel, ResolvedTable } from "@ingestron/definitions";
import { quote } from "../sql/index.js";
import { viewAccess, type ViewAccess } from "../plan/index.js";

/** A view's table and the access views.sql gives it. */
interface Granted {
  table: ResolvedTable;
  access: ViewAccess;
}

/** What every report user needs: the project's credentials, and its data sources' locations. */
export interface Sources {
  credentials: string[];
  locations: string[];
}

/** Each view views.sql grants on, or revokes on, in the model's order. */
export function grantedViews(model: ResolvedModel): Granted[] {
  return model.tables.flatMap((table) => {
    const access = viewAccess(model, table);
    return access ? [{ table, access }] : [];
  });
}

/** One line per principal, in the order first granted, in place of the line about report users. */
export function principalLines(granted: readonly Granted[], sources: Sources): string[] {
  const databases = new Map<string, Set<string>>();
  for (const { table, access } of granted)
    for (const { principal } of access.grants) {
      const held = databases.get(principal) ?? new Set<string>();
      held.add(table.fullName.catalog);
      databases.set(principal, held);
    }
  const credentials = sources.credentials.map(code).join(", ");
  const locations = sources.locations.map(code).join(", ");
  const plural = sources.credentials.length === 1 ? "credential" : "credentials";
  return [...databases].map(
    ([principal, held]) =>
      `${code(principal)}: in ${[...held].map(code).join(", ")}, create it as a database user from the external provider (${code(`CREATE USER ${quote(principal)} FROM EXTERNAL PROVIDER`)}), then give it REFERENCES on the database scoped ${plural} ${credentials} and ADMINISTER DATABASE BULK OPERATIONS, which views over files need. views.sql grants it SELECT on its views. These rights also let it read every file under ${locations} directly, not only through the views.`,
  );
}

/** The "Exact grants" section, when views.sql revokes on any view. */
export function exactSection(granted: readonly Granted[]): RequestSection[] {
  const exact = granted.filter(({ access }) => access.exact);
  if (exact.length === 0) return [];
  return [
    {
      title: "Exact grants",
      intro:
        "Exact grants are on. Each time views.sql runs, it removes every permission granted directly on these views to anyone their contracts and layers don't name, and every permission other than SELECT to those they do. It keeps ownership, permissions on schemas and databases, denials, permissions given WITH GRANT OPTION, and those of the database user that runs views.sql, but not those of a group that user belongs to. Before turning this on, move any access given by hand into the contracts.",
      lines: exact.map(({ table: { fullName }, access }) => {
        const view = `${code(`${quote(fullName.schema)}.${quote(fullName.table)}`)} in ${code(fullName.catalog)}`;
        return access.grants.length > 0 ? view : `${view}${unread}`;
      }),
    },
  ];
}

/** What the request says of a view exact grants reach that no role is granted on. */
const unread =
  ": no contract or layer names a role for it, so no one can read it except its owners and those given access on its schema or database.";

/** A Markdown code span; one holding a backtick is fenced with two. */
export function code(text: string): string {
  return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}
