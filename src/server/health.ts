import {
  embeddedWorkerEnabled,
  runtimeConfigIssues,
  workerIntervalMs,
} from "./config";
import { probeDatabase } from "./db/database";
import { errorMessage } from "./log";
import { getAgentWorkerHealth } from "./worker/worker";

export type HealthResult = {
  ok: boolean;
  service: "crowdclaw";
  uptimeSeconds: number;
  checks: Record<string, { ok: boolean; detail?: string }>;
  worker?: ReturnType<typeof getAgentWorkerHealth>;
};

export function liveHealth(): HealthResult {
  return {
    ok: true,
    service: "crowdclaw",
    uptimeSeconds: Math.floor(process.uptime()),
    checks: { process: { ok: true } },
  };
}

export function readyHealth(): HealthResult {
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

  let worker: ReturnType<typeof getAgentWorkerHealth> | undefined;
  if (embeddedWorkerEnabled()) {
    worker = getAgentWorkerHealth();
    const grace = Math.max(10_000, workerIntervalMs() * 4);
    const fresh =
      worker.running ||
      (worker.lastSuccessAt > 0 && Date.now() - worker.lastSuccessAt < grace);
    checks.worker =
      worker.started && fresh
        ? { ok: true }
        : {
            ok: false,
            detail:
              worker.lastError ||
              "embedded worker has not completed a recent tick",
          };
  }

  return {
    ok: Object.values(checks).every((check) => check.ok),
    service: "crowdclaw",
    uptimeSeconds: Math.floor(process.uptime()),
    checks,
    worker,
  };
}
