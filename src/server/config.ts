export function lamportsPerCredit(): number {
  const value = Number.parseInt(
    process.env.LAMPORTS_PER_CREDIT || "10000000",
    10,
  );
  return Number.isFinite(value) && value > 0 ? value : 10_000_000;
}

export function contextWindow(): number {
  const value = Number.parseInt(
    process.env.ANTHROPIC_CONTEXT_WINDOW || "200000",
    10,
  );
  return Number.isFinite(value) && value > 0 ? value : 200_000;
}

export function modelName(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
}

export function devFundingEnabled(): boolean {
  return process.env.ALLOW_DEV_FUNDING === "1";
}
