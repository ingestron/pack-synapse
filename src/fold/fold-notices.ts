// The notices a fold gives (spec/behaviour.md, section 10): things the people deploying
// views.sql need to know that do not stop it being written.
import type {
  PackNotice,
  ResolvedModel,
  ResolvedTable,
  SuppliedValue,
} from "@ingestron/definitions";
import { appliesTableCheck } from "../sql/index.js";
import { windowsZone } from "../zones/index.js";
import type { Models } from "./fold-problems.js";

/**
 * A notice for each deploy-time value whose name is not all upper case. sqlcmd (Go) reads the
 * environment variable under the name as written, and Azure DevOps gives pipeline variables
 * upper-case names, so a lower-case name is found there only when the step maps it with `env:`.
 */
export function caseNotices(models: Models, deployValues: readonly SuppliedValue[]): PackNotice[] {
  return deployValues
    .filter(({ name }) => name !== name.toUpperCase())
    .map(({ name }): PackNotice => {
      const use = Object.values(models)
        .flatMap((model) => model.deployValues ?? [])
        .find((value) => value.name === name)?.uses[0];
      return {
        code: "PACK_NOTICE",
        severity: "warning",
        message: `The deploy-time value \${envvar:${name}} is read from the environment variable ${name}, exactly as written. Azure DevOps gives pipeline variables upper-case names, so ${name} will not be found there unless the step maps it with env:.`,
        hint: `Write it in upper case, \${envvar:${name.toUpperCase()}}, to avoid this.`,
        ...(use && { file: use.file, ...(use.line !== undefined && { line: use.line }) }),
      };
    });
}

/**
 * A notice, in the words of `NOT_APPLIED`, for each column a view does not convert because
 * Windows has no zone for one of its zones, and for each table check that needs a regular
 * expression. The definitions package judges `cleanse.timezone` and `quality.table-checks` for
 * the pack as a whole, so it cannot say this for one zone or one check.
 */
export function qualityNotices(model: ResolvedModel): PackNotice[] {
  return model.tables
    .filter((table) => table.store?.method === "synapse-view")
    .flatMap((table) => [...zoneNotices(table), ...patternNotices(table)]);
}

function notice(table: ResolvedTable, message: string, hint: string): PackNotice {
  return { code: "PACK_NOTICE", severity: "warning", message, hint, file: table.origin.file };
}

function zoneNotices(table: ResolvedTable): PackNotice[] {
  return Object.entries(table.cleanse?.columns ?? {}).flatMap(([column, operations]) => {
    const zones = operations.timezone;
    const missing = zones && [zones.from, zones.to].find((zone) => !windowsZone(zone));
    if (!missing) return [];
    return [
      notice(
        table,
        `Time zone conversion isn't applied on Synapse: Windows has no zone for ${missing}.`,
        `The column "${column}" of table "${table.name}" keeps the times it has. Name a zone that Windows has, or convert the column in a layer another engine keeps.`,
      ),
    ];
  });
}

function patternNotices(table: ResolvedTable): PackNotice[] {
  if (!Array.isArray(table.does) || !table.does.includes("check")) return [];
  return table.contract.tableChecks
    .filter((check) => !appliesTableCheck(check))
    .map((check) =>
      notice(
        table,
        `The table check "${check.name}" isn't applied on Synapse: serverless T-SQL has no regular expressions.`,
        "Check the pattern in a layer another engine keeps, or write the check as a sql table check.",
      ),
    );
}
