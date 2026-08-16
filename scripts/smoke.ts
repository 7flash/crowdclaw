process.env.DATABASE_PATH = ":memory:";
process.env.ALLOW_DEV_FUNDING = "1";
process.env.LAMPORTS_PER_CREDIT = "100";

const { projectsRepository } =
  await import("../src/server/db/project-repository");
const { toMilestone } = await import("../src/server/agent/output");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`smoke failed: ${message}`);
}

const project = projectsRepository.create({
  idea: "a tiny test game for production smoke verification",
  walletAddress: "SmokeWallet111111111111111111111111111111",
});
const funding = projectsRepository.setFunding(project.id, 500);
assert(
  funding?.project.availableCredits === 5,
  "funding should create five credits",
);
const staleFunding = projectsRepository.setFunding(project.id, 400);
assert(
  staleFunding?.project.fundedCredits === 5,
  "a lower observed balance must not claw back credited funding",
);
const restoredFunding = projectsRepository.setFunding(project.id, 500);
assert(
  restoredFunding?.newlyCreditedLamports === 0,
  "restoring a prior high-water balance must not double-credit",
);
const fundingLedger = projectsRepository.ledger(project.id);
assert(
  fundingLedger.filter((entry) => entry.kind === "funding").length === 1,
  "wallet high-water funding should create one ledger credit",
);
assert(
  fundingLedger.find((entry) => entry.kind === "funding")?.credits === 5,
  "funding ledger should record five credits",
);
projectsRepository.recordDonations(project.id, [
  {
    signature: "smoke-donation",
    fromAddress: "DonorWallet",
    lamports: 500,
    slot: 1,
    blockTime: 1,
  },
]);
projectsRepository.recordDonations(project.id, [
  {
    signature: "smoke-donation",
    fromAddress: "DonorWallet",
    lamports: 500,
    slot: 1,
    blockTime: 1,
  },
]);
assert(
  projectsRepository.donations(project.id).length === 1,
  "donation signatures must be idempotent",
);
const supporter = projectsRepository.supporters(project.id)[0];
assert(
  supporter?.influenceAvailable === 5,
  "donation attribution should create proportional supporter influence",
);
const challenge = projectsRepository.createSteeringChallenge(
  project.id,
  "DonorWallet",
);
const steer = projectsRepository.submitSteering({
  projectId: project.id,
  challengeId: challenge.id,
  address: "DonorWallet",
  instruction: "add risky speed boosts",
  influence: 2,
});
assert(
  projectsRepository.supporters(project.id)[0]?.influenceAvailable === 3,
  "steering should spend supporter influence",
);

const planRun = projectsRepository.createRun({
  projectId: project.id,
  kind: "plan",
  milestoneIndex: -1,
  model: "smoke",
});
projectsRepository.setStatus(project.id, "planning", {
  currentRunId: planRun.id,
});
projectsRepository.setPlanningResult(
  project.id,
  planRun.id,
  "smoke-game",
  "smoke",
  [
    toMilestone({ title: "Playable loop", costCredits: 2 }),
    toMilestone({ title: "Enemy pressure", costCredits: 2 }),
    toMilestone({ title: "Score polish", costCredits: 2 }),
  ],
);

const buildRun = projectsRepository.createRun({
  projectId: project.id,
  kind: "build",
  milestoneIndex: 0,
  model: "smoke",
});
projectsRepository.reserveNextMilestone(project.id, 0, buildRun.id);
assert(
  projectsRepository.get(project.id)?.reservedCredits === 2,
  "build should reserve milestone credits",
);
assert(
  projectsRepository.releaseReservation(
    project.id,
    "stale-run",
    "queued",
    "stale",
  ) === null,
  "stale run must not release another run reservation",
);
assert(
  projectsRepository.get(project.id)?.reservedCredits === 2,
  "stale release must leave reservation intact",
);

let stalePublishRejected = false;
try {
  projectsRepository.ship(project.id, 0, {
    projectId: project.id,
    version: 1,
    milestoneTitle: "Playable loop",
    html: "<!doctype html><html><body><script>/* smoke */</script></body></html>",
    sha256: "stale",
    runId: "stale-run",
    createdAt: Date.now(),
  });
} catch {
  stalePublishRejected = true;
}
assert(stalePublishRejected, "stale run must not publish an artifact");

projectsRepository.releaseReservation(
  project.id,
  buildRun.id,
  "queued",
  "intentional smoke rollback",
);
assert(
  projectsRepository.get(project.id)?.reservedCredits === 0,
  "current run should release its own reservation",
);

const successfulRun = projectsRepository.createRun({
  projectId: project.id,
  kind: "build",
  milestoneIndex: 0,
  model: "smoke",
});
projectsRepository.reserveNextMilestone(project.id, 0, successfulRun.id);
projectsRepository.ship(
  project.id,
  0,
  {
    projectId: project.id,
    version: 1,
    milestoneTitle: "Playable loop",
    html: "<!doctype html><html><body><script>/* smoke */</script></body></html>",
    sha256: "published",
    runId: successfulRun.id,
    createdAt: Date.now(),
  },
  toMilestone({ title: "Rolling improvement", costCredits: 2 }),
  [steer.id],
);
assert(
  projectsRepository.steering(project.id).find((item) => item.id === steer.id)
    ?.status === "consumed",
  "published next milestone should consume captured steering",
);
const settledRun = projectsRepository
  .runs(project.id)
  .find((run) => run.id === successfulRun.id);
assert(
  settledRun?.chargedCredits === 2,
  "successful run should record its settled milestone charge",
);
assert(
  projectsRepository
    .ledger(project.id)
    .some((entry) => entry.kind === "milestone_spend" && entry.credits === -2),
  "shipping should append a milestone debit to the ledger",
);
assert(
  projectsRepository.get(project.id)?.spentCredits === 2,
  "shipping should settle the reserved milestone cost",
);
console.log("CrowdClaw economics smoke passed");

export {};
