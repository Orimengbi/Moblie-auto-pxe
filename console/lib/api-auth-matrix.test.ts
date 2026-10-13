import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { requiredPermission } from "./roles.ts";

/**
 * 每个写接口要什么权限点，一张表钉死。新加接口、改 WRITES 规则时这里会失败，
 * 对着表看一眼对不对再改表 —— 免得新接口悄悄落到默认的「用户」上，或者被前面一条规则吃掉。
 * 路径里的 [id] 一律写成 x1。null 是中间件只要登录，路由自己查（见 SELF_CHECKED）。
 */
const EXPECTED = [
  "POST /api/alerts/x1/ack alerts",
  "POST /api/alerts/x1/resolve alerts",
  "POST /api/alerts/x1/ticket alerts",
  "POST /api/assets/x1/bmc-cert bmc.settings",
  "POST /api/assets/x1/bmc-users bmc.users",
  "POST /api/assets/x1/control power",
  "POST /api/assets/x1/monitor refresh",
  "POST /api/assets/x1/network/baseline assets.edit",
  "POST /api/assets/x1/network refresh",
  "POST /api/assets/x1/optics refresh",
  "PATCH /api/assets/x1/redfish/bios bios",
  "DELETE /api/assets/x1/redfish/bios bios",
  "POST /api/assets/x1/redfish/bios bios",
  "POST /api/assets/x1/redfish/firmware firmware",
  "DELETE /api/assets/x1/redfish/logs logs.clear",
  "POST /api/assets/x1/redfish/media media",
  "PATCH /api/assets/x1/redfish bmc.settings",
  "PATCH /api/assets/x1 assets.edit",
  "DELETE /api/assets/x1 delete",
  "POST /api/assets/x1/sensors refresh",
  "POST /api/assets/import assets.edit",
  "POST /api/assets assets.edit",
  "POST /api/assets/export null",
  "POST /api/auth/challenge null",
  "POST /api/auth/login null",
  "POST /api/auth/logout null",
  "POST /api/catalog/autofill catalog",
  "PATCH /api/catalog/x1 catalog",
  "DELETE /api/catalog/x1 catalog",
  "POST /api/catalog catalog",
  "PATCH /api/customers/x1 dc.edit",
  "DELETE /api/customers/x1 delete",
  "POST /api/customers dc.edit",
  "PATCH /api/datacenters/x1 dc.edit",
  "DELETE /api/datacenters/x1 delete",
  "POST /api/datacenters dc.edit",
  "DELETE /api/files/x1 delete",
  "PUT /api/files files",
  "POST /api/firmware-lib/x1/analyze firmware",
  "PATCH /api/firmware-lib/x1 firmware",
  "DELETE /api/firmware-lib/x1 firmware",
  "PATCH /api/firmware-lib/uploads/x1 firmware",
  "DELETE /api/firmware-lib/uploads/x1 firmware",
  "POST /api/firmware-lib/uploads firmware",
  "DELETE /api/images/x1 delete",
  "POST /api/images images",
  "PATCH /api/images/uploads/x1 images",
  "DELETE /api/images/uploads/x1 images",
  "POST /api/images/uploads images",
  "POST /api/import-jobs/x1 assets.edit",
  "DELETE /api/import-jobs/x1 assets.edit",
  "PATCH /api/part-groups/x1 catalog",
  "DELETE /api/part-groups/x1 catalog",
  "POST /api/part-groups catalog",
  "PATCH /api/parts/x1 parts.edit",
  "DELETE /api/parts/x1 delete",
  "POST /api/parts/x1/status parts.status",
  "POST /api/parts parts.edit",
  "PUT /api/profiles/x1 images",
  "DELETE /api/profiles/x1 delete",
  "POST /api/profiles images",
  "POST /api/projects/x1/baseline install",
  "PUT /api/projects/x1/baseline install",
  "DELETE /api/projects/x1/baseline install",
  "POST /api/projects/x1/enable install",
  "POST /api/projects/x1/import install",
  "POST /api/projects/x1/reconcile install",
  "PUT /api/projects/x1 install",
  "DELETE /api/projects/x1 delete",
  "POST /api/projects/x1/servers install",
  "POST /api/projects/x1/servers/x1/reinstall install",
  "PUT /api/projects/x1/servers/x1 install",
  "DELETE /api/projects/x1/servers/x1 install",
  "POST /api/projects/x1/tasks null",
  "POST /api/projects install",
  "PATCH /api/racks/x1 dc.edit",
  "DELETE /api/racks/x1 delete",
  "POST /api/racks/import dc.edit",
  "POST /api/racks dc.edit",
  "PATCH /api/roles/x1 users",
  "DELETE /api/roles/x1 users",
  "POST /api/roles users",
  "PUT /api/settings/display settings",
  "PUT /api/settings/monitor settings",
  "PUT /api/settings/ssh-jumps settings",
  "POST /api/settings/ssh-jumps/test settings",
  "PUT /api/settings/tag settings",
  "PUT /api/sites/x1/layout dc.edit",
  "PATCH /api/sites/x1 dc.edit",
  "DELETE /api/sites/x1 delete",
  "POST /api/sites dc.edit",
  "PATCH /api/snmp-profiles/x1 settings",
  "DELETE /api/snmp-profiles/x1 settings",
  "POST /api/snmp-profiles settings",
  "POST /api/tasks null",
  "POST /api/tickets/x1/comments tickets",
  "POST /api/tickets/x1/replace tickets",
  "PATCH /api/tickets/x1 tickets",
  "POST /api/tickets/x1/status tickets",
  "POST /api/tickets tickets",
  "DELETE /api/users/x1/access-keys/x1 null",
  "POST /api/users/x1/access-keys null",
  "PATCH /api/users/x1 null",
  "DELETE /api/users/x1 null",
  "DELETE /api/users/x1/ssh-keys/x1 null",
  "POST /api/users/x1/ssh-keys null",
  "POST /api/users users",
];

