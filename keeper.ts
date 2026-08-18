import { resolve } from "node:path";
import {
  getProcess,
  handleRun,
  isProcessRunning,
  terminateProcess,
} from "bgrun";

const ROOT = resolve(import.meta.dir);
const SERVER_NAME =
  process.env.CROWDCLAW_SERVER_PROCESS_NAME?.trim() || "crowdclaw-server";
const SERVER_COMMAND =
  process.env.CROWDCLAW_SERVER_COMMAND?.trim() || "bun server.ts";
const PORT = int("PORT", int("BUN_PORT", 3000));
const HEALTH_URL =
  process.env.CROWDCLAW_KEEPER_HEALTH_URL?.trim() ||
  `http://127.0.0.1:${PORT}/api/health`;
const CHECK_MS = int("KEEPER_CHECK_MS", 5_000, 500);
const HEALTH_TIMEOUT_MS = int("KEEPER_HEALTH_TIMEOUT_MS", 2_500, 250);
const HEALTH_FAILURES = int("KEEPER_HEALTH_FAILURES", 3, 1);
const STARTUP_GRACE_MS = int("KEEPER_STARTUP_GRACE_MS", 15_000, 1_000);
const RESTART_BACKOFF_MS = int("KEEPER_RESTART_BACKOFF_MS", 5_000, 500);

let stopping = false;
let changing = false;
let failedChecks = 0;
let nextRestartAt = 0;

function int(name: string, fallback: number, minimum = 1): number {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

function log(event: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      server: SERVER_NAME,
      ...extra,
    }),
  );
}

async function probe(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(HEALTH_URL, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
    } | null;
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function managedProcess(): Promise<{ pid: number; running: boolean }> {
  const proc = getProcess(SERVER_NAME) as any;
  const pid = Number(proc?.pid || 0);
  return { pid, running: pid > 0 ? await isProcessRunning(pid) : false };
}

async function waitUntilHealthy(): Promise<boolean> {
  const until = Date.now() + STARTUP_GRACE_MS;
  while (!stopping && Date.now() < until) {
    if (await probe()) return true;
    await Bun.sleep(250);
  }
  return false;
}

async function restart(
  reason: string,
  replaceLiveProcess: boolean,
): Promise<void> {
  if (changing || stopping || Date.now() < nextRestartAt) return;
  changing = true;
  try {
    const current = await managedProcess();
    if (replaceLiveProcess && current.running) {
      log("keeper.server_unhealthy", { pid: current.pid, reason });
      await terminateProcess(current.pid);
      for (let i = 0; i < 30 && (await isProcessRunning(current.pid)); i += 1)
        await Bun.sleep(100);
    }

    // A concurrent operator may have repaired it while we were checking.
    if (await probe()) {
      failedChecks = 0;
      return;
    }

    const latest = await managedProcess();
    if (latest.running) return;

    log("keeper.server_start", { reason, command: SERVER_COMMAND });
    await handleRun({
      action: "run",
      name: SERVER_NAME,
      command: SERVER_COMMAND,
      directory: ROOT,
      // Avoid bgrun force-port cleanup here. A dead record can be started safely;
      // a live unhealthy process was explicitly terminated above.
      force: false,
      remoteName: "",
    });

    if (await waitUntilHealthy()) {
      failedChecks = 0;
      nextRestartAt = 0;
      log("keeper.server_ready", { pid: (await managedProcess()).pid });
    } else {
      nextRestartAt = Date.now() + RESTART_BACKOFF_MS;
      log("keeper.server_start_failed", { backoffMs: RESTART_BACKOFF_MS });
    }
  } catch (error) {
    nextRestartAt = Date.now() + RESTART_BACKOFF_MS;
    log("keeper.error", {
      error: error instanceof Error ? error.message : String(error),
      backoffMs: RESTART_BACKOFF_MS,
    });
  } finally {
    changing = false;
  }
}

async function tick(): Promise<void> {
  if (changing || stopping) return;
  if (await probe()) {
    failedChecks = 0;
    return;
  }

  const current = await managedProcess();
  if (!current.running) {
    failedChecks = 0;
    await restart("server process exited", false);
    return;
  }

  failedChecks += 1;
  if (failedChecks >= HEALTH_FAILURES) {
    failedChecks = 0;
    await restart(`${HEALTH_FAILURES} consecutive health checks failed`, true);
  }
}

function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  log("keeper.stop", { signal });
  // Do not terminate the bgrun-managed server when only the keeper is stopped.
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

log("keeper.start", { healthUrl: HEALTH_URL, checkMs: CHECK_MS });
await tick();
while (!stopping) {
  await Bun.sleep(CHECK_MS);
  await tick();
}
