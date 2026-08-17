import { hostname } from "node:os";
import { measure } from "measure-fn";
import {
  assertRuntimeConfig,
  agentPollMs,
  agentLeaseMs,
  jsxAiRuntime,
  modelName,
  treasuryRetryMs,
  treasurySeedEnabled,
} from "./src/server/config";
import { projectsRepository } from "./src/server/db/project-repository";
import { log } from "./src/server/log";
import { syncProjectFunding } from "./src/server/services/funding-service";
import { ensureFirstMilestoneSeed } from "./src/server/services/treasury-service";
import { buildNext, planProject } from "./src/server/worker/tick-project";
import type { Project } from "./src/shared/types";

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

function projectSummary(project: Project | null) {
  return project
    ? {
        status: project.status,
        done: project.done,
        availableCredits: project.availableCredits,
        retryAt: project.retryAt || 0,
      }
    : { missing: true };
}

async function seedFirstMilestone(
  snapshot: NonNullable<ReturnType<typeof projectsRepository.get>>,
): Promise<ReturnType<typeof projectsRepository.get>> {
  let project = await measure(
    {
      start: () => "Seed funding sync",
      end: projectSummary,
      projectId,
    },
    () => syncProjectFunding(snapshot, true),
  );
  project = projectsRepository.markQueuedIfFunded(project.id) || project;
  if (project.status === "queued") {
    projectsRepository.confirmTreasuryGrant(project.id);
    return project;
  }

  let grant;
  try {
    grant = await measure(
      {
        start: () => "Ensure treasury seed",
        end: (value: Awaited<ReturnType<typeof ensureFirstMilestoneSeed>>) => ({
          status: value?.status || "none",
          lamports: value?.lamports || 0,
          signature: value?.signature || "",
        }),
        projectId,
      },
      () => ensureFirstMilestoneSeed(project),
    );
  } catch (error) {
    log("error", "treasury.seed.failed", { projectId, error });
    projectsRepository.setStatus(project.id, "waiting_funds", {
      agentNote: "WAITING",
      retryAt: Date.now() + treasuryRetryMs(),
    });
    return projectsRepository.get(project.id);
  }

  // Burst-poll only a transfer that was just submitted. Older submitted/failed
  // grants get one reconciliation pass per retry window instead of hot-looping.
  const justSubmitted =
    grant?.status === "submitted" && Date.now() - grant.updatedAt < 2_500;
  const attempts = justSubmitted ? 10 : 1;

  for (let attempt = 0; attempt < attempts && !stopping; attempt += 1) {
    if (attempt > 0) await Bun.sleep(700);
    const latest = projectsRepository.get(project.id);
    if (!latest) return null;
    project = await measure(
      {
        start: () => "Confirm seed",
        end: projectSummary,
        projectId,
        attempt: attempt + 1,
      },
      () => syncProjectFunding(latest, true),
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

  projectsRepository.setStatus(project.id, "waiting_funds", {
    agentNote: "WAITING",
    retryAt: Date.now() + treasuryRetryMs(),
  });
  return projectsRepository.get(project.id);
}

async function tick(): Promise<boolean> {
  let snapshot = projectsRepository.get(projectId);
  if (!snapshot) return false;
  if (["completed", "failed"].includes(snapshot.status)) return false;

  projectsRepository.recoverProjectWork(projectId);
  snapshot = projectsRepository.get(projectId);
  if (!snapshot) return false;

  // Planning/build retry backoff may pause model work. Funding is different:
  // while waiting for SOL we still reconcile the project wallet every agent poll
  // so a real inbound transfer can wake the project immediately.
  if (
    snapshot.status !== "waiting_funds" &&
    snapshot.retryAt &&
    snapshot.retryAt > Date.now()
  )
    return false;

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
      await measure(
        {
          start: () => "Plan project",
          end: () => projectSummary(projectsRepository.get(projectId)),
          projectId,
        },
        () => planProject(planningSnapshot, owner, agentLeaseMs()),
      );
    } finally {
      projectsRepository.releaseLease(projectId, owner);
    }
    return true;
  }

  // A waiting project is a funding watch. Force only the balance reconciliation;
  // syncProjectFunding indexes signatures only when the observed balance grows.
  // This makes direct supporter transfers visible within roughly one agent poll.
  if (snapshot.status === "waiting_funds") {
    let funded = await measure(
      {
        start: () => "Watch project SOL",
        end: projectSummary,
        projectId,
      },
      () => syncProjectFunding(snapshot!, true),
    );
    funded = projectsRepository.markQueuedIfFunded(funded.id) || funded;
    if (funded.status === "queued") {
      snapshot = funded;
    } else {
      // Treasury retryAt throttles only another platform-seed attempt. It must
      // never prevent direct user funding from being observed above.
      const mayRetrySeed =
        funded.done === 0 &&
        treasurySeedEnabled() &&
        (!funded.retryAt || funded.retryAt <= Date.now());
      if (!mayRetrySeed) return false;

      if (
        !projectsRepository.claimLease(
          projectId,
          owner,
          ["waiting_funds"],
          agentLeaseMs(),
        )
      )
        return false;
      let seeded: Awaited<ReturnType<typeof seedFirstMilestone>> = null;
      try {
        seeded = await measure(
          {
            start: () => "Seed project",
            end: projectSummary,
            projectId,
          },
          () => seedFirstMilestone(funded),
        );
      } finally {
        projectsRepository.releaseLease(projectId, owner);
      }
      if (!seeded || seeded.status !== "queued") return Boolean(seeded);
      snapshot = seeded;
    }
  }

  // A freshly planned project enters seeding once. If the platform treasury is
  // unavailable it becomes waiting_funds; direct funding then follows the watch
  // path above on subsequent ticks.
  if (snapshot.done === 0 && snapshot.status === "seeding") {
    const seedSnapshot = snapshot;
    if (!treasurySeedEnabled()) {
      projectsRepository.setStatus(seedSnapshot.id, "waiting_funds", {
        agentNote: "WAITING",
        retryAt: 0,
      });
      return false;
    }
    if (
      !projectsRepository.claimLease(
        projectId,
        owner,
        ["seeding"],
        agentLeaseMs(),
      )
    )
      return false;
    let seeded: Awaited<ReturnType<typeof seedFirstMilestone>> = null;
    try {
      seeded = await measure(
        {
          start: () => "Seed project",
          end: projectSummary,
          projectId,
        },
        () => seedFirstMilestone(seedSnapshot),
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
      : await measure(
          {
            start: () => "Refresh funding",
            end: projectSummary,
            projectId,
          },
          () => syncProjectFunding(fundingSnapshot),
        );
  project = projectsRepository.markQueuedIfFunded(project.id) || project;

  if (project.status !== "queued") return false;
  if (project.retryAt && project.retryAt > Date.now()) return false;
  const next = project.milestones[project.done];
  if (!next) return false;
  if (!projectsRepository.hasBuildRunway(project.id)) {
    projectsRepository.setStatus(project.id, "waiting_funds", {
      agentNote: "WAITING",
      retryAt: 0,
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
    await measure(
      {
        start: () => `Build milestone ${project.done + 1}`,
        end: () => projectSummary(projectsRepository.get(projectId)),
        projectId,
        milestone: next.title,
      },
      () => buildNext(project, owner, agentLeaseMs()),
    );
  } finally {
    projectsRepository.releaseLease(project.id, owner);
  }
  return true;
}

log("info", "agent.process.ready", {
  projectId,
  pid: process.pid,
  owner,
  runtime: jsxAiRuntime() || "provider",
  model: modelName(),
});

while (!stopping) {
  const worked = await measure(
    {
      start: () => `Agent tick ${projectId}`,
      end: (value: boolean) => ({
        worked: value,
        ...projectSummary(projectsRepository.get(projectId)),
      }),
      projectId,
      catch: (error) => {
        log("error", "agent.tick.failed", { projectId, error });
        return false;
      },
    },
    () => tick(),
  );

  const latest = projectsRepository.get(projectId);
  if (!latest || ["completed", "failed"].includes(latest.status)) break;
  await Bun.sleep(worked ? 100 : agentPollMs());
}

projectsRepository.expireOwnedLeases(owner);
log("info", "agent.process.stopped", { projectId, pid: process.pid });
