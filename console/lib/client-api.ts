/**
 * 页面里调控制台接口的共用写法：JSON 或 FormData 请求体，统一给出 { ok, data, error }，连不上也不抛异常。
 */
export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  data: T;
  /** 出错时的提示（接口给的 error，或者「没有连上控制台」）。 */
  error: string;
}

export async function api<T = Record<string, unknown>>(url: string, method = "GET", body?: unknown): Promise<ApiResult<T>> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init).catch(() => null);
  if (!response) return { ok: false, data: {} as T, error: "没有连上控制台" };
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  return { ok: response.ok, data, error: response.ok ? "" : data?.error || `请求失败（HTTP ${response.status}）` };
}
