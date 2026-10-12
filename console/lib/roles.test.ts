import assert from "node:assert/strict";
import test from "node:test";
import { atLeast, lowerRole, normalizeRole, requiredRole, taskRole } from "./roles.ts";

test("role ranks", () => {
  assert.equal(normalizeRole("user"), "engineer");
  assert.equal(normalizeRole("nope"), "viewer");
  assert.ok(atLeast("admin", "engineer"));
  assert.ok(!atLeast("operator", "engineer"));
  assert.ok(atLeast("user", "engineer"));
  assert.equal(lowerRole("admin", "operator"), "operator");
});

test("api write policy", () => {
  assert.equal(requiredRole("GET", "/api/assets/abc/logs"), "viewer");
  assert.equal(requiredRole("POST", "/api/alerts/a1/ack"), "operator");
  assert.equal(requiredRole("POST", "/api/tickets"), "operator");
  assert.equal(requiredRole("PATCH", "/api/tickets/t1"), "operator");
  assert.equal(requiredRole("POST", "/api/assets/a1/control"), "operator");
  assert.equal(requiredRole("POST", "/api/assets/a1/redfish/media"), "operator");
  assert.equal(requiredRole("POST", "/api/parts/p1/status"), "operator");
  assert.equal(requiredRole("PATCH", "/api/parts/p1"), "engineer");
  assert.equal(requiredRole("POST", "/api/assets/a1/network/baseline"), "engineer");
  assert.equal(requiredRole("PATCH", "/api/assets/a1/redfish"), "engineer");
  assert.equal(requiredRole("POST", "/api/assets"), "engineer");
  assert.equal(requiredRole("POST", "/api/projects/p1/servers/s1/reinstall"), "engineer");
  assert.equal(requiredRole("POST", "/api/users/u1/access-keys"), "viewer");
  assert.equal(requiredRole("PATCH", "/api/users/u1"), "viewer");
  assert.equal(requiredRole("POST", "/api/tasks"), "operator");
  assert.equal(taskRole("bmc-logs"), "operator");
  assert.equal(taskRole("script"), "engineer");
  assert.equal(taskRole("inventory"), "engineer");
  assert.equal(taskRole("bmc-user"), "admin");
});
