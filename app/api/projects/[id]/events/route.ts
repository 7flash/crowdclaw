import { projectsRepository } from "../../../../../src/server/db/project-repository";
import { log } from "../../../../../src/server/log";

const encoder = new TextEncoder();
const SNAPSHOT_INTERVAL_MS = 200;
const KEEPALIVE_MS = 15_000;

export async function GET(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  const projectId = params.id;
  if (!projectsRepository.get(projectId)) {
    return new Response("project not found", { status: 404 });
  }

  let interval: ReturnType<typeof setInterval> | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let lastPayload = "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        if (keepalive) clearInterval(keepalive);
        interval = null;
        keepalive = null;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (event: string, data: string, id?: string) => {
        if (closed) return;
        const frame = `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${data}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          close();
        }
      };

      const snapshot = () => {
        if (closed) return;
        try {
          const bundle = projectsRepository.bundle(projectId);
          if (!bundle) {
            send("gone", JSON.stringify({ projectId }));
            close();
            return;
          }
          const payload = JSON.stringify(bundle);
          if (payload === lastPayload) return;
          lastPayload = payload;
          send("snapshot", payload, String(bundle.project.updatedAt));
        } catch (error) {
          log("warn", "project.events.snapshot.failed", { projectId, error });
        }
      };

      // Let EventSource know how quickly to retry after a network interruption.
      controller.enqueue(encoder.encode("retry: 1500\n\n"));
      snapshot();
      interval = setInterval(snapshot, SNAPSHOT_INTERVAL_MS);
      keepalive = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
          } catch {
            close();
          }
        }
      }, KEEPALIVE_MS);

      if (request.signal.aborted) close();
      else request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    },
  });
}
