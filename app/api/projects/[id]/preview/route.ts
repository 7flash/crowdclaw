import { projectsRepository } from "../../../../../src/server/db/project-repository";
import { readWorkspaceIndex } from "../../../../../src/server/agent/workspace";

const BOOT = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050a0c}body{display:grid;place-items:center;background-image:linear-gradient(#10202855 1px,transparent 1px),linear-gradient(90deg,#10202855 1px,transparent 1px);background-size:32px 32px}.p{width:8px;height:8px;border-radius:50%;background:#ff5c2b;box-shadow:0 0 0 0 #ff5c2b55;animation:p 1.4s ease-in-out infinite}@keyframes p{50%{box-shadow:0 0 0 14px #ff5c2b00;transform:scale(.75)}}
</style></head><body><i class="p"></i></body></html>`;

export async function GET(
  _request: Request,
  { params }: { params: Record<string, string> },
) {
  const project = projectsRepository.get(params.id);
  if (!project) return new Response("not found", { status: 404 });
  let html = BOOT;
  try {
    html = readWorkspaceIndex(project.id);
  } catch {}
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src data:; object-src 'none'; frame-ancestors 'self'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), payment=()",
    },
  });
}
