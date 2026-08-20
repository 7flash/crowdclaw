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
  if (current.status !== "failed") return json({ project: current });

  const project = projectsRepository.retryFailed(current.id) || current;
  projectsRepository.event(
    current.id,
    "agent.retry.manual",
    current.milestones[current.done]
      ? `Retrying ${current.milestones[current.done].title}.`
      : "Retrying project work.",
  );

  if (!["completed", "waiting_funds", "failed"].includes(project.status))
    await ensureProjectAgent(project.id);

  return json({ project: projectsRepository.get(project.id) || project });
}
