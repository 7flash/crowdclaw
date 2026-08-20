import { ndjson, walletFrom } from "../../../../../src/server/http";
import { buildNextMilestone } from "../../../../../src/server/services/game-service";
import { publicGameActionLimitPerMinute } from "../../../../../src/server/config";
import {
  rateLimitedResponse,
  takeGlobalRateLimit,
} from "../../../../../src/server/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  const rate = takeGlobalRateLimit(
    "public:games:model-action",
    publicGameActionLimitPerMinute(),
    60_000,
  );
  if (!rate.ok) return rateLimitedResponse(rate.retryAfterSeconds);
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
