// The ERP project with access: roles on the orders contract, a masked classified column,
// principals per environment, and Synapse's grants turned on (spec/behaviour.md, "Access").
import { base } from "./project.js";

/** What changes in the project: the grant mode, the switch and the principals. */
export interface AccessOptions {
  /** `exact` or `additive`; no `governance.access` when left out. */
  grants?: "exact" | "additive";
  /** `synapse.manage.grants`; true when left out. */
  manage?: boolean;
  /** The Platform's `principals` lines, as YAML. */
  principals?: string;
  /** The contract's roles, as YAML lines; three when left out, none when empty. */
  roles?: string[];
}

const roles = [
  "  - { role: marketing-analysts, access: read }",
  "  - { role: etl-writers, access: write }",
  "  - { role: auditors }",
];

/** The orders contract with an email the standard masks, and its roles. */
export function accessContract(lines: string[] = roles): string {
  const contract = base["orders.yaml"]!.replace(
    "      - { name: total, logicalType: number }\n",
    "      - { name: total, logicalType: number }\n      - { name: email, logicalType: string, classification: confidential }\n",
  );
  return lines.length === 0 ? contract : [contract.trimEnd(), "roles:", ...lines, ""].join("\n");
}

/** The standard: the masks, and the grant mode when given. */
export function accessStandard(grants?: AccessOptions["grants"]): string {
  return [
    base["standard.yaml"]!.trimEnd(),
    "governance:",
    "  masks: { confidential: hash }",
    ...(grants ? [`  access: { grants: ${grants} }`] : []),
    "",
  ].join("\n");
}

/** The Platform: the data sources, the principals and Synapse's switch. */
export function accessPlatform(options: AccessOptions = {}): string {
  const principals =
    options.principals ??
    "principals: { marketing-analysts: marketing-analysts-dev, auditors: 'ops]admins' }";
  return [
    base["platform.yaml"]!.trimEnd(),
    principals,
    `synapse: { manage: { grants: ${options.manage ?? true} } }`,
    "",
  ].join("\n");
}

/** The project's files with access. */
export function accessFiles(options: AccessOptions = {}): Record<string, string> {
  return {
    ...base,
    "standard.yaml": accessStandard(options.grants),
    "platform.yaml": accessPlatform(options),
    "orders.yaml": accessContract(options.roles),
  };
}
