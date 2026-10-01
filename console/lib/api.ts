export function jsonError(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : "请求失败";
  return Response.json({ error: message }, { status });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("请求体不是 JSON");
  }
}
