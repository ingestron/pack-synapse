// Triggers, parameters and filters on the Synapse workspace route, which reuses the ADF pack's
// output: the default trigger is a schedule, a flow's triggers pass through, and the route stays
// full-snapshot only.
import { describe, expect, it } from "vitest";
import { adf } from "@ingestron/pack-adf";
import { synapse } from "../src/index.js";
import { copyModel, synapseCopy } from "../src/pipelines/index.js";
import { errors, file, flowB, modelOf, operations, resolve, trigger } from "./trigger-project.js";

const weekly = trigger(
  "schedule",
  "      timezone: Europe/London\n      parameters: { load: full }\n",
  "weekly",
);
const hourly = trigger("tumbling-window", "", "hourly");
const withFlow = (triggers: string, standard = operations()) => ({
  "standard.yaml": standard,
  "flow-b.yaml": flowB(`  triggers:\n${triggers}`),
});
const prefix = "trigger/tr_erp_sql_northwind";

describe("the default trigger", () => {
  it("keeps the output of a project that writes no triggers", () => {
    const output = synapse.build(modelOf());
    const kept = Object.fromEntries(
      Object.entries(output).filter(([path]) => /^(workspace|queries)\//.test(path)),
    );
    expect(kept).toMatchSnapshot();
  });

  it("is a schedule in UTC beside the triggers a flow writes", () => {
    const model = modelOf(withFlow(weekly + hourly));
    const found = file(model, `${prefix}.json`);
    expect(found.properties.type).toBe("ScheduleTrigger");
    expect(found.properties.typeProperties.recurrence).toMatchObject({
      frequency: "Hour",
      interval: 24,
      startTime: "2026-11-14T00:00:00Z",
      timeZone: "UTC",
    });
    expect(file(model, "pipeline/pl_erp_sql_northwind.json").properties.parameters).toBeUndefined();
  });
});

describe("a flow's triggers", () => {
  const model = () => modelOf(withFlow(weekly + hourly));

  it("passes a schedule trigger through as the ADF builder wrote it, in a Windows zone", () => {
    const name = `${prefix}_b_weekly`;
    const written = JSON.parse(
      adf.build(copyModel(model()))[`${name}.json`.replace("trigger/", "trigger/")]!,
    );
    const found = file(model(), name);
    expect(found).toEqual(written);
    expect(found.properties.type).toBe("ScheduleTrigger");
    expect(found.properties.typeProperties.recurrence.timeZone).toBe("GMT Standard Time");
    expect(found.properties.pipelines[0].parameters.load).toBe("full");
  });

  it("passes a tumbling window through, marked as a flow's", () => {
    expect(file(model(), `${prefix}_b_hourly_h1`).properties).toMatchObject({
      type: "TumblingWindowTrigger",
      annotations: ["ingestron:flow-trigger"],
      pipeline: { parameters: { windowStart: "@trigger().outputs.windowStartTime" } },
    });
  });

  it("keeps the parameters its triggers pass on the flow's own pipeline", () => {
    const flow = file(model(), "pipeline/pl_erp_sql_northwind_b");
    expect(Object.keys(flow.properties.parameters)).toEqual(["windowStart", "windowEnd", "load"]);
    expect(flow.properties.concurrency).toBe(1);
  });
});

describe("full snapshots only", () => {
  it("does not apply the standard's concurrency, as every pipeline runs one at a time", () => {
    expect(synapseCopy.intent!["operations.concurrency"]).toEqual({
      use: "not-applicable",
      reason:
        "This workspace route runs each pipeline one at a time, so full snapshots never overlap.",
    });
  });

  it("refuses a trigger that sets load to incremental", () => {
    const incremental = trigger("schedule", "      parameters: { load: incremental }\n", "reload");
    expect(errors(resolve(withFlow(incremental)))).toEqual([
      '"synapse-copy" for table "customers": The Synapse workspace route copies full snapshots only; remove `load: incremental` from "reload".',
    ]);
    expect(errors(resolve(withFlow(weekly)))).toEqual([]);
  });

  it("refuses a tumbling window on an incremental table, and allows one on a full table", () => {
    const table = modelOf(withFlow(hourly)).tables.find((item) => item.name === "customers")!;
    expect(synapseCopy.check!(table)).toEqual([]);
    const settings = { ...table.ingest!.settings, mode: "incremental" };
    const incremental = { ...table, ingest: { ...table.ingest!, settings } };
    expect(synapseCopy.check!(incremental)).toContain(
      'The Synapse workspace route copies full snapshots only; the tumbling-window trigger "hourly" would pass a window to the incremental table "customers"',
    );
    const schedule = modelOf(withFlow(weekly)).tables.find((item) => item.name === "customers")!;
    const scheduled = { ...schedule, ingest: { ...schedule.ingest!, settings } };
    expect(synapseCopy.check!(scheduled).join("\n")).not.toContain("tumbling-window");
  });
});

describe("the standard's rules and the ADF pack's checks", () => {
  const types = (list: string) => operations(`  triggers: { types: [${list}] }\n`);
  const problems = (changes: Record<string, string>) => errors(resolve(changes));

  it("judges the default trigger as a schedule", () => {
    expect(problems({ "standard.yaml": types("schedule") })).toEqual([]);
    expect(problems({ "standard.yaml": types("schedule, tumbling-window") })).toEqual([]);
    expect(problems({ "standard.yaml": types("tumbling-window") })).toEqual([
      "The standard allows only tumbling-window triggers. The default trigger \"tr_erp_sql_northwind\" is a schedule trigger; write the flow's own triggers, or ask for schedule in the standard's `operations.triggers.types`.",
    ]);
  });

  it("checks the hours of the default trigger's runs", () => {
    const hours = (from: string, to: string) =>
      operations(`  triggers: { hours: { from: "${from}", to: "${to}", timezone: UTC } }\n`);
    expect(problems({ "standard.yaml": hours("00:00", "01:00") })).toEqual([]);
    expect(problems({ "standard.yaml": hours("08:00", "18:00") })).toEqual([
      '"tr_erp_sql_northwind" starts a run at 00:00 (UTC), outside the hours the standard allows here: 08:00–18:00.',
    ]);
  });

  it("runs the ADF pack's check of a flow's triggers on Synapse tables", () => {
    const first = trigger("tumbling-window", "", "first");
    const twice = first + trigger("tumbling-window", "", "second");
    const model = modelOf(withFlow(first));
    expect(copyModel(model).tables.map((table) => table.ingest!.pack)).toEqual(["adf", "adf"]);
    expect(problems(withFlow(twice))).toEqual([
      'The flow "b" has two tumbling-window triggers, "first" and "second", on one pipeline; ADF would load each window twice. Keep one.',
    ]);
  });
});

describe("the backfill rule", () => {
  const files = (tumbling = hourly) => synapse.build(modelOf(withFlow(tumbling)));
  const now = new Date("2027-01-01T00:00:00Z");
  const flowPath = `workspace/dev/${prefix}_b_hourly_h1.json`;

  it("refuses a new flow tumbling window that starts in the past, and not the default trigger", () => {
    const messages = synapse.checkFirstWrites!(files(), new Set(), now);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^tr_erp_sql_northwind_b_hourly_h1 is new and starts at /);
  });

  it("lets through a trigger that is not new, one that starts later, and one that confirms", () => {
    expect(synapse.checkFirstWrites!(files(), new Set([flowPath]), now)).toEqual([]);
    const early = new Date("2026-11-30T00:00:00Z");
    expect(synapse.checkFirstWrites!(files(), new Set(), early)).toEqual([]);
    const confirmed = trigger("tumbling-window", "      backfill: true\n", "hourly");
    expect(synapse.checkFirstWrites!(files(confirmed), new Set(), now)).toEqual([]);
  });
});

