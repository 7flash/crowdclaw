import { abortScope } from "../abort";
import {
  agentRequestTimeoutMs,
  anthropicMaxTokens,
  contextWindow,
  modelName,
} from "../config";

type Message = { role: "user" | "assistant"; content: string };

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  lastContextTokens: number;
  contextWindow: number;
};

export type AgentResult = {
  text: string;
  usage: AgentUsage;
};

export type Progress = (text: string, usage: AgentUsage) => void;

function apiKey(): string {
  const value = process.env.ANTHROPIC_API_KEY?.trim();
  if (!value) throw new Error("ANTHROPIC_API_KEY is not configured");
  return value;
}

function blankUsage(): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    lastContextTokens: 0,
    contextWindow: contextWindow(),
  };
}

function updateUsage(target: AgentUsage, raw: any): void {
  if (!raw) return;
  if (Number.isFinite(raw.input_tokens))
    target.inputTokens = Number(raw.input_tokens);
  if (Number.isFinite(raw.output_tokens))
    target.outputTokens = Number(raw.output_tokens);
  if (Number.isFinite(raw.cache_creation_input_tokens))
    target.cacheCreationInputTokens = Number(raw.cache_creation_input_tokens);
  if (Number.isFinite(raw.cache_read_input_tokens))
    target.cacheReadInputTokens = Number(raw.cache_read_input_tokens);
  target.lastContextTokens =
    target.inputTokens +
    target.outputTokens +
    target.cacheCreationInputTokens +
    target.cacheReadInputTokens;
}

export async function callOnce(
  system: string,
  messages: Message[],
  onProgress: Progress,
  signal?: AbortSignal,
): Promise<AgentResult> {
  const scope = abortScope(agentRequestTimeoutMs(), signal);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelName(),
        max_tokens: anthropicMaxTokens(),
        stream: true,
        system,
        messages,
      }),
      signal: scope.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `agent unreachable (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    if (!response.body) throw new Error("agent returned no response body");

    let text = "";
    let buffer = "";
    const usage = blankUsage();
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
        let data: any;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }

        if (data.type === "error")
          throw new Error(
            data.error?.message || data.error?.type || "agent stream error",
          );
        if (data.type === "message_start")
          updateUsage(usage, data.message?.usage);
        if (data.type === "message_delta") updateUsage(usage, data.usage);
        if (data.type === "content_block_delta" && data.delta?.text) {
          text += data.delta.text;
          onProgress(text, { ...usage });
        } else if (
          data.type === "message_start" ||
          data.type === "message_delta"
        ) {
          onProgress(text, { ...usage });
        }
      }
    }

    usage.lastContextTokens =
      usage.inputTokens +
      usage.outputTokens +
      usage.cacheCreationInputTokens +
      usage.cacheReadInputTokens;
    onProgress(text, { ...usage });
    return { text, usage };
  } finally {
    scope.close();
  }
}

export async function callUntilComplete(
  system: string,
  prompt: string,
  onProgress: Progress,
  signal?: AbortSignal,
  rounds = 5,
): Promise<AgentResult> {
  let accumulated = "";
  const total = blankUsage();
  let lastContextTokens = 0;

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

    let roundUsage = blankUsage();
    const result = await callOnce(
      system,
      messages,
      (text, usage) => {
        roundUsage = usage;
        onProgress(accumulated + text, {
          inputTokens: total.inputTokens + usage.inputTokens,
          outputTokens: total.outputTokens + usage.outputTokens,
          cacheCreationInputTokens:
            total.cacheCreationInputTokens + usage.cacheCreationInputTokens,
          cacheReadInputTokens:
            total.cacheReadInputTokens + usage.cacheReadInputTokens,
          lastContextTokens: usage.lastContextTokens,
          contextWindow: usage.contextWindow,
        });
      },
      signal,
    );

    accumulated += result.text;
    total.inputTokens += roundUsage.inputTokens;
    total.outputTokens += roundUsage.outputTokens;
    total.cacheCreationInputTokens += roundUsage.cacheCreationInputTokens;
    total.cacheReadInputTokens += roundUsage.cacheReadInputTokens;
    lastContextTokens = roundUsage.lastContextTokens;
    if (/<\/html>/i.test(accumulated)) break;
  }

  total.lastContextTokens = lastContextTokens;
  return { text: accumulated, usage: total };
}
