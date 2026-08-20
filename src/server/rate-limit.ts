type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult =
  { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export function takeGlobalRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const max = Math.max(1, Math.floor(limit));
  const window = Math.max(1_000, Math.floor(windowMs));
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + window };
    buckets.set(key, bucket);
  }
  if (bucket.count >= max) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  }
  bucket.count += 1;
  return { ok: true, remaining: Math.max(0, max - bucket.count) };
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "rate limit exceeded" }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(Math.max(1, Math.floor(retryAfterSeconds))),
      "x-content-type-options": "nosniff",
    },
  });
}
