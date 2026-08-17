import type { AgentRun } from "../shared/types";

type Rates = { input: number; cachedInput: number; output: number };

const DEFAULT_RATES: Record<string, Rates> = {
  // API-equivalent token value. Codex/ChatGPT-managed auth is quota-based, so
  // this is intentionally presented in the UI with an approximation mark.
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
};

function envNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function ratesFor(model: string): Rates | null {
  const input = envNumber("MODEL_INPUT_USD_PER_MTOK");
  const cachedInput = envNumber("MODEL_CACHED_INPUT_USD_PER_MTOK");
  const output = envNumber("MODEL_OUTPUT_USD_PER_MTOK");
  if (input != null && output != null)
    return { input, cachedInput: cachedInput ?? input, output };
  return DEFAULT_RATES[model.toLowerCase()] || null;
}

export function estimateRunUsd(run: AgentRun): number {
  const rates = ratesFor(run.model);
  if (!rates) return 0;
  const cached = Math.max(
    0,
    Math.min(run.inputTokens, run.cacheReadInputTokens),
  );
  const uncached = Math.max(0, run.inputTokens - cached);
  const outputEquivalent =
    Math.max(0, run.outputTokens) + Math.max(0, run.thinkingTokens);
  return (
    (uncached * rates.input +
      cached * rates.cachedInput +
      outputEquivalent * rates.output) /
    1_000_000
  );
}
