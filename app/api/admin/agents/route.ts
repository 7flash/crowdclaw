import { json } from "../../../../src/server/http";
import { isAdminRequest } from "../../../../src/server/admin-auth";
import {
  adminAgentRegistryCount,
  listAdminAgents,
} from "../../../../src/server/agents/process-manager";

export async function GET(request: Request) {
  if (!isAdminRequest(request))
    return json({ error: "admin authorization required" }, 401);
  return json({
    agents: await listAdminAgents(),
    registryCount: adminAgentRegistryCount(),
  });
}
