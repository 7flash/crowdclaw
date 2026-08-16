import { readyHealth } from "../../../src/server/health";
import { json } from "../../../src/server/http";

/**
 * Convenience health endpoint for local probes and simple deployments.
 * Detailed Kubernetes-style probes remain available at /api/health/live
 * and /api/health/ready.
 */
export async function GET() {
  const health = readyHealth();
  return json(health, health.ok ? 200 : 503);
}
