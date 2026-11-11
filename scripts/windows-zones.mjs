// Writes src/zones/windows.json: the Windows zone name of each IANA time zone name, which
// T-SQL's AT TIME ZONE takes (spec/behaviour.md, "Quality and cleansing"). It reads two files of
// a Unicode CLDR release: windowsZones.xml maps each Windows zone to IANA names, the territory
// 001 first, then each territory's list; timezone.xml lists the IANA names that are one zone,
// so an alias CLDR does not name in windowsZones.xml (Asia/Kolkata, Europe/Kyiv) maps too.
//
//   node scripts/windows-zones.mjs [<windowsZones.xml> <timezone.xml>]
//
// With no files, it downloads them from the release below. Run it with `pnpm zones`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The CLDR release the table comes from. */
export const release = "release-49";
const base = `https://raw.githubusercontent.com/unicode-org/cldr/${release}/common`;
export const sources = {
  windowsZones: `${base}/supplemental/windowsZones.xml`,
  timezone: `${base}/bcp47/timezone.xml`,
};

/** Each `mapZone` of windowsZones.xml: its Windows zone, territory and IANA names. */
function mapZones(windowsZonesXml) {
  const pattern = /<mapZone\s+other="([^"]+)"\s+territory="([^"]+)"\s+type="([^"]+)"\s*\/>/g;
  return [...windowsZonesXml.matchAll(pattern)].map(([, windows, territory, names]) => ({
    windows,
    territory,
    names: names.split(/\s+/).filter(Boolean),
  }));
}

/** Each group of IANA names that timezone.xml says are one zone. */
function aliasGroups(timezoneXml) {
  return [...timezoneXml.matchAll(/<type\s[^>]*\balias="([^"]+)"/g)].map(([, names]) =>
    names.split(/\s+/).filter(Boolean),
  );
}

/**
 * The Windows zone of each IANA name, sorted by name: from territory 001, then the other
 * territories in file order (a name keeps the first zone found), then every name of an alias
 * group that has a name with a zone.
 */
export function windowsMapping(windowsZonesXml, timezoneXml) {
  const zones = new Map();
  const entries = mapZones(windowsZonesXml);
  const ordered = [
    ...entries.filter((entry) => entry.territory === "001"),
    ...entries.filter((entry) => entry.territory !== "001"),
  ];
  for (const { windows, names } of ordered)
    for (const name of names) if (!zones.has(name)) zones.set(name, windows);
  for (const group of aliasGroups(timezoneXml)) {
    const windows = group.map((name) => zones.get(name)).find(Boolean);
    if (windows) for (const name of group) if (!zones.has(name)) zones.set(name, windows);
  }
  return Object.fromEntries([...zones].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

async function read(path, url) {
  if (path) return readFileSync(path, "utf8");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [windowsPath, timezonePath] = process.argv.slice(2);
  const zones = windowsMapping(
    await read(windowsPath, sources.windowsZones),
    await read(timezonePath, sources.timezone),
  );
  const table = {
    cldr: release,
    sources: [sources.windowsZones, sources.timezone],
    read: new Date().toISOString().slice(0, 10),
    zones,
  };
  const file = join(import.meta.dirname, "../src/zones/windows.json");
  writeFileSync(file, `${JSON.stringify(table, null, 2)}\n`);
  console.log(`${Object.keys(zones).length} IANA names from CLDR ${release}`);
}
