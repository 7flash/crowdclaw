import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const projectId = String(process.argv[2] || "");
if (!/^p_[a-z0-9]+_[a-z0-9]+$/i.test(projectId))
  throw new Error("project id argument is required");

const rawPhase = String(process.argv[3] || "build").toLowerCase();
const phase = rawPhase === "plan" ? "plan" : "build";

// Codex keeps auth/config under CODEX_HOME, but its SQLite runtime can live in a
// separate directory via CODEX_SQLITE_HOME. CrowdClaw runs independent Codex
// sessions in parallel, so sharing the default SQLite home creates avoidable
// SQLITE_BUSY / "database is locked" startup races between projects.
//
// Keep CODEX_HOME untouched so every worker uses the operator's normal Codex
// login and config. Only the disposable SQLite state is isolated per bgrun
// worker process. The PID suffix also protects a replacement worker from a
// stale Codex child that may still have the previous SQLite files open.
const sqliteRoot = resolve(
  String(
    process.env.CROWDCLAW_CODEX_SQLITE_ROOT || "./data/codex-sqlite",
  ).trim() || "./data/codex-sqlite",
);
const sqliteHome = resolve(sqliteRoot, `${projectId}-${phase}-${process.pid}`);
mkdirSync(sqliteHome, { recursive: true });
process.env.CODEX_SQLITE_HOME = sqliteHome;

try {
  await import("./project-agent.ts");
} finally {
  // A normal worker exit has no reason to retain Codex's local session/index
  // database: CrowdClaw persists canonical project/run state in its own DB.
  // Ignore cleanup failures (notably a late Windows file handle); a future PID
  // gets a different directory and therefore cannot inherit the lock.
  try {
    rmSync(sqliteHome, { recursive: true, force: true });
  } catch {}
}
