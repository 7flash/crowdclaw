import { z } from "zod";
import { projectsRepository } from "../../../../../../src/server/db/project-repository";
import { json, jsonBody } from "../../../../../../src/server/http";

const Body = z.object({
  title: z.string().trim().min(3).max(90),
  goal: z.string().trim().min(8).max(360),
  voterKey: z.string().min(8).max(160),
});

export async function POST(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  try {
    const body = Body.parse(await jsonBody(request));
    const result = projectsRepository.proposeMilestone(params.id, body);
    if (!result) return json({ error: "project not found" }, 404);
    if (result.accepted) {
      projectsRepository.event(
        params.id,
        "milestone.proposed",
        `Community proposed: ${body.title}.`,
      );
    }
    return json(result);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "invalid milestone" },
      400,
    );
  }
}
