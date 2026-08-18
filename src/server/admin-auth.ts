import { timingSafeEqual } from "node:crypto";

function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isAdminRequest(request: Request): boolean {
  const configured = String(process.env.CROWDCLAW_ADMIN_TOKEN || "").trim();
  if (configured) {
    const supplied = String(
      request.headers.get("x-crowdclaw-admin-token") || "",
    ).trim();
    return Boolean(supplied) && secureEqual(supplied, configured);
  }

  // Local development remains zero-config. Remote deployments must configure
  // CROWDCLAW_ADMIN_TOKEN before process-control APIs become reachable.
  const hostname = new URL(request.url).hostname.toLowerCase();
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}
