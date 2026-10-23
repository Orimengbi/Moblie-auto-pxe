import assert from "node:assert/strict";
import test from "node:test";
import { ipCompare } from "./ip-order.ts";

test("IP 按每段的数字排，不按字符", () => {
  const ips = ["10.0.0.10", "10.0.0.9", "10.0.1.2", "9.255.255.255", "10.0.0.100", "", "10.0.0.2"];
  assert.deepEqual([...ips].sort(ipCompare), ["", "9.255.255.255", "10.0.0.2", "10.0.0.9", "10.0.0.10", "10.0.0.100", "10.0.1.2"]);
});
