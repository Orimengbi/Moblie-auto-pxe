import { jsonError, readJson } from "@/lib/api";
import { normalizeMac } from "@/lib/net";
import { createReport } from "@/lib/store";
import type { DiagCheck, ScriptResult } from "@/lib/types";

export const dynamic = "force-dynamic";

function asChecks(value: unknown): DiagCheck[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((item) => {
    const row = item as Partial<DiagCheck>;
    return {
      name: String(row.name || "check").slice(0, 40),
      ok: Boolean(row.ok),
      summary: String(row.summary || "").slice(0, 500),
      detail: row.detail ? String(row.detail).slice(0, 8000) : undefined,
    };
  });
}

function asScripts(value: unknown): ScriptResult[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((item) => {
    const row = item as Partial<ScriptResult>;
    return {
      id: String(row.id || ""),
      name: String(row.name || "script").slice(0, 80),
      exitCode: typeof row.exitCode === "number" ? row.exitCode : null,
      timedOut: Boolean(row.timedOut),
      blocked: Boolean(row.blocked),
      output: String(row.output || "").slice(0, 8000),
    };
  });
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{
      mac?: string;
      startedAt?: string;
      finishedAt?: string;
      checks?: unknown;
      scripts?: unknown;
      mountViolation?: boolean;
      ok?: boolean;
    }>(request);
    if (!body.mac) throw new Error("报告缺少 MAC");
    normalizeMac(body.mac);
    const report = await createReport({
      mac: body.mac,
      startedAt: body.startedAt || new Date().toISOString(),
      finishedAt: body.finishedAt || new Date().toISOString(),
      checks: asChecks(body.checks),
      scripts: asScripts(body.scripts),
      mountViolation: Boolean(body.mountViolation),
      ok: Boolean(body.ok),
    });
    return Response.json(report, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
