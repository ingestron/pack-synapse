// Windows time zone names, which T-SQL's AT TIME ZONE takes, for the IANA names the model gives
// (spec/behaviour.md, "Quality and cleansing"). The table is generated from Unicode CLDR by
// `pnpm zones` (scripts/windows-zones.mjs), not written by hand.
import table from "./windows.json" with { type: "json" };

/** The table: the CLDR release, the files it was generated from and when, and each zone. */
export const windowsZones: {
  cldr: string;
  sources: readonly string[];
  read: string;
  zones: Readonly<Record<string, string>>;
} = table;

/**
 * The Windows name of an IANA zone, or undefined when Windows has no zone for it.
 * @example windowsZone("Europe/London") // "GMT Standard Time"
 */
export function windowsZone(iana: string): string | undefined {
  return Object.hasOwn(windowsZones.zones, iana) ? windowsZones.zones[iana] : undefined;
}
