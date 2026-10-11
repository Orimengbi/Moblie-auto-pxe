import assert from "node:assert/strict";
import test from "node:test";
import { parseSensorList } from "./ipmi-sensors.ts";
import { parseSdr } from "./monitor.ts";

// 6QM8N72HMA0041 上 ipmitool sensor / sdr elist 的原样输出（节选）。
const SENSOR = `GPU0_CX8_TEMP    | 67.000     | degrees C  | ok    | na        | na        | na        | 105.000   | 108.000   | na
GPU_80_FAN_7     | 0.000      | RPM        | lcr   | na        | 500.000   | 1000.000  | na        | na        | na
P12V             | 12.096     | Volts      | ok    | 10.200    | 10.800    | na        | na        | 13.200    | 13.800
PSU_IN_POWER     | 3120.000   | Watts      | ok    | na        | na        | na        | na        | na        | na
DIMM_A9_TEMP     | na         | degrees C  | na    | na        | na        | na        | 85.000    | 90.000    | na
PS6_Status       | 0x1        | discrete   | 0x0180| na        | na        | na        | na        | na        | na
`;
const SDR = `PS6_Status       | EFh | ok  | 10.6 | Presence detected, Power Supply AC lost
`;

test("ipmitool sensor rows are grouped with thresholds and severity", () => {
  const rows = parseSensorList(SENSOR, new Map(parseSdr(SDR).map((item) => [item.name, item])));
  assert.deepEqual(
    rows.map((row) => [row.name, row.group, row.value, row.unit, row.severity]),
    [
      ["GPU0_CX8_TEMP", "temperature", 67, "°C", null],
      ["GPU_80_FAN_7", "fan", 0, "RPM", "critical"],
      ["P12V", "voltage", 12.096, "V", null],
      ["PSU_IN_POWER", "power", 3120, "W", null],
      ["DIMM_A9_TEMP", "temperature", null, "°C", null],
      ["PS6_Status", "state", null, "", "critical"],
    ],
  );
  assert.deepEqual(rows[0].thresholds, { lnr: null, lc: null, lnc: null, unc: 105, uc: 108, unr: null });
  assert.equal(rows[5].text, "Presence detected, Power Supply AC lost");
});
