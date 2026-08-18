import { projectsRepository } from "../../../../../src/server/db/project-repository";
import {
  extractGameSource,
  normalizeGameSource,
} from "../../../../../src/server/agent/game-artifact";

export async function GET(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  const version = Number.parseInt(params.version, 10);
  if (!Number.isFinite(version) || version < 1)
    return new Response("invalid version", { status: 400 });
  const artifact = projectsRepository.artifact(params.projectId, version);
  if (!artifact) return new Response("artifact not found", { status: 404 });
  const embedded = extractGameSource(artifact.html);
  const source = embedded ? normalizeGameSource(embedded) : artifact.html;
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(source, {
    headers: {
      "content-type": embedded
        ? "text/tsx; charset=utf-8"
        : "text/html; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      ...(download
        ? {
            "content-disposition": `attachment; filename="${params.projectId}-v${version}.${embedded ? "tsx" : "html"}"`,
          }
        : {}),
    },
  });
}
