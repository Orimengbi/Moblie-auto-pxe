import type { IpmiSetting, Machine, MachineFact, NicPlan, PowerState } from "./types.ts";

export interface MachineRow {
  key: string;
  sn: string;
  mac: string;
  hostname: string;
  nic: string;
  ipmi: string;
  biosVersion: string;
  bmcVersion: string;
  osVersion: string;
  power: PowerState;
  seen: string;
}

export function mergeMachineRows(input: {
  machines: Machine[];
  nics: NicPlan[];
  ipmi: IpmiSetting[];
  facts: MachineFact[];
}): MachineRow[] {
  const byMac = new Map(input.machines.map((machine) => [machine.mac, machine]));
  const rows = new Map<string, MachineRow>();
  function row(key: string): MachineRow {
    const current = rows.get(key);
    if (current) return current;
    const created: MachineRow = {
      key,
      sn: "",
      mac: "",
      hostname: "",
      nic: "",
      ipmi: "",
      biosVersion: "",
      bmcVersion: "",
      osVersion: "",
      power: "unknown",
      seen: "",
    };
    rows.set(key, created);
    return created;
  }
  for (const plan of input.nics) {
    const item = row(plan.sn);
    item.sn = plan.sn;
    item.mac = plan.mac || item.mac;
    item.hostname = plan.hostname || "";
    item.nic = plan.address;
    const seen = plan.mac ? byMac.get(plan.mac) : undefined;
    if (seen?.lastSeen) item.seen = seen.lastSeen;
  }
  for (const setting of input.ipmi) {
    const item = row(setting.sn);
    item.sn = setting.sn;
    item.ipmi = setting.mode === "static" ? setting.address || "" : "DHCP";
  }
  for (const fact of input.facts) {
    const item = row(fact.sn);
    item.sn = fact.sn;
    item.mac = fact.mac || item.mac;
    if (fact.ipmiAddress) item.ipmi = fact.ipmiAddress;
    item.biosVersion = fact.biosVersion || "";
    item.bmcVersion = fact.bmcVersion || "";
    item.osVersion = fact.osVersion || "";
    item.power = fact.power;
    const seen = fact.mac ? byMac.get(fact.mac) : undefined;
    if (seen?.lastSeen) item.seen = seen.lastSeen;
  }
  for (const machine of input.machines) {
    const planned = input.nics.find((plan) => plan.mac === machine.mac) || input.facts.find((fact) => fact.mac === machine.mac);
    const item = row(planned?.sn || machine.mac);
    item.mac = machine.mac;
    if (!item.nic && machine.fixedIp) item.nic = machine.fixedIp;
    if (machine.lastSeen) item.seen = machine.lastSeen;
  }
  return [...rows.values()];
}
