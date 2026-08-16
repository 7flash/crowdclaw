import { projectsRepository } from "../../../../../../src/server/db/project-repository";
import { json } from "../../../../../../src/server/http";

export async function GET(
  request: Request,
  context: { params: Record<string, string> },
) {
  const projectId = context.params.id;
  if (!projectsRepository.get(projectId))
    return json({ error: "not found" }, 404);
  const address =
    new URL(request.url).searchParams.get("address")?.trim() || "";
  if (address.length < 32 || address.length > 64)
    return json({ error: "invalid address" }, 400);
  return json(projectsRepository.createSteeringChallenge(projectId, address));
}
