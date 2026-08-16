import { z } from "zod";
import { measure } from "measure-fn";
import { projectsRepository } from "../../../src/server/db/project-repository";
import { json, jsonBody } from "../../../src/server/http";
import { createProject } from "../../../src/server/services/project-service";
import { wakeAgentWorker } from "../../../src/server/worker/worker";

const CreateBody = z.object({ idea: z.string().trim().min(10).max(2000) });

export async function GET() {
  const projects = await measure("api.projects.list", async (m) => {
    return await m("db.projects.list", () => projectsRepository.list());
  });
  return json(projects || []);
}

export async function POST(request: Request) {
  try {
    const { idea } = CreateBody.parse(await jsonBody(request));
    const project = await createProject(idea);
    wakeAgentWorker();
    return json({ project }, 201);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "project creation failed",
      },
      400,
    );
  }
}
