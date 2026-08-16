import { hostname } from "node:os";
import { measure } from "measure-fn";
import { projectsRepository } from "../db/project-repository";
import { syncProjectFunding } from "../services/funding-service";
import { buildNext, planProject } from "./tick-project";

const owner = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 7)}`;
let started = false;
let running = false;
let wakePending = false;
let timer: ReturnType<typeof setInterval> | null = null;

function intervalMs(): number {
  return Math.max(
    500,
    Number.parseInt(process.env.WORKER_INTERVAL_MS || "2000", 10) || 2000,
  );
}

function leaseMs(): number {
  return Math.max(
    10_000,
    Number.parseInt(process.env.WORKER_LEASE_MS || "60000", 10) || 60_000,
  );
}

async function runLoop(): Promise<void> {
  if (running) {
    wakePending = true;
    return;
  }
  running = true;
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
              leaseMs(),
            )
          )
            continue;
          try {
            await m("project.plan", () =>
              planProject(project, owner, leaseMs()),
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
              leaseMs(),
            )
          )
            continue;
          try {
            await m("project.build", () =>
              buildNext(project, owner, leaseMs()),
            );
          } finally {
            projectsRepository.releaseLease(project.id, owner);
          }
        }
      }
    });
  } catch (error) {
    console.error("CrowdClaw worker tick failed", error);
  } finally {
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
  void runLoop();
  timer = setInterval(() => void runLoop(), intervalMs());
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    started = false;
  };
}
