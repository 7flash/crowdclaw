import type { Project, ProjectBundle } from "../shared/types";

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || `request failed (${response.status})`;
  } catch {
    return `request failed (${response.status})`;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

export async function listProjects(): Promise<Project[]> {
  return readJson<Project[]>(
    await fetch("/api/projects", { cache: "no-store" }),
  );
}

export async function createProject(idea: string): Promise<Project> {
  const body = await readJson<{ project: Project }>(
    await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea }),
    }),
  );
  return body.project;
}

export async function getProject(id: string): Promise<ProjectBundle> {
  return readJson<ProjectBundle>(
    await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      cache: "no-store",
    }),
  );
}

export async function syncFunding(id: string): Promise<Project> {
  const body = await readJson<{ project: Project }>(
    await fetch(`/api/projects/${encodeURIComponent(id)}/sync`, {
      method: "POST",
    }),
  );
  return body.project;
}

export async function devFund(id: string, credits = 2): Promise<Project> {
  const body = await readJson<{ project: Project }>(
    await fetch(`/api/projects/${encodeURIComponent(id)}/dev-fund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credits }),
    }),
  );
  return body.project;
}

export async function getArtifactCode(
  projectId: string,
  version: number,
): Promise<string> {
  const response = await fetch(
    `/artifacts/${encodeURIComponent(projectId)}/${version}`,
    { cache: "force-cache" },
  );
  if (!response.ok)
    throw new Error(`artifact request failed (${response.status})`);
  return await response.text();
}
