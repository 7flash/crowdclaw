const projectId = String(process.argv[2] || "");
if (!/^p_[a-z0-9]+_[a-z0-9]+$/i.test(projectId))
  throw new Error("project id argument is required");

const rawPhase = String(process.argv[3] || "build").toLowerCase();
const phase = rawPhase === "plan" ? "plan" : "build";

const generation = String(process.argv[4] || "legacy");
if (
  generation !== "legacy" &&
  !/^crowdclaw-agent-p_[a-z0-9]+_[a-z0-9]+-(?:plan|build)-[a-z0-9]+-[a-z0-9]+$/i.test(
    generation,
  )
)
  throw new Error("invalid agent generation argument");

// This launcher deliberately does NOT touch CODEX_HOME, HOME or
// CODEX_SQLITE_HOME. Codex must see exactly the same authenticated environment
// as a normal `codex` invocation by the service account. The SQLite lock that
// CrowdClaw observed was its own shared project database, not evidence that
// Codex auth/state needed to be relocated per worker.
process.env.CROWDCLAW_AGENT_PHASE = phase;
process.env.CROWDCLAW_AGENT_GENERATION = generation;

await import("./project-agent.ts");
