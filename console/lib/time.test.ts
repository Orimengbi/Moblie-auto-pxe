import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TIME_ZONE, displayTimeZone, formatTime, setDisplayTimeZone, validTimeZone } from "./time.ts";

test("times follow the display time zone", () => {
  assert.equal(displayTimeZone(), DEFAULT_TIME_ZONE);
  assert.equal(formatTime("2026-10-11T08:00:00Z", "time"), "16:00:00");
  setDisplayTimeZone("UTC");
  assert.equal(formatTime("2026-10-11T08:00:00Z", "time"), "08:00:00");
  setDisplayTimeZone(DEFAULT_TIME_ZONE);
  assert.equal(validTimeZone("Asia/Bangkok"), true);
  assert.equal(validTimeZone("Mars/Base"), false);
  assert.equal(validTimeZone(""), false);
});
