// The condition of each row check in T-SQL (spec/behaviour.md, "Row checks"): written from its
// rule when it has one, else its check text. The rules keep the Databricks pack's null
// semantics: null fails notNull, passes in and notIn only with allowNull, and passes every other
// kind, so a condition written from a rule is never unknown.
import type { Expectation, RowRule } from "@ingestron/definitions";
import { literal, quote } from "./sql.js";

/** The rule kinds serverless T-SQL cannot check: no regular expressions, and no typed arrays. */
const unapplied: readonly string[] = ["pattern", "items"];

/** True when the pack can check the expectation: a check text, or a rule of a kind it applies. */
export function appliesRule(expectation: Expectation): boolean {
  return !expectation.rule || !unapplied.includes(expectation.rule.kind);
}

/**
 * A value of a rule or a check: a number as it is, any other value as T-SQL text.
 * @example value(5) // "5"
 */
export function value(item: unknown): string {
  return typeof item === "number" ? String(item) : literal(String(item));
}

/**
 * The condition a row passes, as T-SQL. `types` gives each column's type in the view, where
 * the pack knows it; `%` needs an exact number.
 */
export function conditionOf(
  expectation: Expectation,
  types: Readonly<Record<string, string>> = {},
): string {
  return expectation.rule ? ruleCondition(expectation.rule, types) : expectation.check;
}

function ruleCondition(rule: RowRule, types: Readonly<Record<string, string>>): string {
  const name = quote(rule.column);
  switch (rule.kind) {
    case "notNull":
      return `${name} IS NOT NULL`;
    case "in":
    case "notIn": {
      const list = `${name} ${rule.kind === "in" ? "IN" : "NOT IN"} (${rule.values.map(value).join(", ")})`;
      return rule.allowNull ? `${name} IS NULL OR ${list}` : `${name} IS NOT NULL AND ${list}`;
    }
    default:
      return `${name} IS NULL OR ${limits(rule, name, types[rule.column]).join(" AND ")}`;
  }
}

/** The limits of a rule that a null value passes. */
function limits(rule: RowRule, name: string, type: string | undefined): string[] {
  switch (rule.kind) {
    case "length":
      // LEN leaves out the spaces at the end; each counts as `_`, so every character counts.
      return bounds(`LEN(REPLACE(${name}, ' ', '_'))`, rule.min, rule.max, false);
    case "range":
      return bounds(name, rule.min, rule.max, rule.exclusive === true);
    case "multipleOf":
      return [multipleOf(name, rule.value, type)];
    default:
      return [];
  }
}

/** Exact number types, which T-SQL's `%` takes. */
const exact = /^(BIGINT|INT|SMALLINT|TINYINT|DECIMAL|NUMERIC|MONEY|SMALLMONEY)\b/i;

/** `%` for an exact number and a plain value; otherwise the remainder worked out with FLOOR. */
function multipleOf(name: string, divisor: number, type: string | undefined): string {
  const text = value(divisor);
  if (type !== undefined && exact.test(type.trim()) && /^-?\d+(\.\d+)?$/.test(text))
    return `${name} % ${text} = 0`;
  return `${name} - FLOOR(${name} / ${text}) * ${text} = 0`;
}

function bounds(of: string, min: unknown, max: unknown, exclusive: boolean): string[] {
  return [
    ...(min === undefined ? [] : [`${of} ${exclusive ? ">" : ">="} ${value(min)}`]),
    ...(max === undefined ? [] : [`${of} ${exclusive ? "<" : "<="} ${value(max)}`]),
  ];
}
