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
  const name = `sp${depth}`;
  database.exec(depth ? `SAVEPOINT ${name}` : "BEGIN IMMEDIATE");
  depth++;
  try {
    const result = fn();
    depth--;
    database.exec(depth ? `RELEASE ${name}` : "COMMIT");
    return result;
  } catch (error) {
    depth--;
    database.exec(depth ? `ROLLBACK TO ${name}; RELEASE ${name}` : "ROLLBACK");
    throw error;
  }
}
