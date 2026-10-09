import type { Datacenter, Site } from "@/lib/types";

/** 下拉框里的机房，按数据中心分组。wholeDatacenter 给了就在每组最前面加一项「整个数据中心」，值是 dc:<id>。 */
export function SiteOptions({ sites, datacenters, wholeDatacenter }: { sites: Site[]; datacenters: Datacenter[]; wholeDatacenter?: string }) {
  const known = new Set(datacenters.map((item) => item.id));
  const groups = [
    ...datacenters.map((datacenter) => ({ key: datacenter.id, label: `${datacenter.code} · ${datacenter.name}`, sites: sites.filter((site) => site.datacenterId === datacenter.id) })),
    { key: "", label: "没有数据中心", sites: sites.filter((site) => !known.has(site.datacenterId)) },
  ].filter((group) => group.sites.length || (wholeDatacenter && group.key));
  return groups.map((group) => (
    <optgroup key={group.key || "none"} label={group.label}>
      {wholeDatacenter && group.key ? <option value={`dc:${group.key}`}>{wholeDatacenter}</option> : null}
      {group.sites.map((site) => (
        <option key={site.id} value={site.id}>
          {site.code} · {site.name}
        </option>
      ))}
    </optgroup>
  ));
}
