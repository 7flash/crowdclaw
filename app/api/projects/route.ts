import { z } from "zod";
import { measure } from "measure-fn";
import { projectsRepository } from "../../../src/server/db/project-repository";
import { json, jsonBody } from "../../../src/server/http";
import { log } from "../../../src/server/log";
import { createProject } from "../../../src/server/services/project-service";
import { wakeAgentWorker } from "../../../src/server/worker/worker";

const CreateBody = z.object({ idea: z.string().trim().min(10).max(2000) });

export async function GET() {
  const projects = await measure("api.projects.list", async () => {
    return await measure("db.projects.list", () => projectsRepository.list());
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
    const message =
      error instanceof Error ? error.message : "project creation failed";
    if (
      error instanceof z.ZodError ||
      message === "invalid JSON body" ||
      message === "request body too large"
    ) {
      return json({ error: message }, 400);
    }
    log("error", "api.project.create.failed", { error });
    return json({ error: "project creation failed" }, 500);
  }
}
