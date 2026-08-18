import { z } from "zod";
import { projectsRepository } from "../../../../../../src/server/db/project-repository";
import { json, jsonBody } from "../../../../../../src/server/http";

const Body = z.object({
  milestoneKey: z.string().min(3).max(160),
  voterKey: z.string().min(8).max(160),
});

export async function POST(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  try {
    const body = Body.parse(await jsonBody(request));
    const result = projectsRepository.voteMilestone(
      params.id,
      body.milestoneKey,
      body.voterKey,
    );
    if (!result) return json({ error: "project not found" }, 404);
    if (result.accepted) {
      projectsRepository.event(
        params.id,
        "milestone.voted",
        "A future milestone moved up by community vote.",
      );
    }
    return json(result);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "invalid vote" },
      400,
    );
  }
}
