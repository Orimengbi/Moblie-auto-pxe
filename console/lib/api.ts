import { audit, type AuditInput } from "./assets.ts";
import * as XLSX from "xlsx";
import { AuthError, authenticate, clientAddress, requireUser, type Identity } from "./auth.ts";
import type { RemoteTask } from "./types.ts";

export function jsonError(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : "请求失败";
  return Response.json({ error: message }, { status: error instanceof AuthError ? error.status : status });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("请求体不是 JSON");
  }
}

/** 记一条操作审计：谁、从哪个地址、对什么做了什么。 */
export function auditRequest(request: Request, identity: Identity | null, entry: Omit<AuditInput, "actor" | "ip">): void {
  audit({ ...entry, actor: identity?.user.username || "未登录", ip: clientAddress(request.headers) });
}

/** 批量任务的审计：一台时对象是那台资产，多台时是任务本身。 */
export function auditTask(request: Request, identity: Identity, task: RemoteTask): void {
  const kind = task.kind === "inventory" ? "采集硬件" : task.kind === "revoke" ? "交付清理" : "执行脚本";
  const sns = task.targets.map((target) => target.sn);
  auditRequest(request, identity, {
    action: `发起任务：${kind}`,
    targetType: "task",
    targetId: task.targets.length === 1 ? task.targets[0].serverId : task.id,
    targetLabel: `${task.name}（${sns.length} 台）`,
    detail: `${sns.slice(0, 50).join(" ")}${sns.length > 50 ? " …" : ""}${task.kind === "script" ? `\n${task.script.slice(0, 1500)}` : ""}`,
  });
}

type AuditEntry = Omit<AuditInput, "actor" | "ip" | "ok">;

/** 执行一个改动并记审计：成功记结果，失败记错误信息再抛出去。entry 可以按结果补对象名。 */
export async function audited<T>(request: Request, entry: AuditEntry | ((result: T | null) => AuditEntry), work: () => T | Promise<T>): Promise<T> {
  const identity = authenticate(request.headers);
  const describe = (result: T | null) => (typeof entry === "function" ? entry(result) : entry);
  try {
    const result = await work();
    auditRequest(request, identity, describe(result));
    return result;
  } catch (error) {
    const base = describe(null);
    auditRequest(request, identity, { ...base, detail: [base.detail, error instanceof Error ? error.message : "失败"].filter(Boolean).join("："), ok: false });
    throw error;
  }
}

/**
 * 读上传的表格（multipart 里的 file）：xlsx/xls 按第一张表读；CSV 全按文字读，免得长序列号、MAC 被转成数字。
 * raw 为 true 时数字和日期给原始值（日期是 Excel 序列号），否则给表格里显示的文字。
 */
export async function readSheetUpload(request: Request, options: { maxMB: number; raw: boolean }): Promise<{ form: FormData; file: File; rows: unknown[][] }> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("请选择 Excel 文件");
  if (file.size > options.maxMB * 1024 * 1024) throw new Error(`表格不能超过 ${options.maxMB}MB`);
  const buffer = Buffer.from(await file.arrayBuffer());
  const book = file.name.toLowerCase().endsWith(".csv") ? XLSX.read(buffer.toString("utf8"), { type: "string", raw: true }) : XLSX.read(buffer, { type: "buffer" });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error("Excel 里没有工作表");
  return { form, file, rows: XLSX.utils.sheet_to_json(sheet, { header: 1, raw: options.raw, defval: "" }) as unknown[][] };
}

/** 生成一张 xlsx 下载。文件名可以有中文（按 RFC 5987 编码，HTTP 头里不能直接放中文）。 */
export function xlsxResponse(rows: unknown[][], sheetName: string, filename: string): Response {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  const body = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

/** 校验登录，失败时给出 401/403 响应而不是抛异常（用在 try 外面需要 identity 的路由）。 */
export function userOrResponse(request: Request): Identity | Response {
  try {
    return requireUser(request);
  } catch (error) {
    return jsonError(error);
  }
}
