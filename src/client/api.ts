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

export async function listProjects(signal?: AbortSignal): Promise<Project[]> {
  return readJson<Project[]>(
    await fetch("/api/projects", { cache: "no-store", signal }),
  );
}

export async function createProject(
  idea: string,
  signal?: AbortSignal,
): Promise<Project> {
  const body = await readJson<{ project: Project }>(
    await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea }),
      signal,
    }),
  );
  return body.project;
}

export async function getProject(
  id: string,
  signal?: AbortSignal,
): Promise<ProjectBundle> {
  return readJson<ProjectBundle>(
    await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal,
    }),
  );
}

export async function syncFunding(
  id: string,
  signal?: AbortSignal,
): Promise<Project> {
  const body = await readJson<{ project: Project }>(
    await fetch(`/api/projects/${encodeURIComponent(id)}/sync`, {
      method: "POST",
      signal,
    }),
  );
  return body.project;
}

export async function devFund(
  id: string,
  credits = 2,
  signal?: AbortSignal,
): Promise<Project> {
  const body = await readJson<{ project: Project }>(
    await fetch(`/api/projects/${encodeURIComponent(id)}/dev-fund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credits }),
      signal,
    }),
  );
  return body.project;
}

export function projectEventsUrl(id: string): string {
  return `/api/projects/${encodeURIComponent(id)}/events`;
}

export async function getArtifactCode(
  projectId: string,
  version: number,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(
    `/artifacts/${encodeURIComponent(projectId)}/${version}`,
    { cache: "force-cache", signal },
  );
  if (!response.ok)
    throw new Error(`artifact request failed (${response.status})`);
  return await response.text();
}
