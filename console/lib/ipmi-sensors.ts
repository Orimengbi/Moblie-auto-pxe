import fs from "node:fs";
import path from "node:path";
import { withAccount } from "./ipmi-sel.ts";
import { defaultIpmiExec, type IpmiExec } from "./ipmi-remote.ts";
import { parseSdr, sdrCachePath, sensorSeverity } from "./monitor.ts";
import type { Asset, SensorReading } from "./types.ts";

/** 侧栏「传感器」的分组，按单位认。 */
export type SensorGroup = "temperature" | "fan" | "voltage" | "power" | "current" | "state" | "other";

export interface SensorRow {
  name: string;
  group: SensorGroup;
  /** 数值型的读数；状态型（discrete）是 null。 */
  value: number | null;
  unit: string;
  /** ok、nc、cr、nr……状态型给 sdr 解出来的文字，如 Presence detected。 */
  status: string;
  text: string;
  severity: SensorReading["severity"];
  /** 下限：不可恢复、严重、警告；上限：警告、严重、不可恢复。没有是 null。 */
  thresholds: { lnr: number | null; lc: number | null; lnc: number | null; unc: number | null; uc: number | null; unr: number | null };
}

function groupOf(unit: string, discrete: boolean): SensorGroup {
  if (discrete) return "state";
  if (/degrees/i.test(unit)) return "temperature";
  if (/rpm/i.test(unit)) return "fan";
  if (/volts/i.test(unit)) return "voltage";
  if (/watts/i.test(unit)) return "power";
  if (/amps/i.test(unit)) return "current";
  return "other";
}

function number(cell: string | undefined): number | null {
  if (!cell || /^na$/i.test(cell.trim())) return null;
  const value = Number(cell.trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * 解析 `ipmitool sensor`（不带 -v）：名称 | 读数 | 单位 | 状态 | 下不可恢复 | 下严重 | 下警告 | 上警告 | 上严重 | 上不可恢复。
 * 状态型传感器的单位是 discrete、状态是 0x0180 这种位图，文字从 sdr elist 的同名行补（sdrText）。
 */
export function parseSensorList(text: string, sdrText: Map<string, SensorReading> = new Map()): SensorRow[] {
  const out: SensorRow[] = [];
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4 || !cells[0]) continue;
    const [name, reading, unit, status, lnr, lc, lnc, unc, uc, unr] = cells;
    const discrete = /discrete/i.test(unit);
    const sdr = sdrText.get(name);
    const value = discrete ? null : number(reading);
    // 读不到（na）的数值传感器多半是没装那个部件，不算异常。
    const severity = discrete ? (sdr?.severity ?? null) : value === null ? null : sensorSeverity(status, reading);
    out.push({
      name,
      group: groupOf(unit, discrete),
      value,
      unit: discrete ? "" : unit.replace(/^degrees C$/i, "°C").replace(/^Volts$/i, "V").replace(/^Watts$/i, "W").replace(/^Amps$/i, "A"),
      status: discrete ? sdr?.status || "" : status.toLowerCase(),
      text: discrete ? sdr?.reading || status : value === null ? "没有读数" : "",
      severity,
      thresholds: { lnr: number(lnr), lc: number(lc), lnc: number(lnc), unc: number(unc), uc: number(uc), unr: number(unr) },
    });
  }
  return out;
}

export interface SensorsReading {
  at: string;
  sensors: SensorRow[];
}

/** 最近一次读到的传感器表，和 SDR 缓存放在一起。 */
export function sensorsPath(assetId: string): string {
  return path.join(path.dirname(sdrCachePath(assetId)), `${assetId}.sensors.json`);
}

/** 上次手动读到的传感器表，没读过是 null。 */
export function lastSensors(assetId: string): SensorsReading | null {
  if (!/^[0-9a-f-]{36}$/.test(assetId)) return null;
  try {
    return JSON.parse(fs.readFileSync(sensorsPath(assetId), "utf8")) as SensorsReading;
  } catch {
    return null;
  }
}

/** 读一次并存下，页面打开时显示这次的结果。 */
export async function readAndSaveSensors(asset: Asset): Promise<SensorsReading> {
  const reading = await readSensors(asset);
  const file = sensorsPath(asset.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(reading));
  fs.renameSync(`${file}.tmp`, file);
  return reading;
}

/** 读整张传感器表。用监控存下的 SDR 缓存，一台两三秒。 */
export async function readSensors(asset: Asset, exec: IpmiExec = (host, user, password, args) => defaultIpmiExec(host, user, password, args, 120_000, false)): Promise<SensorsReading> {
  return withAccount(asset, exec, async (account) => {
    const cache = sdrCachePath(asset.id);
    const cached = fs.existsSync(cache) ? ["-S", cache] : [];
    const [list, sdr] = await Promise.all([
      exec(asset.bmcIp, account.user, account.password, [...cached, "sensor"]),
      exec(asset.bmcIp, account.user, account.password, [...cached, "sdr", "elist"]),
    ]);
    if (list.code !== 0 && !list.stdout.trim()) throw new Error(`读传感器失败：${(list.stderr || "BMC 没有返回").trim().slice(0, 160)}`);
    const byName = new Map(parseSdr(sdr.stdout).map((item) => [item.name, item]));
    return { at: new Date().toISOString(), sensors: parseSensorList(list.stdout, byName) };
  });
}
