import { json } from "../../../../../../src/server/http";
import { isAdminRequest } from "../../../../../../src/server/admin-auth";
import { readAdminAgentLogs } from "../../../../../../src/server/agents/process-manager";

export async function GET(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  if (!isAdminRequest(request))
    return json({ error: "admin authorization required" }, 401);
  try {
    const lines = Number.parseInt(
      new URL(request.url).searchParams.get("lines") || "160",
      10,
    );
    return json({ logs: await readAdminAgentLogs(params.name, lines) });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "agent logs unavailable",
      },
      404,
    );
  }
}
