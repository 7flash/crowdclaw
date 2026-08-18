import { createHash } from "node:crypto";
import { projectsRepository } from "../../../../src/server/db/project-repository";
import {
  compileGameHtml,
  extractGameSource,
  normalizeGameSource,
} from "../../../../src/server/agent/game-artifact";

type ServedArtifact = { html: string; sha256: string };
const repaired = new Map<string, ServedArtifact>();

function needsLegacyRepair(html: string, source: string): boolean {
  if (normalizeGameSource(source) !== source) return true;
  // 4.31.1's generated host wrapper accidentally lost the backslash in \s and
  // turned \b into backspace characters because those regexes lived inside a
  // template string. Recompile those immutable artifacts from their embedded
  // source once per web process.
  return html.includes(".replace(/s+/g") || html.includes("\b(?:restart");
}

async function servedArtifact(artifact: {
  projectId: string;
  version: number;
  sha256: string;
  html: string;
}): Promise<ServedArtifact> {
  const key = `${artifact.projectId}:${artifact.version}:${artifact.sha256}`;
  const cached = repaired.get(key);
  if (cached) return cached;

  let html = artifact.html;
  const source = extractGameSource(html);
  if (source && needsLegacyRepair(html, source)) {
    try {
      html = await compileGameHtml(source);
    } catch {
      // The stored artifact remains the fallback if a legacy source can no
      // longer be rebuilt under the current compiler.
    }
  }

  const sha256 =
    html === artifact.html
      ? artifact.sha256
      : createHash("sha256").update(html).digest("hex");
  const value = { html, sha256 };
  repaired.set(key, value);
  return value;
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

  const served = await servedArtifact(artifact);
  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const etag = `"sha256-${served.sha256}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "public, max-age=31536000, immutable" },
    });
  }

  return new Response(served.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      etag,
      "last-modified": new Date(artifact.createdAt).toUTCString(),
      "x-crowdclaw-project": artifact.projectId,
      "x-crowdclaw-version": String(artifact.version),
      "x-crowdclaw-sha256": served.sha256,
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src data:; object-src 'none'; frame-ancestors 'self'",
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
