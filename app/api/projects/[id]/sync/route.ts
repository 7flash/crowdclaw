import { projectsRepository } from "../../../../../src/server/db/project-repository";
import { json } from "../../../../../src/server/http";
import { syncProjectFunding } from "../../../../../src/server/services/funding-service";
import { wakeAgentWorker } from "../../../../../src/server/worker/worker";

export async function POST(
  _request: Request,
  { params }: { params: Record<string, string> },
) {
  const project = projectsRepository.get(params.id);
  if (!project) return json({ error: "project not found" }, 404);
  const updated = await syncProjectFunding(project, true);
  projectsRepository.markQueuedIfFunded(project.id);
  wakeAgentWorker();
  return json({ project: projectsRepository.get(project.id) || updated });
}
