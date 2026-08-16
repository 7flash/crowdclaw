import { hostname } from "node:os";
import { measure } from "measure-fn";
import {
  assertRuntimeConfig,
  agentPollMs,
  agentLeaseMs,
} from "./src/server/config";
import { projectsRepository } from "./src/server/db/project-repository";
import { log } from "./src/server/log";
import { syncProjectFunding } from "./src/server/services/funding-service";
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

async function tick(): Promise<boolean> {
  let snapshot = projectsRepository.get(projectId);
  if (!snapshot) return false;
  if (["completed", "failed"].includes(snapshot.status)) return false;
  if (snapshot.retryAt && snapshot.retryAt > Date.now()) return false;

  projectsRepository.recoverProjectWork(projectId);
  snapshot = projectsRepository.get(projectId);
  if (!snapshot) return false;

  if (snapshot.status === "planning") {
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
        planProject(snapshot, owner, agentLeaseMs()),
      );
    } finally {
      projectsRepository.releaseLease(projectId, owner);
    }
    return true;
  }

  let project = await measure("funding.sync", () =>
    syncProjectFunding(snapshot),
  );
  project = projectsRepository.markQueuedIfFunded(project.id) || project;

  if (project.status !== "queued") return false;
  const next = project.milestones[project.done];
  if (!next) return false;
  if (project.availableCredits < next.costCredits) {
    projectsRepository.setStatus(project.id, "waiting_funds", {
      agentNote: "",
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