/** 中间件只要登录的写接口，路由里必须自己查权限；这里写上各自靠什么查。 */
const SELF_CHECKED: Record<string, RegExp | null> = {
  "/api/auth/challenge": null,
  "/api/auth/login": null,
  "/api/auth/logout": null,
  // 导出只读：按选的机器和表生成 Excel，和 GET 一样登录了就能导。
  "/api/assets/export": null,
  "/api/tasks": /taskPermission\(/,
  "/api/projects/x1/tasks": /taskPermission\(/,
  "/api/users/x1": /requireSelfOrAdmin\(/,
  "/api/users/x1/access-keys": /requireSelfOrAdmin\(/,
  "/api/users/x1/access-keys/x1": /requireSelfOrAdmin\(/,
  "/api/users/x1/ssh-keys": /requireSelfOrAdmin\(/,
  "/api/users/x1/ssh-keys/x1": /requireSelfOrAdmin\(/,
};

const API = path.join(import.meta.dirname, "..", "app", "api");

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

function writeRoutes(): { method: string; pathname: string; source: string }[] {
  return routeFiles(API).flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    const pathname = "/api/" + path.relative(API, path.dirname(file)).split(path.sep).join("/").replace(/\[[^\]]+\]/g, "x1");
    const methods = [...source.matchAll(/export (?:async )?(?:function|const) (POST|PATCH|PUT|DELETE)\b/g)].map((match) => match[1]);
    return methods.map((method) => ({ method, pathname, source }));
  });
}

test("every write endpoint needs the permission in the table", () => {
  const actual = writeRoutes()
    .map(({ method, pathname }) => `${method} ${pathname} ${requiredPermission(method, pathname)}`)
    .sort();
  assert.deepEqual(actual, [...EXPECTED].sort());
});

test("endpoints the middleware lets through check permissions themselves", () => {
  for (const { method, pathname, source } of writeRoutes()) {
    if (requiredPermission(method, pathname) !== null) continue;
    assert.ok(pathname in SELF_CHECKED, `${method} ${pathname} 中间件只要登录，要在 SELF_CHECKED 里写清楚路由怎么查权限`);
    const check = SELF_CHECKED[pathname];
    if (check) assert.match(source, check, `${method} ${pathname} 没有自己查权限`);
  }
});

test("reads never need a permission point, unknown writes fall back to the admin-only one", () => {
  assert.equal(requiredPermission("DELETE", "/api/assets/x1/something-new"), "users");
  assert.equal(requiredPermission("GET", "/api/assets/x1/redfish"), null);
  assert.equal(requiredPermission("POST", "/api/something-new"), "users");
});
