"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublicSnmpProfile } from "@/lib/types";

const BLANK = { name: "", version: "v2c", community: "", username: "", authProto: "SHA", authPass: "", privProto: "AES", privPass: "" };

/** SNMP 凭据：交换机、PDU 选用其中一套。密码保存后不再显示，留空表示不改。 */
export function SnmpProfileManager({ profiles }: { profiles: PublicSnmpProfile[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState("");

  function start(profile: PublicSnmpProfile | null) {
    setEditing(profile?.id || "new");
    setForm(profile ? { ...BLANK, name: profile.name, version: profile.version, username: profile.username, authProto: profile.authProto, privProto: profile.privProto } : BLANK);
    setError("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(editing === "new" ? "/api/snmp-profiles" : `/api/snmp-profiles/${editing}`, {
      method: editing === "new" ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setError(body?.error || "保存失败");
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function remove(profile: PublicSnmpProfile) {
    if (!window.confirm(`删除凭据「${profile.name}」？`)) return;
    const response = await fetch(`/api/snmp-profiles/${profile.id}`, { method: "DELETE" }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    setError(response?.ok ? "" : body?.error || "删除失败");
    router.refresh();
  }

  const field = (key: keyof typeof BLANK) => ({ value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value }) });
  const isNew = editing === "new";

  return (
    <div className="grid max-w-3xl gap-4">
      <ul className="grid gap-2 text-sm">
        {profiles.map((profile) => (
          <li key={profile.id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{profile.name}</span>
            <span className="text-muted-foreground">
              {profile.version === "v2c" ? "v2c" : `v3 · ${profile.username} · ${profile.authProto || "不认证"} / ${profile.privProto || "不加密"}`}
            </span>
            <Button type="button" size="xs" variant="ghost" onClick={() => start(profile)}>
              编辑
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => void remove(profile)}>
              删除
            </Button>
          </li>
        ))}
        {profiles.length === 0 ? <li className="text-muted-foreground">还没有凭据。交换机上开 SNMP（只读即可）后在这里建一套。</li> : null}
      </ul>
      {editing ? (
        <form onSubmit={save} className="grid gap-3 rounded-md border p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">名称</span>
              <Input {...field("name")} required placeholder="例如 机房只读 v3" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">版本</span>
              <NativeSelect {...field("version")}>
                <option value="v2c">v2c</option>
                <option value="v3">v3</option>
              </NativeSelect>
            </label>
            {form.version === "v2c" ? (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Community</span>
                <Input {...field("community")} type="password" autoComplete="new-password" placeholder={isNew ? "" : "留空不改"} required={isNew} />
              </label>
            ) : (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">用户名</span>
                <Input {...field("username")} required />
              </label>
            )}
          </div>
          {form.version === "v3" ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">认证</span>
                <NativeSelect {...field("authProto")}>
                  <option value="">不认证</option>
                  {["MD5", "SHA", "SHA-256", "SHA-512"].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">认证密码</span>
                <Input {...field("authPass")} type="password" autoComplete="new-password" placeholder={isNew ? "至少 8 位" : "留空不改"} />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">加密</span>
                <NativeSelect {...field("privProto")}>
                  <option value="">不加密</option>
                  {["DES", "AES", "AES-256"].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">加密密码</span>
                <Input {...field("privPass")} type="password" autoComplete="new-password" placeholder={isNew ? "至少 8 位" : "留空不改"} />
              </label>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              保存
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => start(null)}>
            新建凭据
          </Button>
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
