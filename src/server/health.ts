import { runtimeConfigIssues } from "./config";
import { probeDatabase } from "./db/database";
import { errorMessage } from "./log";
import { bgrunHealth } from "./agents/process-manager";

export type HealthResult = {
  ok: boolean;
  service: "crowdclaw";
  uptimeSeconds: number;
  checks: Record<string, { ok: boolean; detail?: string }>;
  agents?: { total: number; running: number };
};

export function liveHealth(): HealthResult {
  return {
    ok: true,
    service: "crowdclaw",
    uptimeSeconds: Math.floor(process.uptime()),
    checks: { process: { ok: true } },
  };
}

export async function readyHealth(): Promise<HealthResult> {
  const checks: HealthResult["checks"] = {};
  const issues = runtimeConfigIssues("web");
  checks.config = issues.length
    ? { ok: false, detail: issues.join("; ") }
    : { ok: true };

  try {
    probeDatabase();
    checks.database = { ok: true };
  } catch (error) {
    checks.database = { ok: false, detail: errorMessage(error) };
  }

  const agents = await bgrunHealth();
  checks.bgrun = agents.ok
    ? { ok: true }
    : { ok: false, detail: agents.detail || "bgrun unavailable" };

  return {
    ok: Object.values(checks).every((check) => check.ok),
    service: "crowdclaw",
    uptimeSeconds: Math.floor(process.uptime()),
    checks,
    agents: { total: agents.total, running: agents.running },
  };
}
