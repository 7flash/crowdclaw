import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const DEFAULT_TIMEOUT_MS = 8_000;
const CHROMIUM_CANDIDATES = [
  process.env.CROWDCLAW_CHROMIUM_PATH || "",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter(Boolean);

function chromiumExecutable(): string {
  const path = CHROMIUM_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(
      "runtime validation requires Chromium; set CROWDCLAW_CHROMIUM_PATH or install /usr/bin/chromium",
    );
  }
  return path;
}

type RuntimeSnapshot = {
  hasRoot: boolean;
  visibleChildren: number;
  canvases: number;
  runtimeError: string;
};

async function snapshot(
  page: import("playwright-core").Page,
): Promise<RuntimeSnapshot> {
  return page.evaluate(() => {
    const root = document.getElementById("game-root");
    const runtimeError = root?.querySelector<HTMLElement>(
      "[data-crowdclaw-runtime-error]",
    );
    const visibleChildren = root
      ? Array.from(root.children).filter((node) => {
          const element = node as HTMLElement;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        }).length
      : 0;
    return {
      hasRoot: Boolean(root),
      visibleChildren,
      canvases: root?.querySelectorAll("canvas").length || 0,
      runtimeError: runtimeError?.textContent?.trim() || "",
    };
  });
}

function assertHealthy(
  state: RuntimeSnapshot,
  errors: string[],
  phase: string,
) {
  if (state.runtimeError) {
    throw new Error(
      `${phase} runtime validation failed: ${state.runtimeError.replace(/\s+/g, " ").slice(0, 500)}`,
    );
  }
  if (errors.length) {
    throw new Error(
      `${phase} runtime validation failed: ${errors.join(" | ").slice(0, 500)}`,
    );
  }
  if (!state.hasRoot || state.visibleChildren < 1) {
    throw new Error(
      `${phase} runtime validation failed: mount() left no visible game DOM`,
    );
  }
}

export async function validateGameRuntime(html: string): Promise<void> {
  if (process.env.CROWDCLAW_RUNTIME_VALIDATION === "0") return;

  const browser = await chromium.launch({
    executablePath: chromiumExecutable(),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 760 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.setContent(html, {
      waitUntil: "load",
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await page.waitForTimeout(450);
    assertHealthy(await snapshot(page), errors, "initial mount");

    await page.evaluate(() => {
      const restart = (
        globalThis as typeof globalThis & {
          __crowdclawRestart?: () => void;
        }
      ).__crowdclawRestart;
      if (typeof restart !== "function") {
        throw new Error("CrowdClaw restart hook is missing");
      }
      restart();
    });
    await page.waitForTimeout(350);
    assertHealthy(await snapshot(page), errors, "restart");
  } finally {
    await browser.close();
  }
}
