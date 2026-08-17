import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_MARKER = "crowdclaw-source";
const MAX_SOURCE_CHARS = 100_000;

export function validateGameSource(source: string): string[] {
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
  if (imports.some((value) => value !== "tradjs/client"))
    issues.push("only tradjs/client may be imported");
  return issues;
}

export async function compileGameHtml(source: string): Promise<string> {
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
      `import mount from "./game.tsx";\nconst cleanup = mount();\naddEventListener("pagehide", () => { if (typeof cleanup === "function") cleanup(); }, { once: true });\n`,
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
