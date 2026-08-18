import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_MARKER = "crowdclaw-source";
const MAX_SOURCE_CHARS = 100_000;

const DEFAULT_TRADJS_RENDER_IMPORT =
  /import\s+render\s+from\s+(["\'])tradjs\/client\1\s*;?/g;

/**
 * tradjs/client exposes render as a named export. Older generated games used a
 * default import, which Bun could bundle as an empty object and then call at
 * runtime ("... is not a function"). Normalize that legacy source before it
 * reaches validation, the workspace, or the artifact compiler.
 */
export function normalizeGameSource(source: string): string {
  return source.replace(
    DEFAULT_TRADJS_RENDER_IMPORT,
    'import { render } from "tradjs/client";',
  );
}

export function validateGameSource(source: string): string[] {
  source = normalizeGameSource(source);
  const issues: string[] = [];
  if (source.length < 300) issues.push("game source is too small");
  if (source.length > MAX_SOURCE_CHARS)
    issues.push(`game source exceeds ${MAX_SOURCE_CHARS} characters`);
  if (!/from\s+["']tradjs\/client["']/.test(source))
    issues.push("game source must import tradjs/client");
  if (
    !/export\s+default\s+function\s+mount\b|export\s+default\s+mount\b/.test(
      source,
    )
  )
    issues.push("game source must default-export mount");
  if (!/\brender\s*\(/.test(source))
    issues.push("game source must render through tradjs/client");
  if (
    /\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\s*\(|EventSource\s*\(|sendBeacon\s*\(|localStorage\b|sessionStorage\b|indexedDB\b)/i.test(
      source,
    )
  ) {
    issues.push(
      "network requests and persistent browser storage are not allowed",
    );
  }
  const imports = [
    ...source.matchAll(
      /(?:import\s+(?:[^"']+?\s+from\s+)?|import\s*\()["']([^"']+)["']/g,
    ),
  ].map((m) => m[1]);
  if (imports.some((value) => !["tradjs/client", "three"].includes(value)))
    issues.push("only tradjs/client and three may be imported");
  return issues;
}

export async function compileGameHtml(source: string): Promise<string> {
  source = normalizeGameSource(source);
  const sourceIssues = validateGameSource(source);
  if (sourceIssues.length) throw new Error(sourceIssues.join("; "));

  // Build inside the CrowdClaw project so bare imports resolve against this
  // app's node_modules even when WORKSPACE_ROOT points elsewhere.
  const temp = mkdtempSync(resolve(process.cwd(), ".crowdclaw-game-"));
  const gamePath = resolve(temp, "game.tsx");
  const entryPath = resolve(temp, "entry.tsx");
  try {
    writeFileSync(gamePath, source, "utf8");
    writeFileSync(
      entryPath,
      `import mount from "./game.tsx";
let cleanup: void | (() => void);
let restarting = false;
const restart = () => {
  if (restarting) return;
  restarting = true;
  try { if (typeof cleanup === "function") cleanup(); } catch {}
  const root = document.getElementById("game-root");
  if (root) root.replaceChildren();
  cleanup = mount();
  restarting = false;
};
(globalThis as any).__crowdclawRestart = restart;
const onHostRestartKey = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  if (event.code !== "KeyR" || event.repeat || target?.matches?.("input, textarea, select, [contenteditable=true]")) return;
  event.preventDefault();
  restart();
};
const onHostRestartClick = (event: MouseEvent) => {
  const origin = event.target instanceof Element ? event.target : null;
  const control = origin?.closest?.("button, [role=button], a") as HTMLElement | null;
  if (!control) return;
  const label = ((control.getAttribute("aria-label") || "") + " " + (control.textContent || "")).replace(/\\s+/g, " ").trim();
  const explicit = control.hasAttribute("data-crowdclaw-restart");
  const restartLabel = /\\b(?:restart|retry|try again|play again|new game)\\b/i.test(label);
  if (!explicit && !restartLabel) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  restart();
};
addEventListener("keydown", onHostRestartKey);
addEventListener("click", onHostRestartClick, true);
restart();
addEventListener("pagehide", () => {
  removeEventListener("keydown", onHostRestartKey);
  removeEventListener("click", onHostRestartClick, true);
  try { if (typeof cleanup === "function") cleanup(); } catch {}
  try { delete (globalThis as any).__crowdclawRestart; } catch {}
}, { once: true });
`,
      "utf8",
    );

    const build = await Bun.build({
      entrypoints: [entryPath],
      target: "browser",
      format: "esm",
      minify: true,
      sourcemap: "none",
      jsx: { runtime: "automatic", importSource: "tradjs/client" },
    });
    if (!build.success) {
      const message =
        build.logs.map((item) => String(item)).join("; ") ||
        "game bundle failed";
      throw new Error(message);
    }
    const output =
      build.outputs.find((item) => item.kind === "entry-point") ||
      build.outputs[0];
    if (!output) throw new Error("game bundle produced no JavaScript");
    const js = (await output.text()).replace(/<\/script/gi, "<\\/script");
    const encodedSource = JSON.stringify(source).replace(/</g, "\\u003c");

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#game-root{margin:0;width:100%;height:100%;overflow:hidden;background:#050a0c}*{box-sizing:border-box}</style></head><body><div id="game-root"></div><script type="module">${js}</script><script id="${SOURCE_MARKER}" type="application/json">${encodedSource}</script></body></html>`;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function extractGameSource(html: string): string {
  const match = html.match(
    new RegExp(
      `<script\\s+id=["']${SOURCE_MARKER}["']\\s+type=["']application/json["']>([\\s\\S]*?)<\\/script>`,
      "i",
    ),
  );
  if (!match) return "";
  try {
    const parsed = JSON.parse(match[1]);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}
