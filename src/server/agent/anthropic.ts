type Message = { role: "user" | "assistant"; content: string };

type Delta = (accumulatedText: string) => void;

function apiKey(): string {
  const value = process.env.ANTHROPIC_API_KEY?.trim();
  if (!value) throw new Error("ANTHROPIC_API_KEY is not configured");
  return value;
}

function maxTokens(): number {
  const parsed = Number.parseInt(
    process.env.ANTHROPIC_MAX_TOKENS || "1000",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

export async function callOnce(
  system: string,
  messages: Message[],
  onDelta: Delta,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: maxTokens(),
      stream: true,
      system,
      messages,
    }),
    signal,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `agent unreachable (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  if (!response.body) throw new Error("agent returned no response body");

  let out = "";
  let buffer = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload);
        if (data.type === "content_block_delta" && data.delta?.text) {
          out += data.delta.text;
          onDelta(out);
        }
      } catch {
        // A malformed/partial SSE event is ignored; the next complete event continues the stream.
      }
    }
  }

  return out;
}

export async function callUntilComplete(
  system: string,
  prompt: string,
  onText: Delta,
  signal?: AbortSignal,
  rounds = 5,
): Promise<string> {
  let accumulated = "";
  for (let i = 0; i < rounds; i += 1) {
    const messages: Message[] =
      i === 0
        ? [{ role: "user", content: prompt }]
        : [
            { role: "user", content: prompt },
            { role: "assistant", content: accumulated.replace(/\s+$/, "") },
            {
              role: "user",
              content:
                "Continue from exactly where you stopped. Do not repeat anything, do not explain, just carry on the file and finish it with </html>.",
            },
          ];

    const chunk = await callOnce(
      system,
      messages,
      (text) => onText(accumulated + text),
      signal,
    );
    accumulated += chunk;
    if (/<\/html>/i.test(accumulated)) break;
  }
  return accumulated;
}
