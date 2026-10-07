import assert from "node:assert/strict";
import test from "node:test";
import { OPTICS_SCRIPT, opticsComponents, parseLaneValues, parseOptics, powerLevel } from "./optics.ts";

/** 照 CX8 上一个 twin-port OSFP 的 mlxlink -m --json 删减，序列号换掉了。 */
const MLX_PORT = `{
	"result" : {
		"output" : {
			"Module Info" : {
				"Active Set Media Compliance Code" : "400GBASE-DR4",
				"CDR RX" : { "values" : [ "ON", "ON", "ON", "ON" ] },
				"Cable Type" : "Optical Module (separated)",
				"Compliance" : ",400GBASE-DR4",
				"FW Version" : "80.1.0",
				"Identifier" : "OSFP",
				"Rx Power Current [dBm]" : "0,2,-9,0 [-8..6]",
				"SMF Length" : "500m",
				"Temperature [C]" : "48 [-5..75]",
				"Tx Power Current [dBm]" : "2,2,2,2 [-6..6]",
				"Vendor Name" : "ACCELINK",
				"Vendor Part Number" : "RTXM600-2401        ",
				"Vendor Serial Number" : "MODSN0001   ",
				"Voltage [mV]" : "3273.6 [2970..3630]",
				"Wavelength [nm]" : "1311"
			}
		}
	},
	"status" : { "code" : 0, "message" : "success" }
}`;

const MLX_EMPTY = `{ "result" : { "output" : { "Module Info" : { "Identifier" : "N/A", "Vendor Name" : "N/A", "Rx Power Current [dBm]" : "N/A" } } }, "status" : { "code" : 0 } }`;

const ETHTOOL_QSFP = `	Identifier                                : 0x11 (QSFP28)
	Connector                                 : 0x07 (LC)
	Transceiver type                          : 100G Ethernet: 100G Base-LR4 or 25GBase-LR
	Vendor name                               : FINISAR CORP
	Vendor PN                                 : FTLC1154RDPL
	Vendor rev                                : A0
	Vendor SN                                 : X3AB123
	Laser wavelength                          : 1310.000nm
	Module temperature                        : 35.12 degrees C / 95.22 degrees F
	Module voltage                            : 3.2918 V
	Transmit avg optical power (Channel 1)    : 0.8000 mW / -0.97 dBm
	Transmit avg optical power (Channel 2)    : 0.7943 mW / -1.00 dBm
	Rcvr signal avg optical power(Channel 1)  : 0.0000 mW / -inf dBm
	Rcvr signal avg optical power(Channel 2)  : 0.6310 mW / -2.00 dBm
	Laser output power high alarm threshold   : 3.1623 mW / 5.00 dBm
	Laser output power low alarm threshold    : 0.1585 mW / -8.00 dBm
	Laser rx power high alarm threshold       : 3.1623 mW / 5.00 dBm
	Laser rx power low alarm threshold        : 0.0457 mW / -13.40 dBm
`;

const OUTPUT = `===PXEOPT mlx mlx5_2 0000:03:00.0 enp3s0f0np0 ===
${MLX_PORT}
===PXEOPT mlx mlx5_10 0000:d9:00.0 ibs11f0 ===
\u001b[31m
-E- Checking valid firmware raised the following exception: Failed to send access register: ICMD error 0x4

\u001b[0m
===PXEOPT mlx mlx5_12 0000:d9:00.2 ibs11f2 ===
${MLX_EMPTY}
===PXEOPT eth ens1f0 0000:41:00.0===
${ETHTOOL_QSFP}
===PXEOPT eth eno1 0000:51:00.0===
netlink error: Invalid argument
===PXEOPT eth ens2 0000:61:00.0===
Offset		Values
------		------
0x0000:		19 52 04 07 01 00 00 00 01 00 00 00 00 00 30 6c
===PXEOPT end===
`;

