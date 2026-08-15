import type { Game, GameBundle, StreamEvent } from "../shared/types";

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || `request failed (${response.status})`;
  } catch {
    return `request failed (${response.status})`;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

export async function readNdjson(
  response: Response,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  if (!response.ok) throw new Error(await errorMessage(response));
  if (!response.body) throw new Error("stream response has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "error") throw new Error(event.message);
      onEvent(event);
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer) as StreamEvent;
    if (event.type === "error") throw new Error(event.message);
    onEvent(event);
  }
}

function headers(wallet: string, json = false): HeadersInit {
  return {
    "x-crowdclaw-wallet": wallet,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

export async function listGames(): Promise<Game[]> {
  return readJson<Game[]>(await fetch("/api/games", { cache: "no-store" }));
}

export async function getGame(id: string): Promise<GameBundle> {
  return readJson<GameBundle>(
    await fetch(`/api/games/${encodeURIComponent(id)}`, { cache: "no-store" }),
  );
}

export function plan(prompt: string, wallet: string): Promise<Response> {
  return fetch("/api/games/plan", {
    method: "POST",
    headers: headers(wallet, true),
    body: JSON.stringify({ prompt }),
  });
}

export async function fund(
  id: string,
  amount: number,
  wallet: string,
): Promise<Game> {
  const payload = await readJson<{ game: Game }>(
    await fetch(`/api/games/${encodeURIComponent(id)}/fund`, {
      method: "POST",
      headers: headers(wallet, true),
      body: JSON.stringify({ amount }),
    }),
  );
  return payload.game;
}

export function run(id: string, wallet: string): Promise<Response> {
  return fetch(`/api/games/${encodeURIComponent(id)}/run`, {
    method: "POST",
    headers: headers(wallet),
  });
}
