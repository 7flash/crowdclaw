import { hostname } from "node:os";
import { measure } from "measure-fn";
import {
  embeddedWorkerEnabled,
  workerIntervalMs,
  workerLeaseMs,
} from "../config";
import { projectsRepository } from "../db/project-repository";
import { errorMessage, log } from "../log";
import { syncProjectFunding } from "../services/funding-service";
import { buildNext, planProject } from "./tick-project";

const owner = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 7)}`;
let started = false;
let running = false;
let wakePending = false;
let timer: ReturnType<typeof setInterval> | null = null;

const health = {
  owner,
  startedAt: 0,
  lastTickStartedAt: 0,
  lastTickFinishedAt: 0,
  lastSuccessAt: 0,
  lastErrorAt: 0,
  lastError: "",
  ticks: 0,
};

export type AgentWorkerHealth = typeof health & {
  started: boolean;
  running: boolean;
};

export function getAgentWorkerHealth(): AgentWorkerHealth {
  return { ...health, started, running };
}

async function runLoop(): Promise<void> {
  if (running) {
    wakePending = true;
    return;
  }
  running = true;
  health.lastTickStartedAt = Date.now();
  health.ticks += 1;
  try {
    await measure("worker.tick", async () => {
      await measure("worker.recover-expired", () =>
        projectsRepository.recoverExpiredWork(),
      );
      const projects = await measure("db.projects.scan", () =>
        projectsRepository.list(),
      );
      if (!projects) return;

      for (const snapshot of projects) {
        if (snapshot.status === "completed" || snapshot.status === "failed")
          continue;
        if (snapshot.retryAt && snapshot.retryAt > Date.now()) continue;

        // Initial planning is independent of project funding. Do it before any
        // Solana RPC work so a slow/unavailable RPC cannot delay the roadmap.
        if (snapshot.status === "planning") {
          if (
            !projectsRepository.claimLease(
              snapshot.id,
              owner,
              ["planning"],
              workerLeaseMs(),
            )
          )
            continue;
          try {
            await measure("project.plan", () =>
              planProject(snapshot, owner, workerLeaseMs()),
            );
          } finally {
            projectsRepository.releaseLease(snapshot.id, owner);
          }
          continue;
        }

        let project = await measure("funding.sync", () =>
          syncProjectFunding(snapshot),
        );
        project = projectsRepository.markQueuedIfFunded(project.id) || project;

        if (project.status === "queued") {
          const next = project.milestones[project.done];
          if (!next) {
            projectsRepository.setStatus(project.id, "completed", {
              agentNote: "Roadmap complete.",
            });
            continue;
          }
          if (project.availableCredits < next.costCredits) {
            projectsRepository.setStatus(project.id, "waiting_funds", {
              agentNote: "Waiting for enough funding to continue.",
            });
            continue;
          }
          if (
            !projectsRepository.claimLease(
              project.id,
              owner,
              ["queued"],
              workerLeaseMs(),
            )
          )
            continue;
          try {
            await measure("project.build", () =>
              buildNext(project, owner, workerLeaseMs()),
            );
          } finally {
            projectsRepository.releaseLease(project.id, owner);
          }
        }
      }
    });
    health.lastSuccessAt = Date.now();
    health.lastError = "";
  } catch (error) {
    health.lastErrorAt = Date.now();
    health.lastError = errorMessage(error).slice(0, 500);
    log("error", "worker.tick.failed", { owner, error });
  } finally {
    health.lastTickFinishedAt = Date.now();
    running = false;
    if (wakePending && started) {
      wakePending = false;
      queueMicrotask(() => void runLoop());
    } else if (!started) {
      wakePending = false;
    }
  }
}

/**
 * Ensure the autonomous worker exists when the web process is configured to
 * embed it. This deliberately lives below the HTTP entrypoint so CrowdClaw
 * also works when TradJS is launched through its own CLI instead of server.ts.
 */
export function ensureAgentWorker(): boolean {
  if (started) return true;
  if (!embeddedWorkerEnabled()) return false;
  startAgentWorker();
  return started;
}

export function wakeAgentWorker(): void {
  // Project creation is itself a valid bootstrap point. If the web app was
  // launched through `tradjs serve`, server.ts was never executed, so start
  // the embedded worker here before attempting to wake it. startAgentWorker()
  // already kicks the first tick, so no second wake is needed in that case.
  if (!started) {
    ensureAgentWorker();
    return;
  }
  if (running) {
    wakePending = true;
    return;
  }
  queueMicrotask(() => void runLoop());
}

export function stopAgentWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  wakePending = false;
  if (!started) return;
  started = false;
  const expiredLeases = projectsRepository.expireOwnedLeases(owner);
  log("info", "worker.stopped", { owner, expiredLeases });
}

export function startAgentWorker(): () => void {
  if (!started) {
    started = true;
    health.startedAt = Date.now();
    log("info", "worker.started", {
      owner,
      intervalMs: workerIntervalMs(),
      leaseMs: workerLeaseMs(),
    });
    void runLoop();
    timer = setInterval(() => void runLoop(), workerIntervalMs());
  }
  // Always return the real shared stop function. A second bootstrap path must
  // not receive a no-op cleanup merely because another path started first.
  return stopAgentWorker;
}
