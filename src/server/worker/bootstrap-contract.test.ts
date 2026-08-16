import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dir, "../../..");

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

describe("embedded worker bootstrap contract", () => {
  test("project creation can bootstrap and wake the worker", () => {
    const route = source("app/api/projects/route.ts");
    expect(route).toContain("ensureAgentWorker()");
    expect(route).toContain("wakeAgentWorker()");
  });

  test("root middleware bootstraps embedded worker for TradJS CLI startup", () => {
    const middleware = source("app/middleware.ts");
    expect(middleware).toContain("ensureAgentWorker()");
  });

  test("wake self-starts an embedded worker instead of silently returning", () => {
    const worker = source("src/server/worker/worker.ts");
    const wake = worker.slice(
      worker.indexOf("export function wakeAgentWorker"),
      worker.indexOf("export function stopAgentWorker"),
    );
    expect(wake).toContain("if (!started)");
    expect(wake).toContain("ensureAgentWorker()");
    expect(wake).not.toContain("if (!started) return;");
  });

  test("custom server starts worker before awaiting TradJS serve", () => {
    const server = source("server.ts");
    expect(server.indexOf("ensureAgentWorker()")).toBeLessThan(
      server.indexOf("await serve("),
    );
  });
});
