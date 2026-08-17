export type PublicErrorLabel =
  | "CODEX SDK"
  | "CODEX LOGIN"
  | "AUTH"
  | "QUOTA"
  | "BUSY"
  | "SOL"
  | "MODEL ERROR"
  | "ERROR";

export function publicErrorLabel(value: unknown): PublicErrorLabel {
  const message = value instanceof Error ? value.message : String(value || "");
  const oneLine = message.replace(/\s+/g, " ").trim();

  if (
    /(?:@openai\/codex-sdk|codex runtime requires.*codex-sdk|cannot find module ['"]@openai\/codex-sdk)/i.test(
      oneLine,
    )
  )
    return "CODEX SDK";
  if (
    /(?:codex login|chatgpt-managed codex auth|not authenticated|authentication required|please login|please log in)/i.test(
      oneLine,
    )
  )
    return "CODEX LOGIN";
  if (
    /(?:no api key found|api key.*required|missing.*api key|unauthorized|invalid credential)/i.test(
      oneLine,
    )
  )
    return "AUTH";
  if (/(?:cannot find module|invalid runtime configuration)/i.test(oneLine))
    return "MODEL ERROR";
  if (/(?:\b429\b|quota|rate.?limit)/i.test(oneLine)) return "QUOTA";
  if (
    /(?:\b50[234]\b|\b503\b|UNAVAILABLE|high demand|temporar(?:y|ily)|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|network error)/i.test(
      oneLine,
    )
  )
    return "BUSY";
  if (/rpc|solana|solard/i.test(oneLine)) return "SOL";
  if (/model|gemini|jsx-ai|openai|anthropic|deepseek|codex/i.test(oneLine))
    return "MODEL ERROR";
  return "ERROR";
}
