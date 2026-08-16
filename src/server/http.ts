export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function jsonBody<T>(
  request: Request,
  maxBytes = 16_384,
): Promise<T> {
  const declared = Number.parseInt(
    request.headers.get("content-length") || "0",
    10,
  );
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new Error("request body too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error("request body too large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("invalid JSON body");
  }
}
