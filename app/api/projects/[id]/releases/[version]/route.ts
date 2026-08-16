import { projectsRepository } from "../../../../../../src/server/db/project-repository";
import { json } from "../../../../../../src/server/http";

export async function GET(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  const version = Number.parseInt(params.version, 10);
  if (!Number.isFinite(version) || version < 1)
    return json({ error: "invalid version" }, 400);
  const artifact = projectsRepository.artifact(params.id, version);
  if (!artifact) return json({ error: "release not found" }, 404);

  const etag = `"release-${artifact.sha256}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      },
    });
  }

  const origin = new URL(request.url).origin;
  return json(
    {
      projectId: artifact.projectId,
      version: artifact.version,
      milestoneTitle: artifact.milestoneTitle,
      sha256: artifact.sha256,
      runId: artifact.runId,
      createdAt: artifact.createdAt,
      artifactUrl: `${origin}/artifacts/${encodeURIComponent(artifact.projectId)}/${artifact.version}`,
    },
    200,
    {
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      etag,
    },
  );
}
