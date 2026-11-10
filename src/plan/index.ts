// The plan module: what the rest of the package uses.
export {
  hasView,
  plan,
  tableReference,
  type CodePart,
  type FilesPlan,
  type Statement,
  type TransformPlan,
  type ViewPlan,
  type ViewReference,
  type ViewsPlan,
} from "./plan.js";
export type { CheckPlan, QualityPlan, RowCheckPlan, TableCheckPlan } from "./quality.js";
