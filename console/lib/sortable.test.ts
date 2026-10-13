import assert from "node:assert/strict";
import test from "node:test";
import { moveKey } from "./sortable.ts";

test("moving a key puts it at the target position and clamps out-of-range targets", () => {
  assert.deepEqual(moveKey(["a", "b", "c", "d"], "a", 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveKey(["a", "b", "c", "d"], "d", 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveKey(["a", "b", "c"], "b", 99), ["a", "c", "b"]);
  assert.deepEqual(moveKey(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveKey(["a", "b"], "x", 0), ["a", "b"]);
});
