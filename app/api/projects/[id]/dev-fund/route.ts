import { z } from "zod";
import { devFundingEnabled } from "../../../../../src/server/config";
import { projectsRepository } from "../../../../../src/server/db/project-repository";
import { json, jsonBody } from "../../../../../src/server/http";
import { ensureProjectAgent } from "../../../../../src/server/agents/process-manager";

const Body = z.object({ credits: z.number().finite().positive().max(100) });

export async function POST(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  if (!devFundingEnabled())
    return json({ error: "dev funding is disabled" }, 404);
  try {
    const { credits } = Body.parse(await jsonBody(request));
    const project = projectsRepository.addManualCredits(params.id, credits);
    if (!project) return json({ error: "project not found" }, 404);
    projectsRepository.event(
      project.id,
      "funding.dev",
      `Added ${credits.toFixed(2)} local test credits.`,
    );
    projectsRepository.markQueuedIfFunded(project.id);
    await ensureProjectAgent(project.id);
    return json({ project: projectsRepository.get(project.id) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "invalid request" },
      400,
    );
  }
}
