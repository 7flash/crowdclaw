/**
 * Deliberately tiny process-liveness endpoint for keeper.ts.
 * If this handler answers, TradJS is accepting and dispatching HTTP requests.
 * Do not make this depend on Solana, model providers, bgrun agent health, or
 * any other external service: those failures must never cause the web process
 * itself to be restarted.
 */
export async function GET() {
  return new Response(
    JSON.stringify({
      ok: true,
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      now: Date.now(),
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
