import { ndjson, walletFrom } from "../../../../../src/server/http";
import { buildNextMilestone } from "../../../../../src/server/services/game-service";

export async function POST(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  try {
    const wallet = walletFrom(request);
    return ndjson((send) =>
      buildNextMilestone(params.id, wallet, send, request.signal),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
}
