import { hostname } from "node:os";
import { measure } from "measure-fn";
import {
  assertRuntimeConfig,
  agentPollMs,
  agentLeaseMs,
  treasurySeedEnabled,
} from "./src/server/config";
import { projectsRepository } from "./src/server/db/project-repository";
import { log } from "./src/server/log";
import { syncProjectFunding } from "./src/server/services/funding-service";
import { ensureFirstMilestoneSeed } from "./src/server/services/treasury-service";
import { buildNext, planProject } from "./src/server/worker/tick-project";

assertRuntimeConfig("worker");

const projectId = String(process.argv[2] || "");
if (!/^p_[a-z0-9]+_[a-z0-9]+$/i.test(projectId))
  throw new Error("project id argument is required");

const owner = `${hostname()}:${process.pid}:${projectId}`;
let stopping = false;

process.once("SIGTERM", () => {
  stopping = true;
});
process.once("SIGINT", () => {
  stopping = true;
});

async function seedFirstMilestone(
  snapshot: NonNullable<ReturnType<typeof projectsRepository.get>>,
): Promise<ReturnType<typeof projectsRepository.get>> {
  let project = await measure("funding.seed.sync-before", () =>
    syncProjectFunding(snapshot, true),
  );
  project = projectsRepository.markQueuedIfFunded(project.id) || project;
  if (project.status === "queued") {
    projectsRepository.confirmTreasuryGrant(project.id);
    return project;
  }

  try {
    await measure("funding.seed.ensure", () =>
      ensureFirstMilestoneSeed(project),
    );
  } catch (error) {
    log("error", "treasury.seed.failed", { projectId, error });
    projectsRepository.setStatus(project.id, "waiting_funds", {
      agentNote: "WAITING",
    });
    return projectsRepository.get(project.id);
  }

  // A submitted Solana transfer is visible in the bundle immediately. Poll a
  // few times so the same agent can start v1 as soon as RPC observes it.
  for (let attempt = 0; attempt < 10 && !stopping; attempt += 1) {
    if (attempt > 0) await Bun.sleep(700);
    const latest = projectsRepository.get(project.id);
    if (!latest) return null;
    project = await measure("funding.seed.sync", () =>
      syncProjectFunding(latest, true),
    );
    project = projectsRepository.markQueuedIfFunded(project.id) || project;
    if (project.status === "queued") {
      projectsRepository.confirmTreasuryGrant(project.id);
      projectsRepository.event(
        project.id,
        "treasury.seed.confirmed",
        "CrowdClaw seed confirmed.",
      );
      return project;
    }
  }

  return projectsRepository.get(project.id);
}

async function tick(): Promise<boolean> {
  let snapshot = projectsRepository.get(projectId);
  if (!snapshot) return false;
  if (["completed", "failed"].includes(snapshot.status)) return false;
  if (snapshot.retryAt && snapshot.retryAt > Date.now()) return false;

  projectsRepository.recoverProjectWork(projectId);
  snapshot = projectsRepository.get(projectId);
  if (!snapshot) return false;

  if (snapshot.status === "planning") {
    const planningSnapshot = snapshot;
    if (
      !projectsRepository.claimLease(
        projectId,
        owner,
        ["planning"],
        agentLeaseMs(),
      )
    )
      return false;
    try {
      await measure("project.plan", () =>
        planProject(planningSnapshot, owner, agentLeaseMs()),
      );
    } finally {
      projectsRepository.releaseLease(projectId, owner);
    }
    return true;
  }

  // Every new project gets one platform seed attempt for milestone 1. Existing
  // first-milestone projects created before this feature are picked up too.
  if (
    snapshot.done === 0 &&
    ["seeding", "waiting_funds"].includes(snapshot.status)
  ) {
    const seedSnapshot = snapshot;
    if (!treasurySeedEnabled() && seedSnapshot.status === "seeding") {
      projectsRepository.setStatus(seedSnapshot.id, "waiting_funds", {
        agentNote: "WAITING",
      });
      return false;
    }
    if (
      !projectsRepository.claimLease(
        projectId,
        owner,
        [seedSnapshot.status],
        agentLeaseMs(),
      )
    )
      return false;
    let seeded: Awaited<ReturnType<typeof seedFirstMilestone>> = null;
    try {
      seeded = await measure("project.seed", () =>
        seedFirstMilestone(seedSnapshot),
      );
    } finally {
      projectsRepository.releaseLease(projectId, owner);
    }
    if (!seeded || seeded.status !== "queued") return Boolean(seeded);
    snapshot = seeded;
  }

  const fundingSnapshot = snapshot;
  let project =
    fundingSnapshot.status === "queued"
      ? fundingSnapshot
      : await measure("funding.sync", () =>
          syncProjectFunding(fundingSnapshot),
        );
  project = projectsRepository.markQueuedIfFunded(project.id) || project;

  if (project.status !== "queued") return false;
  const next = project.milestones[project.done];
  if (!next) return false;
  if (project.availableCredits < next.costCredits) {
    projectsRepository.setStatus(project.id, "waiting_funds", {
      agentNote: "WAITING",
    });
    return false;
  }
  if (
    !projectsRepository.claimLease(
      project.id,
      owner,
      ["queued"],
      agentLeaseMs(),
    )
  )
    return false;
  try {
    await measure("project.build", () =>
      buildNext(project, owner, agentLeaseMs()),
    );
  } finally {
    projectsRepository.releaseLease(project.id, owner);
  }
  return true;
}

log("info", "agent.process.ready", { projectId, pid: process.pid, owner });

while (!stopping) {
  let worked = false;
  try {
    worked = (await measure("agent.tick", () => tick())) || false;
  } catch (error) {
    log("error", "agent.tick.failed", { projectId, error });
  }
  const latest = projectsRepository.get(projectId);
  if (!latest || ["completed", "failed"].includes(latest.status)) break;
  await Bun.sleep(worked ? 100 : agentPollMs());
}

projectsRepository.expireOwnedLeases(owner);
log("info", "agent.process.stopped", { projectId, pid: process.pid });
