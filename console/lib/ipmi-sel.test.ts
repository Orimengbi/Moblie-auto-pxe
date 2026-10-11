import assert from "node:assert/strict";
import test from "node:test";
import { parseSelCount, parseSelElist } from "./ipmi-sel.ts";

// 6QM8N72HMA0041 上 ipmitool sel elist 的原样输出（节选）。
const ELIST = `   1 | 09/11/26 | 07:39:12 UTC | Drive Slot / Bay #0x02 | Drive Present | Asserted
  4f | 10/10/26 | 02:51:46 UTC | Power Supply PS6_Status | Power Supply AC lost | Asserted
  50 | 10/10/26 | 02:51:46 UTC | Power Supply PS6_Status | Power Supply Inactive | Asserted
  51 | 10/10/26 | 02:52:25 UTC | Power Supply PS6_Status | Power Supply AC lost | Deasserted
  52 | 10/10/26 | 02:52:25 UTC | Power Supply PS6_Status | Power Supply Inactive | Deasserted
  57 | 10/10/26 | 04:24:46 UTC | Power Supply PS6_Status | Power Supply AC lost | Asserted
  6c | 10/11/26 | 07:00:24 UTC | Power Supply PS2_Status | Presence detected | Asserted
SEL has no entries
`;

test("ipmitool sel elist is parsed with severity and recovery", () => {
  const entries = parseSelElist(ELIST);
  assert.equal(entries.length, 7);
  assert.deepEqual(entries.map((entry) => entry.id), ["1", "79", "80", "81", "82", "87", "108"]);
  assert.equal(entries[1].created, "2026-10-10T02:51:46.000Z");
  assert.deepEqual(entries.map((entry) => entry.severity), ["OK", "Critical", "Warning", "OK", "OK", "Critical", "OK"]);
  // 第一次 AC lost 后来恢复了，04:24 那次没有。
  assert.equal(entries[1].resolved, true);
  assert.equal(entries[2].resolved, true);
  assert.equal(entries[5].resolved, false);
  assert.equal(entries[6].resolved, null);
  assert.match(entries[5].message, /PS6_Status · Power Supply AC lost · Asserted/);
});

test("sel info entry count", () => {
  assert.equal(parseSelCount("SEL Information\nVersion          : 1.5 (v1.5, v2 compliant)\nEntries          : 108\nFree Space       : 16452 bytes\n"), 108);
  assert.equal(parseSelCount("nothing"), null);
});
