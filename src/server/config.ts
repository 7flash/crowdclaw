function positiveInt(name: string, fallback: number, minimum = 1): number {
  const parsed = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function lamportsPerCredit(): number {
  return positiveInt("LAMPORTS_PER_CREDIT", 10_000_000);
}

export function contextWindow(): number {
  return positiveInt("ANTHROPIC_CONTEXT_WINDOW", 200_000);
}

export function modelName(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";
}

export function anthropicMaxTokens(): number {
  return positiveInt("ANTHROPIC_MAX_TOKENS", 1000);
}

export function agentRequestTimeoutMs(): number {
  return positiveInt("AGENT_REQUEST_TIMEOUT_MS", 180_000, 5_000);
}

export function solanaRpcTimeoutMs(): number {
  return positiveInt("SOLANA_RPC_TIMEOUT_MS", 12_000, 1_000);
}

export function fundingSyncMs(): number {
  return positiveInt("FUNDING_SYNC_MS", 15_000, 1_000);
}

export function workerIntervalMs(): number {
  return positiveInt("WORKER_INTERVAL_MS", 2_000, 500);
}

export function workerLeaseMs(): number {
  return positiveInt("WORKER_LEASE_MS", 60_000, 10_000);
}

export function embeddedWorkerEnabled(): boolean {
  return process.env.EMBEDDED_WORKER !== "0";
}

export function devFundingEnabled(): boolean {
  return process.env.ALLOW_DEV_FUNDING === "1";
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
  const needsAgent = role === "worker" || embeddedWorkerEnabled();

  if (needsAgent && !process.env.ANTHROPIC_API_KEY?.trim()) {
    issues.push(
      "ANTHROPIC_API_KEY is required when an agent worker is enabled",
    );
  }
  if (production && devFundingEnabled()) {
    issues.push("ALLOW_DEV_FUNDING must be 0 in production");
  }
  if (production && databasePath() === ":memory:") {
    issues.push("DATABASE_PATH=:memory: is not safe for production");
  }

  try {
    const url = new URL(solanaRpcUrl());
    if (!/^https?:$/.test(url.protocol))
      issues.push("SOLANA_RPC_URL must use http or https");
  } catch {
    issues.push("SOLANA_RPC_URL is invalid");
  }

  if (workerLeaseMs() < workerIntervalMs() * 2) {
    issues.push("WORKER_LEASE_MS should be at least twice WORKER_INTERVAL_MS");
  }
  return issues;
}

export function assertRuntimeConfig(role: "web" | "worker"): void {
  const issues = runtimeConfigIssues(role);
  if (issues.length)
    throw new Error(`invalid runtime configuration: ${issues.join("; ")}`);
}
