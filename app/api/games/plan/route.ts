import { z } from "zod";
import { jsonBody, ndjson, walletFrom } from "../../../../src/server/http";
import { planGame } from "../../../../src/server/services/game-service";
import { publicGameActionLimitPerMinute } from "../../../../src/server/config";
import {
  rateLimitedResponse,
  takeGlobalRateLimit,
} from "../../../../src/server/rate-limit";

const Body = z.object({ prompt: z.string().trim().min(10).max(2000) });

export async function POST(request: Request) {
  const rate = takeGlobalRateLimit(
    "public:games:model-action",
    publicGameActionLimitPerMinute(),
    60_000,
  );
  if (!rate.ok) return rateLimitedResponse(rate.retryAfterSeconds);
  try {
    const body = Body.parse(await jsonBody(request));
    const wallet = walletFrom(request);
    return ndjson((send) =>
      planGame(body.prompt, wallet, send, request.signal),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
}
