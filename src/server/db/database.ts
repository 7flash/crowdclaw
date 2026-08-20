import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database as BunSqlite } from "bun:sqlite";
import { Database, z } from "sqlite-zod-orm";
import { databasePath } from "../config";

const MilestoneSchema = z.object({
  key: z.string().default(""),
  title: z.string(),
  goal: z.string().default(""),
  costCredits: z.number(),
  votes: z.number().int().default(0),
  rendering: z.enum(["canvas", "three_migration", "three"]).optional(),
  origin: z.enum(["agent", "community"]).default("agent"),
  proposedBy: z.string().optional(),
  state: z.enum(["queued", "working", "shipped"]),
  createdAt: z.number().int(),
  completedAt: z.number().int().optional(),
  artifactVersion: z.number().int().optional(),
});

const ProjectSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  idea: z.string(),
  summary: z.string(),
  status: z.enum([
    "planning",
    "awaiting_start",
    "seeding",
    "waiting_funds",
    "queued",
    "working",
    "validating",
    "publishing",
    "completed",
    "failed",
  ]),
  agentId: z.string(),
  walletAddress: z.string(),
  milestones: z.array(MilestoneSchema).default([]),
  done: z.number().int().default(0),
  spentCredits: z.number().default(0),
  reservedCredits: z.number().default(0),
  onchainLamports: z.number().default(0),
  creditedLamports: z.number().default(0),
  manualCredits: z.number().default(0),
  currentRunId: z.string().nullable().default(null),
  agentNote: z.string().default(""),
  streamPreview: z.string().default(""),
  streamUpdatedAt: z.number().int().default(0),
  streamEventCount: z.number().int().default(0),
  lastFundingSyncAt: z.number().int().default(0),
  fundingError: z.string().default(""),
  failureCount: z.number().int().default(0),
  retryAt: z.number().int().default(0),
  error: z.string().default(""),
  leaseOwner: z.string().default(""),
  leaseUntil: z.number().int().default(0),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const ArtifactSchema = z.object({
  artifactId: z.string(),
  projectId: z.string(),
  version: z.number().int(),
  milestoneTitle: z.string(),
  html: z.string(),
  sha256: z.string(),
  runId: z.string(),
  createdAt: z.number().int(),
});

const RunSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  kind: z.enum(["plan", "build"]),
  status: z.enum(["running", "complete", "failed"]),
  milestoneIndex: z.number().int(),
  model: z.string(),
  inputTokens: z.number().int().default(0),
  outputTokens: z.number().int().default(0),
  thinkingTokens: z.number().int().default(0),
  cacheCreationInputTokens: z.number().int().default(0),
  cacheReadInputTokens: z.number().int().default(0),
  lastContextTokens: z.number().int().default(0),
  contextWindow: z.number().int().default(1048576),
  usageEstimated: z.boolean().default(false),
  streamChars: z.number().int().default(0),
  streamUpdatedAt: z.number().int().default(0),
  streamEventCount: z.number().int().default(0),
  preview: z.string().default(""),
  note: z.string().default(""),
  error: z.string().default(""),
  startedAt: z.number().int(),
  finishedAt: z.number().int().default(0),
  chargedCredits: z.number().default(0),
});

const MilestoneVoteSchema = z.object({
  voteId: z.string(),
  projectId: z.string(),
  milestoneKey: z.string(),
  voterKey: z.string(),
  createdAt: z.number().int(),
});

const EventSchema = z.object({
  eventId: z.string(),
  projectId: z.string(),
  type: z.string(),
  message: z.string(),
  createdAt: z.number().int(),
});

const DonationSchema = z.object({
  donationId: z.string(),
  projectId: z.string(),
  signature: z.string(),
  fromAddress: z.string(),
  lamports: z.number().int(),
  credits: z.number(),
  slot: z.number().int(),
  blockTime: z.number().int(),
  confirmedAt: z.number().int(),
  source: z.enum(["supporter", "platform_seed"]).default("supporter"),
});

