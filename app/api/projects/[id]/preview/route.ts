import { projectsRepository } from "../../../../../src/server/db/project-repository";
import { readWorkspaceGameSource } from "../../../../../src/server/agent/workspace";
import { compileGameHtml } from "../../../../../src/server/agent/game-artifact";
import type { ProjectBundle } from "../../../../../src/shared/types";

export async function GET(
  _request: Request,
  { params }: { params: Record<string, string> },
) {
  const bundle = projectsRepository.bundle(params.id);
  if (!bundle) return new Response("not found", { status: 404 });

  let html = "";
  try {
    html = await compileGameHtml(readWorkspaceGameSource(bundle.project.id));
  } catch {}

  if (!html) {
    const artifacts = projectsRepository.artifacts(bundle.project.id);
    html = artifacts[artifacts.length - 1]?.html || bootHtml(bundle);
  }

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src data:; object-src 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-pointer-lock",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), payment=()",
    },
  });
}

function bootHtml(bundle: ProjectBundle) {
  const { project } = bundle;
  const step =
    project.status === "validating"
      ? 1
      : project.status === "publishing" || project.status === "completed"
        ? 2
        : 0;
  const phase = [0, 1, 2]
    .map((index) => {
      const className = index < step ? "done" : index === step ? "on" : "";
      return `<i class="${className}"></i>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark;--bg:#050a0c;--line:#17262d;--claw:#ff5c2b;--mint:#4fe3c1}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--bg)}
body{position:relative;background-image:linear-gradient(#10202844 1px,transparent 1px),linear-gradient(90deg,#10202844 1px,transparent 1px),radial-gradient(circle at 50% 48%,#10252a88 0,transparent 34%);background-size:32px 32px,32px 32px,100% 100%;animation:grid 12s linear infinite}
body:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(5,10,12,.02),rgba(5,10,12,.38));box-shadow:inset 0 0 100px rgba(0,0,0,.38)}
.center{position:absolute;z-index:2;inset:0;display:grid;place-items:center}.orb{position:relative;width:72px;height:72px;border:1px solid #29414a;border-radius:50%;box-shadow:0 0 0 18px #0b15191d,0 0 48px #ff5c2b10}.orb:before,.orb:after{content:"";position:absolute;inset:50% auto auto 50%;transform:translate(-50%,-50%);border-radius:50%}.orb:before{width:9px;height:9px;background:var(--claw);box-shadow:0 0 22px #ff5c2b77;animation:pulse 1.5s ease-in-out infinite}.orb:after{width:40px;height:40px;border:1px solid #ff5c2b44;animation:ring 2.2s ease-out infinite}
.phase{position:absolute;z-index:3;left:50%;bottom:32px;display:flex;width:min(160px,34vw);gap:5px;transform:translateX(-50%)}.phase i{display:block;height:2px;flex:1;background:#16272e}.phase i.done{background:#33534f}.phase i.on{background:var(--claw);box-shadow:0 0 10px #ff5c2b44}
.scan{position:absolute;z-index:1;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#ff5c2b4d,transparent);box-shadow:0 0 18px #ff5c2b22;animation:scan 3.6s cubic-bezier(.45,0,.55,1) infinite}
@keyframes grid{to{background-position:32px 32px,32px 32px,0 0}}@keyframes pulse{50%{transform:translate(-50%,-50%) scale(.72);box-shadow:0 0 0 16px #ff5c2b00}}@keyframes ring{0%{transform:translate(-50%,-50%) scale(.72);opacity:.8}100%{transform:translate(-50%,-50%) scale(1.55);opacity:0}}@keyframes scan{0%{top:-2%;opacity:0}12%{opacity:1}88%{opacity:1}100%{top:102%;opacity:0}}
@media(prefers-reduced-motion:reduce){body,.orb:before,.orb:after,.scan{animation:none}}
</style>
</head>
<body>
<div class="scan"></div>
<div class="center"><div class="orb"></div></div>
<div class="phase">${phase}</div>
</body>
</html>`;
}
