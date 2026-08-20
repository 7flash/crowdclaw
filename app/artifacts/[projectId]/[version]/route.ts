import { projectsRepository } from "../../../../src/server/db/project-repository";
import {
  compileGameHtml,
  extractGameSource,
  normalizeGameSource,
} from "../../../../src/server/agent/game-artifact";

const repairedHtml = new Map<string, Promise<string>>();

async function playableHtml(artifact: {
  sha256: string;
  html: string;
}): Promise<{ html: string; repaired: boolean }> {
  const source = extractGameSource(artifact.html);
  if (!source) return { html: artifact.html, repaired: false };
  const normalized = normalizeGameSource(source);
  if (normalized === source) return { html: artifact.html, repaired: false };
  let pending = repairedHtml.get(artifact.sha256);
  if (!pending) {
    pending = compileGameHtml(normalized);
    repairedHtml.set(artifact.sha256, pending);
  }
  try {
    return { html: await pending, repaired: true };
  } catch {
    repairedHtml.delete(artifact.sha256);
    return { html: artifact.html, repaired: false };
  }
}

export async function GET(
  request: Request,
  { params }: { params: Record<string, string> },
) {
  const version = Number.parseInt(params.version, 10);
  if (!Number.isFinite(version) || version < 1)
    return new Response("invalid version", { status: 400 });
  const artifact = projectsRepository.artifact(params.projectId, version);
  if (!artifact) return new Response("artifact not found", { status: 404 });

  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const playable = await playableHtml(artifact);
  const etag = `"sha256-${artifact.sha256}${playable.repaired ? "-runtime2" : ""}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        "cache-control": playable.repaired
          ? "public, max-age=300, stale-while-revalidate=3600"
          : "public, max-age=31536000, immutable",
      },
    });
  }

  return new Response(playable.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": playable.repaired
        ? "public, max-age=300, stale-while-revalidate=3600"
        : "public, max-age=31536000, immutable",
      etag,
      "last-modified": new Date(artifact.createdAt).toUTCString(),
      "x-crowdclaw-project": artifact.projectId,
      "x-crowdclaw-version": String(artifact.version),
      "x-crowdclaw-sha256": artifact.sha256,
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src data:; object-src 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-pointer-lock",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), payment=()",
      "cross-origin-resource-policy": "same-origin",
      ...(download
        ? {
            "content-disposition": `attachment; filename="${params.projectId}-v${version}.html"`,
          }
        : {}),
    },
  });
}