const TreasuryGrantSchema = z.object({
  grantId: z.string(),
  projectId: z.string(),
  purpose: z.enum(["first_milestone"]),
  status: z.enum(["pending", "submitted", "confirmed", "failed"]),
  fromAddress: z.string().default(""),
  toAddress: z.string(),
  lamports: z.number().int(),
  signature: z.string().default(""),
  error: z.string().default(""),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

const SteeringSchema = z.object({
  steerId: z.string(),
  projectId: z.string(),
  fromAddress: z.string(),
  instruction: z.string(),
  influence: z.number(),
  status: z.enum(["open", "consumed"]),
  createdAt: z.number().int(),
  consumedAt: z.number().int().default(0),
  consumedMilestoneIndex: z.number().int().default(-1),
});

const SteeringChallengeSchema = z.object({
  challengeId: z.string(),
  projectId: z.string(),
  address: z.string(),
  message: z.string(),
  expiresAt: z.number().int(),
  usedAt: z.number().int().default(0),
  createdAt: z.number().int(),
});

const CreditLedgerSchema = z.object({
  ledgerId: z.string(),
  projectId: z.string(),
  kind: z.enum([
    "funding",
    "manual",
    "milestone_spend",
    "legacy_funding",
    "legacy_spend",
  ]),
  credits: z.number(),
  runId: z.string().default(""),
  milestoneIndex: z.number().int().default(-1),
  reference: z.string().default(""),
  note: z.string().default(""),
  createdAt: z.number().int(),
});

const FundingObservationSchema = z.object({
  observationId: z.string(),
  projectId: z.string(),
  observedLamports: z.number().int(),
  creditedLamports: z.number().int(),
  deltaCreditedLamports: z.number().int(),
  source: z.enum(["solana_balance", "dev"]),
  createdAt: z.number().int(),
});

const rawPath = databasePath();
const dbPath = rawPath === ":memory:" ? rawPath : resolve(rawPath);

function positiveInt(name: string, fallback: number, minimum: number): number {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

const SQLITE_BUSY_TIMEOUT_MS = positiveInt(
  "CROWDCLAW_DB_BUSY_TIMEOUT_MS",
  10_000,
  1_000,
);

function applySqlitePragmas(connection: any): void {
  // busy_timeout is connection-local, so every process applies these pragmas
  // to the actual long-lived sqlite-zod-orm connection that performs reads and
  // writes. WAL handles normal web + agent concurrency; no external writer
  // mutex or application-level SQLite retry loop is needed.
  const exec =
    typeof connection?.exec === "function"
      ? connection.exec.bind(connection)
      : typeof connection?.run === "function"
        ? connection.run.bind(connection)
        : null;
  if (!exec) {
    throw new Error(
      "sqlite-zod-orm connection does not expose exec/run; cannot configure SQLite pragmas",
    );
  }
  exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
  exec("PRAGMA journal_mode = WAL;");
  exec("PRAGMA synchronous = NORMAL;");
  exec("PRAGMA wal_autocheckpoint = 1000;");
  exec("PRAGMA foreign_keys = ON;");
}

// Establish persistent WAL mode before the ORM opens its connection. This raw
// handle is not used as a writer coordinator; it only initializes the file.
if (dbPath !== ":memory:") {
  const bootstrap = new BunSqlite(dbPath, { create: true });
  try {
    applySqlitePragmas(bootstrap);
  } finally {
    bootstrap.close();
  }
}

export const db = new Database(dbPath, {
  projects: ProjectSchema,
  artifacts: ArtifactSchema,
  runs: RunSchema,
  events: EventSchema,
  milestoneVotes: MilestoneVoteSchema,
  fundingObservations: FundingObservationSchema,
  donations: DonationSchema,
  treasuryGrants: TreasuryGrantSchema,
  steering: SteeringSchema,
  steeringChallenges: SteeringChallengeSchema,
  creditLedger: CreditLedgerSchema,
});

applySqlitePragmas(db);

const SQLITE_RETRY_DELAYS_MS = [20, 60, 140];
const SQLITE_RETRY_CELL = new Int32Array(new SharedArrayBuffer(4));

function sqliteBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /SQLITE_BUSY|database (?:table )?is locked/i.test(message);
}

function withSqliteRetry<T>(operation: () => T): T {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      const delay = SQLITE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !sqliteBusy(error)) throw error;
      Atomics.wait(SQLITE_RETRY_CELL, 0, 0, delay);
    }
  }
}

// WAL + busy_timeout remain the first line of defense. The short retry here is
// a final cross-process backstop for the small SQLITE_BUSY windows that still
// occur when multiple autonomous workers finish writes at the same instant.
export function databaseWrite<T>(operation: () => T): T {
  return withSqliteRetry(operation);
}

export function databaseTransaction<T>(operation: () => T): T {
  return withSqliteRetry(() => db.transaction(operation) as T);
}

export function probeDatabase(): void {
  db.projects.select().limit(1).all();
}