describe("source filters", () => {
  const filtered = (filter: string) =>
    flowB(`  triggers:\n${weekly}`, `, ingest: { filter: "${filter}" }`);

  it("accepts a filter, and writes it into the source query and its review file", () => {
    expect(synapseCopy.filters).toBe(true);
    const model = modelOf({ ...withFlow(weekly), "flow-b.yaml": filtered("CustomerID > 5") });
    const output = synapse.build(model);
    const pipeline = file(model, "pipeline/pl_erp_sql_northwind_b");
    expect(pipeline.properties.activities[0].typeProperties.source.sqlReaderQuery).toContain(
      "WHERE (CustomerID > 5\n)",
    );
    const query = Object.entries(output).find(([path]) => path.endsWith("copy_customers.sql"))!;
    expect(query[1]).toContain("WHERE (CustomerID > 5\n)");
  });

  it("writes a filter that reads a parameter as an expression, and says so in its review file", () => {
    const filter = "CustomerID > {{ parameters.windowStart }}";
    const model = modelOf({ ...withFlow(weekly), "flow-b.yaml": filtered(filter) });
    const output = synapse.build(model);
    const query = Object.entries(output).find(([path]) => path.endsWith("copy_customers.sql"))!;
    expect(query[1]).toContain("expression");
    expect(query[1]).toContain("pipeline().parameters.windowStart");
    expect(query[1]).not.toContain("[object Object]");
  });

  it("keeps the window a default pipeline's filter reads, which its schedule then passes", () => {
    const flow = flowB("  parameters:\n    p: { type: int, default: 1 }\n").replace(
      "northwind.dbo.Customers}",
      'northwind.dbo.Customers, ingest: { filter: "CustomerID > {{ parameters.windowStart }}" }}',
    );
    const model = modelOf({ "flow-b.yaml": flow });
    const pipeline = file(model, "pipeline/pl_erp_sql_northwind_b");
    expect(Object.keys(pipeline.properties.parameters)).toEqual(["windowStart", "p"]);
    expect(file(model, `${prefix}_b.json`).properties.pipelines[0].parameters).toEqual({
      windowStart: "@trigger().scheduledTime",
    });
  });
});

describe("judging a schedule for each flow", () => {
  const warnings = (changes: Record<string, string>) =>
    resolve(changes)
      .diagnostics.filter((item) => item.code === "NOT_APPLIED")
      .map((item) => item.message);

  it("warns of nothing when a flow copies with synapse-copy", () => {
    expect(warnings({ "standard.yaml": operations() })).toEqual([]);
  });

  it("still says what a value the copy method does not apply misses", () => {
    expect(
      warnings({ "standard.yaml": operations("  concurrency: { max_runs: 2, queue: true }\n") }),
    ).toEqual([
      'operations.concurrency: {"max_runs":2,"queue":true} isn\'t applied on synapse: This workspace route runs each pipeline one at a time, so full snapshots never overlap.',
    ]);
  });
});
