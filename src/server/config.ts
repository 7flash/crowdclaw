function positiveInt(name: string, fallback: number, minimum = 1): number {
  const parsed = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export type AgentProvider =
  "gemini" | "openai" | "anthropic" | "deepseek" | "custom";

export function lamportsPerCredit(): number {
  return positiveInt("LAMPORTS_PER_CREDIT", 10_000_000);
}

export function modelName(): string {
  return process.env.GAME_MODEL?.trim() || "gemini-3-flash-preview";
}

export function modelProvider(model = modelName()): AgentProvider {
  const value = model.toLowerCase();
  if (value.startsWith("gemini-")) return "gemini";
  if (value.startsWith("gpt-") || value.startsWith("o4-")) return "openai";
  if (value.startsWith("claude-")) return "anthropic";
  if (value.startsWith("deepseek-")) return "deepseek";
  return "custom";
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

export function solanaRpcTimeoutMs(): number {
  return positiveInt("SOLANA_RPC_TIMEOUT_MS", 12_000, 1_000);
}

export function fundingSyncMs(): number {
  return positiveInt("FUNDING_SYNC_MS", 15_000, 1_000);
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

export function databasePath(): string {
  return process.env.DATABASE_PATH?.trim() || "./data/crowdclaw.sqlite";
}

export function solanaRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com"
  );
}

function providerCredentialIssue(): string | null {
  switch (modelProvider()) {
    case "gemini":
      return process.env.GEMINI_API_KEY?.trim()
        ? null
        : "GEMINI_API_KEY is required for Gemini models";
    case "openai":
      return process.env.OPENAI_API_KEY?.trim()
        ? null
        : "OPENAI_API_KEY is required for OpenAI models";
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY?.trim()
        ? null
        : "ANTHROPIC_API_KEY is required for Anthropic models";
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY?.trim()
        ? null
        : "DEEPSEEK_API_KEY is required for DeepSeek models";
    case "custom":
      return null;
  }
}

export function runtimeConfigIssues(role: "web" | "worker"): string[] {
  const issues: string[] = [];
  const production = process.env.NODE_ENV === "production";

  // Web creates the bgrun agent processes, so fail before accepting ideas if
  // the selected provider cannot run in those inherited child environments.
  const credentialIssue = providerCredentialIssue();
  if (credentialIssue) issues.push(credentialIssue);

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
