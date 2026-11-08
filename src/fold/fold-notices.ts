// The notices a fold gives (spec/behaviour.md, section 10): things the people deploying
// views.sql need to know that do not stop it being written.
import type { PackNotice, SuppliedValue } from "@ingestron/definitions";
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
