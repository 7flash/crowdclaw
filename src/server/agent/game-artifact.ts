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
function repairLegacyDomRender(source: string): string {
  const domNodes = new Set(
    [
      ...source.matchAll(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\s*\(/g,
      ),
    ].map((match) => match[1]),
  );
  if (!domNodes.size) return source;
  return source.replace(
    /\brender\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*;?/g,
    (call, value: string, root: string) =>
      domNodes.has(value) ? `${root}.replaceChildren(${value});` : call,
  );
}

/**
 * Normalize old generated sources before they are compiled or shown. Older
 * agents sometimes passed a real HTMLElement to TradJS render(), which accepts
 * JSX/h() vnodes rather than DOM nodes. Repair that historical pattern to a
 * direct DOM mount so already-shipped versions remain playable.
 */
export function normalizeGameSource(source: string): string {
  source = source.replace(
    DEFAULT_TRADJS_RENDER_IMPORT,
    'import { render } from "tradjs/client";',
  );
  return repairLegacyDomRender(source);
}

export function validateGameSource(source: string): string[] {
  source = normalizeGameSource(source);
  const issues: string[] = [];
  if (source.length < 300) issues.push("game source is too small");
  if (source.length > MAX_SOURCE_CHARS)
    issues.push(`game source exceeds ${MAX_SOURCE_CHARS} characters`);
  const importsTradRender =
    /import\s*{[^}]*\brender\b[^}]*}\s*from\s*["']tradjs\/client["']/.test(
      source,
    );
  const usesTradVNodeMount = /\brender\s*\(\s*(?:<|h\s*\()/.test(source);
  const usesDirectDomMount =
    /\.replaceChildren\s*\(|\.appendChild\s*\(|\.append\s*\(/.test(source);
  if (/\brender\s*\(/.test(source) && !importsTradRender)
    issues.push('render() requires { render } from "tradjs/client"');
  if (
    !/export\s+default\s+function\s+mount\b|export\s+default\s+mount\b/.test(
      source,
    )
  )
    issues.push("game source must default-export mount");
  if (!usesTradVNodeMount && !usesDirectDomMount)
    issues.push(
      "mount must attach visible DOM using render(<JSX />, root), render(h(...), root), or root.replaceChildren(...) ",
    );
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
let fitTimeout = 0;
let resizeObserver: ResizeObserver | null = null;

const contentBounds = (root: HTMLElement) => {
  const rootRect = root.getBoundingClientRect();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  // scrollWidth/scrollHeight miss negative overflow from centered grid/flex
  // layouts. Measure rendered descendants so content that spills above or to
  // the left is included too.
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("*"));
  for (const node of nodes) {
    if (node.tagName === "STYLE" || node.tagName === "SCRIPT") continue;
    const rect = node.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) continue;
    minX = Math.min(minX, rect.left);
    minY = Math.min(minY, rect.top);
    maxX = Math.max(maxX, rect.right);
    maxY = Math.max(maxY, rect.bottom);
  }

  if (!Number.isFinite(minX)) {
    minX = rootRect.left;
    minY = rootRect.top;
    maxX = rootRect.right;
    maxY = rootRect.bottom;
  }

  return {
    rootRect,
    left: minX,
    top: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

const fitGame = () => {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const root = document.getElementById("game-root") as HTMLElement | null;
    if (!root) return;

    root.style.transform = "none";
    const bounds = contentBounds(root);
    const inset = 20;
    const availableWidth = Math.max(1, innerWidth - inset * 2);
    const availableHeight = Math.max(1, innerHeight - inset * 2);
    const scale = Math.min(
      1,
      availableWidth / bounds.width,
      availableHeight / bounds.height,
    );

    // Transform from the unscaled root coordinate system. Center the measured
    // content bounds, not the root box, because generated games often use
    // min-height:100% + place-items:center and can overflow symmetrically.
    const localLeft = bounds.left - bounds.rootRect.left;
    const localTop = bounds.top - bounds.rootRect.top;
    const targetLeft = (innerWidth - bounds.width * scale) / 2;
    const targetTop = (innerHeight - bounds.height * scale) / 2;
    const tx = targetLeft - localLeft * scale;
    const ty = targetTop - localTop * scale;
    root.style.transform = "matrix(" + scale + ",0,0," + scale + "," + tx + "," + ty + ")";
  });
};

const observeFit = () => {
  resizeObserver?.disconnect();
  resizeObserver = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(() => fitGame());
  const root = document.getElementById("game-root");
  if (!root || !resizeObserver) return;
  resizeObserver.observe(root);
  for (const child of Array.from(root.children)) {
    if (child instanceof Element) resizeObserver.observe(child);
  }
};

const showRuntimeError = (error: unknown) => {
  const root = document.getElementById("game-root");
  if (!root) return;
  const message = error instanceof Error ? error.message : String(error || "unknown game error");
  const panel = document.createElement("div");
  panel.setAttribute("role", "alert");
  panel.style.cssText = "position:absolute;inset:18px;display:grid;place-items:center;padding:24px;border:1px solid #ff5c2b66;border-radius:12px;background:#110b0bee;color:#ffd7ca;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;text-align:center;overflow:auto";
  panel.textContent = "GAME RUNTIME ERROR\n\n" + message;
  root.style.transform = "none";
  root.replaceChildren(panel);
};

const restart = () => {
  if (restarting) return;
  restarting = true;
  try {
    try { if (typeof cleanup === "function") cleanup(); } catch {}
    const root = document.getElementById("game-root");
    if (!root) throw new Error("#game-root is missing");
    root.style.transform = "none";
    root.replaceChildren();
    cleanup = mount();
    if (!root.firstElementChild)
      throw new Error("mount() completed without attaching any visible DOM to #game-root");
    observeFit();
    fitGame();
    requestAnimationFrame(fitGame);
    clearTimeout(fitTimeout);
    fitTimeout = setTimeout(fitGame, 180);
  } catch (error) {
    console.error("CrowdClaw game runtime failed", error);
    showRuntimeError(error);
  } finally {
    restarting = false;
  }
};

addEventListener("error", (event) => {
  if (event.error || event.message) showRuntimeError(event.error || event.message);
});
addEventListener("unhandledrejection", (event) => showRuntimeError(event.reason));

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
  resizeObserver?.disconnect();
  clearTimeout(fitTimeout);
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

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050a0c}body{position:relative}#game-root{position:absolute;inset:0;width:100%;height:100%;overflow:visible;background:#050a0c;transform-origin:0 0;will-change:transform}</style></head><body><div id="game-root"></div><script type="module">${js}</script><script id="${SOURCE_MARKER}" type="application/json">${encodedSource}</script></body></html>`;
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
