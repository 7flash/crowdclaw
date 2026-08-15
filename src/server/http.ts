import type { StreamEvent } from "../shared/types";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function jsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("invalid JSON body");
  }
}

export function walletFrom(request: Request): string {
  const value = request.headers.get("x-crowdclaw-wallet")?.trim();
  if (!value || value.length < 8 || value.length > 120)
    throw new Error("missing or invalid wallet id");
  return value;
}

export function ndjson(
  run: (send: (event: StreamEvent) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      void run(send)
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "request failed";
          send({ type: "error", message });
        })
        .finally(() => {
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            /* client disconnected */
          }
        });
    },
    cancel() {
      open = false;
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
