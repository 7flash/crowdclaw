import {
  isNotificationFeedRequest,
  latestNotificationCursor,
  readNotificationsAfter,
} from "../../../src/server/notification-feed";

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 30_000;

function integer(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, parsed))
    : fallback;
}

function cursorFrom(value: string | null): number {
  if (!value) return 0;
  if (value === "now" || value === "latest") return latestNotificationCursor();
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("invalid cursor");
  return parsed;
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    const abort = () => done();
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function GET(request: Request) {
  if (!isNotificationFeedRequest(request))
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });

  try {
    const url = new URL(request.url);
    const initialCursor = cursorFrom(url.searchParams.get("cursor"));
    const limit = integer(url.searchParams.get("limit"), 50, 1, 100);
    const timeoutMs = integer(
      url.searchParams.get("timeout"),
      DEFAULT_TIMEOUT_MS,
      0,
      MAX_TIMEOUT_MS,
    );
    const projectId = String(url.searchParams.get("projectId") || "").trim();
    const types = String(url.searchParams.get("types") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20);
    const deadline = Date.now() + timeoutMs;

    while (!request.signal.aborted) {
      const events = readNotificationsAfter({
        cursor: initialCursor,
        limit,
        ...(projectId ? { projectId } : {}),
        ...(types.length ? { types } : {}),
      });
      if (events.length) {
        const nextCursor =
          events[events.length - 1]?.cursor || String(initialCursor);
        return new Response(
          JSON.stringify({ events, nextCursor, timedOut: false }),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store, no-cache, must-revalidate",
              "x-accel-buffering": "no",
            },
          },
        );
      }
      if (Date.now() >= deadline || timeoutMs === 0) break;
      await wait(
        Math.min(400, Math.max(1, deadline - Date.now())),
        request.signal,
      );
    }

    if (request.signal.aborted) return new Response(null, { status: 204 });
    return new Response(
      JSON.stringify({
        events: [],
        nextCursor: String(initialCursor),
        timedOut: true,
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store, no-cache, must-revalidate",
          "x-accel-buffering": "no",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "invalid request",
      }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }
}
