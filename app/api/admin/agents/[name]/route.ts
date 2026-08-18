import { z } from "zod";
import { json, jsonBody } from "../../../../../src/server/http";
import { isAdminRequest } from "../../../../../src/server/admin-auth";
import {
  restartAdminAgent,
  stopAdminAgent,
} from "../../../../../src/server/agents/process-manager";

const Body = z.object({ action: z.enum(["stop", "restart"]) });

export async function POST(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  if (!isAdminRequest(request))
    return json({ error: "admin authorization required" }, 401);
  try {
    const { action } = Body.parse(await jsonBody(request));
    if (action === "stop") {
      await stopAdminAgent(params.name);
      return json({ ok: true });
    }
    return json({ ok: true, process: await restartAdminAgent(params.name) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "agent action failed" },
      error instanceof z.ZodError ? 400 : 409,
    );
  }
}
