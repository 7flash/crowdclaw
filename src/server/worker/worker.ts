import { hostname } from "node:os";
import { measure } from "measure-fn";
import { workerIntervalMs, workerLeaseMs } from "../config";
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
    await measure({ label: "worker.tick", owner }, async (m) => {
      await m("worker.recover-expired", () =>
        projectsRepository.recoverExpiredWork(),
      );
      const projects = await m("db.projects.scan", () =>
        projectsRepository.list(),
      );
      if (!projects) return;

      for (const snapshot of projects) {
        if (snapshot.status === "completed" || snapshot.status === "failed")
          continue;
        if (snapshot.retryAt && snapshot.retryAt > Date.now()) continue;

        let project = await m("funding.sync", () =>
          syncProjectFunding(snapshot),
        );
        project = projectsRepository.markQueuedIfFunded(project.id) || project;

        if (project.status === "planning") {
          if (
            !projectsRepository.claimLease(
              project.id,
              owner,
              ["planning"],
              workerLeaseMs(),
            )
          )
            continue;
          try {
            await m("project.plan", () =>
              planProject(project, owner, workerLeaseMs()),
            );
          } finally {
            projectsRepository.releaseLease(project.id, owner);
          }
          continue;
        }

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
            await m("project.build", () =>
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
    if (wakePending) {
      wakePending = false;
      queueMicrotask(() => void runLoop());
    }
  }
}

export function wakeAgentWorker(): void {
  if (!started) return;
  if (running) {
    wakePending = true;
    return;
  }
  queueMicrotask(() => void runLoop());
}

export function startAgentWorker(): () => void {
  if (started) return () => {};
  started = true;
  health.startedAt = Date.now();
  log("info", "worker.started", {
    owner,
    intervalMs: workerIntervalMs(),
    leaseMs: workerLeaseMs(),
  });
  void runLoop();
  timer = setInterval(() => void runLoop(), workerIntervalMs());
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    started = false;
    const expiredLeases = projectsRepository.expireOwnedLeases(owner);
    log("info", "worker.stopped", { owner, expiredLeases });
  };
}
