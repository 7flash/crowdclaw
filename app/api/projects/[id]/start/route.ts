import { projectsRepository } from "../../../../../src/server/db/project-repository";
import { ensureProjectAgent } from "../../../../../src/server/agents/process-manager";
import { json } from "../../../../../src/server/http";
import { publicAgentActionLimitPerMinute } from "../../../../../src/server/config";
import {
  rateLimitedResponse,
  takeGlobalRateLimit,
} from "../../../../../src/server/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  void request;
  const rate = takeGlobalRateLimit(
    "public:projects:agent-action",
    publicAgentActionLimitPerMinute(),
    60_000,
  );
  if (!rate.ok) return rateLimitedResponse(rate.retryAfterSeconds);

  const current = projectsRepository.get(params.id);
  if (!current) return json({ error: "project not found" }, 404);

  const project = projectsRepository.startBuild(params.id) || current;
  if (project.status === "completed" || project.status === "failed")
    return json({ project });

  // Planning and build workers have distinct bgrun names. Starting the build
  // therefore never restarts the just-finished planning process or touches its
  // stale process metadata. One verified launch is enough.
  await ensureProjectAgent(project.id);
  return json({ project: projectsRepository.get(project.id) || project });
}