test("reads module identity and per-lane power from mlxlink and ethtool -m", () => {
  const ports = parseOptics(OUTPUT);
  assert.deepEqual(
    ports.map((port) => [port.port, port.present]),
    [
      ["enp3s0f0np0", true],
      ["ibs11f0", false],
      ["ens1f0", true],
      ["ens2", false],
    ],
    "没插模块的口和电口不列，读错的列出来",
  );
  const [osfp, broken, qsfp, raw] = ports;
  assert.equal(osfp.rdma, "mlx5_2");
  assert.equal(osfp.vendor, "ACCELINK");
  assert.equal(osfp.model, "RTXM600-2401");
  assert.equal(osfp.sn, "MODSN0001");
  assert.equal(osfp.firmware, "80.1.0");
  assert.equal(osfp.type, "OSFP");
  assert.equal(osfp.compliance, "400GBASE-DR4");
  assert.equal(osfp.wavelengthNm, 1311);
  assert.equal(osfp.length, "500m");
  assert.equal(osfp.temperatureC, 48);
  assert.equal(osfp.voltageV, 3.274);
  assert.deepEqual(osfp.rx, [0, 2, -9, 0]);
  assert.deepEqual(osfp.rxRange, [-8, 6]);
  assert.deepEqual(osfp.tx, [2, 2, 2, 2]);
  assert.deepEqual(osfp.txRange, [-6, 6]);
  assert.match(broken.error || "", /^Checking valid firmware raised/);

  assert.equal(qsfp.source, "ethtool");
  assert.equal(qsfp.type, "QSFP28");
  assert.equal(qsfp.model, "FTLC1154RDPL");
  assert.equal(qsfp.sn, "X3AB123");
  assert.equal(qsfp.compliance, "100G Base-LR4 or 25GBase-LR");
  assert.equal(qsfp.wavelengthNm, 1310);
  assert.equal(qsfp.temperatureC, 35.12);
  assert.deepEqual(qsfp.tx, [-0.97, -1]);
  assert.deepEqual(qsfp.rx, [-40, -2], "没光（-inf）当作 -40 dBm");
  assert.deepEqual(qsfp.rxRange, [-13.4, 5]);
  assert.deepEqual(qsfp.txRange, [-8, 5]);
  assert.match(raw.error || "", /ethtool 解不了/);

  const parts = opticsComponents(ports);
  assert.deepEqual(parts.map((part) => [part.kind, part.slot, part.model, part.sn]), [
    ["transceiver", "enp3s0f0np0", "RTXM600-2401", "MODSN0001"],
    ["transceiver", "ens1f0", "FTLC1154RDPL", "X3AB123"],
  ]);
  assert.deepEqual(parts[0].attrs, { type: "OSFP", compliance: "400GBASE-DR4", wavelengthNm: 1311, length: "500m", cable: "Optical Module (separated)", rdma: "mlx5_2" });
});

test("judges each lane against the module's own alarm thresholds", () => {
  assert.deepEqual(parseLaneValues("0,2,0,0 [-8..6]"), { values: [0, 2, 0, 0], range: [-8, 6] });
  assert.deepEqual(parseLaneValues("N/A"), { values: [] });
  assert.equal(powerLevel(0, [-8, 6]), "ok");
  assert.equal(powerLevel(-7, [-8, 6]), "warn");
  assert.equal(powerLevel(-9, [-8, 6]), "bad");
  assert.equal(powerLevel(7, [-8, 6]), "bad");
  assert.equal(powerLevel(-30), "ok", "没有门限就不判断");
});

test("the optics script only reads", () => {
  assert.match(OPTICS_SCRIPT, /mlxlink -d "\$\(basename "\$d"\)" -m --json/);
  assert.match(OPTICS_SCRIPT, /ethtool -m /);
  assert.doesNotMatch(OPTICS_SCRIPT, /mlxlink[^\n]*(--port_state|-a |--pc|--set|--fec|--speeds)/);
  assert.doesNotMatch(OPTICS_SCRIPT, /\b(rm|dd|reboot|ip link set)\b/);
});
