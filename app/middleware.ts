/**
 * Legacy overlay tombstone.
 *
 * CrowdClaw used to bootstrap an embedded shared worker from root middleware.
 * Agents are now separate bgrun-managed per-project processes, so middleware
 * intentionally does nothing. Keeping this file prevents an old middleware.ts
 * from surviving when a newer release is extracted over an existing checkout.
 */
export default function middleware(): void {
  // Intentionally empty.
}
