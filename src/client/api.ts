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

export async function startProject(
  id: string,
  signal?: AbortSignal,
): Promise<Project> {
  const body = await readJson<{ project: Project }>(
    await fetch(`/api/projects/${encodeURIComponent(id)}/start`, {
      method: "POST",
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
    `/artifacts/${encodeURIComponent(projectId)}/${version}/source`,
    { cache: "force-cache", signal },
  );
  if (!response.ok)
    throw new Error(`artifact request failed (${response.status})`);
  return await response.text();
}

export async function steeringChallenge(
  projectId: string,
  address: string,
): Promise<{ id: string; message: string; expiresAt: number }> {
  return readJson(
    await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/steer/challenge?address=${encodeURIComponent(address)}`,
      { cache: "no-store" },
    ),
  );
}

export async function submitSteering(
  projectId: string,
  input: {
    challengeId: string;
    address: string;
    signature: string;
    instruction: string;
    influence: number;
  },
): Promise<void> {
  await readJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/steer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function voteMilestone(
  projectId: string,
  milestoneKey: string,
  voterKey: string,
): Promise<{ project: Project; accepted: boolean }> {
  return readJson(
    await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/milestones/vote`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ milestoneKey, voterKey }),
      },
    ),
  );
}

export async function proposeMilestone(
  projectId: string,
  input: { title: string; goal: string; voterKey: string },
): Promise<{
  project: Project;
  accepted: boolean;
  milestoneKey?: string;
  reason?: string;
}> {
  return readJson(
    await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/milestones/propose`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    ),
  );
}
