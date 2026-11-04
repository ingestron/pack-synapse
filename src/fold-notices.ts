// The notices a fold gives (spec/behaviour.md, section 10): things the people deploying
// views.sql need to know that do not stop it being written.
import type { PackNotice, SuppliedValue } from "@ingestron/definitions";
import type { Models } from "./fold-problems.js";

/**
 * A notice for each deploy-time value whose name is not all upper case. sqlcmd (Go) reads the
 * environment variable under the name as written, and Azure DevOps gives the pipeline
 * variables it passes to a step upper-case names, so a Linux agent would not find it.
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
        message: `The deploy-time value \${envvar:${name}} is read from the environment variable ${name}, in that case. Azure DevOps gives pipeline variables upper-case names, so on a Linux agent the deploy step sees ${name.toUpperCase()} and sqlcmd does not find ${name}.`,
        hint: `Write the name in upper case, \${envvar:${name.toUpperCase()}}, and supply it under that name.`,
        ...(use && { file: use.file, ...(use.line !== undefined && { line: use.line }) }),
      };
    });
}
