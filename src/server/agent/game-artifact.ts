import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_MARKER = "crowdclaw-source";
const MAX_SOURCE_CHARS = 100_000;

const DEFAULT_TRADJS_RENDER_IMPORT =
  /import\s+render\s+from\s+(["\'])tradjs\/client\1\s*;?/g;

/**
 * Keep the generated source on the actual TradJS public client API. The model
 * is prompted to use the named render export; this normalization is only a
 * cheap guard before source reaches the workspace/compiler.
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
  if (
    !/import\s*{[^}]*\brender\b[^}]*}\s*from\s*["']tradjs\/client["']/.test(
      source,
    )
  )
    issues.push('game source must import { render } from "tradjs/client"');
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

const ENTRY_SOURCE = String.raw`import mount from "./game.tsx";
let cleanup: void | (() => void);
let restarting = false;
let fitFrame = 0;

const fitGame = () => {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const root = document.getElementById("game-root") as HTMLElement | null;
    if (!root) return;

    root.style.transform = "none";
    const contentWidth = Math.max(root.scrollWidth, root.clientWidth, 1);
    const contentHeight = Math.max(root.scrollHeight, root.clientHeight, 1);
    const inset = 20;
    const scale = Math.min(
      1,
      Math.max(0.45, (innerWidth - inset * 2) / contentWidth),
      Math.max(0.45, (innerHeight - inset * 2) / contentHeight),
    );
    root.style.transform = "scale(" + scale + ")";
  });
};

const restart = () => {
  if (restarting) return;
  restarting = true;
  try { if (typeof cleanup === "function") cleanup(); } catch {}
  const root = document.getElementById("game-root");
  if (root) root.replaceChildren();
  cleanup = mount();
  fitGame();
  requestAnimationFrame(fitGame);
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
  const label = ((control.getAttribute("aria-label") || "") + " " + (control.textContent || "")).replace(/\s+/g, " ").trim();
  const explicit = control.hasAttribute("data-crowdclaw-restart");
  const restartLabel = /\b(?:restart|retry|try again|play again|new game)\b/i.test(label);
  if (!explicit && !restartLabel) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  restart();
};

addEventListener("keydown", onHostRestartKey);
addEventListener("click", onHostRestartClick, true);
addEventListener("resize", fitGame);
restart();

addEventListener("pagehide", () => {
  removeEventListener("keydown", onHostRestartKey);
  removeEventListener("click", onHostRestartClick, true);
  removeEventListener("resize", fitGame);
  cancelAnimationFrame(fitFrame);
  try { if (typeof cleanup === "function") cleanup(); } catch {}
  try { delete (globalThis as any).__crowdclawRestart; } catch {}
}, { once: true });
`;

export async function compileGameHtml(source: string): Promise<string> {
  source = normalizeGameSource(source);
  const sourceIssues = validateGameSource(source);
  if (sourceIssues.length) throw new Error(sourceIssues.join("; "));

  // Compile the game against the real TradJS client and JSX runtime installed
  // by CrowdClaw. There is intentionally no CrowdClaw-owned renderer shim.
  const temp = mkdtempSync(resolve(process.cwd(), ".crowdclaw-game-"));
  const gamePath = resolve(temp, "game.tsx");
  const entryPath = resolve(temp, "entry.tsx");
  try {
    writeFileSync(gamePath, source, "utf8");
    writeFileSync(entryPath, ENTRY_SOURCE, "utf8");

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

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050a0c}body{display:grid;place-items:center;padding:20px}#game-root{width:100%;height:100%;overflow:visible;background:#050a0c;transform-origin:center center;will-change:transform}</style></head><body><div id="game-root"></div><script type="module">${js}</script><script id="${SOURCE_MARKER}" type="application/json">${encodedSource}</script></body></html>`;
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
