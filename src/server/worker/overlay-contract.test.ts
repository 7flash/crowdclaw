import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("legacy overlay safety", () => {
  test("root middleware cannot bootstrap the retired shared worker", () => {
    const source = readFileSync("app/middleware.ts", "utf8");
    expect(source).not.toContain("ensureAgentWorker(");
    expect(source).not.toContain("workerLeaseMs");
  });

  test("legacy worker path is a tombstone", () => {
    const source = readFileSync("src/server/worker/worker.ts", "utf8");
    expect(source).toContain("bgrun-managed");
    expect(source).not.toContain("setInterval(");
    expect(source).not.toContain("workerLeaseMs");
    expect(source).not.toContain("planProject(");
    expect(source).not.toContain("buildNext(");
  });
});
