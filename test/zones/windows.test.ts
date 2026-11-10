// Windows zone names for the IANA names the model gives (spec/behaviour.md, "Quality and
// cleansing", "Time zones"), and what a zone Windows has no name for does to a view.
import { memoryFiles } from "@ingestron/config";
import { intentUseOf, resolveDefinitions, type ResolvedModel } from "@ingestron/definitions";
import { describe, expect, it } from "vitest";
import { synapse } from "../../src/index.js";
import { windowsZone, windowsZones } from "../../src/zones/index.js";
import { crm, crmFiles, viewOf } from "../quality-project.js";
import { landing, tables } from "../stub-packs.js";

describe("windowsZone", () => {
  it("names Europe/London's Windows zone", () => {
    expect(windowsZone("Europe/London")).toBe("GMT Standard Time");
  });

  it("maps the older and newer names of one zone, whichever CLDR lists", () => {
    expect(windowsZone("Asia/Kolkata")).toBe("India Standard Time");
    expect(windowsZone("Asia/Calcutta")).toBe("India Standard Time");
    expect(windowsZone("Europe/Kyiv")).toBe("FLE Standard Time");
    expect(windowsZone("Europe/Kiev")).toBe("FLE Standard Time");
  });

  it("maps UTC, and a place that shares a Windows zone", () => {
    expect(windowsZone("UTC")).toBe("UTC");
    expect(windowsZone("Etc/UTC")).toBe("UTC");
    expect(windowsZone("Europe/Dublin")).toBe("GMT Standard Time");
  });

  it("has no name for a zone Windows does not have, nor for anything else", () => {
    expect(windowsZone("Antarctica/Troll")).toBeUndefined();
    expect(windowsZone("toString")).toBeUndefined();
  });

  it("records the CLDR release and files it was generated from", () => {
    expect(windowsZones.cldr).toBe("release-49");
    expect(windowsZones.read).toBe("2026-11-10");
    expect(windowsZones.sources).toEqual([
      "https://raw.githubusercontent.com/unicode-org/cldr/release-49/common/supplemental/windowsZones.xml",
      "https://raw.githubusercontent.com/unicode-org/cldr/release-49/common/bcp47/timezone.xml",
    ]);
  });
});

describe("a zone Windows has no name for", () => {
  const troll = (text: string) =>
    text.replace(
      "contacted_at: { timezone: { from: UTC, to: Europe/London } }",
      "contacted_at: { timezone: { from: UTC, to: Antarctica/Troll } }",
    );
  const changes = {
    "transforms/customers_clean.yaml": troll(crmFiles()["transforms/customers_clean.yaml"]!),
  };

  it("leaves the column as it is in the view", () => {
    const view = viewOf(crm(changes).files["views.sql"]!, "[silver].[customers_clean]");
    expect(view).toContain("\n  [contacted_at],\n");
    expect(view).not.toContain("Troll");
  });

  it("is NOT_APPLIED at the column, and the table keeps the zone it was in", () => {
    const { result, model } = crm(changes);
    const notApplied = result.diagnostics.filter(
      (item) => item.code === "NOT_APPLIED" && item.message.startsWith("Time zone"),
    );
    expect(notApplied.map(({ message, location }) => [message, location?.file])).toEqual([
      [
        "Time zone conversion isn't applied on synapse: Windows has no zone for Antarctica/Troll.",
        "transforms/customers_clean.yaml",
      ],
    ]);
    const orders = model!.tables.find((table) => table.name === "customers_clean")!;
    expect(orders.cleanse?.columns.contacted_at?.timezone).toEqual({
      from: "UTC",
      to: "Antarctica/Troll",
    });
  });

  it("is declared in coverage for every zone the table has no Windows name for", () => {
    const use = intentUseOf(synapse, "cleanse.timezone", "true");
    const listed = use?.use === "used" ? Object.keys(use.zonesNotApplied ?? {}) : [];
    expect(listed).toEqual(["Antarctica/Troll", "CST6CDT", "EST5EDT", "MST7MDT", "PST8PDT"]);
    for (const zone of listed) expect(windowsZone(zone), zone).toBeUndefined();
    expect(use).toMatchObject({
      zonesNotApplied: { "Antarctica/Troll": "Windows has no zone for Antarctica/Troll." },
    });
  });

  it("gives no notice of its own when building every environment", () => {
    const model = resolveDefinitions(memoryFiles(crmFiles(changes)), {
      packs: [landing, synapse, tables],
      environment: "dev",
      deployTime: true,
      environmentsTogether: true,
    }).model as ResolvedModel;
    expect(synapse.buildEnvironments!({ dev: model }).problems).toEqual([]);
  });
});
