import { db } from "./database";
import { contextWindow, lamportsPerCredit } from "../config";
import type {
  AgentRun,
  Artifact,
  CreditLedgerEntry,
  Donation,
  Supporter,
  Steering,
  TreasuryGrant,
  ArtifactSummary,
  Milestone,
  Project,
  ProjectBundle,
  ProjectEvent,
  ProjectStatus,
  RunKind,
  UsageSummary,
} from "../../shared/types";

const round2 = (value: number) => Math.round(value * 100) / 100;
const now = () => Date.now();
const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

function projectFromRow(row: any): Project {
  const creditedLamports = Math.max(
    Number(row.creditedLamports || 0),
    Number(row.onchainLamports || 0),
  );
  const onchainCredits = creditedLamports / lamportsPerCredit();
  const fundedCredits = round2(onchainCredits + Number(row.manualCredits || 0));
  const spentCredits = Number(row.spentCredits || 0);
  const reservedCredits = Number(row.reservedCredits || 0);
  return {
    id: row.projectId,
    name: row.name,
    idea: row.idea,
    summary: row.summary,
    status: row.status,
    agentId: row.agentId,
    walletAddress: row.walletAddress,
    milestones: (row.milestones || []) as Milestone[],
    done: Number(row.done || 0),
    spentCredits,
    reservedCredits,
    onchainLamports: Number(row.onchainLamports || 0),
    creditedLamports,
    manualCredits: Number(row.manualCredits || 0),
    fundedCredits,
    availableCredits: round2(
      Math.max(0, fundedCredits - spentCredits - reservedCredits),
    ),
    currentRunId: row.currentRunId || null,
    agentNote: row.agentNote || "",
    streamPreview: row.streamPreview || "",
    lastFundingSyncAt: Number(row.lastFundingSyncAt || 0),
    fundingError: row.fundingError || "",
    failureCount: Number(row.failureCount || 0),
    retryAt: Number(row.retryAt || 0),
    error: row.error || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function artifactFromRow(row: any): Artifact {
  return {
    id: row.artifactId,
    projectId: row.projectId,
    version: row.version,
    milestoneTitle: row.milestoneTitle,
    html: row.html,
    sha256: row.sha256,
    runId: row.runId,
    createdAt: row.createdAt,
  };
}

function runFromRow(row: any): AgentRun {
  const lastContextTokens = Number(row.lastContextTokens || 0);
  const window = Number(row.contextWindow || contextWindow());
  return {
    id: row.runId,
    projectId: row.projectId,
    kind: row.kind,
    status: row.status,
    milestoneIndex: Number(row.milestoneIndex || 0),
    model: row.model,
    inputTokens: Number(row.inputTokens || 0),
    outputTokens: Number(row.outputTokens || 0),
    thinkingTokens: Number(row.thinkingTokens || 0),
    cacheCreationInputTokens: Number(row.cacheCreationInputTokens || 0),
    cacheReadInputTokens: Number(row.cacheReadInputTokens || 0),
    lastContextTokens,
    contextWindow: window,
    remainingContextTokens: Math.max(0, window - lastContextTokens),
    usageEstimated: Boolean(row.usageEstimated),
    streamChars: Number(row.streamChars || 0),
    preview: row.preview || "",
    note: row.note || "",
    error: row.error || "",
    startedAt: row.startedAt,
    finishedAt: Number(row.finishedAt || 0),
    chargedCredits: Number(row.chargedCredits || 0),
  };
}

function eventFromRow(row: any): ProjectEvent {
  return {
    id: row.eventId,
    projectId: row.projectId,
    type: row.type,
    message: row.message,
    createdAt: row.createdAt,
  };
}

function donationFromRow(row: any): Donation {
  return {
    id: row.donationId,
    projectId: row.projectId,
    signature: row.signature,
    fromAddress: row.fromAddress || "",
    lamports: Number(row.lamports || 0),
    credits: Number(row.credits || 0),
    slot: Number(row.slot || 0),
    blockTime: Number(row.blockTime || 0),
    confirmedAt: Number(row.confirmedAt || 0),
    source: row.source === "platform_seed" ? "platform_seed" : "supporter",
  };
}

function treasuryGrantFromRow(row: any): TreasuryGrant {
  return {
    id: row.grantId,
    projectId: row.projectId,
    purpose: "first_milestone",
    status: row.status,
    fromAddress: row.fromAddress || "",
    toAddress: row.toAddress || "",
    lamports: Number(row.lamports || 0),
    signature: row.signature || "",
    error: row.error || "",
    createdAt: Number(row.createdAt || 0),
    updatedAt: Number(row.updatedAt || 0),
  };
}

function steeringFromRow(row: any): Steering {
  return {
    id: row.steerId,
    projectId: row.projectId,
    fromAddress: row.fromAddress || "",
    instruction: row.instruction || "",
    influence: Number(row.influence || 0),
    status: row.status,
    createdAt: Number(row.createdAt || 0),
    consumedAt: Number(row.consumedAt || 0),
    consumedMilestoneIndex: Number(row.consumedMilestoneIndex ?? -1),
  };
}

function ledgerFromRow(row: any): CreditLedgerEntry {
  return {
    id: row.ledgerId,
    projectId: row.projectId,
    kind: row.kind,
    credits: Number(row.credits || 0),
    runId: row.runId || "",
    milestoneIndex: Number(row.milestoneIndex ?? -1),
    reference: row.reference || "",
    note: row.note || "",
    createdAt: Number(row.createdAt || 0),
  };
}

function insertLedger(input: Omit<CreditLedgerEntry, "id">): CreditLedgerEntry {
  return ledgerFromRow(
    db.creditLedger.insert({
      ledgerId: uid("l"),
      projectId: input.projectId,
      kind: input.kind,
      credits: round2(input.credits),
      runId: input.runId || "",
      milestoneIndex: input.milestoneIndex,
      reference: input.reference || "",
      note: input.note.slice(0, 300),
      createdAt: input.createdAt,
    }) as any,
  );
}

function backfillLedgerIfNeeded(row: any): void {
  const existing = db.creditLedger
    .select()
    .where({ projectId: row.projectId })
    .first() as any | null;
  if (existing) return;
  const project = projectFromRow(row);
  if (project.fundedCredits > 0) {
    insertLedger({
      projectId: project.id,
      kind: "legacy_funding",
      credits: project.fundedCredits,
      runId: "",
      milestoneIndex: -1,
      reference: "migration",
      note: "Opening funding balance carried forward from the pre-ledger project state.",
      createdAt: project.createdAt,
    });
  }
  if (project.spentCredits > 0) {
    insertLedger({
      projectId: project.id,
      kind: "legacy_spend",
      credits: -project.spentCredits,
      runId: "",
      milestoneIndex: Math.max(-1, project.done - 1),
      reference: "migration",
      note: "Opening milestone spend carried forward from the pre-ledger project state.",
      createdAt: project.updatedAt,
    });
  }
}

function rowByProjectId(projectId: string): any | null {
  return db.projects.select().where({ projectId }).first() as any | null;
}

function rowByRunId(runId: string): any | null {
  return db.runs.select().where({ runId }).first() as any | null;
}

function usageFromRuns(runs: AgentRun[], project: Project): UsageSummary {
  const inputTokens = runs.reduce((sum, run) => sum + run.inputTokens, 0);
  const outputTokens = runs.reduce((sum, run) => sum + run.outputTokens, 0);
  const thinkingTokens = runs.reduce((sum, run) => sum + run.thinkingTokens, 0);
  const buildTokens = runs
    .filter((run) => run.kind === "build" && run.status === "complete")
    .reduce(
      (sum, run) =>
        sum + run.inputTokens + run.outputTokens + run.thinkingTokens,
      0,
    );
  const tokensPerSpentCredit =
    project.spentCredits > 0 ? buildTokens / project.spentCredits : 0;
  const estimatedFundedTokenRunway =
    tokensPerSpentCredit > 0
      ? project.availableCredits * tokensPerSpentCredit
      : 0;
  const latest = runs[0];
  const window = latest?.contextWindow || contextWindow();
  const latestContextTokens = latest?.lastContextTokens || 0;
  return {
    inputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens: inputTokens + outputTokens + thinkingTokens,
    buildTokens,
    tokensPerSpentCredit,
    estimatedFundedTokenRunway,
    latestContextTokens,
    contextWindow: window,
    remainingContextTokens: Math.max(0, window - latestContextTokens),
  };
}

export const projectsRepository = {
  list(): Project[] {
    const rows = db.projects
      .select()
      .orderBy("createdAt", "DESC")
      .limit(50)
      .all() as any[];
    return rows.map(projectFromRow);
  },

  get(projectId: string): Project | null {
    const row = rowByProjectId(projectId);
    return row ? projectFromRow(row) : null;
  },

  bundle(projectId: string): ProjectBundle | null {
    const row = rowByProjectId(projectId);
    if (!row) return null;
    backfillLedgerIfNeeded(row);
    const project = projectFromRow(row);
    const artifacts = this.artifactSummaries(projectId);
    const allRuns = this.runs(projectId, 500);
    const runs = allRuns.slice(0, 40);
    const events = this.events(projectId, 40);
    const donations = this.donations(projectId, 40);
    const treasuryGrants = this.treasuryGrants(projectId);
    const supporters = this.supporters(projectId);
    const steering = this.steering(projectId, 20);
    const ledger = this.ledger(projectId, 40);
    return {
      project,
      artifacts,
      runs,
      events,
      donations,
      treasuryGrants,
      supporters,
      steering,
      ledger,
      usage: usageFromRuns(allRuns, project),
      lamportsPerCredit: lamportsPerCredit(),
      devFundingEnabled: process.env.ALLOW_DEV_FUNDING === "1",
    };
  },

  create(input: {
    projectId?: string;
    idea: string;
    walletAddress: string;
  }): Project {
    const createdAt = now();
    const projectId = input.projectId || uid("p");
    const row = db.projects.insert({
      projectId,
      name: "new-project",
      idea: input.idea,
      summary: input.idea,
      status: "planning",
      agentId: `claw-${projectId.slice(-6)}`,
      walletAddress: input.walletAddress,
      milestones: [],
      done: 0,
      spentCredits: 0,
      reservedCredits: 0,
      onchainLamports: 0,
      creditedLamports: 0,
      manualCredits: 0,
      currentRunId: null,
      agentNote: "PLAN",
      streamPreview: "",
      lastFundingSyncAt: 0,
      fundingError: "",
      failureCount: 0,
      retryAt: 0,
      error: "",
      leaseOwner: "",
      leaseUntil: 0,
      createdAt,
      updatedAt: createdAt,
    }) as any;
    return projectFromRow(row);
  },

  setFunding(
    projectId: string,
    lamports: number,
    error = "",
  ): { project: Project; newlyCreditedLamports: number } | null {
    let result: { project: Project; newlyCreditedLamports: number } | null =
      null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) return;
      backfillLedgerIfNeeded(row);
      const observed = Math.max(0, Math.floor(lamports));
      const previousObserved = Math.max(0, Number(row.onchainLamports || 0));
      const previousCredited = Math.max(
        Number(row.creditedLamports || 0),
        previousObserved,
      );
      const credited = Math.max(previousCredited, observed);
      const delta = Math.max(0, credited - previousCredited);
      row.onchainLamports = observed;
      row.creditedLamports = credited;
      row.lastFundingSyncAt = now();
      row.fundingError = error;
      row.updatedAt = now();
      if (observed !== previousObserved || delta > 0) {
        const observationId = uid("fo");
        const observedAt = now();
        db.fundingObservations.insert({
          observationId,
          projectId,
          observedLamports: observed,
          creditedLamports: credited,
          deltaCreditedLamports: delta,
          source: "solana_balance",
          createdAt: observedAt,
        });
        if (delta > 0) {
          insertLedger({
            projectId,
            kind: "funding",
            credits: delta / lamportsPerCredit(),
            runId: "",
            milestoneIndex: -1,
            reference: observationId,
            note: "Confirmed increase in the project wallet balance.",
            createdAt: observedAt,
          });
        }
      }
      result = { project: projectFromRow(row), newlyCreditedLamports: delta };
    });
    return result;
  },

  setFundingError(projectId: string, error: string): void {
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) return;
      row.lastFundingSyncAt = now();
      row.fundingError = error.slice(0, 240);
      row.updatedAt = now();
    });
  },

  addManualCredits(projectId: string, credits: number): Project | null {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) return;
      backfillLedgerIfNeeded(row);
      const amount = round2(credits);
      row.manualCredits = round2(Number(row.manualCredits || 0) + amount);
      row.updatedAt = now();
      insertLedger({
        projectId,
        kind: "manual",
        credits: amount,
        runId: "",
        milestoneIndex: -1,
        reference: "dev",
        note: "Development-only build credit.",
        createdAt: now(),
      });
      result = projectFromRow(row);
    });
    return result;
  },

  setPlanningResult(
    projectId: string,
    runId: string,
    name: string,
    summary: string,
    milestones: Milestone[],
  ): Project {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) throw new Error("project not found");
      if (row.currentRunId !== runId)
        throw new Error("planning run is no longer current");
      const run = rowByRunId(runId);
      if (!run || run.status !== "running")
        throw new Error("planning run is no longer active");
      row.name = name || "untitled";
      row.summary = summary || row.idea;
      row.milestones = milestones;
      row.done = 0;
      row.reservedCredits = 0;
      row.currentRunId = null;
      row.agentNote = "FUNDING";
      row.streamPreview = "";
      row.error = "";
      row.failureCount = 0;
      row.retryAt = 0;
      const project = projectFromRow(row);
      const next = project.milestones[0];
      row.status =
        next && project.availableCredits >= next.costCredits
          ? "queued"
          : "seeding";
      row.updatedAt = now();
      run.status = "complete";
      run.finishedAt = now();
      result = projectFromRow(row);
    });
    if (!result) throw new Error("failed to save project plan");
    return result;
  },

  setStatus(
    projectId: string,
    status: ProjectStatus,
    patch: Partial<{
      agentNote: string;
      streamPreview: string;
      error: string;
      currentRunId: string | null;
      reservedCredits: number;
      retryAt: number;
      failureCount: number;
    }> = {},
  ): Project | null {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) return;
      row.status = status;
      if (patch.agentNote !== undefined) row.agentNote = patch.agentNote;
      if (patch.streamPreview !== undefined)
        row.streamPreview = patch.streamPreview;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.currentRunId !== undefined)
        row.currentRunId = patch.currentRunId;
      if (patch.reservedCredits !== undefined)
        row.reservedCredits = patch.reservedCredits;
      if (patch.retryAt !== undefined) row.retryAt = patch.retryAt;
      if (patch.failureCount !== undefined)
        row.failureCount = patch.failureCount;
      row.updatedAt = now();
      result = projectFromRow(row);
    });
    return result;
  },

  setRunStatus(
    projectId: string,
    runId: string,
    status: ProjectStatus,
    patch: Partial<{
      agentNote: string;
      streamPreview: string;
      error: string;
    }> = {},
  ): Project | null {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row || row.currentRunId !== runId) return;
      row.status = status;
      if (patch.agentNote !== undefined) row.agentNote = patch.agentNote;
      if (patch.streamPreview !== undefined)
        row.streamPreview = patch.streamPreview;
      if (patch.error !== undefined) row.error = patch.error;
      row.updatedAt = now();
      result = projectFromRow(row);
    });
    return result;
  },

  failPlanning(
    projectId: string,
    runId: string,
    terminal: boolean,
    error: unknown,
    retryAt: number,
  ): Project | null {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : String(error || "planning failed");
    const note = /(?:\b429\b|quota|rate.?limit)/i.test(message)
      ? "QUOTA"
      : /(?:\b50[234]\b|\b503\b|UNAVAILABLE|high demand|temporar(?:y|ily)|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|network error)/i.test(
            message,
          )
        ? "BUSY"
        : "MODEL ERROR";
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row || row.currentRunId !== runId) return;
      row.currentRunId = null;
      row.streamPreview = "";
      row.error = message.slice(0, 500);
      row.failureCount = Number(row.failureCount || 0) + 1;
      row.retryAt = terminal ? 0 : retryAt;
      row.status = terminal ? "failed" : "planning";
      row.agentNote = terminal ? note : note === "BUSY" ? "BUSY" : "RETRY";
      row.updatedAt = now();
      result = projectFromRow(row);
    });
    return result;
  },

  markQueuedIfFunded(projectId: string): Project | null {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) return;
      const project = projectFromRow(row);

      // Funding reconciliation must never advance unrelated lifecycle states.
      // A brand-new planning project intentionally has no milestones yet; treating
      // that as roadmap exhaustion would complete it before the planner can run.
      if (project.status === "waiting_funds" || project.status === "seeding") {
        const next = project.milestones[project.done];
        if (next && project.availableCredits >= next.costCredits) {
          row.status = "queued";
          row.agentNote = "READY";
          row.error = "";
          row.updatedAt = now();
        }
      }

      result = projectFromRow(row);
    });
    return result;
  },

  reserveNextMilestone(
    projectId: string,
    expectedDone: number,
    runId: string,
  ): Project {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) throw new Error("project not found");
      if (Number(row.done || 0) !== expectedDone)
        throw new Error("project advanced before reservation");
      const project = projectFromRow(row);
      const next = project.milestones[expectedDone];
      if (!next) throw new Error("no next milestone");
      if (project.availableCredits < next.costCredits)
        throw new Error("milestone is not funded");
      const miles = [...project.milestones];
      miles[expectedDone] = { ...next, state: "working" };
      row.milestones = miles;
      row.reservedCredits = next.costCredits;
      row.currentRunId = runId;
      row.status = "working";
      row.agentNote = "BUILDING";
      row.streamPreview = "";
      row.error = "";
      row.updatedAt = now();
      result = projectFromRow(row);
    });
    if (!result) throw new Error("failed to reserve milestone");
    return result;
  },

  updateLiveRun(
    projectId: string,
    runId: string,
    preview: string,
    note = "",
  ): void {
    db.transaction(() => {
      const project = rowByProjectId(projectId);
      const run = rowByRunId(runId);
      if (
        !project ||
        !run ||
        project.currentRunId !== runId ||
        run.status !== "running"
      )
        return;
      const clipped = preview.slice(-1800);
      project.streamPreview = clipped;
      if (note) project.agentNote = note.slice(0, 220);
      project.updatedAt = now();
      run.streamChars = preview.length;
      run.preview = clipped;
      if (note) run.note = note.slice(0, 220);
    });
  },

  ship(
    projectId: string,
    expectedDone: number,
    artifact: Omit<Artifact, "id">,
    nextMilestone?: Milestone,
    steeringIds: string[] = [],
  ): Project {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) throw new Error("project not found");
      backfillLedgerIfNeeded(row);
      if (Number(row.done || 0) !== expectedDone)
        throw new Error("project advanced while build was running");
      if (row.currentRunId !== artifact.runId)
        throw new Error("build run is no longer current");
      const run = rowByRunId(artifact.runId);
      if (!run || run.status !== "running")
        throw new Error("build run is no longer active");
      const project = projectFromRow(row);
      const current = project.milestones[expectedDone];
      if (!current) throw new Error("milestone missing");
      if (Number(row.reservedCredits || 0) < current.costCredits)
        throw new Error("milestone reservation disappeared");

      db.artifacts.insert({ artifactId: uid("a"), ...artifact });
      const miles = [...project.milestones];
      miles[expectedDone] = {
        ...current,
        state: "shipped",
        completedAt: now(),
        artifactVersion: artifact.version,
      };
      if (nextMilestone && miles.length < 40) miles.push(nextMilestone);

      for (const steerId of steeringIds) {
        const steer = db.steering
          .select()
          .where({ projectId, steerId })
          .first() as any | null;
        if (!steer || steer.status !== "open") continue;
        steer.status = "consumed";
        steer.consumedAt = now();
        steer.consumedMilestoneIndex = expectedDone + 1;
      }

      row.milestones = miles;
      row.done = expectedDone + 1;
      row.spentCredits = round2(
        Number(row.spentCredits || 0) + current.costCredits,
      );
      insertLedger({
        projectId,
        kind: "milestone_spend",
        credits: -current.costCredits,
        runId: artifact.runId,
        milestoneIndex: expectedDone,
        reference: artifact.sha256,
        note: `Shipped v${artifact.version}: ${current.title}.`,
        createdAt: artifact.createdAt,
      });
      run.chargedCredits = current.costCredits;
      row.reservedCredits = 0;
      row.currentRunId = null;
      row.streamPreview = "";
      row.failureCount = 0;
      row.retryAt = 0;
      row.error = "";
      row.agentNote = `V${artifact.version}`;

      const updated = projectFromRow(row);
      const next = updated.milestones[updated.done];
      row.status = !next
        ? "completed"
        : updated.availableCredits >= next.costCredits
          ? "queued"
          : "waiting_funds";
      row.updatedAt = now();
      run.status = "complete";
      run.finishedAt = now();
      result = projectFromRow(row);
    });
    if (!result) throw new Error("failed to publish artifact");
    return result;
  },

  releaseReservation(
    projectId: string,
    runId: string,
    status: ProjectStatus,
    error: string,
    retryAt = 0,
  ): Project | null {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row || row.currentRunId !== runId) return;
      const project = projectFromRow(row);
      const index = project.done;
      const miles = [...project.milestones];
      if (miles[index] && miles[index].state === "working")
        miles[index] = { ...miles[index], state: "queued" };
      row.milestones = miles;
      row.reservedCredits = 0;
      row.currentRunId = null;
      row.status = status;
      row.error = error.slice(0, 500);
      row.agentNote = status === "failed" ? "STOPPED" : "RETRY";
      row.streamPreview = "";
      row.failureCount = Number(row.failureCount || 0) + 1;
      row.retryAt = retryAt;
      row.updatedAt = now();
      result = projectFromRow(row);
    });
    return result;
  },

  createRun(input: {
    projectId: string;
    kind: RunKind;
    milestoneIndex: number;
    model: string;
  }): AgentRun {
    const startedAt = now();
    const row = db.runs.insert({
      runId: uid("r"),
      projectId: input.projectId,
      kind: input.kind,
      status: "running",
      milestoneIndex: input.milestoneIndex,
      model: input.model,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      lastContextTokens: 0,
      contextWindow: contextWindow(),
      usageEstimated: false,
      streamChars: 0,
      preview: "",
      note: "",
      error: "",
      startedAt,
      finishedAt: 0,
      chargedCredits: 0,
    }) as any;
    return runFromRow(row);
  },

  updateRunUsage(
    runId: string,
    usage: Partial<{
      inputTokens: number;
      outputTokens: number;
      thinkingTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      lastContextTokens: number;
      usageEstimated: boolean;
      streamChars: number;
      preview: string;
      note: string;
    }>,
  ): AgentRun | null {
    let result: AgentRun | null = null;
    db.transaction(() => {
      const row = rowByRunId(runId);
      if (!row || row.status !== "running") return;
      if (usage.inputTokens !== undefined)
        row.inputTokens = Math.max(0, Math.floor(usage.inputTokens));
      if (usage.outputTokens !== undefined)
        row.outputTokens = Math.max(0, Math.floor(usage.outputTokens));
      if (usage.thinkingTokens !== undefined)
        row.thinkingTokens = Math.max(0, Math.floor(usage.thinkingTokens));
      if (usage.cacheCreationInputTokens !== undefined)
        row.cacheCreationInputTokens = Math.max(
          0,
          Math.floor(usage.cacheCreationInputTokens),
        );
      if (usage.cacheReadInputTokens !== undefined)
        row.cacheReadInputTokens = Math.max(
          0,
          Math.floor(usage.cacheReadInputTokens),
        );
      if (usage.lastContextTokens !== undefined)
        row.lastContextTokens = Math.max(
          0,
          Math.floor(usage.lastContextTokens),
        );
      if (usage.usageEstimated !== undefined)
        row.usageEstimated = Boolean(usage.usageEstimated);
      if (usage.streamChars !== undefined)
        row.streamChars = Math.max(0, Math.floor(usage.streamChars));
      if (usage.preview !== undefined) row.preview = usage.preview.slice(-1800);
      if (usage.note !== undefined) row.note = usage.note.slice(0, 220);
      result = runFromRow(row);
    });
    return result;
  },

  finishRun(
    runId: string,
    status: "complete" | "failed",
    patch: Partial<{
      inputTokens: number;
      outputTokens: number;
      thinkingTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      lastContextTokens: number;
      usageEstimated: boolean;
      preview: string;
      note: string;
      error: string;
    }> = {},
  ): AgentRun | null {
    let result: AgentRun | null = null;
    db.transaction(() => {
      const row = rowByRunId(runId);
      if (!row) return;
      if (row.status !== "running") {
        result = runFromRow(row);
        return;
      }
      row.status = status;
      row.finishedAt = now();
      if (patch.inputTokens !== undefined) row.inputTokens = patch.inputTokens;
      if (patch.outputTokens !== undefined)
        row.outputTokens = patch.outputTokens;
      if (patch.thinkingTokens !== undefined)
        row.thinkingTokens = patch.thinkingTokens;
      if (patch.cacheCreationInputTokens !== undefined)
        row.cacheCreationInputTokens = patch.cacheCreationInputTokens;
      if (patch.cacheReadInputTokens !== undefined)
        row.cacheReadInputTokens = patch.cacheReadInputTokens;
      if (patch.lastContextTokens !== undefined)
        row.lastContextTokens = patch.lastContextTokens;
      if (patch.usageEstimated !== undefined)
        row.usageEstimated = Boolean(patch.usageEstimated);
      if (patch.preview !== undefined) row.preview = patch.preview.slice(-1800);
      if (patch.note !== undefined) row.note = patch.note.slice(0, 220);
      if (patch.error !== undefined) row.error = patch.error.slice(0, 500);
      result = runFromRow(row);
    });
    return result;
  },

  runs(projectId: string, limit = 20): AgentRun[] {
    const rows = db.runs
      .select()
      .where({ projectId })
      .orderBy("startedAt", "DESC")
      .limit(limit)
      .all() as any[];
    return rows.map(runFromRow);
  },

  artifacts(projectId: string): Artifact[] {
    const rows = db.artifacts
      .select()
      .where({ projectId })
      .orderBy("version", "ASC")
      .all() as any[];
    return rows.map(artifactFromRow);
  },

  artifactSummaries(projectId: string): ArtifactSummary[] {
    return this.artifacts(projectId).map(
      ({ html: _html, ...artifact }) => artifact,
    );
  },

  artifact(projectId: string, version: number): Artifact | null {
    const row = db.artifacts.select().where({ projectId, version }).first() as
      any | null;
    return row ? artifactFromRow(row) : null;
  },

  donationSignatures(projectId: string, limit = 100): string[] {
    const rows = db.donations
      .select()
      .where({ projectId })
      .orderBy("confirmedAt", "DESC")
      .limit(limit)
      .all() as any[];
    return rows.map((row) => String(row.signature));
  },

  recordDonations(
    projectId: string,
    transfers: Array<{
      signature: string;
      fromAddress: string;
      lamports: number;
      slot: number;
      blockTime: number;
    }>,
  ): Donation[] {
    const inserted: Donation[] = [];
    db.transaction(() => {
      for (const transfer of transfers) {
        if (!transfer.signature || transfer.lamports <= 0) continue;
        const exists = db.donations
          .select()
          .where({ projectId, signature: transfer.signature })
          .first() as any | null;
        if (exists) continue;
        const confirmedAt =
          transfer.blockTime > 0 ? transfer.blockTime * 1000 : now();
        const grant = db.treasuryGrants
          .select()
          .where({ projectId, signature: transfer.signature })
          .first() as any | null;
        const row = db.donations.insert({
          donationId: uid("d"),
          projectId,
          signature: transfer.signature,
          fromAddress: transfer.fromAddress || "unknown",
          lamports: Math.floor(transfer.lamports),
          credits: round2(transfer.lamports / lamportsPerCredit()),
          slot: Math.floor(transfer.slot || 0),
          blockTime: Math.floor(transfer.blockTime || 0),
          confirmedAt,
          source:
            grant &&
            (!grant.signature ||
              grant.signature === transfer.signature ||
              grant.fromAddress === transfer.fromAddress)
              ? "platform_seed"
              : "supporter",
        }) as any;
        inserted.push(donationFromRow(row));
      }
    });
    return inserted;
  },

  donations(projectId: string, limit = 20): Donation[] {
    const rows = db.donations
      .select()
      .where({ projectId })
      .orderBy("confirmedAt", "DESC")
      .limit(limit)
      .all() as any[];
    return rows.map(donationFromRow);
  },

  supporters(projectId: string): Supporter[] {
    const donations = this.donations(projectId, 2000).filter(
      (item) =>
        item.source === "supporter" &&
        item.fromAddress &&
        item.fromAddress !== "unknown",
    );
    const steerRows = db.steering.select().where({ projectId }).all() as any[];
    const map = new Map<string, Supporter>();
    for (const donation of donations) {
      const current = map.get(donation.fromAddress) || {
        address: donation.fromAddress,
        donatedLamports: 0,
        influenceEarned: 0,
        influenceSpent: 0,
        influenceAvailable: 0,
      };
      current.donatedLamports += donation.lamports;
      current.influenceEarned = round2(
        current.influenceEarned + donation.credits,
      );
      map.set(current.address, current);
    }
    for (const row of steerRows) {
      const address = String(row.fromAddress || "");
      const current = map.get(address);
      if (!current) continue;
      current.influenceSpent = round2(
        current.influenceSpent + Number(row.influence || 0),
      );
    }
    for (const supporter of map.values()) {
      supporter.influenceAvailable = round2(
        Math.max(0, supporter.influenceEarned - supporter.influenceSpent),
      );
    }
    return [...map.values()].sort(
      (a, b) => b.donatedLamports - a.donatedLamports,
    );
  },

  treasuryGrant(projectId: string): TreasuryGrant | null {
    const row = db.treasuryGrants
      .select()
      .where({ projectId, purpose: "first_milestone" })
      .orderBy("createdAt", "DESC")
      .first() as any | null;
    return row ? treasuryGrantFromRow(row) : null;
  },

  treasuryGrants(projectId: string): TreasuryGrant[] {
    const rows = db.treasuryGrants
      .select()
      .where({ projectId })
      .orderBy("createdAt", "DESC")
      .limit(8)
      .all() as any[];
    return rows.map(treasuryGrantFromRow);
  },

  beginTreasuryGrant(input: {
    projectId: string;
    toAddress: string;
    lamports: number;
  }): TreasuryGrant {
    let result: TreasuryGrant | null = null;
    db.transaction(() => {
      const existing = db.treasuryGrants
        .select()
        .where({ projectId: input.projectId, purpose: "first_milestone" })
        .first() as any | null;
      if (existing) {
        if (existing.status === "failed") {
          existing.status = "pending";
          existing.error = "";
          existing.lamports = Math.max(1, Math.floor(input.lamports));
          existing.updatedAt = now();
        }
        result = treasuryGrantFromRow(existing);
        return;
      }
      const createdAt = now();
      const row = db.treasuryGrants.insert({
        grantId: `tg_${input.projectId}`,
        projectId: input.projectId,
        purpose: "first_milestone",
        status: "pending",
        fromAddress: "",
        toAddress: input.toAddress,
        lamports: Math.max(1, Math.floor(input.lamports)),
        signature: "",
        error: "",
        createdAt,
        updatedAt: createdAt,
      }) as any;
      result = treasuryGrantFromRow(row);
    });
    if (!result) throw new Error("failed to create treasury grant");
    return result;
  },

  submitTreasuryGrant(
    projectId: string,
    fromAddress: string,
    signature: string,
  ): TreasuryGrant {
    let result: TreasuryGrant | null = null;
    db.transaction(() => {
      const row = db.treasuryGrants
        .select()
        .where({ projectId, purpose: "first_milestone" })
        .first() as any | null;
      if (!row) throw new Error("treasury grant not found");
      row.status = "submitted";
      row.fromAddress = fromAddress;
      row.signature = signature || row.signature || "";
      row.error = "";
      row.updatedAt = now();
      result = treasuryGrantFromRow(row);
    });
    if (!result) throw new Error("failed to submit treasury grant");
    return result;
  },

  confirmTreasuryGrant(projectId: string): TreasuryGrant | null {
    let result: TreasuryGrant | null = null;
    db.transaction(() => {
      const row = db.treasuryGrants
        .select()
        .where({ projectId, purpose: "first_milestone" })
        .first() as any | null;
      if (!row) return;
      row.status = "confirmed";
      row.error = "";
      row.updatedAt = now();
      result = treasuryGrantFromRow(row);
    });
    return result;
  },

  failTreasuryGrant(projectId: string, error: string): TreasuryGrant | null {
    let result: TreasuryGrant | null = null;
    db.transaction(() => {
      const row = db.treasuryGrants
        .select()
        .where({ projectId, purpose: "first_milestone" })
        .first() as any | null;
      if (!row) return;
      row.status = "failed";
      row.error = error.slice(0, 300);
      row.updatedAt = now();
      result = treasuryGrantFromRow(row);
    });
    return result;
  },

  steering(projectId: string, limit = 20): Steering[] {
    const rows = db.steering
      .select()
      .where({ projectId })
      .orderBy("createdAt", "DESC")
      .limit(limit)
      .all() as any[];
    return rows.map(steeringFromRow);
  },

  openSteering(projectId: string, limit = 12): Steering[] {
    const rows = db.steering
      .select()
      .where({ projectId, status: "open" })
      .orderBy("influence", "DESC")
      .limit(limit)
      .all() as any[];
    return rows.map(steeringFromRow);
  },

  createSteeringChallenge(
    projectId: string,
    address: string,
  ): { id: string; message: string; expiresAt: number } {
    const createdAt = now();
    const challengeId = uid("sc");
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    const message = `CrowdClaw steer\nproject:${projectId}\naddress:${address}\nnonce:${nonce}`;
    const expiresAt = createdAt + 5 * 60_000;
    db.steeringChallenges.insert({
      challengeId,
      projectId,
      address,
      message,
      expiresAt,
      usedAt: 0,
      createdAt,
    });
    return { id: challengeId, message, expiresAt };
  },

  steeringChallenge(
    projectId: string,
    challengeId: string,
    address: string,
  ): { message: string; expiresAt: number; usedAt: number } | null {
    const row = db.steeringChallenges
      .select()
      .where({ projectId, challengeId, address })
      .first() as any | null;
    return row
      ? {
          message: row.message,
          expiresAt: Number(row.expiresAt || 0),
          usedAt: Number(row.usedAt || 0),
        }
      : null;
  },

  submitSteering(input: {
    projectId: string;
    challengeId: string;
    address: string;
    instruction: string;
    influence: number;
  }): Steering {
    let result: Steering | null = null;
    db.transaction(() => {
      const challenge = db.steeringChallenges
        .select()
        .where({
          projectId: input.projectId,
          challengeId: input.challengeId,
          address: input.address,
        })
        .first() as any | null;
      if (
        !challenge ||
        Number(challenge.usedAt || 0) > 0 ||
        Number(challenge.expiresAt || 0) < now()
      )
        throw new Error("steering challenge expired");

      const supporter = this.supporters(input.projectId).find(
        (item) => item.address === input.address,
      );
      const influence = round2(input.influence);
      if (
        !supporter ||
        influence <= 0 ||
        influence > supporter.influenceAvailable + 1e-9
      )
        throw new Error("insufficient influence");

      challenge.usedAt = now();
      const row = db.steering.insert({
        steerId: uid("s"),
        projectId: input.projectId,
        fromAddress: input.address,
        instruction: input.instruction.trim().slice(0, 180),
        influence,
        status: "open",
        createdAt: now(),
        consumedAt: 0,
        consumedMilestoneIndex: -1,
      }) as any;
      result = steeringFromRow(row);
    });
    if (!result) throw new Error("failed to submit steering");
    return result;
  },

  ledger(projectId: string, limit = 40): CreditLedgerEntry[] {
    const row = rowByProjectId(projectId);
    if (row) backfillLedgerIfNeeded(row);
    const rows = db.creditLedger
      .select()
      .where({ projectId })
      .orderBy("createdAt", "DESC")
      .limit(limit)
      .all() as any[];
    return rows.map(ledgerFromRow);
  },

  event(projectId: string, type: string, message: string): ProjectEvent {
    const row = db.events.insert({
      eventId: uid("e"),
      projectId,
      type,
      message: message.slice(0, 500),
      createdAt: now(),
    }) as any;
    return eventFromRow(row);
  },

  events(projectId: string, limit = 30): ProjectEvent[] {
    const rows = db.events
      .select()
      .where({ projectId })
      .orderBy("createdAt", "DESC")
      .limit(limit)
      .all() as any[];
    return rows.map(eventFromRow);
  },

  claimLease(
    projectId: string,
    owner: string,
    allowed: ProjectStatus[],
    leaseMs: number,
  ): boolean {
    let claimed = false;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row || !allowed.includes(row.status)) return;
      const t = now();
      if (
        row.leaseOwner &&
        Number(row.leaseUntil || 0) > t &&
        row.leaseOwner !== owner
      )
        return;
      row.leaseOwner = owner;
      row.leaseUntil = t + leaseMs;
      row.updatedAt = t;
      claimed = true;
    });
    return claimed;
  },

  heartbeat(projectId: string, owner: string, leaseMs: number): void {
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row || row.leaseOwner !== owner) return;
      row.leaseUntil = now() + leaseMs;
      row.updatedAt = now();
    });
  },

  releaseLease(projectId: string, owner: string): void {
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row || row.leaseOwner !== owner) return;
      row.leaseOwner = "";
      row.leaseUntil = 0;
      row.updatedAt = now();
    });
  },

  expireOwnedLeases(owner: string): number {
    let expired = 0;
    db.transaction(() => {
      const rows = db.projects.select().all() as any[];
      for (const row of rows) {
        if (row.leaseOwner !== owner) continue;
        row.leaseUntil = 0;
        row.updatedAt = now();
        expired += 1;
      }
    });
    return expired;
  },

  recoverProjectWork(projectId: string): number {
    let recovered = 0;
    const t = now();
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) return;
      const milestones = Array.isArray(row.milestones) ? row.milestones : [];
      if (
        row.status === "completed" &&
        milestones.length === 0 &&
        Number(row.done || 0) === 0 &&
        row.name === "new-project"
      ) {
        row.status = "planning";
        row.currentRunId = null;
        row.leaseOwner = "";
        row.leaseUntil = 0;
        row.retryAt = 0;
        row.failureCount = 0;
        row.error = "";
        row.agentNote = "";
        row.streamPreview = "";
        row.updatedAt = t;
        recovered += 1;
        return;
      }
      if (Number(row.leaseUntil || 0) > t) return;
      if (row.status === "planning" && row.currentRunId) {
        const run = rowByRunId(row.currentRunId);
        if (run && run.status === "running") {
          run.status = "failed";
          run.error = "agent lease expired";
          run.finishedAt = t;
        }
        row.currentRunId = null;
        row.leaseOwner = "";
        row.leaseUntil = 0;
        row.streamPreview = "";
        row.updatedAt = t;
        recovered += 1;
        return;
      }
      if (["working", "validating", "publishing"].includes(row.status)) {
        const project = projectFromRow(row);
        if (row.currentRunId) {
          const run = rowByRunId(row.currentRunId);
          if (run && run.status === "running") {
            run.status = "failed";
            run.error = "agent lease expired";
            run.finishedAt = t;
          }
        }
        const miles = [...project.milestones];
        if (miles[project.done]?.state === "working")
          miles[project.done] = { ...miles[project.done], state: "queued" };
        row.milestones = miles;
        row.status = "queued";
        row.reservedCredits = 0;
        row.currentRunId = null;
        row.leaseOwner = "";
        row.leaseUntil = 0;
        row.error = "";
        row.updatedAt = t;
        recovered += 1;
      }
    });
    return recovered;
  },

  recoverExpiredWork(): number {
    let recovered = 0;
    const t = now();
    db.transaction(() => {
      const rows = db.projects.select().all() as any[];
      for (const row of rows) {
        // Repair projects produced by the old funding-state bug: a fresh
        // project could be marked completed before its first roadmap existed.
        const milestones = Array.isArray(row.milestones) ? row.milestones : [];
        if (
          row.status === "completed" &&
          milestones.length === 0 &&
          Number(row.done || 0) === 0 &&
          row.name === "new-project"
        ) {
          row.status = "planning";
          row.currentRunId = null;
          row.leaseOwner = "";
          row.leaseUntil = 0;
          row.retryAt = 0;
          row.failureCount = 0;
          row.error = "";
          row.agentNote =
            "Recovered initial planning state; retrying the roadmap now.";
          row.streamPreview = "";
          row.updatedAt = t;
          recovered += 1;
          continue;
        }

        const expired = Number(row.leaseUntil || 0) <= t;
        if (!expired) continue;

        if (row.status === "planning" && row.currentRunId) {
          const interruptedRun = rowByRunId(row.currentRunId);
          if (interruptedRun && interruptedRun.status === "running") {
            interruptedRun.status = "failed";
            interruptedRun.error = "worker lease expired during planning";
            interruptedRun.finishedAt = t;
          }
          row.currentRunId = null;
          row.leaseOwner = "";
          row.leaseUntil = 0;
          row.agentNote =
            "Recovered an interrupted planning lease; retrying safely.";
          row.streamPreview = "";
          row.updatedAt = t;
          recovered += 1;
          continue;
        }

        if (!["working", "validating", "publishing"].includes(row.status))
          continue;
        const project = projectFromRow(row);
        const interruptedRunId = row.currentRunId;
        if (interruptedRunId) {
          const interruptedRun = rowByRunId(interruptedRunId);
          if (interruptedRun && interruptedRun.status === "running") {
            interruptedRun.status = "failed";
            interruptedRun.error = "worker lease expired during this run";
            interruptedRun.finishedAt = t;
          }
        }
        const miles = [...project.milestones];
        if (miles[project.done]?.state === "working")
          miles[project.done] = { ...miles[project.done], state: "queued" };
        row.milestones = miles;
        row.status = "queued";
        row.reservedCredits = 0;
        row.currentRunId = null;
        row.leaseOwner = "";
        row.leaseUntil = 0;
        row.agentNote =
          "Recovered an interrupted worker lease; retrying safely.";
        row.error = "";
        row.updatedAt = t;
        recovered += 1;
      }

      const activeRunIds = new Set(
        rows.map((row) => row.currentRunId).filter(Boolean),
      );
      const staleAfter = Math.max(
        20_000,
        (Number.parseInt(process.env.AGENT_LEASE_MS || "60000", 10) || 60_000) *
          2,
      );
      const runs = db.runs.select().all() as any[];
      for (const run of runs) {
        if (run.status !== "running" || activeRunIds.has(run.runId)) continue;
        if (t - Number(run.startedAt || 0) < staleAfter) continue;
        run.status = "failed";
        run.error = "orphaned run recovered by worker";
        run.finishedAt = t;
      }
    });
    return recovered;
  },
};
