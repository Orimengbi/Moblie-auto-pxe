import path from "node:path";
import { dataDir, ensureDataDirs } from "./paths.ts";

/**
 * 资产、客户、审计这些要查询和关联的数据放在 data/pxe.db（SQLite）。镜像、采集记录、任务日志还是文件。
 * 用 Node 自带的 node:sqlite，不加依赖；经 getBuiltinModule 加载，免得打包器去解析这个模块。
 * 控制台和执行任务的子进程都会打开它，所以开 WAL，写冲突时等一会儿。
 */

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface Statement {
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
  all(...params: SqlValue[]): Record<string, SqlValue>[];
}

export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

type SqliteModule = { DatabaseSync: new (file: string) => Database };

/** 每一版加在最后，不改前面的。启动时按 user_version 补跑没跑过的。 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE,
    tag_override TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    sn TEXT NOT NULL UNIQUE,
    vendor TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    owner TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    bmc_mac TEXT NOT NULL DEFAULT '',
    bmc_ip TEXT NOT NULL DEFAULT '',
    bmc_user TEXT NOT NULL DEFAULT '',
    bmc_password TEXT NOT NULL DEFAULT '',
    bmc_fallback_user TEXT NOT NULL DEFAULT '',
    bmc_fallback_password TEXT NOT NULL DEFAULT '',
    boot_mac TEXT NOT NULL DEFAULT '',
    os_address TEXT NOT NULL DEFAULT '',
    os_netmask TEXT NOT NULL DEFAULT '',
    hostname TEXT NOT NULL DEFAULT '',
    purchase_supplier TEXT NOT NULL DEFAULT '',
    purchase_order TEXT NOT NULL DEFAULT '',
    purchase_date TEXT NOT NULL DEFAULT '',
    purchase_price TEXT NOT NULL DEFAULT '',
    warranty_vendor TEXT NOT NULL DEFAULT '',
    warranty_level TEXT NOT NULL DEFAULT '',
    warranty_start TEXT NOT NULL DEFAULT '',
    warranty_end TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX assets_customer ON assets(customer_id);
  CREATE INDEX assets_status ON assets(status);
  CREATE TABLE asset_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL,
    at TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX asset_events_asset ON asset_events(asset_id, at);
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    target_label TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    ok INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX audit_at ON audit_log(at);
  CREATE INDEX audit_target ON audit_log(target_id, at);
  `,
  `
  CREATE TABLE sites (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE racks (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id),
    name TEXT NOT NULL,
    row_label TEXT NOT NULL DEFAULT '',
    height_u INTEGER NOT NULL,
    power_kw TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (site_id, name)
  );
  ALTER TABLE assets ADD COLUMN rack_id TEXT REFERENCES racks(id) ON DELETE SET NULL;
  ALTER TABLE assets ADD COLUMN u_start INTEGER;
  ALTER TABLE assets ADD COLUMN u_height INTEGER NOT NULL DEFAULT 1;
  CREATE INDEX assets_rack ON assets(rack_id);
  `,
  `
  CREATE TABLE parts (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    vendor TEXT NOT NULL DEFAULT '',
    sn TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
    bin TEXT NOT NULL DEFAULT '',
    asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
    slot TEXT NOT NULL DEFAULT '',
    supplier TEXT NOT NULL DEFAULT '',
    purchase_order TEXT NOT NULL DEFAULT '',
    warranty_end TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX parts_sn ON parts(sn) WHERE sn != '';
  CREATE INDEX parts_asset ON parts(asset_id);
  CREATE INDEX parts_status ON parts(status);
  CREATE TABLE part_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id TEXT NOT NULL,
    at TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    ticket_id TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX part_events_part ON part_events(part_id, at);
  CREATE TABLE tickets (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE,
    asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    assignee TEXT NOT NULL DEFAULT '',
    reporter TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    vendor_case TEXT NOT NULL DEFAULT '',
    prev_asset_status TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT NOT NULL DEFAULT '',
    closed_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX tickets_asset ON tickets(asset_id);
  CREATE INDEX tickets_status ON tickets(status);
  CREATE TABLE ticket_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL,
    at TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX ticket_logs_ticket ON ticket_logs(ticket_id, id);
  `,
  `
  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    source TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    sticky INTEGER NOT NULL DEFAULT 0,
    count INTEGER NOT NULL DEFAULT 1,
    first_at TEXT NOT NULL,
    last_at TEXT NOT NULL,
    acked_by TEXT NOT NULL DEFAULT '',
    acked_at TEXT NOT NULL DEFAULT '',
    resolved_by TEXT NOT NULL DEFAULT '',
    resolved_at TEXT NOT NULL DEFAULT '',
    ticket_id TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX alerts_open ON alerts(status, asset_id, key);
  CREATE TABLE monitor_state (
    asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    bmc_at TEXT NOT NULL DEFAULT '',
    bmc_ok INTEGER NOT NULL DEFAULT 0,
    bmc_error TEXT NOT NULL DEFAULT '',
    bmc_failures INTEGER NOT NULL DEFAULT 0,
    sensors TEXT NOT NULL DEFAULT '[]',
    sel_last TEXT NOT NULL DEFAULT '',
    sel_recent TEXT NOT NULL DEFAULT '[]',
    os_at TEXT NOT NULL DEFAULT '',
    os_ok INTEGER NOT NULL DEFAULT 0,
    os_error TEXT NOT NULL DEFAULT '',
    gpus TEXT NOT NULL DEFAULT '[]',
    disks TEXT NOT NULL DEFAULT '[]'
  );
  `,
  `
  CREATE TABLE snmp_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    version TEXT NOT NULL,
    community TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    auth_proto TEXT NOT NULL DEFAULT '',
    auth_pass TEXT NOT NULL DEFAULT '',
    priv_proto TEXT NOT NULL DEFAULT '',
    priv_pass TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ALTER TABLE assets ADD COLUMN mgmt_ip TEXT NOT NULL DEFAULT '';
  ALTER TABLE assets ADD COLUMN snmp_profile_id TEXT REFERENCES snmp_profiles(id) ON DELETE SET NULL;
  ALTER TABLE monitor_state ADD COLUMN ports TEXT NOT NULL DEFAULT '[]';
  `,
  `
  ALTER TABLE monitor_state ADD COLUMN os_ok_at TEXT NOT NULL DEFAULT '';
  CREATE INDEX parts_sn_upper ON parts(UPPER(sn)) WHERE sn != '';
  `,
  `
  ALTER TABLE racks ADD COLUMN pos_x INTEGER;
  ALTER TABLE racks ADD COLUMN pos_y INTEGER;
  ALTER TABLE racks ADD COLUMN facing TEXT NOT NULL DEFAULT '';
  `,
  `
  ALTER TABLE racks ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE floor_items (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    w INTEGER NOT NULL DEFAULT 1,
    h INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX floor_items_site ON floor_items(site_id);
  `,
  // 机房上面加一层数据中心。已经有机房的，建一个默认数据中心把它们都放进去，之后在页面上改名。
  `
  CREATE TABLE datacenters (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ALTER TABLE sites ADD COLUMN datacenter_id TEXT REFERENCES datacenters(id);
  CREATE INDEX sites_datacenter ON sites(datacenter_id);
  INSERT INTO datacenters (id, code, name, note, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), 'DC1', '默认数据中心', '升级时自动建的，原来的机房都放在这里，改成实际的代码和名称', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE EXISTS (SELECT 1 FROM sites);
  UPDATE sites SET datacenter_id = (SELECT id FROM datacenters LIMIT 1) WHERE datacenter_id IS NULL;
  `,
  // BMC 经 Redfish SSE 推来的事件，每台只留最近的一批。
  `
  CREATE TABLE bmc_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT '',
    message_id TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX bmc_events_asset ON bmc_events(asset_id, id);
  `,
  // 机房平面图：机房的长宽（格子数，0 是没设，不画外墙），门这类开在墙上的东西记在哪面墙。
  `
  ALTER TABLE sites ADD COLUMN floor_w INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sites ADD COLUMN floor_h INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE floor_items ADD COLUMN side TEXT NOT NULL DEFAULT '';
  `,
];

let opened: { file: string; db: Database } | null = null;

export function dbPath(): string {
  return path.join(dataDir(), "pxe.db");
}

export function db(): Database {
  const file = dbPath();
  // 测试会换数据目录，换了就重新打开。
  if (opened?.file === file) return opened.db;
  opened?.db.close();
  ensureDataDirs();
  const sqlite = (process as unknown as { getBuiltinModule(id: string): SqliteModule }).getBuiltinModule("node:sqlite");
  const database = new sqlite.DatabaseSync(file);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  migrate(database);
  opened = { file, db: database };
  return database;
}

function migrate(database: Database): void {
  const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  for (let next = version; next < MIGRATIONS.length; next++) {
    transaction(database, () => {
      database.exec(MIGRATIONS[next]);
      database.exec(`PRAGMA user_version = ${next + 1}`);
    });
  }
}

let depth = 0;

/** 嵌套调用时里层用 SAVEPOINT：里层失败只撤销里层，外层可以接着做或整个撤销（批量导入的预览就是整个撤销）。 */
export function transaction<T>(database: Database, fn: () => T): T {
  const outer = depth === 0;
  const name = `sp${depth}`;
  database.exec(outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
  depth++;
  try {
    const result = fn();
    database.exec(outer ? "COMMIT" : `RELEASE ${name}`);
    return result;
  } catch (error) {
    // 提交本身失败时 SQLite 可能已经自己回滚了，这里再回滚会报错；不能让它盖掉原来的错误。
    try {
      database.exec(outer ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
    } catch {
      // 已经没有事务可回滚。
    }
    throw error;
  } finally {
    depth--;
  }
}

// ---------- 共用的小工具 ----------

/** settings 表里存的 JSON。读不出来当没存。 */
export function getSetting<T>(key: string): T | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return null;
  try {
    return JSON.parse(String(row.value)) as T;
  } catch {
    return null;
  }
}

export function putSetting(key: string, value: unknown): void {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

class Preview<T> extends Error {
  readonly result: T;
  constructor(result: T) {
    super("preview");
    this.result = result;
  }
}

/** 在一个事务里跑 fn。dryRun 时照常跑完拿到结果，然后整个撤销（批量导入的预览）。 */
export function runOrPreview<T>(dryRun: boolean | undefined, fn: () => T): T {
  try {
    return transaction(db(), () => {
      const result = fn();
      if (dryRun) throw new Preview(result);
      return result;
    });
  } catch (error) {
    if (error instanceof Preview) return error.result as T;
    throw error;
  }
}

/** 某张表里某一列等于 value 的行数。表名、列名只由代码传常量。 */
export function countWhere(table: string, column: string, value: string): number {
  return Number(db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(value)?.n ?? 0);
}

/** 代码（客户代码、机房代码）在这张表里不能重复。 */
export function assertCodeFree(table: string, code: string, selfId: string | null, label: string): void {
  const clash = db().prepare(`SELECT name FROM ${table} WHERE code = ? AND id != ?`).get(code, selfId || "");
  if (clash) throw new Error(`${label} ${code} 已经给了「${clash.name}」`);
}
