import { ensureAgentWorker } from "../src/server/worker/worker";

/**
 * Server-only CrowdClaw bootstrap. TradJS executes root middleware for page and
 * API requests, so the embedded autonomous worker does not depend on server.ts
 * being the process entrypoint. The call is idempotent.
 */
export default function middleware(): void {
  ensureAgentWorker();
}
