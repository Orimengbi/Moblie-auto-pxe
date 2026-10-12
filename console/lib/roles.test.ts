import assert from "node:assert/strict";
import test from "node:test";
import { ALL_PERMISSIONS, BUILTIN_ROLES, normalizeRoleId, requiredPermission, taskPermission } from "./roles.ts";

test("role ids: the old user role is the engineer", () => {
  assert.equal(normalizeRoleId("user"), "engineer");
  assert.equal(normalizeRoleId(""), "viewer");
  assert.equal(normalizeRoleId("r-abc"), "r-abc");
  assert.deepEqual(BUILTIN_ROLES.find((role) => role.id === "admin")?.permissions, ALL_PERMISSIONS);
  assert.deepEqual(BUILTIN_ROLES.find((role) => role.id === "viewer")?.permissions, []);
});

test("each write maps to one permission; reads and one's own account need none", () => {
  assert.equal(requiredPermission("GET", "/api/assets/abc/logs"), null);
  assert.equal(requiredPermission("POST", "/api/alerts/a1/ack"), "alerts");
  assert.equal(requiredPermission("POST", "/api/tickets"), "tickets");
  assert.equal(requiredPermission("PATCH", "/api/tickets/t1"), "tickets");
  assert.equal(requiredPermission("POST", "/api/assets/a1/control"), "power");
  assert.equal(requiredPermission("POST", "/api/assets/a1/redfish/media"), "media");
  assert.equal(requiredPermission("POST", "/api/assets/a1/sensors"), "refresh");
  assert.equal(requiredPermission("POST", "/api/parts/p1/status"), "parts.status");
  assert.equal(requiredPermission("PATCH", "/api/parts/p1"), "parts.edit");
  assert.equal(requiredPermission("DELETE", "/api/parts/p1"), "delete");
  assert.equal(requiredPermission("POST", "/api/assets/a1/network/baseline"), "assets.edit");
  assert.equal(requiredPermission("PATCH", "/api/assets/a1/redfish"), "bmc.settings");
  assert.equal(requiredPermission("PATCH", "/api/assets/a1/redfish/bios"), "bios");
  assert.equal(requiredPermission("POST", "/api/assets/a1/redfish/firmware"), "firmware");
  assert.equal(requiredPermission("DELETE", "/api/assets/a1/redfish/logs"), "logs.clear");
  assert.equal(requiredPermission("POST", "/api/assets/a1/bmc-users"), "bmc.users");
  assert.equal(requiredPermission("POST", "/api/assets"), "assets.edit");
  assert.equal(requiredPermission("PATCH", "/api/assets/a1"), "assets.edit");
  assert.equal(requiredPermission("DELETE", "/api/assets/a1"), "delete");
  assert.equal(requiredPermission("PUT", "/api/sites/s1/layout"), "dc.edit");
  assert.equal(requiredPermission("POST", "/api/projects/p1/servers/s1/reinstall"), "install");
  assert.equal(requiredPermission("DELETE", "/api/projects/p1"), "delete");
  assert.equal(requiredPermission("POST", "/api/firmware-lib/uploads"), "firmware");
  assert.equal(requiredPermission("PUT", "/api/settings/monitor"), "settings");
  assert.equal(requiredPermission("POST", "/api/snmp-profiles"), "settings");
  assert.equal(requiredPermission("POST", "/api/users/u1/access-keys"), null);
  assert.equal(requiredPermission("PATCH", "/api/users/u1"), null);
  assert.equal(requiredPermission("POST", "/api/users"), "users");
  assert.equal(requiredPermission("POST", "/api/roles"), "users");
  assert.equal(requiredPermission("POST", "/api/tasks"), null);
  // 没登记的写接口默认只有管理员能做。
  assert.equal(requiredPermission("POST", "/api/something-new"), "users");
});

test("batch tasks map by kind", () => {
  assert.equal(taskPermission("bmc-logs"), "logs.collect");
  assert.equal(taskPermission("script"), "scripts");
  assert.equal(taskPermission("revoke"), "scripts");
  assert.equal(taskPermission("inventory"), "inventory");
  assert.equal(taskPermission("bmc-reset"), "bmc.settings");
  assert.equal(taskPermission("bmc-user"), "bmc.users");
});
