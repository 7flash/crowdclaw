import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
const WRITER_LOCK_PATH = dbPath === ":memory:" ? "" : `${dbPath}.writer.lock`;
const WRITER_LOCK_WAIT_MS = positiveInt(
  "CROWDCLAW_DB_LOCK_WAIT_MS",
  15_000,
  1_000,
);
const WRITER_LOCK_STALE_MS = positiveInt(
  "CROWDCLAW_DB_LOCK_STALE_MS",
  30_000,
  5_000,
);
const SQLITE_BUSY_RETRIES = positiveInt("CROWDCLAW_DB_BUSY_RETRIES", 8, 1);
let writerDepth = 0;

function positiveInt(name: string, fallback: number, minimum: number): number {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

function sleepSync(ms: number): void {
  // Database access in this module is synchronous. Atomics.wait gives us a
  // cheap synchronous backoff without burning a CPU core in a spin loop.
  try {
    const view = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(view, 0, 0, Math.max(1, Math.floor(ms)));
  } catch {
    const until = Date.now() + Math.max(1, Math.floor(ms));
    while (Date.now() < until) {}
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    // EPERM means the process exists but this user cannot signal it.
    return error?.code === "EPERM";
  }
}

function clearStaleWriterLock(): boolean {
  if (!WRITER_LOCK_PATH) return false;
  try {
    const raw = readFileSync(WRITER_LOCK_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}") as {
      pid?: number;
      createdAt?: number;
    };
    const pid = Number(parsed.pid || 0);
    const createdAt = Number(parsed.createdAt || 0);
    if (pid > 0 && processAlive(pid)) return false;
    if (
      pid > 0 ||
      (createdAt > 0 && Date.now() - createdAt > WRITER_LOCK_STALE_MS)
    ) {
      rmSync(WRITER_LOCK_PATH, { force: true });
      return true;
    }
    return false;
  } catch (error: any) {
    if (error?.code === "ENOENT") return true;
    // Another process can observe the lock between open("wx") and writing its
    // metadata. Never delete a fresh/partially-written lock. Only an old lock
    // with no readable owner is considered abandoned.
    try {
      const age = Date.now() - statSync(WRITER_LOCK_PATH).mtimeMs;
      if (age <= WRITER_LOCK_STALE_MS) return false;
      rmSync(WRITER_LOCK_PATH, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}

function acquireWriterLock(): () => void {
  if (!WRITER_LOCK_PATH || writerDepth > 0) return () => {};
  const started = Date.now();
  let delay = 5;
  while (true) {
    let fd = -1;
    try {
      fd = openSync(WRITER_LOCK_PATH, "wx", 0o600);
      const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }),
      );
      return () => {
        try {
          closeSync(fd);
        } catch {}
        try {
          const current = JSON.parse(
            readFileSync(WRITER_LOCK_PATH, "utf8"),
          ) as {
            token?: string;
          };
          if (current.token === token)
            rmSync(WRITER_LOCK_PATH, { force: true });
        } catch {}
      };
    } catch (error: any) {
      if (fd >= 0) {
        try {
          closeSync(fd);
        } catch {}
      }
      if (error?.code !== "EEXIST") throw error;
      if (clearStaleWriterLock()) continue;
      if (Date.now() - started >= WRITER_LOCK_WAIT_MS)
        throw new Error(
          `CrowdClaw database writer lock timed out after ${WRITER_LOCK_WAIT_MS}ms`,
        );
      sleepSync(delay);
      delay = Math.min(80, Math.ceil(delay * 1.6));
    }
  }
}

function isBusyError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error || "");
  return /(?:database is locked|SQLITE_BUSY|database table is locked)/i.test(
    text,
  );
}

function withBusyRetry<T>(operation: () => T): T {
  let last: unknown;
  for (let attempt = 0; attempt <= SQLITE_BUSY_RETRIES; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      last = error;
      if (!isBusyError(error)) throw error;
      if (attempt >= SQLITE_BUSY_RETRIES) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `CrowdClaw database write remained busy after ${SQLITE_BUSY_RETRIES + 1} attempts: ${message}`,
          { cause: error },
        );
      }
      sleepSync(Math.min(200, 8 * 2 ** attempt));
    }
  }
  throw last;
}

function withWriterLock<T>(operation: () => T): T {
  if (!WRITER_LOCK_PATH || writerDepth > 0) return operation();
  const release = acquireWriterLock();
  writerDepth += 1;
  try {
    return withBusyRetry(operation);
  } finally {
    writerDepth -= 1;
    release();
  }
}

if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

// sqlite-zod-orm opens and initializes its own connection in every process.
// That constructor can perform schema writes, so even startup must participate
// in the same cross-process writer mutex as normal repository transactions.
const orm = withWriterLock(() => {
  if (dbPath !== ":memory:") {
    const bootstrap = new BunSqlite(dbPath, { create: true });
    try {
      bootstrap.exec("PRAGMA busy_timeout=10000;");
      bootstrap.exec("PRAGMA journal_mode=WAL;");
      bootstrap.exec("PRAGMA synchronous=NORMAL;");
      bootstrap.exec("PRAGMA wal_autocheckpoint=1000;");
    } finally {
      bootstrap.close();
    }
  }
  return new Database(dbPath, {
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
});

// Repository writes are synchronous. Keep the mutex explicit instead of
// monkey-patching sqlite-zod-orm internals; callers use these helpers around
// transactions and the few direct inserts.
export const db = orm;

export function databaseWrite<T>(operation: () => T): T {
  return withWriterLock(operation);
}

export function databaseTransaction<T>(operation: () => T): T {
  return withWriterLock(() => db.transaction(operation) as T);
}

export function probeDatabase(): void {
  db.projects.select().limit(1).all();
}
