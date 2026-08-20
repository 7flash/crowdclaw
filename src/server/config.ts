function positiveInt(name: string, fallback: number, minimum = 1): number {
  const parsed = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function jsxAiRuntime(): string {
  return process.env.JSX_AI_RUNTIME?.trim().toLowerCase() || "";
}

export function lamportsPerCredit(): number {
  return positiveInt("LAMPORTS_PER_CREDIT", 100_000);
}

export function projectFloatCredits(): number {
  return positiveInt("PROJECT_FLOAT_CREDITS", 12, 0);
}

export function publicProjectCreateLimitPerHour(): number {
  return positiveInt("PUBLIC_PROJECT_CREATE_LIMIT_PER_HOUR", 30, 1);
}

export function publicAgentActionLimitPerMinute(): number {
  return positiveInt("PUBLIC_AGENT_ACTION_LIMIT_PER_MINUTE", 120, 1);
}

export function publicGameActionLimitPerMinute(): number {
  return positiveInt("PUBLIC_GAME_ACTION_LIMIT_PER_MINUTE", 60, 1);
}

export function modelName(): string {
  return process.env.GAME_MODEL?.trim() || "gemini-3-flash-preview";
}

export function contextWindow(): number {
  return positiveInt("GAME_CONTEXT_WINDOW", 1_048_576);
}

export function agentMaxTokens(): number {
  return positiveInt("AGENT_MAX_TOKENS", 14_000, 512);
}

export function agentMaxSteps(): number {
  return positiveInt("AGENT_MAX_STEPS", 8, 1);
}

export function agentRequestTimeoutMs(): number {
  return positiveInt("AGENT_REQUEST_TIMEOUT_MS", 90_000, 5_000);
}

export function buildRequestTimeoutMs(): number {
  return positiveInt("AGENT_BUILD_TIMEOUT_MS", 3 * 60_000, 30_000);
}

export function agentMaxDurationMs(): number {
  return positiveInt("AGENT_MAX_DURATION_MS", 4 * 60_000, 30_000);
}

export function solanaRpcTimeoutMs(): number {
  return positiveInt("SOLANA_RPC_TIMEOUT_MS", 12_000, 1_000);
}

export function fundingSyncMs(): number {
  return positiveInt("FUNDING_SYNC_MS", 5_000, 1_000);
}

export function agentPollMs(): number {
  return positiveInt("AGENT_POLL_MS", 2_000, 500);
}

export function agentLeaseMs(): number {
  return positiveInt("AGENT_LEASE_MS", 60_000, 10_000);
}

export function agentSupervisorMs(): number {
  return positiveInt("AGENT_SUPERVISOR_MS", 15_000, 2_000);
}

export function devFundingEnabled(): boolean {
  return process.env.ALLOW_DEV_FUNDING === "1";
}

export function treasurySeedEnabled(): boolean {
  return process.env.TREASURY_SEED_ENABLED !== "0";
}

export function treasuryWalletName(): string {
  return process.env.TREASURY_WALLET_NAME?.trim() || "crowdclaw-main";
}

export function treasuryRetryMs(): number {
  return positiveInt("TREASURY_RETRY_MS", 15_000, 2_000);
}

export function databasePath(): string {
  return process.env.DATABASE_PATH?.trim() || "./data/crowdclaw.sqlite";
}

export function solanaRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com"
  );
}

export function runtimeConfigIssues(role: "web" | "worker"): string[] {
  const issues: string[] = [];
  const production = process.env.NODE_ENV === "production";

  if (treasurySeedEnabled() && !process.env.SLRD_MASTER_KEY?.trim()) {
    issues.push("SLRD_MASTER_KEY is required when TREASURY_SEED_ENABLED=1");
  }

  if (
    production &&
    role === "web" &&
    !process.env.CROWDCLAW_ADMIN_TOKEN?.trim()
  )
    issues.push("CROWDCLAW_ADMIN_TOKEN is required in production");
  if (production && devFundingEnabled())
    issues.push("ALLOW_DEV_FUNDING must be 0 in production");
  if (production && databasePath() === ":memory:")
    issues.push("DATABASE_PATH=:memory: is not safe for production");

  try {
    const url = new URL(solanaRpcUrl());
    if (!/^https?:$/.test(url.protocol))
      issues.push("SOLANA_RPC_URL must use http or https");
  } catch {
    issues.push("SOLANA_RPC_URL is invalid");
  }

  if (agentLeaseMs() < agentPollMs() * 2) {
    issues.push("AGENT_LEASE_MS should be at least twice AGENT_POLL_MS");
  }
  return issues;
}

export function assertRuntimeConfig(role: "web" | "worker"): void {
  const issues = runtimeConfigIssues(role);
  if (issues.length)
    throw new Error(`invalid runtime configuration: ${issues.join("; ")}`);
}
