// The Windows zone table's generation, from small CLDR files written here.
import assert from "node:assert/strict";
import test from "node:test";
import { windowsMapping } from "./windows-zones.mjs";

const windowsZones = `<supplementalData><windowsZones><mapTimezones>
  <mapZone other="UTC" territory="001" type="Etc/UTC"/>
  <mapZone other="UTC" territory="ZZ" type="Etc/UTC Etc/GMT"/>
  <mapZone other="GMT Standard Time" territory="001" type="Europe/London"/>
  <mapZone other="GMT Standard Time" territory="IE" type="Europe/Dublin"/>
  <mapZone other="FLE Standard Time" territory="001" type="Europe/Kiev"/>
  <mapZone other="FLE Standard Time" territory="UA" type="Europe/Kiev Europe/Uzhgorod"/>
  <mapZone other="Other Time" territory="UA" type="Europe/Kiev"/>
  <mapZone other="India Standard Time" territory="001" type="Asia/Calcutta"/>
</mapTimezones></windowsZones></supplementalData>`;

const timezone = `<ldmlBCP47><keyword><key name="tz">
  <type name="gblon" description="London, United Kingdom" alias="Europe/London Europe/Belfast GB"/>
  <type name="uaiev" description="Kyiv, Ukraine" alias="Europe/Kiev Europe/Kyiv Europe/Zaporozhye"/>
  <type name="inccu" description="Kolkata, India" alias="Asia/Calcutta Asia/Kolkata" iana="Asia/Kolkata"/>
  <type name="utc" description="UTC" alias="Etc/UTC Etc/UCT UTC"/>
  <type name="aqtrl" description="Troll, Antarctica" alias="Antarctica/Troll"/>
</key></keyword></ldmlBCP47>`;

const zones = windowsMapping(windowsZones, timezone);

test("maps each territory's IANA names to their Windows zone", () => {
  assert.equal(zones["Europe/London"], "GMT Standard Time");
  assert.equal(zones["Europe/Dublin"], "GMT Standard Time");
  assert.equal(zones["Europe/Uzhgorod"], "FLE Standard Time");
  assert.equal(zones["Etc/GMT"], "UTC");
});

test("keeps territory 001's zone when a name is listed again", () => {
  assert.equal(zones["Europe/Kiev"], "FLE Standard Time");
});

test("maps every alias of a zone CLDR names, older and newer", () => {
  assert.equal(zones["Asia/Kolkata"], "India Standard Time");
  assert.equal(zones["Asia/Calcutta"], "India Standard Time");
  assert.equal(zones["Europe/Kyiv"], "FLE Standard Time");
  assert.equal(zones["Europe/Zaporozhye"], "FLE Standard Time");
  assert.equal(zones["GB"], "GMT Standard Time");
  assert.equal(zones["UTC"], "UTC");
});

test("leaves out a zone that no Windows zone covers", () => {
  assert.equal(zones["Antarctica/Troll"], undefined);
});

test("sorts the names", () => {
  const names = Object.keys(zones);
  assert.deepEqual(names, [...names].sort());
});
