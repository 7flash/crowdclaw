import { projectsRepository } from "../../../../../src/server/db/project-repository";
import { ensureProjectAgent } from "../../../../../src/server/agents/process-manager";
import { json } from "../../../../../src/server/http";

export async function POST(
  _request: Request,
  { params }: { params: Record<string, string> },
) {
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
