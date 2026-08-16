import { db } from "./database";
import { contextWindow, lamportsPerCredit } from "../config";
import type {
  AgentRun,
  Artifact,
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
  const onchainCredits = Number(row.onchainLamports || 0) / lamportsPerCredit();
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
    cacheCreationInputTokens: Number(row.cacheCreationInputTokens || 0),
    cacheReadInputTokens: Number(row.cacheReadInputTokens || 0),
    lastContextTokens,
    contextWindow: window,
    remainingContextTokens: Math.max(0, window - lastContextTokens),
    streamChars: Number(row.streamChars || 0),
    preview: row.preview || "",
    note: row.note || "",
    error: row.error || "",
    startedAt: row.startedAt,
    finishedAt: Number(row.finishedAt || 0),
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

function rowByProjectId(projectId: string): any | null {
  return db.projects.select().where({ projectId }).first() as any | null;
}

function rowByRunId(runId: string): any | null {
  return db.runs.select().where({ runId }).first() as any | null;
}

function usageFromRuns(runs: AgentRun[], project: Project): UsageSummary {
  const inputTokens = runs.reduce((sum, run) => sum + run.inputTokens, 0);
  const outputTokens = runs.reduce((sum, run) => sum + run.outputTokens, 0);
  const buildTokens = runs
    .filter((run) => run.kind === "build" && run.status === "complete")
    .reduce((sum, run) => sum + run.inputTokens + run.outputTokens, 0);
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
    totalTokens: inputTokens + outputTokens,
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
    const project = this.get(projectId);
    if (!project) return null;
    const artifacts = this.artifactSummaries(projectId);
    const allRuns = this.runs(projectId, 500);
    const runs = allRuns.slice(0, 40);
    const events = this.events(projectId, 40);
    return {
      project,
      artifacts,
      runs,
      events,
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
      manualCredits: 0,
      currentRunId: null,
      agentNote: "Reading the idea and planning the first playable milestones…",
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

  setFunding(projectId: string, lamports: number, error = ""): Project | null {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) return;
      row.onchainLamports = Math.max(0, Math.floor(lamports));
      row.lastFundingSyncAt = now();
      row.fundingError = error;
      row.updatedAt = now();
      result = projectFromRow(row);
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
      row.manualCredits = round2(Number(row.manualCredits || 0) + credits);
      row.updatedAt = now();
      result = projectFromRow(row);
    });
    return result;
  },

  setPlanningResult(
    projectId: string,
    name: string,
    summary: string,
    milestones: Milestone[],
  ): Project {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) throw new Error("project not found");
      row.name = name || "untitled";
      row.summary = summary || row.idea;
      row.milestones = milestones;
      row.done = 0;
      row.reservedCredits = 0;
      row.currentRunId = null;
      row.agentNote =
        "Roadmap ready. I’ll start as soon as the first milestone is funded.";
      row.streamPreview = "";
      row.error = "";
      row.failureCount = 0;
      row.retryAt = 0;
      const project = projectFromRow(row);
      const next = project.milestones[0];
      row.status =
        next && project.availableCredits >= next.costCredits
          ? "queued"
          : "waiting_funds";
      row.updatedAt = now();
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

  markQueuedIfFunded(projectId: string): Project | null {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) return;
      const project = projectFromRow(row);
      const next = project.milestones[project.done];
      if (!next) {
        row.status = "completed";
      } else if (
        project.availableCredits >= next.costCredits &&
        project.status === "waiting_funds"
      ) {
        row.status = "queued";
        row.agentNote = "Funding reached. Queued for the next milestone.";
        row.error = "";
      }
      row.updatedAt = now();
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
      row.agentNote = `Building ${next.title}…`;
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
      if (!project || !run) return;
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
  ): Project {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) throw new Error("project not found");
      if (Number(row.done || 0) !== expectedDone)
        throw new Error("project advanced while build was running");
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

      row.milestones = miles;
      row.done = expectedDone + 1;
      row.spentCredits = round2(
        Number(row.spentCredits || 0) + current.costCredits,
      );
      row.reservedCredits = 0;
      row.currentRunId = null;
      row.streamPreview = "";
      row.failureCount = 0;
      row.retryAt = 0;
      row.error = "";
      row.agentNote = `Shipped v${artifact.version}: ${current.title}.`;

      const updated = projectFromRow(row);
      const next = updated.milestones[updated.done];
      row.status = !next
        ? "completed"
        : updated.availableCredits >= next.costCredits
          ? "queued"
          : "waiting_funds";
      row.updatedAt = now();
      result = projectFromRow(row);
    });
    if (!result) throw new Error("failed to publish artifact");
    return result;
  },

  releaseReservation(
    projectId: string,
    status: ProjectStatus,
    error: string,
    retryAt = 0,
  ): Project | null {
    let result: Project | null = null;
    db.transaction(() => {
      const row = rowByProjectId(projectId);
      if (!row) return;
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
      row.agentNote =
        status === "failed"
          ? "The agent stopped after repeated failed attempts."
          : "That attempt failed without charging the milestone. I’ll retry automatically.";
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
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      lastContextTokens: 0,
      contextWindow: contextWindow(),
      streamChars: 0,
      preview: "",
      note: "",
      error: "",
      startedAt,
      finishedAt: 0,
    }) as any;
    return runFromRow(row);
  },

  updateRunUsage(
    runId: string,
    usage: Partial<{
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      lastContextTokens: number;
      streamChars: number;
      preview: string;
      note: string;
    }>,
  ): AgentRun | null {
    let result: AgentRun | null = null;
    db.transaction(() => {
      const row = rowByRunId(runId);
      if (!row) return;
      if (usage.inputTokens !== undefined)
        row.inputTokens = Math.max(0, Math.floor(usage.inputTokens));
      if (usage.outputTokens !== undefined)
        row.outputTokens = Math.max(0, Math.floor(usage.outputTokens));
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
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
      lastContextTokens: number;
      preview: string;
      note: string;
      error: string;
    }> = {},
  ): AgentRun | null {
    let result: AgentRun | null = null;
    db.transaction(() => {
      const row = rowByRunId(runId);
      if (!row) return;
      row.status = status;
      row.finishedAt = now();
      if (patch.inputTokens !== undefined) row.inputTokens = patch.inputTokens;
      if (patch.outputTokens !== undefined)
        row.outputTokens = patch.outputTokens;
      if (patch.cacheCreationInputTokens !== undefined)
        row.cacheCreationInputTokens = patch.cacheCreationInputTokens;
      if (patch.cacheReadInputTokens !== undefined)
        row.cacheReadInputTokens = patch.cacheReadInputTokens;
      if (patch.lastContextTokens !== undefined)
        row.lastContextTokens = patch.lastContextTokens;
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

  recoverExpiredWork(): number {
    let recovered = 0;
    const t = now();
    db.transaction(() => {
      const rows = db.projects.select().all() as any[];
      for (const row of rows) {
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
        (Number.parseInt(process.env.WORKER_LEASE_MS || "60000", 10) ||
          60_000) * 2,
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
